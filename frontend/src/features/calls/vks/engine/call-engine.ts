import { createConferenceState, type ConferenceState } from './conference-state';
import { acquireLocalCallStreamWithFallback, getDisplayMediaCompat, stopMediaStream } from './media';
import { createSfuMode, type SfuMode, type TrackSource } from './sfu-mode';
import { createSignalingClient, type SignalingClient } from './signaling';
import { createSpeakingMonitor, type SpeakingMonitor } from './speaking-monitor';
import { RT_EVENTS } from './realtime-events';
import type {
  CallEngineEvents,
  CallEngineOptions,
  JoinRoomAck,
  LocalMediaSnapshot,
  NewProducerEvent,
  PeerLabel,
  PeerMediaStatePayload,
  ProducerInfo,
  RemoteMediaHint,
  RemoteParticipant,
  StateDeltaPayload,
} from './types';

// Mesh scales quadratically in both upload bandwidth and CPU, but this project
// can run multiple backend instances without a shared SFU state. In that setup
// auto-switching to SFU at 3 peers splits participants by instance (each user
// ends up seeing only local producers). Keep mesh by default and allow opt-in
// via env when deployment guarantees sticky sessions / shared SFU.
const resolveSfuSwitchPeerCount = () => {
  const raw = Number(import.meta.env.VITE_VKS_SFU_SWITCH_PEER_COUNT ?? 99);
  if (!Number.isFinite(raw) || raw < 3) return 99;
  return Math.trunc(raw);
};
const SFU_SWITCH_PEER_COUNT = resolveSfuSwitchPeerCount();
const PEER_DISCONNECT_GRACE_MS = 4000;
type CallMode = 'mesh' | 'switching' | 'sfu';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

type EventMap = {
  [K in keyof CallEngineEvents]: Set<CallEngineEvents[K]>;
};

function normalizeRemoteMediaHint(hint: Partial<PeerMediaStatePayload> | null | undefined): RemoteMediaHint {
  const audioEnabled = typeof hint?.audioEnabled === 'boolean' ? hint.audioEnabled : true;
  const videoEnabled = Boolean(hint?.videoEnabled);
  const cameraEnabled =
    typeof hint?.cameraEnabled === 'boolean' ? hint.cameraEnabled : Boolean(hint?.videoEnabled);
  const screenSharing = Boolean(hint?.screenSharing);
  const primary =
    hint?.primaryVideoSource === 'screen' ||
    hint?.primaryVideoSource === 'camera' ||
    hint?.primaryVideoSource === 'none'
      ? hint.primaryVideoSource
      : screenSharing
        ? 'screen'
        : videoEnabled
          ? 'camera'
          : 'none';
  return {
    audioEnabled,
    videoEnabled,
    cameraEnabled,
    screenSharing,
    primaryVideoSource: primary,
    screenTrackId: hint?.screenTrackId ?? null,
    cameraTrackId: hint?.cameraTrackId ?? null,
    streamRef: typeof hint?.streamRef === 'string' ? hint.streamRef : null,
  };
}

function areHintsEqual(a: RemoteMediaHint, b: RemoteMediaHint): boolean {
  return (
    a.audioEnabled === b.audioEnabled &&
    a.videoEnabled === b.videoEnabled &&
    a.cameraEnabled === b.cameraEnabled &&
    a.screenSharing === b.screenSharing &&
    a.primaryVideoSource === b.primaryVideoSource &&
    a.screenTrackId === b.screenTrackId &&
    a.cameraTrackId === b.cameraTrackId &&
    a.streamRef === b.streamRef
  );
}

export type CallEngine = {
  start: () => Promise<void>;
  leave: () => Promise<void>;
  shutdown: () => Promise<void>;
  toggleMic: () => void;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  kickPeer: (peerId: string) => Promise<void>;
  getRoomId: () => string;
  getParticipants: () => RemoteParticipant[];
  getLocalMedia: () => LocalMediaSnapshot;
  getPeerLabels: () => Map<string, PeerLabel>;
  getCallChatHistory: (limit?: number) => Promise<unknown[]>;
  sendCallChatMessage: (text: string) => Promise<unknown>;
  onCallChatMessage: (handler: (message: unknown) => void) => () => void;
  on: <K extends keyof CallEngineEvents>(event: K, handler: CallEngineEvents[K]) => () => void;
};

export function createCallEngine(options: CallEngineOptions): CallEngine {
  const iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
  const rtcConfig: RTCConfiguration = { iceServers };
  const signaling: SignalingClient = createSignalingClient({
    baseUrl: options.baseUrl,
    authToken: options.authToken,
  });
  const conferenceState: ConferenceState = createConferenceState();
  const speaker: SpeakingMonitor = createSpeakingMonitor();

  const listeners: EventMap = {
    participants: new Set(),
    localMedia: new Set(),
    activeSpeaker: new Set(),
    activeSpeakers: new Set(),
    connectionState: new Set(),
    error: new Set(),
    peerLabels: new Set(),
    kicked: new Set(),
  };
  const callChatListeners = new Set<(message: unknown) => void>();

  signaling.on<unknown>(RT_EVENTS.CALL_CHAT_MESSAGE, (message) => {
    for (const listener of callChatListeners) {
      listener(message);
    }
  });

  const emit = <K extends keyof CallEngineEvents>(
    event: K,
    ...args: Parameters<CallEngineEvents[K]>
  ) => {
    for (const handler of listeners[event]) {
      (handler as (...a: Parameters<CallEngineEvents[K]>) => void)(...args);
    }
  };

  const peerConnections = new Map<string, RTCPeerConnection>();
  const pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  const pendingRenegotiation = new Set<string>();
  const pendingRtcOffers: { fromPeerId: string; sdp: RTCSessionDescriptionInit }[] = [];
  const screenShareSenders = new Map<string, RTCRtpSender>();
  const remoteStreams = new Map<string, MediaStream>();
  const remoteMediaState = new Map<string, RemoteMediaHint>();
  const remoteTrackOrder = new Map<string, string[]>();
  const disconnectCleanupTimers = new Map<string, number>();
  const peerConnectionState = new Map<string, RTCPeerConnectionState>();
  const peerLabels = new Map<string, PeerLabel>();
  const seenDeltaMessageIds: string[] = [];
  const remoteSpeakingUntil = new Map<string, number>();
  let lastAnalyzerActivity: { primaryPeerId: string | null; activePeerIds: string[] } = {
    primaryPeerId: null,
    activePeerIds: [],
  };
  let lastBroadcastSpeaking = false;

  let roomId = options.roomId;
  let myPeerId: string | null = null;
  let joined = false;
  let localStream: MediaStream | null = null;
  let screenShareStream: MediaStream | null = null;
  let screenShareTrack: MediaStreamTrack | null = null;
  let isScreenSharing = false;
  let peerStatusTimer: number | null = null;
  let reconcileTimer: number | null = null;
  let mediaStateHeartbeatTimer: number | null = null;
  let conferenceSnapshotTimer: number | null = null;
  let scalabilityMode: 'full' | 'speaker-focus' = 'full';
  let cameraStreamSeq = 0;
  let screenStreamSeq = 0;
  let currentCameraStreamRef: string | null = null;
  let currentScreenStreamRef: string | null = null;
  let shutdownInvoked = false;
  let starting = false;
  let mode: CallMode = 'mesh';
  let sfu: SfuMode | null = null;
  // Tracks producerIds we've already spotted so we skip duplicates between
  // `getProducers` and the `newProducer` live event.
  const knownProducerIds = new Set<string>();

  const emitEffectiveSpeaking = () => {
    const now = Date.now();
    const remoteActivePeerIds: string[] = [];
    for (const [peerId, until] of remoteSpeakingUntil.entries()) {
      if (until > now) remoteActivePeerIds.push(peerId);
      else remoteSpeakingUntil.delete(peerId);
    }
    const effectiveActivePeerIds = [...new Set([...lastAnalyzerActivity.activePeerIds, ...remoteActivePeerIds])];
    if (effectiveActivePeerIds.length > 0) {
      const primaryPeerId = effectiveActivePeerIds.includes(lastAnalyzerActivity.primaryPeerId ?? '')
        ? (lastAnalyzerActivity.primaryPeerId as string)
        : effectiveActivePeerIds[0];
      emit('activeSpeaker', primaryPeerId);
      emit('activeSpeakers', effectiveActivePeerIds);
      return;
    }
    emit('activeSpeaker', lastAnalyzerActivity.primaryPeerId);
    emit('activeSpeakers', lastAnalyzerActivity.activePeerIds);
  };

  speaker.subscribe((activity) => {
    lastAnalyzerActivity = activity;
    const localSpeaking = Boolean(myPeerId && activity.activePeerIds.includes(myPeerId));
    if (joined && localSpeaking !== lastBroadcastSpeaking) {
      lastBroadcastSpeaking = localSpeaking;
      signaling.emit('peerQualityState', { speaking: localSpeaking });
    }
    emitEffectiveSpeaking();
  });

  const setPeerLabel = (label: PeerLabel) => {
    const prev = peerLabels.get(label.peerId);
    if (prev && prev.displayName === label.displayName && prev.isLocal === label.isLocal) return;
    peerLabels.set(label.peerId, label);
    emit('peerLabels', new Map(peerLabels));
  };

  const getParticipants = (): RemoteParticipant[] => {
    const list: RemoteParticipant[] = [];
    const remotePeerIds = new Set<string>();
    for (const peerId of remoteStreams.keys()) {
      remotePeerIds.add(peerId);
    }
    for (const [peerId, label] of peerLabels.entries()) {
      if (!label.isLocal) {
        remotePeerIds.add(peerId);
      }
    }
    for (const peerId of remotePeerIds) {
      const label = peerLabels.get(peerId);
      const media =
        remoteMediaState.get(peerId) ??
        normalizeRemoteMediaHint({
          audioEnabled: true,
          videoEnabled: true,
          cameraEnabled: true,
          screenSharing: false,
          primaryVideoSource: 'camera',
        });
      list.push({
        peerId,
        displayName: label?.displayName ?? fallbackPeerName(peerId),
        stream: remoteStreams.get(peerId) ?? null,
        media,
        videoTrackOrder: [...(remoteTrackOrder.get(peerId) ?? [])],
        connectionState: peerConnectionState.get(peerId) ?? 'new',
      });
    }
    // Stable sort by join order (peerId as a proxy, since backend assigns deterministically).
    list.sort((a, b) => a.peerId.localeCompare(b.peerId));
    return list;
  };

  const emitParticipants = () => emit('participants', getParticipants());

  const getLocalMedia = (): LocalMediaSnapshot => {
    const audioTrack = localStream?.getAudioTracks()[0] ?? null;
    const videoTrack = localStream?.getVideoTracks()[0] ?? null;
    return {
      stream: localStream,
      micEnabled: Boolean(audioTrack?.enabled && audioTrack.readyState === 'live'),
      cameraEnabled: Boolean(videoTrack?.enabled && videoTrack.readyState === 'live'),
      screenSharing: isScreenSharing,
      screenStream: screenShareStream,
    };
  };

  const emitLocalMedia = () => emit('localMedia', getLocalMedia());

  const applyRemoteMediaHint = (
    peerId: string,
    hint: Partial<PeerMediaStatePayload>,
    source: 'socket:peerMediaState' | 'socket:peerMediaStateChanged' | 'snapshot' | 'poll' | 'join-ack',
  ) => {
    const key = String(peerId);
    if (!key) return;
    const normalized = normalizeRemoteMediaHint(hint);
    const prev = remoteMediaState.get(key);
    if (prev && areHintsEqual(prev, normalized)) return;
    remoteMediaState.set(key, normalized);
    speaker.setMicLive(key, normalized.audioEnabled);
    normalizeRemoteVideoTracksForPeer(key);
    if (mediaDebugEnabled) {
      const stream = remoteStreams.get(key);
      const tracks = (stream?.getVideoTracks() ?? []).map((t) => {
        const settings = typeof t.getSettings === 'function' ? t.getSettings() : {};
        const ds = String((settings as { displaySurface?: string }).displaySurface ?? '');
        return `${t.id}|${t.label || 'no-label'}|${t.readyState}|en=${t.enabled}|muted=${t.muted}|ds=${ds}`;
      });
      // eslint-disable-next-line no-console
      console.debug('[vks/media]', source, {
        peerId: key,
        hint: normalized,
        trackOrder: remoteTrackOrder.get(key) ?? [],
        tracks,
      });
    }
    emitParticipants();
  };

  const syncSpeakerBindingForPeer = (peerId: string) => {
    const stream = remoteStreams.get(peerId);
    if (!stream) {
      speaker.unbind(peerId);
      return;
    }
    const hasLiveAudio = stream.getAudioTracks().some((track) => track.readyState === 'live');
    if (!hasLiveAudio) {
      speaker.unbind(peerId);
      return;
    }
    void speaker.bind(peerId, stream);
    const hint = remoteMediaState.get(peerId);
    if (hint) {
      speaker.setMicLive(peerId, Boolean(hint.audioEnabled));
    }
  };

  const applyPeerDirectory = (rows: Array<{
    peerId?: string;
    user?: { id?: number | string; username?: string | null; guestName?: string | null } | null;
    guestName?: string | null;
  }>) => {
    for (const row of rows ?? []) {
      if (!row?.peerId) continue;
      const display =
        row.user?.username?.trim() ||
        row.user?.guestName?.trim() ||
        row.guestName?.trim() ||
        fallbackPeerName(row.peerId);
      setPeerLabel({
        peerId: row.peerId,
        displayName: display,
        isLocal: row.peerId === myPeerId,
        userId: row.user?.id ?? null,
      });
    }
  };

  const log = (_msg: string) => {
    // Minimal logger; replace with proper debug channel when needed.
  };
  const mediaDebugEnabled =
    typeof window !== 'undefined' &&
    (window.localStorage.getItem('vks:media-debug') === '1' ||
      window.localStorage.getItem('vks:media-debug') === 'true');

  // ----- WebRTC / peer-mesh -----

  const getLocalCameraTrack = (): MediaStreamTrack | null => {
    return localStream?.getVideoTracks()[0] ?? null;
  };

  const scoreTrackAsScreen = (track: MediaStreamTrack): number => {
    const label = String(track.label || '').toLowerCase();
    const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
    const displaySurface = String((settings as { displaySurface?: string }).displaySurface || '').toLowerCase();
    const contentHint = String(track.contentHint || '').toLowerCase();
    const width = Number((settings as { width?: number }).width || 0);
    const height = Number((settings as { height?: number }).height || 0);
    const area = width > 0 && height > 0 ? width * height : 0;
    let score = 0;
    if (displaySurface) score += 10000;
    if (displaySurface === 'monitor' || displaySurface === 'window' || displaySurface === 'browser') score += 5000;
    if (
      label.includes('screen') ||
      label.includes('display') ||
      label.includes('window') ||
      label.includes('monitor') ||
      label.includes('tab')
    ) {
      score += 2500;
    }
    if (contentHint === 'detail' || contentHint === 'text') score += 1200;
    if (track.enabled === false) score -= 7000;
    if (track.muted) score -= 4500;
    score += Math.min(Math.round(area / 100000), 120);
    return score;
  };

  const normalizeRemoteVideoTracksForPeer = (peerId: string) => {
    const stream = remoteStreams.get(peerId);
    if (!stream) return;
    const reported = remoteMediaState.get(peerId) ?? null;
    const orderedIds = remoteTrackOrder.get(peerId) ?? [];
    const videoTracks = stream.getVideoTracks().filter((track) => track.readyState === 'live');
    if (videoTracks.length <= 1) return;

    const byId = new Map(videoTracks.map((track) => [track.id, track]));
    const orderedTracks = orderedIds
      .map((id) => byId.get(id) ?? null)
      .filter((track): track is MediaStreamTrack => track !== null);
    for (const track of videoTracks) {
      if (!orderedTracks.some((candidate) => candidate.id === track.id)) {
        orderedTracks.push(track);
      }
    }

    const pickLikelyScreenTrack = (candidates: MediaStreamTrack[]) => {
      if (!candidates.length) return null;
      let best = candidates[0];
      let bestScore = scoreTrackAsScreen(best);
      for (const track of candidates) {
        const current = scoreTrackAsScreen(track);
        if (current > bestScore) {
          best = track;
          bestScore = current;
        }
      }
      return best;
    };
    const pickLikelyCameraTrack = (candidates: MediaStreamTrack[]) => {
      if (!candidates.length) return null;
      let best = candidates[0];
      let bestScore = scoreTrackAsScreen(best);
      for (const track of candidates) {
        const current = scoreTrackAsScreen(track);
        if (current < bestScore) {
          best = track;
          bestScore = current;
        }
      }
      return best;
    };

    const cameraById = reported?.cameraTrackId ? byId.get(reported.cameraTrackId) ?? null : null;
    const newestTrack = orderedTracks[orderedTracks.length - 1] ?? videoTracks[videoTracks.length - 1] ?? null;
    const keepIds = new Set<string>();
    if (reported?.screenSharing) {
      const shareTrack = pickLikelyScreenTrack(orderedTracks) ?? newestTrack;
      if (shareTrack) keepIds.add(shareTrack.id);
      if (reported.cameraEnabled) {
        const cameraTrack =
          cameraById ??
          pickLikelyCameraTrack(orderedTracks.filter((track) => track.id !== shareTrack?.id)) ??
          [...orderedTracks].find((track) => track.id !== shareTrack?.id) ??
          null;
        if (cameraTrack) keepIds.add(cameraTrack.id);
      }
    } else {
      const cameraTrack = cameraById ?? pickLikelyCameraTrack(orderedTracks) ?? newestTrack;
      if (cameraTrack) keepIds.add(cameraTrack.id);
    }
    if (keepIds.size === 0) return;

    for (const track of videoTracks) {
      if (keepIds.has(track.id)) continue;
      try {
        stream.removeTrack(track);
      } catch {
        /* best-effort */
      }
    }
    remoteTrackOrder.set(
      peerId,
      (remoteTrackOrder.get(peerId) ?? []).filter((id) => keepIds.has(id)),
    );
  };

  const ensurePeerConnection = (peerId: string): RTCPeerConnection => {
    const existing = peerConnections.get(peerId);
    if (existing) return existing;
    if (!localStream) throw new Error('Cannot create peer connection before local stream');

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionState.set(peerId, 'new');

    const audioTrack = localStream.getAudioTracks()[0] ?? null;
    const cameraTrack = getLocalCameraTrack();
    if (audioTrack) pc.addTrack(audioTrack, localStream);
    if (isScreenSharing && screenShareTrack && screenShareStream) {
      // Keep parity with vks: during sharing, primary video sender carries
      // screen, optional extra sender carries camera PiP.
      pc.addTrack(screenShareTrack, screenShareStream);
      if (
        cameraTrack &&
        cameraTrack.id !== screenShareTrack.id &&
        cameraTrack.readyState === 'live' &&
        cameraTrack.enabled
      ) {
        const cameraExtraSender = pc.addTrack(cameraTrack, localStream);
        screenShareSenders.set(peerId, cameraExtraSender);
      } else {
        screenShareSenders.delete(peerId);
      }
    } else if (cameraTrack) {
      pc.addTrack(cameraTrack, localStream);
    }

    pc.ontrack = (event) => {
      let stream = remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        remoteStreams.set(peerId, stream);
      }
      if (!stream.getTracks().some((t) => t.id === event.track.id)) {
        stream.addTrack(event.track);
      }
      if (event.track.kind === 'video') {
        const order = remoteTrackOrder.get(peerId) ?? [];
        if (!order.includes(event.track.id)) {
          order.push(event.track.id);
          remoteTrackOrder.set(peerId, order);
        }
        normalizeRemoteVideoTracksForPeer(peerId);
      }
      event.track.addEventListener('ended', () => {
        const latest = remoteStreams.get(peerId);
        if (!latest) return;
        const stale = latest.getTracks().find((t) => t.id === event.track.id);
        if (stale) latest.removeTrack(stale);
        if (event.track.kind === 'video') {
          const ord = remoteTrackOrder.get(peerId) ?? [];
          remoteTrackOrder.set(
            peerId,
            ord.filter((id) => id !== event.track.id),
          );
        }
        emitParticipants();
      });
      if (!peerLabels.has(peerId)) {
        setPeerLabel({
          peerId,
          displayName: fallbackPeerName(peerId),
          isLocal: false,
          userId: null,
        });
      }
      syncSpeakerBindingForPeer(peerId);
      emitParticipants();
    };

    pc.onicecandidate = async (event) => {
      if (!event.candidate) return;
      try {
        await signaling.emitWithAck(RT_EVENTS.RTC_ICE, {
          targetPeerId: peerId,
          candidate: event.candidate,
        });
      } catch (error) {
        log(`ICE send error: ${(error as Error).message}`);
      }
    };

    pc.onconnectionstatechange = () => {
      peerConnectionState.set(peerId, pc.connectionState);
      emitParticipants();
      if (pc.connectionState === 'failed') {
        const pending = disconnectCleanupTimers.get(peerId);
        if (pending) {
          window.clearTimeout(pending);
          disconnectCleanupTimers.delete(peerId);
        }
        cleanupRemoteByPeer(peerId);
        return;
      }
      if (pc.connectionState === 'disconnected') {
        const prev = disconnectCleanupTimers.get(peerId);
        if (prev) window.clearTimeout(prev);
        const timerId = window.setTimeout(() => {
          disconnectCleanupTimers.delete(peerId);
          if (peerConnections.get(peerId) !== pc) return;
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            cleanupRemoteByPeer(peerId);
          }
        }, PEER_DISCONNECT_GRACE_MS);
        disconnectCleanupTimers.set(peerId, timerId);
        return;
      }
      if (pc.connectionState === 'connected') {
        void broadcastMyMediaState();
        const prev = disconnectCleanupTimers.get(peerId);
        if (prev) {
          window.clearTimeout(prev);
          disconnectCleanupTimers.delete(peerId);
        }
      }
    };

    pc.onsignalingstatechange = () => {
      if (pc.signalingState !== 'stable') return;
      if (!pendingRenegotiation.has(peerId)) return;
      void renegotiatePeer(peerId);
    };

    peerConnections.set(peerId, pc);
    return pc;
  };

  const renegotiatePeer = async (peerId: string) => {
    const pc = peerConnections.get(peerId);
    if (!pc) return;
    if (pc.signalingState !== 'stable') {
      pendingRenegotiation.add(peerId);
      return;
    }
    pendingRenegotiation.delete(peerId);
    try {
      await createOffer(peerId);
    } catch (error) {
      pendingRenegotiation.add(peerId);
      log(`renegotiation error: ${(error as Error).message}`);
    }
  };

  const createOffer = async (peerId: string) => {
    const pc = ensurePeerConnection(peerId);
    const senders = pc.getSenders();
    const sendingAudio = senders.some((s) => s.track && s.track.kind === 'audio');
    const sendingVideo = senders.some((s) => s.track && s.track.kind === 'video');
    if (!sendingAudio) pc.addTransceiver('audio', { direction: 'recvonly' });
    if (!sendingVideo) pc.addTransceiver('video', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await signaling.emitWithAck(RT_EVENTS.RTC_OFFER, { targetPeerId: peerId, sdp: offer });
  };

  const flushPendingCandidates = async (peerId: string) => {
    const pc = peerConnections.get(peerId);
    if (!pc || !pc.remoteDescription) return;
    const queue = pendingCandidates.get(peerId) || [];
    while (queue.length) {
      const candidate = queue.shift();
      if (!candidate) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        log(`ICE add error: ${(error as Error).message}`);
      }
    }
    pendingCandidates.set(peerId, queue);
  };

  const handleRtcOffer = async (payload: { fromPeerId: string; sdp: RTCSessionDescriptionInit }) => {
    const peerId = payload.fromPeerId;
    const pc = ensurePeerConnection(peerId);
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    await flushPendingCandidates(peerId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await signaling.emitWithAck(RT_EVENTS.RTC_ANSWER, {
      targetPeerId: peerId,
      sdp: answer,
    });
  };

  const cleanupRemoteByPeer = (peerId: string) => {
    const timer = disconnectCleanupTimers.get(peerId);
    if (timer) {
      window.clearTimeout(timer);
      disconnectCleanupTimers.delete(peerId);
    }
    const pc = peerConnections.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.delete(peerId);
    }
    screenShareSenders.delete(peerId);
    remoteTrackOrder.delete(peerId);
    pendingCandidates.delete(peerId);
    pendingRenegotiation.delete(peerId);
    remoteStreams.delete(peerId);
    remoteMediaState.delete(peerId);
    remoteSpeakingUntil.delete(peerId);
    peerConnectionState.delete(peerId);
    speaker.unbind(peerId);
    peerLabels.delete(peerId);
    emit('peerLabels', new Map(peerLabels));
    emitEffectiveSpeaking();
    emitParticipants();
  };

  const cleanupAll = () => {
    stopPeerStatusPolling();
    stopReconcileLoop();
    stopMediaStateHeartbeat();
    stopConferenceSnapshotSync();
    if (sfu) {
      try {
        sfu.stop();
      } catch {
        /* ignore */
      }
      sfu = null;
    }
    for (const pc of peerConnections.values()) pc.close();
    peerConnections.clear();
    pendingCandidates.clear();
    pendingRenegotiation.clear();
    pendingRtcOffers.length = 0;
    screenShareSenders.clear();
    remoteTrackOrder.clear();
    for (const t of disconnectCleanupTimers.values()) window.clearTimeout(t);
    disconnectCleanupTimers.clear();
    speaker.reset();
    stopMediaStream(localStream);
    localStream = null;
    setLocalSharePreview(false);
    screenShareTrack = null;
    screenShareStream = null;
    isScreenSharing = false;
    currentCameraStreamRef = null;
    currentScreenStreamRef = null;
    remoteStreams.clear();
    remoteMediaState.clear();
    peerConnectionState.clear();
    peerLabels.clear();
    knownProducerIds.clear();
    remoteSpeakingUntil.clear();
    lastAnalyzerActivity = { primaryPeerId: null, activePeerIds: [] };
    lastBroadcastSpeaking = false;
    mode = 'mesh';
    emit('peerLabels', new Map(peerLabels));
    emitLocalMedia();
    emitParticipants();
  };

  // ----- Screen share -----

  const setLocalSharePreview = (_enabled: boolean) => {
    emitLocalMedia();
  };

  const addScreenShareSenders = async () => {
    if (!screenShareTrack || !screenShareStream) return;
    for (const [peerId, pc] of peerConnections.entries()) {
      // Keep parity with vks/client: during share, primary video sender carries
      // screen, and the extra sender carries camera PiP.
      const extraSender = screenShareSenders.get(peerId) ?? null;
      let primaryVideoSender =
        pc.getSenders().find((sender) => sender.track?.kind === 'video' && sender !== extraSender) ??
        null;
      if (!primaryVideoSender) {
        primaryVideoSender = pc.addTrack(screenShareTrack, screenShareStream);
      } else {
        try {
          if (primaryVideoSender.track?.id !== screenShareTrack.id) {
            await primaryVideoSender.replaceTrack(screenShareTrack);
          }
        } catch {
          /* ignore */
        }
      }
      if (!screenShareSenders.has(peerId) && localStream) {
        const localCameraTrack = getLocalCameraTrack();
        if (
          localCameraTrack &&
          localCameraTrack.id !== screenShareTrack.id &&
          localCameraTrack.readyState === 'live' &&
          localCameraTrack.enabled
        ) {
          const sender = pc.addTrack(localCameraTrack, localStream);
          screenShareSenders.set(peerId, sender);
        }
      }
      await renegotiatePeer(peerId);
    }
  };

  const removeScreenShareSenders = async () => {
    for (const [peerId, pc] of peerConnections.entries()) {
      // Keep parity with vks/client: hard reset all video senders on share stop.
      const videoSenders = pc.getSenders().filter((sender) => sender.track?.kind === 'video');
      for (const sender of videoSenders) {
        try {
          pc.removeTrack(sender);
        } catch {
          /* ignore */
        }
      }
      screenShareSenders.delete(peerId);
      const localCameraTrack = getLocalCameraTrack();
      if (localCameraTrack && localStream && localCameraTrack.readyState === 'live' && localCameraTrack.enabled) {
        pc.addTrack(localCameraTrack, localStream);
      }
      await renegotiatePeer(peerId);
    }
    screenShareSenders.clear();
  };

  const syncScreenShareCameraSenders = async () => {
    if (!isScreenSharing || !screenShareTrack || !localStream) return;
    const localCameraTrack = getLocalCameraTrack();
    const canSendCameraTrack = Boolean(
      localCameraTrack &&
        localCameraTrack.readyState === 'live' &&
        localCameraTrack.enabled &&
        localCameraTrack.id !== screenShareTrack.id,
    );
    for (const [peerId, pc] of peerConnections.entries()) {
      const extraSender = screenShareSenders.get(peerId) ?? null;
      if (canSendCameraTrack && !extraSender) {
        const sender = pc.addTrack(localCameraTrack as MediaStreamTrack, localStream);
        screenShareSenders.set(peerId, sender);
        await renegotiatePeer(peerId);
        continue;
      }
      if (!canSendCameraTrack && extraSender) {
        try {
          pc.removeTrack(extraSender);
        } catch {
          /* ignore */
        }
        screenShareSenders.delete(peerId);
        await renegotiatePeer(peerId);
      }
    }
  };

  const nextCameraStreamRef = () => {
    cameraStreamSeq += 1;
    return `camera:${myPeerId ?? 'local'}:${cameraStreamSeq}`;
  };

  const nextScreenStreamRef = () => {
    screenStreamSeq += 1;
    return `screen:${myPeerId ?? 'local'}:${screenStreamSeq}`;
  };

  // ----- Broadcast -----

  const broadcastMyMediaState = async () => {
    if (!joined || !localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    const cameraTrack = getLocalCameraTrack();
    const audioEnabled = Boolean(audioTrack && audioTrack.enabled);
    if (myPeerId) {
      speaker.setMicLive(myPeerId, audioEnabled);
    }
    const cameraTrackEnabled = Boolean(
      cameraTrack && cameraTrack.enabled && cameraTrack.readyState === 'live',
    );
    const screenEnabled = Boolean(
      isScreenSharing &&
        screenShareTrack &&
        screenShareTrack.readyState === 'live' &&
        screenShareTrack.enabled,
    );
    const hasSfuCameraProducer = Boolean(
      mode === 'sfu' && sfu?.getProducer('camera') && !sfu.getProducer('camera')?.paused,
    );
    const hasMeshCameraPipSender = (() => {
      if (mode !== 'mesh' || !screenEnabled || !cameraTrack) return false;
      // While screen sharing in mesh mode, camera is only visible remotely if
      // an extra sender carrying the camera track is attached.
      for (const pc of peerConnections.values()) {
        const hasCameraSender = pc
          .getSenders()
          .some((sender) => sender.track?.kind === 'video' && sender.track.id === cameraTrack.id);
        if (hasCameraSender) return true;
      }
      return false;
    })();
    const cameraEnabled = screenEnabled
      ? Boolean(
          cameraTrackEnabled &&
            (mode === 'sfu'
              ? hasSfuCameraProducer
              : hasMeshCameraPipSender),
        )
      : cameraTrackEnabled;
    const videoEnabled = cameraEnabled || screenEnabled;
    const primaryVideoSource = screenEnabled ? 'screen' : cameraEnabled ? 'camera' : 'none';
    const activeStreamRef =
      primaryVideoSource === 'screen'
        ? currentScreenStreamRef
        : cameraEnabled
          ? currentCameraStreamRef
          : null;
    const payload: PeerMediaStatePayload = {
      audioEnabled,
      videoEnabled,
      cameraEnabled,
      screenSharing: screenEnabled,
      primaryVideoSource,
      streamRef: activeStreamRef,
      screenTrackId: isScreenSharing ? screenShareTrack?.id ?? null : null,
      cameraTrackId: cameraTrack?.id ?? null,
    };
    try {
      const ack = await signaling.emitWithAck<{ version?: number }>(RT_EVENTS.STATE_PATCH, payload);
      if (typeof ack?.version === 'number' && Number.isFinite(ack.version)) {
        conferenceState.applyPatch({
          peerId: myPeerId || 'local',
          version: ack.version,
          patch: payload,
        });
      }
    } catch {
      /* ignore — ack errors are non-fatal */
    }
  };

  // ----- Polling / reconcile -----

  const pollPeerStatuses = async () => {
    if (!joined || !roomId) return;
    try {
      const response = await fetch(
        `${options.baseUrl}/api/rooms/${encodeURIComponent(roomId)}/peer-status`,
        { method: 'GET', cache: 'no-store' },
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        peers?: Array<{ peerId?: string; media?: Partial<PeerMediaStatePayload> | null }>;
      };
      const nextMode = (payload.peers?.length ?? 0) + 1 > 12 ? 'speaker-focus' : 'full';
      scalabilityMode = nextMode;
      // Polling is a rare fallback now: any mismatch triggers full snapshot
      // resync instead of mutating local state from a competing source.
      const remoteCount = payload.peers?.length ?? 0;
      const localCount = remoteStreams.size;
      if (Math.abs(remoteCount - localCount) > 0) {
        signaling.emit(RT_EVENTS.STATE_RESYNC_REQUEST, { roomId });
        void syncConferenceSnapshot();
      }
    } catch {
      /* polling is best-effort */
    }
  };

  const startPeerStatusPolling = () => {
    stopPeerStatusPolling();
    peerStatusTimer = window.setInterval(() => {
      void pollPeerStatuses();
    }, 15000);
  };

  const stopPeerStatusPolling = () => {
    if (peerStatusTimer) {
      window.clearInterval(peerStatusTimer);
      peerStatusTimer = null;
    }
  };

  const reconcileMediaState = () => {
    if (!joined) return;
    let needSnapshot = false;
    for (const [peerId, reported] of remoteMediaState.entries()) {
      const stream = remoteStreams.get(peerId);
      if (!stream) continue;
      const liveVideos = stream.getVideoTracks().filter((t) => t.readyState === 'live');
      const expectsVideo = Boolean(reported.screenSharing || reported.cameraEnabled);
      if (expectsVideo && liveVideos.length === 0) {
        needSnapshot = true;
        break;
      }
    }
    if (needSnapshot) void syncConferenceSnapshot();
  };

  const startReconcileLoop = () => {
    stopReconcileLoop();
    reconcileTimer = window.setInterval(() => reconcileMediaState(), 3000);
  };

  const stopReconcileLoop = () => {
    if (reconcileTimer) {
      window.clearInterval(reconcileTimer);
      reconcileTimer = null;
    }
  };

  const startMediaStateHeartbeat = () => {
    stopMediaStateHeartbeat();
    mediaStateHeartbeatTimer = window.setInterval(() => {
      void broadcastMyMediaState();
    }, 1200);
  };

  const stopMediaStateHeartbeat = () => {
    if (mediaStateHeartbeatTimer) {
      window.clearInterval(mediaStateHeartbeatTimer);
      mediaStateHeartbeatTimer = null;
    }
  };

  const startConferenceSnapshotSync = () => {
    stopConferenceSnapshotSync();
    conferenceSnapshotTimer = window.setInterval(() => {
      void syncConferenceSnapshot();
    }, 20000);
  };

  const stopConferenceSnapshotSync = () => {
    if (conferenceSnapshotTimer) {
      window.clearInterval(conferenceSnapshotTimer);
      conferenceSnapshotTimer = null;
    }
  };

  const syncConferenceSnapshot = async () => {
    if (!joined) return;
    try {
      const res = await signaling.emitWithAck<{ snapshot?: JoinRoomAck['snapshot'] }>(
        RT_EVENTS.STATE_SNAPSHOT_GET,
      );
      if (!res?.snapshot) return;
      conferenceState.applySnapshot(res.snapshot);
      for (const peer of res.snapshot.peers ?? []) {
        if (!peer?.peerId || peer.peerId === myPeerId) continue;
        applyRemoteMediaHint(peer.peerId, {
          audioEnabled: Boolean(peer.mic?.enabled),
          videoEnabled: Boolean(peer.camera?.enabled || peer.screen?.enabled),
          cameraEnabled: Boolean(peer.camera?.enabled),
          screenSharing: Boolean(peer.screen?.enabled),
          primaryVideoSource: peer.screen?.enabled
            ? 'screen'
            : peer.camera?.enabled
              ? 'camera'
              : 'none',
          streamRef: peer.screen?.enabled
            ? peer.screen?.streamRef ?? null
            : peer.camera?.streamRef ?? null,
          screenTrackId: peer.screen?.trackRef ?? null,
          cameraTrackId: peer.camera?.trackRef ?? null,
        }, 'snapshot');
      }
    } catch {
      /* best-effort */
    }
  };

  const applyAdaptiveTrackLimits = async () => {
    if (scalabilityMode !== 'speaker-focus') return;
    const cameraTrack = getLocalCameraTrack();
    if (cameraTrack?.applyConstraints) {
      try {
        await cameraTrack.applyConstraints({
          width: { ideal: 640, max: 960 },
          height: { ideal: 360, max: 540 },
          frameRate: { ideal: 12, max: 15 },
        });
      } catch {
        /* best-effort */
      }
    }
    if (screenShareTrack?.applyConstraints) {
      try {
        await screenShareTrack.applyConstraints({ frameRate: { ideal: 10, max: 12 } });
      } catch {
        /* best-effort */
      }
    }
  };

  // ----- SFU mode -----

  // Returns the number of remote peers we currently know about, optionally
  // including an id that's just arrived but might not be in peerLabels yet.
  const getKnownPeerCount = (extraPeerId?: string | null): number => {
    const ids = new Set<string>();
    for (const pid of peerLabels.keys()) {
      if (pid && pid !== myPeerId) ids.add(pid);
    }
    for (const pid of peerConnections.keys()) {
      if (pid && pid !== myPeerId) ids.add(pid);
    }
    if (extraPeerId && extraPeerId !== myPeerId) ids.add(extraPeerId);
    return ids.size;
  };

  const attachSfuRemoteTrack = (
    peerId: string,
    track: MediaStreamTrack,
    source: TrackSource,
  ) => {
    if (!peerId) return;
    let stream = remoteStreams.get(peerId);
    if (!stream) {
      stream = new MediaStream();
      remoteStreams.set(peerId, stream);
    }
    if (!stream.getTracks().some((t) => t.id === track.id)) {
      stream.addTrack(track);
    }
    if (track.kind === 'video') {
      const order = remoteTrackOrder.get(peerId) ?? [];
      if (!order.includes(track.id)) {
        order.push(track.id);
        remoteTrackOrder.set(peerId, order);
      }
    }
    if (!peerLabels.has(peerId)) {
      setPeerLabel({
        peerId,
        displayName: fallbackPeerName(peerId),
        isLocal: false,
        userId: null,
      });
    }
    syncSpeakerBindingForPeer(peerId);
    peerConnectionState.set(peerId, 'connected');
    emitParticipants();
    log(`SFU: attached ${source} track for ${peerId}`);
  };

  const detachSfuRemoteTrack = (peerId: string, trackId: string) => {
    const stream = remoteStreams.get(peerId);
    if (!stream) return;
    const track = stream.getTracks().find((t) => t.id === trackId);
    if (track) stream.removeTrack(track);
    const order = remoteTrackOrder.get(peerId);
    if (order) {
      remoteTrackOrder.set(
        peerId,
        order.filter((id) => id !== trackId),
      );
    }
    emitParticipants();
  };

  const closeMeshPeerConnections = () => {
    for (const pc of peerConnections.values()) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    peerConnections.clear();
    pendingCandidates.clear();
    pendingRenegotiation.clear();
    pendingRtcOffers.length = 0;
    screenShareSenders.clear();
    for (const t of disconnectCleanupTimers.values()) window.clearTimeout(t);
    disconnectCleanupTimers.clear();
    // Remote streams from the mesh path are dropped — the SFU consumers will
    // re-populate them as tracks arrive. This makes the "switching" instant
    // from the UI perspective: the remote tile just goes blank until the
    // mediasoup consumer is ready (usually <500ms on LAN).
    remoteStreams.clear();
    remoteTrackOrder.clear();
    peerConnectionState.clear();
  };

  const switchToSfu = async (initialProducerInfos?: ProducerInfo[]): Promise<boolean> => {
    if (mode !== 'mesh') return mode === 'sfu';
    if (!joined) return false;
    mode = 'switching';
    // eslint-disable-next-line no-console
    console.debug('[vks/call] switching to SFU', {
      knownPeers: getKnownPeerCount(),
      producerInfos: initialProducerInfos?.length ?? 0,
    });
    try {
      const { rtpCapabilities } = await signaling.emitWithAck<{
        rtpCapabilities: unknown;
      }>(RT_EVENTS.SFU_GET_ROUTER_CAPS, {});
      if (!rtpCapabilities) throw new Error('Router RTP capabilities missing');
      const sfuInstance = createSfuMode(signaling, {
        onRemoteTrackAdded: (peerId, track, info) => {
          attachSfuRemoteTrack(peerId, track, info.source);
        },
        onRemoteTrackRemoved: (peerId, trackId) => {
          detachSfuRemoteTrack(peerId, trackId);
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.warn('[vks/call] SFU error', err);
        },
      });
      await sfuInstance.init(rtpCapabilities as never);
      await sfuInstance.createTransports();
      sfu = sfuInstance;

      const audioTrack = localStream?.getAudioTracks()[0] ?? null;
      const cameraTrack = getLocalCameraTrack();
      if (audioTrack) {
        await sfuInstance.publishTrack(audioTrack, 'mic');
        if (!audioTrack.enabled) await sfuInstance.pauseProducer('mic');
      }
      if (cameraTrack) {
        await sfuInstance.publishTrack(cameraTrack, 'camera');
        if (!cameraTrack.enabled) await sfuInstance.pauseProducer('camera');
      }
      if (isScreenSharing && screenShareTrack) {
        await sfuInstance.publishTrack(screenShareTrack, 'screen');
      }

      let producers = initialProducerInfos;
      if (!producers) {
        const res = await signaling.emitWithAck<{ producerInfos: ProducerInfo[] }>(
          RT_EVENTS.SFU_GET_PRODUCERS,
          {},
        );
        producers = res?.producerInfos ?? [];
      }
      for (const info of producers) {
        if (!info?.producerId) continue;
        knownProducerIds.add(info.producerId);
        await sfuInstance.consumeRemote({
          producerId: info.producerId,
          peerId: info.peerId,
          kind: info.kind,
          appData: info.appData,
        });
      }

      closeMeshPeerConnections();
      mode = 'sfu';
      emitParticipants();
      void broadcastMyMediaState();
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vks/call] switchToSfu failed', err);
      try {
        sfu?.stop();
      } catch {
        /* ignore */
      }
      sfu = null;
      mode = 'mesh';
      emit('error', (err as Error).message || 'Не удалось переключиться на SFU');
      return false;
    }
  };

  // ----- Signaling listeners -----

  signaling.on<{ peerId: string; user?: { username?: string } | null; guestName?: string | null }>(
    RT_EVENTS.ROOM_PEER_JOINED,
    async (payload) => {
      if (!payload?.peerId) return;
      const display =
        payload.user?.username?.trim() ||
        payload.guestName?.trim() ||
        fallbackPeerName(payload.peerId);
      setPeerLabel({
        peerId: payload.peerId,
        displayName: display,
        isLocal: false,
        userId: null,
      });
      if (!joined) return;
      void broadcastMyMediaState();
      // At SFU_SWITCH_PEER_COUNT participants (self + remotes) we promote the
      // call to SFU; past that point any new arrivals are served through
      // mediasoup without ever creating an RTCPeerConnection.
      const nextPeerCount = getKnownPeerCount(payload.peerId) + 1;
      if (mode !== 'mesh') return;
      if (nextPeerCount >= SFU_SWITCH_PEER_COUNT) {
        void switchToSfu();
        return;
      }
      try {
        await createOffer(payload.peerId);
      } catch (err) {
        log(`Offer error: ${(err as Error).message}`);
      }
    },
  );

  signaling.on<{ peerId: string }>(RT_EVENTS.ROOM_PEER_LEFT, (payload) => {
    if (!payload?.peerId) return;
    if (sfu) {
      sfu.removePeer(payload.peerId);
    }
    remoteSpeakingUntil.delete(payload.peerId);
    cleanupRemoteByPeer(payload.peerId);
  });

  signaling.on<{ fromPeerId: string; speaking?: boolean }>('peerQualityState', (payload) => {
    if (!joined || !payload?.fromPeerId) return;
    const peerId = String(payload.fromPeerId);
    if (peerId === myPeerId) return;
    if (payload.speaking) {
      remoteSpeakingUntil.set(peerId, Date.now() + 900);
    } else {
      remoteSpeakingUntil.delete(peerId);
    }
    emitEffectiveSpeaking();
  });

  signaling.on<NewProducerEvent>(RT_EVENTS.SFU_NEW_PRODUCER, (payload) => {
    if (!joined || !payload?.producerId || !payload?.peerId) return;
    knownProducerIds.add(payload.producerId);
    if (mode !== 'sfu' || !sfu) return;
    void sfu.consumeRemote({
      producerId: payload.producerId,
      peerId: payload.peerId,
      kind: payload.kind,
      appData: payload.appData,
    });
  });

  signaling.on<{ fromPeerId: string; sdp: RTCSessionDescriptionInit }>(
    RT_EVENTS.RTC_OFFER,
    async (payload) => {
      if (mode === 'sfu') return;
      if (!joined || !localStream) {
        pendingRtcOffers.push(payload);
        return;
      }
      try {
        await handleRtcOffer(payload);
      } catch (err) {
        log(`Offer handle error: ${(err as Error).message}`);
      }
    },
  );

  signaling.on<{ fromPeerId: string; sdp: RTCSessionDescriptionInit }>(
    RT_EVENTS.RTC_ANSWER,
    async (payload) => {
      if (mode === 'sfu') return;
      const pc = peerConnections.get(payload.fromPeerId);
      if (!pc) return;
      if (pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await flushPendingCandidates(payload.fromPeerId);
      } catch (err) {
        log(`Answer handle error: ${(err as Error).message}`);
      }
    },
  );

  signaling.on<{ fromPeerId: string; candidate: RTCIceCandidateInit }>(
    RT_EVENTS.RTC_ICE,
    async (payload) => {
      if (mode === 'sfu') return;
      const pc = peerConnections.get(payload.fromPeerId);
      if (!pc || !pc.remoteDescription) {
        const queue = pendingCandidates.get(payload.fromPeerId) || [];
        queue.push(payload.candidate);
        pendingCandidates.set(payload.fromPeerId, queue);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (err) {
        log(`ICE add error: ${(err as Error).message}`);
      }
    },
  );

  signaling.on<
    { fromPeerId: string } & Partial<PeerMediaStatePayload>
  >(RT_EVENTS.STATE_PATCH, (payload) => {
    if (!joined || !payload?.fromPeerId) return;
    applyRemoteMediaHint(String(payload.fromPeerId), payload, 'socket:peerMediaState');
  });

  signaling.on<StateDeltaPayload>(RT_EVENTS.STATE_DELTA, async (payload) => {
    if (!joined) return;
    if (payload.roomId && roomId && payload.roomId !== roomId) return;
    if (!payload.peerId || !payload.patch) return;
    if (payload.messageId) {
      if (seenDeltaMessageIds.includes(payload.messageId)) return;
      seenDeltaMessageIds.push(payload.messageId);
      if (seenDeltaMessageIds.length > 300) seenDeltaMessageIds.shift();
    }
    const result = conferenceState.applyPatch({
      peerId: String(payload.peerId),
      version: payload.version,
      patch: payload.patch,
    });
    if (result.needSnapshot) {
      signaling.emit(RT_EVENTS.STATE_RESYNC_REQUEST, { roomId });
      await syncConferenceSnapshot();
      return;
    }
    if (!result.applied) return;
    applyRemoteMediaHint(String(payload.peerId), payload.patch, 'socket:peerMediaStateChanged');
  });

  signaling.on<{ roomId?: string; snapshot?: JoinRoomAck['snapshot'] }>(
    RT_EVENTS.STATE_SNAPSHOT,
    (payload) => {
      if (!joined) return;
      if (payload.roomId && roomId && payload.roomId !== roomId) return;
      if (!payload.snapshot) return;
      conferenceState.applySnapshot(payload.snapshot);
      for (const peer of payload.snapshot.peers ?? []) {
        if (!peer?.peerId || peer.peerId === myPeerId) continue;
        applyRemoteMediaHint(peer.peerId, {
          audioEnabled: Boolean(peer.mic?.enabled),
          videoEnabled: Boolean(peer.camera?.enabled || peer.screen?.enabled),
          cameraEnabled: Boolean(peer.camera?.enabled),
          screenSharing: Boolean(peer.screen?.enabled),
          primaryVideoSource: peer.screen?.enabled
            ? 'screen'
            : peer.camera?.enabled
              ? 'camera'
              : 'none',
          streamRef: peer.screen?.enabled
            ? peer.screen?.streamRef ?? null
            : peer.camera?.streamRef ?? null,
          screenTrackId: peer.screen?.trackRef ?? null,
          cameraTrackId: peer.camera?.trackRef ?? null,
        }, 'snapshot');
      }
    },
  );

  signaling.on<{ roomId?: string; byPeerId?: string | null }>(RT_EVENTS.ROOM_KICKED, (payload) => {
    if (!joined) return;
    emit('kicked', { byPeerId: payload?.byPeerId ?? null });
    void leave();
  });

  signaling.onSocketReady(() => {
    if (joined && localStream) {
      void broadcastMyMediaState();
      void syncConferenceSnapshot();
    }
  });

  signaling.onConnectionError((err) => {
    if (joined) return;
    // eslint-disable-next-line no-console
    console.error('[vks/call] signaling connect_error', err);
    emit('error', err?.message || 'Не удалось подключиться к серверу звонков');
  });

  // ----- Public actions -----

  const start = async () => {
    if (joined) return;
    if (starting) return;
    if (shutdownInvoked) return;
    starting = true;
    emit('connectionState', 'connecting');
    try {
      // eslint-disable-next-line no-console
      console.debug('[vks/call] acquiring local media for room', roomId);
      localStream = await acquireLocalCallStreamWithFallback();
      // eslint-disable-next-line no-console
      console.debug(
        '[vks/call] got local media; tracks:',
        localStream.getTracks().map((t) => `${t.kind}:${t.readyState}`),
      );
      const audioTrack = localStream.getAudioTracks()[0] ?? null;
      const videoTrack = localStream.getVideoTracks()[0] ?? null;
      if (audioTrack && options.initialMic === false) {
        audioTrack.enabled = false;
      }
      if (videoTrack && options.initialCamera === false) {
        videoTrack.enabled = false;
      }
      if (videoTrack) {
        currentCameraStreamRef = nextCameraStreamRef();
      }
      // eslint-disable-next-line no-console
      console.debug('[vks/call] emitting joinRoom', roomId);
      const joinRes = await signaling.emitWithAck<JoinRoomAck>(
        RT_EVENTS.ROOM_JOIN,
        {
          roomId,
          ...(options.guestName ? { guestName: options.guestName } : {}),
        },
        15000,
      );
      // eslint-disable-next-line no-console
      console.debug('[vks/call] joinRoom ack', joinRes);
      myPeerId = String(joinRes?.peerId ?? '');
      if (joinRes.roomId && typeof joinRes.roomId === 'string') {
        roomId = joinRes.roomId;
      }
      if (myPeerId) {
        setPeerLabel({
          peerId: myPeerId,
          displayName: options.guestName?.trim() || 'Вы',
          isLocal: true,
          userId: null,
        });
      }
      for (const row of joinRes.peerMediaHints ?? []) {
        if (!row?.peerId) continue;
        applyRemoteMediaHint(String(row.peerId), row, 'join-ack');
      }
      if (joinRes.peerDirectory) applyPeerDirectory(joinRes.peerDirectory);
      conferenceState.applySnapshot(joinRes.snapshot ?? null);
      scalabilityMode = joinRes.scalabilityMode ?? 'full';
      await applyAdaptiveTrackLimits();
      joined = true;
      emit('connectionState', 'joined');
      emitLocalMedia();
      await syncConferenceSnapshot();
      await speaker.resumeAudio();
      if (localStream && myPeerId) {
        // Bind local microphone too so users can see their own speaking
        // indicator and quickly confirm mic capture is live.
        await speaker.bind(myPeerId, localStream);
        speaker.setMicLive(myPeerId, Boolean(localStream.getAudioTracks()[0]?.enabled));
      }
      startPeerStatusPolling();
      startReconcileLoop();
      startMediaStateHeartbeat();
      startConferenceSnapshotSync();
      // If we joined into a room that already has >=2 remote peers, skip mesh
      // entirely and go straight to SFU. This avoids a quick "mesh ↔ SFU"
      // flicker at the exact moment 3 participants line up. The producers
      // returned in the join ack are fed directly into `switchToSfu` so we
      // don't need a follow-up `getProducers` round-trip.
      const existingPeerIds = joinRes.peerIds ?? [];
      if (existingPeerIds.length >= SFU_SWITCH_PEER_COUNT - 1) {
        const ok = await switchToSfu(joinRes.producerInfos ?? []);
        if (!ok) {
          // Fallback to mesh: flush any pending offers we received while
          // `switchToSfu` was running.
          while (pendingRtcOffers.length) {
            const offer = pendingRtcOffers.shift();
            if (!offer) continue;
            try {
              await handleRtcOffer(offer);
            } catch (err) {
              log(`Deferred offer error: ${(err as Error).message}`);
            }
          }
        }
      } else {
        while (pendingRtcOffers.length) {
          const offer = pendingRtcOffers.shift();
          if (!offer) continue;
          try {
            await handleRtcOffer(offer);
          } catch (err) {
            log(`Deferred offer error: ${(err as Error).message}`);
          }
        }
      }
      void broadcastMyMediaState();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vks/call] start() failed', err);
      cleanupAll();
      joined = false;
      emit('connectionState', 'error');
      emit('error', (err as Error).message || 'Не удалось присоединиться к звонку');
    } finally {
      starting = false;
    }
  };

  const leave = async () => {
    if (!joined) return;
    emit('connectionState', 'leaving');
    try {
      await signaling.emitWithAck(RT_EVENTS.ROOM_LEAVE, {}, 3000);
    } catch {
      /* best-effort */
    }
    joined = false;
    cleanupAll();
    emit('connectionState', 'left');
  };

  const shutdown = async () => {
    if (shutdownInvoked) return;
    shutdownInvoked = true;
    try {
      if (joined) {
        await leave();
      } else {
        cleanupAll();
      }
    } catch {
      try {
        cleanupAll();
      } catch {
        /* ignore */
      }
    }
    try {
      signaling.disconnect();
    } catch {
      /* ignore */
    }
  };

  const toggleMic = () => {
    const audioTrack = localStream?.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    if (mode === 'sfu' && sfu) {
      // mediasoup needs an explicit pause/resume so the backend stops
      // forwarding RTP packets while the mic is muted (saves upstream
      // bandwidth and prevents flickering audio levels on other clients).
      if (audioTrack.enabled) void sfu.resumeProducer('mic');
      else void sfu.pauseProducer('mic');
    }
    emitLocalMedia();
    void broadcastMyMediaState();
  };

  const toggleCamera = async () => {
    const videoTrack = localStream?.getVideoTracks()[0];
    if (!videoTrack) return;
    if (!videoTrack.enabled && !currentCameraStreamRef) {
      currentCameraStreamRef = nextCameraStreamRef();
    }
    videoTrack.enabled = !videoTrack.enabled;
    if (isScreenSharing) {
      await syncScreenShareCameraSenders();
    }
    if (mode === 'sfu' && sfu) {
      if (videoTrack.enabled) void sfu.resumeProducer('camera');
      else void sfu.pauseProducer('camera');
    }
    emitLocalMedia();
    void broadcastMyMediaState();
  };

  const startScreenShare = async () => {
    if (isScreenSharing || !joined || !localStream) return;
    try {
      const displayStream = await getDisplayMediaCompat({ video: true, audio: false });
      const track = displayStream.getVideoTracks()[0];
      if (!track) throw new Error('Экранный видеопоток не найден');
      screenShareStream = displayStream;
      screenShareTrack = track;
      isScreenSharing = true;
      currentScreenStreamRef = nextScreenStreamRef();
      track.onended = () => {
        void stopScreenShare();
      };
      setLocalSharePreview(true);
      void broadcastMyMediaState();
      if (mode === 'sfu' && sfu) {
        await sfu.publishTrack(track, 'screen');
      } else {
        await addScreenShareSenders();
      }
      await applyAdaptiveTrackLimits();
      void broadcastMyMediaState();
    } catch (err) {
      isScreenSharing = false;
      screenShareTrack = null;
      screenShareStream = null;
      currentScreenStreamRef = null;
      emitLocalMedia();
      emit('error', (err as Error).message || 'Не удалось начать демонстрацию экрана');
    }
  };

  const stopScreenShare = async () => {
    if (!isScreenSharing) return;
    const activeTrack = screenShareTrack;
    const activeStream = screenShareStream;
    isScreenSharing = false;
    screenShareTrack = null;
    screenShareStream = null;
    currentScreenStreamRef = null;
    if (activeTrack) {
      activeTrack.onended = null;
      activeTrack.stop();
    }
    stopMediaStream(activeStream);
    setLocalSharePreview(false);
    void broadcastMyMediaState();
    if (mode === 'sfu' && sfu) {
      sfu.closeProducer('screen');
    } else {
      await removeScreenShareSenders();
    }
    void broadcastMyMediaState();
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }
    await startScreenShare();
  };

  const kickPeer = async (peerId: string) => {
    if (!peerId) return;
    try {
      await signaling.emitWithAck('kickPeer', { targetPeerId: peerId });
    } catch {
      try {
        await fetch(`${options.baseUrl}/api/rooms/${encodeURIComponent(roomId)}/kick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPeerId: peerId }),
        });
      } catch {
        emit('error', 'Не удалось удалить участника');
      }
    }
  };

  const getCallChatHistory = async (limit = 30) => {
    const chatId = Number(roomId);
    if (!Number.isFinite(chatId) || chatId <= 0) return [];
    const result = await signaling.emitWithAck<unknown[]>(RT_EVENTS.CALL_CHAT_HISTORY_GET, {
      chatId,
      limit,
    });
    return Array.isArray(result) ? result : [];
  };

  const sendCallChatMessage = async (text: string) => {
    const chatId = Number(roomId);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      throw new Error('Invalid room id');
    }
    return signaling.emitWithAck(RT_EVENTS.CALL_CHAT_MESSAGE_SEND, {
      chatId,
      text,
    });
  };

  return {
    start,
    leave,
    shutdown,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    kickPeer,
    getRoomId: () => roomId,
    getParticipants,
    getLocalMedia,
    getPeerLabels: () => new Map(peerLabels),
    getCallChatHistory,
    sendCallChatMessage,
    onCallChatMessage: (handler: (message: unknown) => void) => {
      callChatListeners.add(handler);
      return () => {
        callChatListeners.delete(handler);
      };
    },
    on: <K extends keyof CallEngineEvents>(event: K, handler: CallEngineEvents[K]) => {
      listeners[event].add(handler as never);
      return () => {
        listeners[event].delete(handler as never);
      };
    },
  };
}

function fallbackPeerName(peerId: string): string {
  return `Участник ${peerId.slice(0, 5)}`;
}

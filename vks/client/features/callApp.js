import { createSignalingClient } from "../services/signaling.js";
import { acquireLocalCallStreamWithFallback, getDisplayMediaCompat, stopMediaStream } from "../services/media.js";
import { createPeerQualityReporter } from "../services/qualityTelemetry.js";
import { createCallState } from "../state/callState.js";
import { createConferenceState } from "../state/conferenceState.js";
import { createActiveSpeakerHighlight } from "./speakingMonitor.js";
import { createBinaryMachine, createPublishMachine, createTransitionMachine } from "./mediaMachines.js";
import {
  bindStreamToTileIndicators,
  paintParticipantMediaFromReported,
  setParticipantStatusText,
  syncTileAvatarFallback,
  updateRemoteParticipantIndicators,
  updateTileFromStream,
} from "./tileIndicators.js";
import { buildShareUrlWithRoom, replaceHistoryWithCanonicalRoom, resolveRoomIdFromLocation } from "../utils/roomId.js";
import { bindTileFullscreen, exitFullscreenIfParticipantTile } from "./tileFullscreen.js";

function getGridDimensions(tileCount) {
  if (tileCount <= 1) return { cols: 1, rows: 1 };
  const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 600px)").matches;
  if (tileCount === 2) {
    return narrow ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 };
  }
  const cols = Math.ceil(Math.sqrt(tileCount));
  const rows = Math.ceil(tileCount / cols);
  return { cols, rows };
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function lcm(a, b) {
  if (a === 0 || b === 0) return 0;
  return Math.abs((a * b) / gcd(a, b));
}

export function initCallApp() {
  const abortController = new AbortController();
  const { signal: abortSignal } = abortController;
  const state = createCallState();
  const conferenceState = createConferenceState();
  const signaling = createSignalingClient();
  const speaker = createActiveSpeakerHighlight();
  const streamSpeakerBound = new WeakSet();
  const micMachine = createBinaryMachine(true);
  const cameraMachine = createTransitionMachine("off");
  const screenMachine = createTransitionMachine("off");
  const publishMachine = createPublishMachine();

  function bindToolbarAction(el, handler, { resumeAudio = true } = {}) {
    if (!el) return;
    const run = async (event) => {
      if (resumeAudio) {
        await speaker.resumeAudio();
      }
      handler(event);
    };
    el.addEventListener("click", (event) => {
      event.preventDefault();
      void run(event);
    });
  }

  function attachSpeakerToTileStream(tile, stream) {
    void speaker.bindTile(tile, stream);
    if (streamSpeakerBound.has(stream)) return;
    streamSpeakerBound.add(stream);
    stream.addEventListener("addtrack", () => {
      void speaker.bindTile(tile, stream);
    });
  }

  const startCallButton = document.getElementById("startCallButton");
  const leaveCallButton = document.getElementById("leaveCallButton");
  const toggleMicButton = document.getElementById("toggleMicButton");
  const toggleCamButton = document.getElementById("toggleCamButton");
  const toggleShareButton = document.getElementById("toggleShareButton");
  const copyInviteButton = document.getElementById("copyInviteButton");
  const localVideo = document.getElementById("localVideo");
  const localShareVideo = document.getElementById("localShareVideo");
  const participantGrid = document.getElementById("participantGrid");
  const participantCountBadge = document.getElementById("participantCountBadge");
  const participantCountValue = document.getElementById("participantCountValue");
  const participantListPopover = document.getElementById("participantListPopover");
  const participantListItems = document.getElementById("participantListItems");
  const participantListCount = document.getElementById("participantListCount");
  const activeCallShell = document.getElementById("activeCallShell");
  const copyInviteMain = document.getElementById("copyInviteMain");
  const inviteCopyFeedback = document.getElementById("inviteCopyFeedback");
  const meetingIdDisplay = document.getElementById("meetingIdDisplay");
  const copyMeetingMini = document.getElementById("copyMeetingMini");
  const prejoinPanel = document.getElementById("prejoinPanel");
  const callControls = document.getElementById("callControls");
  const roomLabel = document.getElementById("roomLabel");
  const copyInvitePrejoin = document.getElementById("copyInvitePrejoin");

  const roomId = resolveRoomIdFromLocation();
  state.roomId = roomId;
  replaceHistoryWithCanonicalRoom(roomId);
  if (roomLabel) {
    roomLabel.textContent = roomId;
  }

  const peerConnections = new Map();
  const pendingCandidatesByPeerId = new Map();
  const pendingRenegotiationByPeerId = new Set();
  const screenShareSenderByPeerId = new Map();
  /** @type {Map<string, string[]>} */
  const remoteVideoTrackOrderByPeerId = new Map();
  /** @type {Map<string, {
   * audioEnabled: boolean;
   * videoEnabled: boolean;
   * cameraEnabled?: boolean;
   * screenSharing?: boolean;
   * primaryVideoSource?: "none" | "camera" | "screen";
   * screenTrackId?: string | null;
   * cameraTrackId?: string | null;
   * streamRef?: string | null;
   * }>} */
  const remoteMediaStateByPeerId = new Map();
  /** @type {Map<string, unknown>} */
  const remoteQualityStateByPeerId = new Map();
  const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  /** @type {{ fromPeerId: string, sdp: RTCSessionDescriptionInit }[]} */
  const pendingRtcOffers = [];
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const disconnectCleanupTimers = new Map();
  const localTracksMediaNotify = new WeakSet();
  const qualityReporter = createPeerQualityReporter({
    getLocalStream: () => state.localStream,
    getPeerConnections: () => peerConnections,
    sendQualityState: (payload) => {
      signaling.emit("peerQualityState", payload);
    },
  });

  let copyUiTimer = null;
  let baseCameraTrack = null;
  let screenShareTrack = null;
  let screenShareStream = null;
  let isScreenSharing = false;
  let peerStatusPollTimer = null;
  let mediaReconcileTimer = null;
  let cameraStreamSeq = 0;
  let screenStreamSeq = 0;
  let currentCameraStreamRef = null;
  let currentScreenStreamRef = null;
  let roomScalabilityMode = "full";
  const mediaDebugEnabled = (() => {
    try {
      const qp = new URLSearchParams(window.location.search);
      return qp.get("debugMedia") === "1" || window.localStorage?.getItem("debugMedia") === "1";
    } catch {
      return false;
    }
  })();

  function normalizeRemoteMediaHint(hint) {
    if (!hint) return null;
    return {
      audioEnabled: Boolean(hint.audioEnabled),
      videoEnabled: Boolean(hint.videoEnabled),
      cameraEnabled: typeof hint.cameraEnabled === "boolean" ? hint.cameraEnabled : Boolean(hint.videoEnabled),
      screenSharing: Boolean(hint.screenSharing),
      primaryVideoSource:
        hint.primaryVideoSource === "screen" || hint.primaryVideoSource === "camera" || hint.primaryVideoSource === "none"
          ? hint.primaryVideoSource
          : (Boolean(hint.screenSharing) ? "screen" : (Boolean(hint.videoEnabled) ? "camera" : "none")),
      screenTrackId: hint.screenTrackId ?? null,
      cameraTrackId: hint.cameraTrackId ?? null,
      streamRef: typeof hint.streamRef === "string" ? hint.streamRef : null,
    };
  }

  function areRemoteHintsEqual(a, b) {
    return Boolean(
      a
      && b
      && a.audioEnabled === b.audioEnabled
      && a.videoEnabled === b.videoEnabled
      && a.cameraEnabled === b.cameraEnabled
      && Boolean(a.screenSharing) === Boolean(b.screenSharing)
      && (a.primaryVideoSource ?? "none") === (b.primaryVideoSource ?? "none")
      && (a.screenTrackId ?? null) === (b.screenTrackId ?? null)
      && (a.cameraTrackId ?? null) === (b.cameraTrackId ?? null)
      && (a.streamRef ?? null) === (b.streamRef ?? null)
    );
  }

  function applyRemoteMediaHint(peerId, hint) {
    if (!peerId || !hint) return;
    const normalized = normalizeRemoteMediaHint(hint);
    if (!normalized) return;
    const key = String(peerId);
    const prev = remoteMediaStateByPeerId.get(key);
    if (areRemoteHintsEqual(prev, normalized)) return;
    remoteMediaStateByPeerId.set(key, normalized);
  }

  async function pollPeerStatuses() {
    if (!state.joined || !state.roomId) return;
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(state.roomId)}/peer-status`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = await response.json();
      const peerCount = Array.isArray(payload?.peers) ? payload.peers.length + 1 : 1;
      const nextMode = peerCount > 12 ? "speaker-focus" : "full";
      if (nextMode !== roomScalabilityMode) {
        roomScalabilityMode = nextMode;
        void applyAdaptiveTrackLimits();
      }
      for (const peer of payload?.peers ?? []) {
        const peerId = String(peer?.peerId ?? "");
        if (!peerId) continue;
        const prevHint = remoteMediaStateByPeerId.get(peerId) ?? null;
        applyRemoteMediaHint(peerId, peer.media ?? null);
        const nextHint = remoteMediaStateByPeerId.get(peerId) ?? null;
        const hintChanged = !areRemoteHintsEqual(prevHint, nextHint);
        logPolledPeerState(peerId, nextHint ?? peer.media ?? null);
        const tile = findTileByPeerId(peerId);
        const stream = state.remoteStreamsByPeerId.get(peerId);
        if (hintChanged && tile && stream) {
          const reported = nextHint;
          syncRemoteTileVideoLayout(tile, stream, {
            isRemoteScreenSharing: Boolean(reported?.screenSharing),
            isRemoteCameraEnabled: reported?.cameraEnabled ?? true,
            remotePrimaryVideoSource: reported?.primaryVideoSource ?? "none",
            remoteScreenTrackId: reported?.screenTrackId ?? null,
            remoteCameraTrackId: reported?.cameraTrackId ?? null,
            remoteTrackOrder: remoteVideoTrackOrderByPeerId.get(peerId) ?? [],
          });
        }
        if (hintChanged) {
          refreshRemoteTileMediaStatus(peerId);
        }
      }
    } catch (_error) {
      // Polling is best-effort.
    }
  }

  function startPeerStatusPolling() {
    stopPeerStatusPolling();
    void pollPeerStatuses();
    peerStatusPollTimer = window.setInterval(() => {
      void pollPeerStatuses();
    }, 1000);
  }

  function stopPeerStatusPolling() {
    if (!peerStatusPollTimer) return;
    clearInterval(peerStatusPollTimer);
    peerStatusPollTimer = null;
  }

  function reconcileMediaState() {
    if (!state.joined) return;
    let needSnapshot = false;
    for (const [peerId, reported] of remoteMediaStateByPeerId.entries()) {
      const stream = state.remoteStreamsByPeerId.get(peerId);
      if (!stream) continue;
      const liveVideos = stream.getVideoTracks().filter((track) => track.readyState === "live");
      const expectsVideo = Boolean(reported?.screenSharing || reported?.cameraEnabled);
      if (expectsVideo && liveVideos.length === 0) {
        needSnapshot = true;
        break;
      }
    }
    if (needSnapshot) {
      void syncConferenceSnapshot("reconcile-mismatch");
    }
  }

  function startMediaReconcileLoop() {
    if (mediaReconcileTimer) {
      clearInterval(mediaReconcileTimer);
    }
    mediaReconcileTimer = window.setInterval(() => {
      reconcileMediaState();
    }, 3000);
  }

  function stopMediaReconcileLoop() {
    if (!mediaReconcileTimer) return;
    clearInterval(mediaReconcileTimer);
    mediaReconcileTimer = null;
  }

  function getLocalCameraTrack() {
    return state.localStream?.getVideoTracks()[0] ?? null;
  }

  function getCurrentOutgoingVideoTrack() {
    if (isScreenSharing && screenShareTrack && screenShareTrack.readyState === "live") {
      return screenShareTrack;
    }
    return getLocalCameraTrack();
  }

  async function applyAdaptiveTrackLimits() {
    if (roomScalabilityMode !== "speaker-focus") return;
    const cameraTrack = getLocalCameraTrack();
    if (cameraTrack && typeof cameraTrack.applyConstraints === "function") {
      try {
        await cameraTrack.applyConstraints({
          width: { ideal: 640, max: 960 },
          height: { ideal: 360, max: 540 },
          frameRate: { ideal: 12, max: 15 },
        });
      } catch (_error) {
        // Best effort for weaker devices/networks.
      }
    }
    if (screenShareTrack && typeof screenShareTrack.applyConstraints === "function") {
      try {
        await screenShareTrack.applyConstraints({
          frameRate: { ideal: 10, max: 12 },
        });
      } catch (_error) {
        // Best effort for weaker devices/networks.
      }
    }
  }

  function nextCameraStreamRef() {
    cameraStreamSeq += 1;
    return `camera:${state.myPeerId ?? "local"}:${cameraStreamSeq}`;
  }

  function nextScreenStreamRef() {
    screenStreamSeq += 1;
    return `screen:${state.myPeerId ?? "local"}:${screenStreamSeq}`;
  }

  async function syncConferenceSnapshot(reason = "manual") {
    if (!state.joined) return;
    try {
      const response = await signaling.emitWithAck("getConferenceSnapshot");
      if (!response?.conferenceSnapshot) return;
      conferenceState.applySnapshot(response.conferenceSnapshot);
      const peers = response.conferenceSnapshot.peers ?? [];
      for (const peer of peers) {
        if (!peer?.peerId || peer.peerId === state.myPeerId) continue;
        applyRemoteMediaHint(peer.peerId, {
          audioEnabled: Boolean(peer.mic?.enabled),
          videoEnabled: Boolean(peer.camera?.enabled || peer.screen?.enabled),
          cameraEnabled: Boolean(peer.camera?.enabled),
          screenSharing: Boolean(peer.screen?.enabled),
          primaryVideoSource: peer.screen?.enabled ? "screen" : (peer.camera?.enabled ? "camera" : "none"),
          streamRef: peer.screen?.enabled ? (peer.screen?.streamRef ?? null) : (peer.camera?.streamRef ?? null),
          screenTrackId: peer.screen?.trackRef ?? null,
          cameraTrackId: peer.camera?.trackRef ?? null,
        });
      }
      log(`[signal-media] snapshot-applied reason=${reason} version=${conferenceState.getVersion()}`);
    } catch (error) {
      log(`[signal-media] snapshot-error reason=${reason} error=${error.message}`);
    }
  }

  function log(message) {
    if (typeof message !== "string") return;
    const alwaysVisiblePrefixes = ["[signal-media]", "[kick]"];
    const shouldShow = alwaysVisiblePrefixes.some((prefix) => message.startsWith(prefix))
      || (mediaDebugEnabled && message.startsWith("[media-debug]"));
    if (!shouldShow) return;
    // eslint-disable-next-line no-console
    console.log(message);
  }

  function logPolledPeerState(peerId, mediaState) {
    if (!peerId || !mediaState) return;
    log(
      `[poll-state] peer=${peerId} `
      + `mic=${Boolean(mediaState.audioEnabled)} `
      + `camera=${Boolean(mediaState.cameraEnabled)} `
      + `demo=${Boolean(mediaState.screenSharing)}`
    );
  }

  function logRemoteVideoTracks(peerId, reason) {
    const stream = state.remoteStreamsByPeerId.get(peerId);
    const reported = remoteMediaStateByPeerId.get(peerId);
    const videoTracks = stream
      ? stream.getVideoTracks().map((track) => {
        const label = String(track.label || "").trim() || "no-label";
        return `${track.id}|${label}|${track.readyState}`;
      })
      : [];
    const payload = [
      `peer=${peerId}`,
      `reason=${reason}`,
      `screenSharing=${Boolean(reported?.screenSharing)}`,
      `cameraEnabled=${typeof reported?.cameraEnabled === "boolean" ? reported.cameraEnabled : "-"}`,
      `primary=${reported?.primaryVideoSource ?? "-"}`,
      `streamRef=${reported?.streamRef ?? "-"}`,
      `screenTrackId=${reported?.screenTrackId ?? "-"}`,
      `cameraTrackId=${reported?.cameraTrackId ?? "-"}`,
      `videos=[${videoTracks.join(", ")}]`,
    ].join(" ");
    log(`[remote-media] ${payload}`);
  }

  function logLocalVideoTracks(reason) {
    const localTracks = state.localStream
      ? state.localStream.getVideoTracks().map((track) => {
        const label = String(track.label || "").trim() || "no-label";
        return `${track.id}|${label}|${track.readyState}|enabled=${track.enabled}`;
      })
      : [];
    const shareTrackPart = screenShareTrack
      ? `${screenShareTrack.id}|${String(screenShareTrack.label || "").trim() || "no-label"}|${screenShareTrack.readyState}`
      : "-";
    log(
      `[local-media] reason=${reason} screenSharing=${isScreenSharing} `
      + `screenTrack=${shareTrackPart} localVideos=[${localTracks.join(", ")}]`,
    );
  }

  function logOutgoingSenders(peerId, reason) {
    const peerConnection = peerConnections.get(peerId);
    if (!peerConnection) {
      log(`[local-media] peer=${peerId} reason=${reason} senders=[]`);
      return;
    }
    const senderParts = peerConnection
      .getSenders()
      .filter((sender) => sender.track?.kind === "video")
      .map((sender, index) => {
        const track = sender.track;
        const label = String(track.label || "").trim() || "no-label";
        return `#${index}:${track.id}|${label}|${track.readyState}|enabled=${track.enabled}`;
      });
    log(`[local-media] peer=${peerId} reason=${reason} senders=[${senderParts.join(", ")}]`);
  }

  function getLocalTile() {
    return participantGrid?.querySelector(".participant-tile--local") ?? null;
  }

  function hasRenderableLocalVideo() {
    const track = state.localStream?.getVideoTracks?.()[0] ?? null;
    return Boolean(track && track.readyState === "live" && track.enabled && !track.muted);
  }

  function syncLocalTileVisibility() {
    const tile = getLocalTile();
    if (!tile) return;
    tile.hidden = false;
  }

  function setParticipantListOpen(isOpen) {
    if (!participantListPopover || !participantCountBadge) return;
    participantListPopover.hidden = !isOpen;
    participantCountBadge.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  function updateParticipantList() {
    if (!participantGrid || !participantListItems || !participantListCount) return;
    const tiles = Array.from(participantGrid.querySelectorAll(".participant-tile"));
    participantListCount.textContent = String(tiles.length);
    participantListItems.replaceChildren();
    for (const tile of tiles) {
      const peerId = tile.dataset.peerId ?? "local";
      const name = tile.querySelector(".participant-name")?.textContent?.trim()
        || (peerId === "local" ? "Вы" : `Участник ${peerId.slice(0, 5)}`);
      const micOn = tile.dataset.peerMicLive === "1";
      const camOn = tile.dataset.peerCamLive === "1";
      const item = document.createElement("li");
      item.className = "participant-list-popover__item";
      const label = document.createElement("span");
      label.className = "participant-list-popover__item-name";
      label.textContent = name;
      const meta = document.createElement("span");
      meta.className = "participant-list-popover__item-meta";
      const micIcon = document.createElement("span");
      micIcon.className = "participant-list-popover__item-icon material-symbols-outlined";
      micIcon.textContent = micOn ? "mic" : "mic_off";
      micIcon.style.fontVariationSettings = micOn
        ? '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 20'
        : '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 20';
      const camIcon = document.createElement("span");
      camIcon.className = "participant-list-popover__item-icon material-symbols-outlined";
      camIcon.textContent = camOn ? "videocam" : "videocam_off";
      camIcon.style.fontVariationSettings = camOn
        ? '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 20'
        : '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 20';
      meta.append(micIcon, camIcon);
      if (peerId !== "local") {
        const kickBtn = document.createElement("button");
        kickBtn.type = "button";
        kickBtn.className = "participant-list-popover__kick-btn";
        kickBtn.dataset.peerId = peerId;
        kickBtn.setAttribute("aria-label", "Удалить из чата");
        const kickIcon = document.createElement("span");
        kickIcon.className = "material-symbols-outlined";
        kickIcon.textContent = "exit_to_app";
        kickIcon.setAttribute("aria-hidden", "true");
        kickBtn.appendChild(kickIcon);
        kickBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          kickBtn.disabled = true;
          log(`[kick] click target=${peerId} room=${state.roomId ?? "-"}`);
          void (async () => {
            try {
              log(`[kick] socket request target=${peerId}`);
              await Promise.race([
                signaling.emitWithAck("kickPeer", { targetPeerId: peerId }),
                new Promise((_, reject) => {
                  window.setTimeout(() => {
                    reject(new Error("kickPeer ack timeout"));
                  }, 2000);
                }),
              ]);
              log(`[kick] socket ok target=${peerId}`);
              return;
            } catch (socketError) {
              log(`[kick] socket error target=${peerId} error=${socketError.message}`);
            }
            try {
              log(`[kick] api request target=${peerId}`);
              const response = await fetch(`/api/rooms/${encodeURIComponent(state.roomId)}/kick`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetPeerId: peerId }),
              });
              if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || "kick API failed");
              }
              log(`[kick] api ok target=${peerId}`);
            } catch (error) {
              log(`[kick] final error target=${peerId} error=${error.message}`);
            } finally {
              kickBtn.disabled = false;
            }
          })();
        });
        meta.appendChild(kickBtn);
      }
      item.append(label, meta);
      participantListItems.appendChild(item);
    }
  }

  function syncLocalTileIndicators() {
    const tile = getLocalTile();
    if (!tile) return;
    if (!state.localStream) {
      setParticipantStatusText(tile, false, false);
      syncTileAvatarFallback(tile, null, null, true);
      return;
    }
    updateTileFromStream(tile, state.localStream);
  }

  function getShareUrl() {
    return buildShareUrlWithRoom(window.location.href, state.roomId);
  }

  function resetCopyInviteUi() {
    if (copyUiTimer) {
      clearTimeout(copyUiTimer);
      copyUiTimer = null;
    }
    if (copyInviteMain) {
      copyInviteMain.textContent = "Скопировать ссылку";
      copyInviteMain.classList.remove("is-copied");
    }
    if (inviteCopyFeedback) {
      inviteCopyFeedback.hidden = true;
    }
  }

  function flashCopyInviteUi() {
    if (copyInviteMain) {
      copyInviteMain.textContent = "Ссылка скопирована";
      copyInviteMain.classList.add("is-copied");
    }
    if (inviteCopyFeedback) {
      inviteCopyFeedback.hidden = false;
    }
    if (copyUiTimer) clearTimeout(copyUiTimer);
    copyUiTimer = window.setTimeout(() => {
      resetCopyInviteUi();
    }, 2800);
  }

  async function copyInviteLink() {
    const text = getShareUrl();
    try {
      await navigator.clipboard.writeText(text);
      log("Link copied");
    } catch (_err) {
      window.prompt("Ссылка:", text);
    }
    if (state.joined) {
      flashCopyInviteUi();
    }
  }

  function updateMeetingDisplay() {
    if (meetingIdDisplay) {
      meetingIdDisplay.textContent = state.roomId;
    }
  }

  function hasRemoteParticipants() {
    return Boolean(participantGrid?.querySelector(".participant-tile[data-peer-id]"));
  }

  function updateSoloLayout() {
    if (!activeCallShell || activeCallShell.hidden) return;
    if (hasRemoteParticipants()) {
      activeCallShell.classList.remove("active-call-shell--solo");
    } else {
      activeCallShell.classList.add("active-call-shell--solo");
    }
  }

  function setCallUiJoined(isJoined) {
    if (prejoinPanel) {
      prejoinPanel.hidden = isJoined;
    }
    if (callControls) {
      callControls.hidden = !isJoined;
    }
    if (activeCallShell) {
      activeCallShell.hidden = !isJoined;
    }
    resetCopyInviteUi();
    if (isJoined) {
      updateMeetingDisplay();
      updateSoloLayout();
    }
  }

  function setControlsEnabled(isEnabled) {
    if (copyInviteButton) copyInviteButton.disabled = false;
    leaveCallButton.disabled = !isEnabled;
    if (toggleShareButton) toggleShareButton.disabled = !isEnabled;
    const hasAudio = Boolean(state.localStream?.getAudioTracks()[0]);
    const hasVideo = Boolean(state.localStream?.getVideoTracks()[0]);
    toggleMicButton.disabled = !isEnabled || !hasAudio;
    toggleCamButton.disabled = !isEnabled || !hasVideo;
  }

  function updateShareButtonLabel() {
    if (!toggleShareButton) return;
    const glyph = toggleShareButton.querySelector(".material-symbols-outlined");
    if (glyph) {
      glyph.textContent = isScreenSharing ? "stop_screen_share" : "screen_share";
      glyph.style.fontVariationSettings = isScreenSharing
        ? '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24'
        : '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24';
    }
    toggleShareButton.setAttribute("aria-pressed", isScreenSharing ? "true" : "false");
    toggleShareButton.title = isScreenSharing ? "Остановить демонстрацию" : "Демонстрация экрана";
    toggleShareButton.setAttribute("aria-label", toggleShareButton.title);
    if (localVideo) {
      localVideo.classList.toggle("participant-tile__video--share", isScreenSharing);
    }
  }

  function applyLocalPreviewTrack(track) {
    if (!localVideo) return;
    if (!track) {
      localVideo.srcObject = null;
      return;
    }
    localVideo.srcObject = new MediaStream([track]);
  }

  function syncRemoteTileVideoLayout(
    tile,
    stream,
    {
      isRemoteScreenSharing = false,
      isRemoteCameraEnabled = true,
      remotePrimaryVideoSource = "none",
      remoteScreenTrackId = null,
      remoteCameraTrackId = null,
      remoteTrackOrder = [],
    } = {},
  ) {
    if (!tile) return;
    const mainVideo = tile.querySelector(".participant-tile__main-video");
    if (!mainVideo) return;
    const getPipVideo = () => tile.querySelector(".participant-tile__remote-camera-pip");
    const ensurePipVideo = () => {
      let pip = getPipVideo();
      if (pip) return pip;
      pip = document.createElement("video");
      pip.autoplay = true;
      pip.playsInline = true;
      pip.setAttribute("playsinline", "true");
      pip.muted = true;
      pip.defaultMuted = true;
      pip.preload = "auto";
      pip.className = "participant-tile__remote-camera-pip";
      pip.hidden = true;
      tile.insertBefore(pip, mainVideo.nextSibling);
      return pip;
    };
    const removePipVideo = () => {
      const pip = getPipVideo();
      if (!pip) return;
      pip.srcObject = null;
      pip.dataset.trackId = "";
      pip.remove();
    };
    const setVideoTrack = (videoEl, track) => {
      const nextTrackId = track?.id ?? "";
      if (videoEl.dataset.trackId === nextTrackId) return;
      videoEl.dataset.trackId = nextTrackId;
      videoEl.srcObject = track ? new MediaStream([track]) : null;
    };
    const liveVideoTracks = stream
      .getVideoTracks()
      .filter((track) => track.readyState === "live");
    if (liveVideoTracks.length === 0) {
      setVideoTrack(mainVideo, null);
      removePipVideo();
      tile.classList.remove("participant-tile--remote-sharing");
      return;
    }
    const tracksById = new Map(liveVideoTracks.map((track) => [track.id, track]));
    const orderedTracks = (remoteTrackOrder ?? [])
      .map((id) => tracksById.get(id) ?? null)
      .filter(Boolean);
    for (const track of liveVideoTracks) {
      if (!orderedTracks.some((candidate) => candidate.id === track.id)) {
        orderedTracks.push(track);
      }
    }
    const cameraTrackFromSignal = remoteCameraTrackId
      ? tracksById.get(remoteCameraTrackId) ?? null
      : null;

    const scoreTrackAsScreen = (track) => {
      const label = String(track.label || "").toLowerCase();
      const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
      const displaySurface = String(settings.displaySurface || "").toLowerCase();
      const contentHint = String(track.contentHint || "").toLowerCase();
      const width = Number(settings.width || 0);
      const height = Number(settings.height || 0);
      const area = width > 0 && height > 0 ? width * height : 0;
      let score = 0;
      if (displaySurface) score += 10000;
      if (displaySurface === "monitor" || displaySurface === "window" || displaySurface === "browser") score += 5000;
      if (label.includes("screen") || label.includes("display") || label.includes("window") || label.includes("monitor") || label.includes("tab")) score += 2500;
      if (contentHint === "detail" || contentHint === "text") score += 1200;
      if (track.enabled === false) score -= 7000;
      if (track.muted) score -= 4500;
      score += Math.min(Math.round(area / 100000), 120);
      return score;
    };
    const scoredTracks = liveVideoTracks.map((track) => ({
      track,
      score: scoreTrackAsScreen(track),
    }));
    const pickLikelyScreenTrack = (candidates = liveVideoTracks) => {
      if (!candidates.length) return null;
      const candidateScores = candidates.map((track) => ({
        track,
        score: scoreTrackAsScreen(track),
      }));
      let best = candidateScores[0];
      for (const current of candidateScores) {
        if (current.score > best.score) {
          best = current;
        }
      }
      return best.track;
    };
    const pickLikelyCameraTrack = () => {
      if (!liveVideoTracks.length) return null;
      let best = scoredTracks[0];
      for (const current of scoredTracks) {
        if (current.score < best.score) {
          best = current;
        }
      }
      return best.track;
    };
    const peerIdForLog = tile.dataset.peerId ?? "unknown-peer";
    const toTrackPart = (track) => {
      if (!track) return "none";
      const label = String(track.label || "").trim() || "no-label";
      return `${track.id}|${label}|${track.readyState}|enabled=${track.enabled}|muted=${track.muted}`;
    };

    // If sender says camera is off and no screenshare, never render stale black video.
    if (!isRemoteScreenSharing && isRemoteCameraEnabled === false) {
      log(`[remote-media] peer=${peerIdForLog} layout=none reason=camera-disabled-no-screen`);
      setVideoTrack(mainVideo, null);
      removePipVideo();
      tile.classList.remove("participant-tile--remote-sharing");
      return;
    }

    const confirmedScreenSharing = Boolean(
      remotePrimaryVideoSource === "screen"
      || isRemoteScreenSharing
      || remoteScreenTrackId,
    );
    const shouldUseShareLayout = confirmedScreenSharing;
    const cameraTrack = cameraTrackFromSignal ?? null;
    const nonCameraTracks = orderedTracks.filter((track) => track.id !== cameraTrack?.id);
    const freshestTrack = orderedTracks[orderedTracks.length - 1] ?? liveVideoTracks[liveVideoTracks.length - 1] ?? null;
    const shareTrack = shouldUseShareLayout
      ? (pickLikelyScreenTrack(nonCameraTracks.length ? nonCameraTracks : orderedTracks) ?? freshestTrack)
      : null;
    const fallbackCamera = pickLikelyCameraTrack();
    const mainTrack = shouldUseShareLayout
      ? (shareTrack ?? freshestTrack)
      : (cameraTrack ?? fallbackCamera ?? freshestTrack);
    if (!mainTrack) {
      setVideoTrack(mainVideo, null);
      removePipVideo();
      tile.classList.remove("participant-tile--remote-sharing");
      return;
    }
    setVideoTrack(mainVideo, mainTrack);
    const fallbackPipCameraTrack = shouldUseShareLayout
      ? (cameraTrack ?? fallbackCamera ?? null)
      : null;
    const pipTrack = shouldUseShareLayout
      ? (fallbackPipCameraTrack && fallbackPipCameraTrack.id !== mainTrack.id ? fallbackPipCameraTrack : null)
      : null;
    const canShowPip = Boolean(
      isRemoteCameraEnabled
      && shouldUseShareLayout
      && pipTrack
      && pipTrack.id !== mainTrack.id
      && pipTrack.readyState === "live"
      && pipTrack.enabled
    );
    if (mediaDebugEnabled) {
      const scoredParts = scoredTracks.map((row) => `${toTrackPart(row.track)}|score=${row.score}`).join(", ");
      log(
        `[media-debug] peer=${peerIdForLog} choose `
        + `primary=${remotePrimaryVideoSource} screenFlag=${Boolean(isRemoteScreenSharing)} `
        + `screenTrackId=${remoteScreenTrackId ?? "-"} cameraTrackId=${remoteCameraTrackId ?? "-"} `
        + `main=${toTrackPart(mainTrack)} pip=${toTrackPart(canShowPip ? pipTrack : null)} `
        + `tracks=[${scoredParts}]`,
      );
    }
    if (canShowPip) {
      const pipVideo = ensurePipVideo();
      setVideoTrack(pipVideo, pipTrack);
      pipVideo.hidden = false;
      void pipVideo.play().catch(() => {
        // Mobile browsers may block autoplay even for muted PiP; keep tile intact.
      });
      tile.classList.remove("participant-tile--remote-sharing");
    } else {
      removePipVideo();
      tile.classList.remove("participant-tile--remote-sharing");
    }
    return;
  }

  function setLocalSharePreview(isEnabled) {
    const localTile = getLocalTile();
    if (localTile) {
      localTile.classList.toggle("participant-tile--local-sharing", isEnabled);
    }
    if (!localShareVideo) return;
    if (!isEnabled || !screenShareStream) {
      localShareVideo.srcObject = null;
      localShareVideo.hidden = true;
      syncLocalTileVisibility();
      updateGridLayout();
      return;
    }
    localShareVideo.srcObject = screenShareStream;
    localShareVideo.hidden = false;
    syncLocalTileVisibility();
    updateGridLayout();
  }

  async function addScreenShareSenders() {
    if (!screenShareTrack || !screenShareStream) return;
    logLocalVideoTracks("addScreenShareSenders:start");
    for (const [peerId, peerConnection] of peerConnections.entries()) {
      const extraSender = screenShareSenderByPeerId.get(peerId) ?? null;
      let primaryVideoSender = peerConnection
        .getSenders()
        .find((sender) => sender.track?.kind === "video" && sender !== extraSender) ?? null;
      if (!primaryVideoSender) {
        // Guarantee screen publication even if this peer had no active primary video sender yet.
        primaryVideoSender = peerConnection.addTrack(screenShareTrack, screenShareStream);
      } else if (primaryVideoSender.track?.id !== screenShareTrack.id) {
        await primaryVideoSender.replaceTrack(screenShareTrack);
      }
      if (!screenShareSenderByPeerId.has(peerId)) {
        const localCameraTrack = getLocalCameraTrack();
        if (
          localCameraTrack
          && localCameraTrack.id !== screenShareTrack.id
          && localCameraTrack.readyState === "live"
          && localCameraTrack.enabled
        ) {
          const sender = peerConnection.addTrack(localCameraTrack, state.localStream);
          screenShareSenderByPeerId.set(peerId, sender);
        }
      }
      await renegotiatePeer(peerId, "Share start");
      logOutgoingSenders(peerId, "addScreenShareSenders:after-renegotiate");
    }
  }

  async function removeScreenShareSenders() {
    logLocalVideoTracks("removeScreenShareSenders:start");
    for (const [peerId, peerConnection] of peerConnections.entries()) {
      // Hard reset video senders on share stop to avoid stale black remote track.
      const videoSenders = peerConnection
        .getSenders()
        .filter((sender) => sender.track?.kind === "video");
      for (const sender of videoSenders) {
        try {
          peerConnection.removeTrack(sender);
        } catch (_error) {
          // Ignore sender removal issues during teardown.
        }
      }
      screenShareSenderByPeerId.delete(peerId);
      const localCameraTrack = getLocalCameraTrack();
      if (localCameraTrack && localCameraTrack.readyState === "live" && localCameraTrack.enabled) {
        peerConnection.addTrack(localCameraTrack, state.localStream);
      }
      await renegotiatePeer(peerId, "Share stop");
      logOutgoingSenders(peerId, "removeScreenShareSenders:after-renegotiate");
    }
    screenShareSenderByPeerId.clear();
    updateMediaButtonLabels();
  }

  async function syncScreenShareCameraSenders(reason = "share-camera-sync") {
    if (!isScreenSharing || !screenShareTrack) return;
    const localCameraTrack = getLocalCameraTrack();
    const canSendCameraTrack = Boolean(
      localCameraTrack
      && localCameraTrack.readyState === "live"
      && localCameraTrack.enabled
      && localCameraTrack.id !== screenShareTrack.id,
    );
    for (const [peerId, peerConnection] of peerConnections.entries()) {
      const extraSender = screenShareSenderByPeerId.get(peerId) ?? null;
      if (canSendCameraTrack && !extraSender) {
        const sender = peerConnection.addTrack(localCameraTrack, state.localStream);
        screenShareSenderByPeerId.set(peerId, sender);
        await renegotiatePeer(peerId, `${reason}:add-camera`);
        logOutgoingSenders(peerId, `${reason}:after-add-camera`);
        continue;
      }
      if (!canSendCameraTrack && extraSender) {
        try {
          peerConnection.removeTrack(extraSender);
        } catch (_error) {
          // Keep state consistent even if sender is already detached.
        }
        screenShareSenderByPeerId.delete(peerId);
        await renegotiatePeer(peerId, `${reason}:remove-camera`);
        logOutgoingSenders(peerId, `${reason}:after-remove-camera`);
      }
    }
  }

  async function renegotiatePeer(peerId, reason) {
    const peerConnection = peerConnections.get(peerId);
    if (!peerConnection) return;
    if (peerConnection.signalingState !== "stable") {
      pendingRenegotiationByPeerId.add(peerId);
      return;
    }
    pendingRenegotiationByPeerId.delete(peerId);
    try {
      await createOffer(peerId);
    } catch (error) {
      pendingRenegotiationByPeerId.add(peerId);
      log(`${reason} renegotiation error (${peerId.slice(0, 5)}): ${error.message}`);
    }
  }

  async function stopScreenShare() {
    if (!isScreenSharing) return;
    screenMachine.setState("stopping");
    const activeScreenTrack = screenShareTrack;
    const activeScreenStream = screenShareStream;
    isScreenSharing = false;
    screenShareTrack = null;
    screenShareStream = null;
    currentScreenStreamRef = null;
    if (activeScreenTrack) {
      activeScreenTrack.onended = null;
      activeScreenTrack.stop();
    }
    stopMediaStream(activeScreenStream);
    logLocalVideoTracks("stopScreenShare:before-remove-senders");
    setLocalSharePreview(false);
    void broadcastMyMediaState("stopScreenShare:before-remove");
    await removeScreenShareSenders();
    void broadcastMyMediaState("stopScreenShare:after-remove");
    updateShareButtonLabel();
    setControlsEnabled(true);
    screenMachine.setState("off");
  }

  async function startScreenShare() {
    if (!state.joined || !state.localStream) return;
    screenMachine.setState("starting");
    try {
      const displayStream = await getDisplayMediaCompat({ video: true, audio: false });
      const track = displayStream.getVideoTracks()[0];
      if (!track) {
        throw new Error("Экранный видеопоток не найден");
      }
      screenShareStream = displayStream;
      screenShareTrack = track;
      isScreenSharing = true;
      currentScreenStreamRef = nextScreenStreamRef();
      screenMachine.setState("on");
      logLocalVideoTracks("startScreenShare:track-acquired");
      track.onended = () => {
        void stopScreenShare();
      };
      setLocalSharePreview(true);
      void broadcastMyMediaState("startScreenShare:before-add");
      await addScreenShareSenders();
      await applyAdaptiveTrackLimits();
      void broadcastMyMediaState("startScreenShare:after-add");
      updateShareButtonLabel();
      setControlsEnabled(true);
    } catch (error) {
      screenMachine.setState("off");
      log(`Screen share error: ${error.message}`);
    }
  }

  async function toggleScreenShare() {
    if (isScreenSharing) {
      await stopScreenShare();
      setControlsEnabled(true);
      return;
    }
    await startScreenShare();
  }

  function updateGridLayout() {
    if (!participantGrid || activeCallShell?.hidden) return;
    const allTiles = participantGrid.querySelectorAll(".participant-tile");
    const visibleTiles = Array.from(participantGrid.querySelectorAll(".participant-tile:not([hidden])"));
    if (roomScalabilityMode === "speaker-focus" && visibleTiles.length > 4) {
      for (let i = 0; i < visibleTiles.length; i++) {
        const tile = visibleTiles[i];
        const isLocal = tile.classList.contains("participant-tile--local");
        tile.hidden = !isLocal && i > 3;
      }
    }
    const tiles = participantGrid.querySelectorAll(".participant-tile:not([hidden])");
    const n = tiles.length;
    if (participantCountValue) {
      participantCountValue.textContent = String(allTiles.length);
    }
    if (participantCountBadge) {
      participantCountBadge.setAttribute("aria-label", `Участников в комнате: ${allTiles.length}`);
    }
    updateParticipantList();
    for (const tile of tiles) {
      tile.style.removeProperty("grid-column");
      tile.style.removeProperty("grid-row");
    }
    /* Нечётные n≥3: ⌈n/2⌉ сверху, ⌊n/2⌋ снизу на всю ширину (3→2+1, 5→3+2, 7→4+3, …) */
    if (n >= 3 && n % 2 === 1) {
      const topCount = Math.ceil(n / 2);
      const bottomCount = Math.floor(n / 2);
      const gridCols = lcm(topCount, bottomCount);
      const topSpan = gridCols / topCount;
      const bottomSpan = gridCols / bottomCount;
      participantGrid.style.setProperty("--cols", String(gridCols));
      participantGrid.style.setProperty("--rows", "2");
      const list = Array.from(tiles);
      for (let i = 0; i < topCount; i++) {
        const start = i * topSpan + 1;
        const end = (i + 1) * topSpan + 1;
        list[i].style.gridRow = "1";
        list[i].style.gridColumn = `${start} / ${end}`;
      }
      for (let j = 0; j < bottomCount; j++) {
        const idx = topCount + j;
        const start = j * bottomSpan + 1;
        const end = (j + 1) * bottomSpan + 1;
        list[idx].style.gridRow = "2";
        list[idx].style.gridColumn = `${start} / ${end}`;
      }
      return;
    }
    const { cols, rows } = getGridDimensions(n);
    participantGrid.style.setProperty("--cols", String(cols));
    participantGrid.style.setProperty("--rows", String(rows));
  }

  function findTileByPeerId(peerId) {
    if (!participantGrid) return null;
    for (const el of participantGrid.querySelectorAll(".participant-tile[data-peer-id]")) {
      if (el.dataset.peerId === peerId) return el;
    }
    return null;
  }

  function refreshRemoteTileMediaStatus(peerId) {
    const tile = findTileByPeerId(peerId);
    if (!tile) return;
    const stream = state.remoteStreamsByPeerId.get(peerId);
    const reported = remoteMediaStateByPeerId.get(peerId);
    if (stream) {
      updateRemoteParticipantIndicators(tile, stream, reported ?? null);
    } else if (reported) {
      paintParticipantMediaFromReported(tile, reported);
    }
  }

  function normalizeRemoteVideoTracksForPeer(peerId) {
    const stream = state.remoteStreamsByPeerId.get(peerId);
    if (!stream) return;
    const reported = remoteMediaStateByPeerId.get(peerId) ?? null;
    const orderedIds = remoteVideoTrackOrderByPeerId.get(peerId) ?? [];
    const videoTracks = stream.getVideoTracks().filter((track) => track.readyState === "live");
    if (videoTracks.length <= 1) return;
    if (reported?.screenSharing) {
      // Do not prune tracks while demo is active.
      // Renegotiation order is unstable; removing tracks here can drop the
      // actual screen track and leave remote with a black main video.
      return;
    }
    // Remote track ids can diverge from sender track ids after replaceTrack/addTrack.
    // In this state, pruning tracks can drop the actual screen track and leave black video.
    if (reported?.screenSharing && !reported?.cameraTrackId) return;

    const byId = new Map(videoTracks.map((track) => [track.id, track]));
    const orderedTracks = orderedIds
      .map((id) => byId.get(id) ?? null)
      .filter(Boolean);
    for (const track of videoTracks) {
      if (!orderedTracks.some((candidate) => candidate.id === track.id)) {
        orderedTracks.push(track);
      }
    }

    const cameraById = reported?.cameraTrackId ? byId.get(reported.cameraTrackId) ?? null : null;
    const newestTrack = orderedTracks[orderedTracks.length - 1] ?? videoTracks[videoTracks.length - 1] ?? null;
    const scoreTrackAsScreen = (track) => {
      const label = String(track.label || "").toLowerCase();
      const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
      const displaySurface = String(settings.displaySurface || "").toLowerCase();
      const contentHint = String(track.contentHint || "").toLowerCase();
      const width = Number(settings.width || 0);
      const height = Number(settings.height || 0);
      const area = width > 0 && height > 0 ? width * height : 0;
      let score = 0;
      if (displaySurface) score += 10000;
      if (displaySurface === "monitor" || displaySurface === "window" || displaySurface === "browser") score += 5000;
      if (label.includes("screen") || label.includes("display") || label.includes("window") || label.includes("monitor") || label.includes("tab")) score += 2500;
      if (contentHint === "detail" || contentHint === "text") score += 1200;
      if (track.enabled === false) score -= 7000;
      if (track.muted) score -= 4500;
      score += Math.min(Math.round(area / 100000), 120);
      return score;
    };
    const pickLikelyScreenTrack = (candidates) => {
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
    const pickLikelyCameraTrack = (candidates) => {
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

    const keepIds = new Set();
    if (reported?.screenSharing) {
      const shareTrack = pickLikelyScreenTrack(orderedTracks) ?? newestTrack;
      if (shareTrack) keepIds.add(shareTrack.id);
      if (reported?.cameraEnabled) {
        const cameraTrack = cameraById
          ?? pickLikelyCameraTrack(orderedTracks.filter((track) => track.id !== shareTrack?.id))
          ?? [...orderedTracks].find((track) => track.id !== shareTrack?.id)
          ?? null;
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
      } catch (_error) {
        // Keep going; this is a best-effort cleanup.
      }
    }
    remoteVideoTrackOrderByPeerId.set(
      peerId,
      (remoteVideoTrackOrderByPeerId.get(peerId) ?? []).filter((id) => keepIds.has(id)),
    );
  }

  function attachLocalStreamMediaListeners(stream) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      if (localTracksMediaNotify.has(track)) continue;
      localTracksMediaNotify.add(track);
      track.addEventListener("mute", () => updateMediaButtonLabels());
      track.addEventListener("unmute", () => updateMediaButtonLabels());
      track.addEventListener("ended", () => updateMediaButtonLabels());
    }
  }

  async function broadcastMyMediaState(reason = "state-update") {
    if (!state.joined || !state.localStream) return;
    const a = state.localStream.getAudioTracks()[0];
    const cameraTrack = getLocalCameraTrack();
    const audioEnabled = Boolean(a && a.enabled);
    const cameraTrackEnabled = Boolean(cameraTrack && cameraTrack.enabled && cameraTrack.readyState === "live");
    const screenEnabled = Boolean(isScreenSharing && screenShareTrack && screenShareTrack.readyState === "live");
    const hasScreenShareCameraSender = [...screenShareSenderByPeerId.values()].some((sender) => (
      sender?.track?.kind === "video"
      && sender.track.readyState === "live"
      && sender.track.enabled
      && sender.track.id === cameraTrack?.id
    ));
    const cameraEnabled = screenEnabled ? Boolean(cameraTrackEnabled && hasScreenShareCameraSender) : cameraTrackEnabled;
    const videoEnabled = cameraEnabled || screenEnabled;
    const primaryVideoSource = screenEnabled ? "screen" : (cameraEnabled ? "camera" : "none");
    const activeStreamRef = primaryVideoSource === "screen" ? currentScreenStreamRef : (cameraEnabled ? currentCameraStreamRef : null);
    const payload = {
      audioEnabled,
      videoEnabled,
      cameraEnabled,
      screenSharing: isScreenSharing,
      primaryVideoSource,
      streamRef: activeStreamRef,
      screenTrackId: isScreenSharing ? (screenShareTrack?.id ?? null) : null,
      cameraTrackId: cameraTrack?.id ?? null,
    };
    try {
      const ack = await signaling.emitWithAck("peerMediaState", payload);
      if (typeof ack?.version === "number" && Number.isFinite(ack.version)) {
        conferenceState.applyPatch({
          peerId: state.myPeerId || "local",
          version: ack.version,
          patch: payload,
        });
      }
    } catch (error) {
      log(`peerMediaState ack error (${reason}): ${error.message}`);
    }
    logLocalVideoTracks("broadcastMyMediaState");
  }

  function updateMediaButtonLabels() {
    const audioTrack = state.localStream?.getAudioTracks()[0];
    const videoTrack = state.localStream?.getVideoTracks()[0];
    const micEnabled = audioTrack ? audioTrack.enabled : false;
    const camEnabled = videoTrack ? videoTrack.enabled : false;

    const micGlyph = toggleMicButton.querySelector(".material-symbols-outlined");
    if (micGlyph) {
      micGlyph.textContent = micEnabled ? "mic" : "mic_off";
      micGlyph.style.fontVariationSettings = micEnabled
        ? '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24'
        : '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24';
    }
    toggleMicButton.setAttribute("aria-pressed", micEnabled ? "true" : "false");

    const camGlyph = toggleCamButton.querySelector(".material-symbols-outlined");
    if (camGlyph) {
      camGlyph.textContent = camEnabled ? "videocam" : "videocam_off";
      camGlyph.style.fontVariationSettings = camEnabled
        ? '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24'
        : '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24';
    }
    toggleCamButton.setAttribute("aria-pressed", camEnabled ? "true" : "false");

    syncLocalTileIndicators();
    syncLocalTileVisibility();
    void broadcastMyMediaState();
    updateShareButtonLabel();
    void qualityReporter.emitOnce();
    if (state.joined) {
      setControlsEnabled(true);
      updateGridLayout();
    }
  }

  function getOrCreateRemoteTile(peerId) {
    const existing = findTileByPeerId(peerId);
    if (existing) return existing;

    const tile = document.createElement("article");
    tile.className = "participant-tile";
    tile.dataset.peerId = peerId;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.className = "participant-tile__main-video";

    const name = document.createElement("span");
    name.className = "participant-name";
    name.textContent = `Участник ${peerId.slice(0, 5)}`;

    const fallback = document.createElement("div");
    fallback.className = "participant-tile__fallback";
    fallback.hidden = true;
    const av = document.createElement("div");
    av.className = "participant-tile__avatar";
    av.setAttribute("aria-hidden", "true");
    const fbName = document.createElement("span");
    fbName.className = "participant-tile__fallback-name";
    fallback.append(av, fbName);

    const status = document.createElement("div");
    status.className = "participant-status";
    status.setAttribute("aria-live", "polite");

    tile.append(name, video, fallback, status);
    syncTileAvatarFallback(tile, null, null, false);
    participantGrid.appendChild(tile);
    bindTileFullscreen(tile);
    updateSoloLayout();
    updateGridLayout();
    return tile;
  }

  function removeRemoteTile(peerId) {
    const tile = findTileByPeerId(peerId);
    if (tile) {
      if (document.fullscreenElement === tile) {
        void document.exitFullscreen().catch(() => { });
      }
      speaker.unbindTile(tile);
      tile.remove();
    }
    updateSoloLayout();
    updateGridLayout();
  }

  function removeAllRemoteTiles() {
    participantGrid.querySelectorAll(".participant-tile[data-peer-id]").forEach((el) => {
      el.remove();
    });
    updateSoloLayout();
    updateGridLayout();
  }

  function ensurePeerConnection(peerId) {
    if (peerConnections.has(peerId)) {
      return peerConnections.get(peerId);
    }

    const peerConnection = new RTCPeerConnection(rtcConfig);
    const audioTrack = state.localStream.getAudioTracks()[0] ?? null;
    const videoTrack = getCurrentOutgoingVideoTrack();
    if (audioTrack) {
      peerConnection.addTrack(audioTrack, state.localStream);
    }
    if (videoTrack) {
      const videoSourceStream = (isScreenSharing && screenShareStream && videoTrack.id === screenShareTrack?.id)
        ? screenShareStream
        : state.localStream;
      peerConnection.addTrack(videoTrack, videoSourceStream);
    }
    if (isScreenSharing) {
      const cameraTrack = getLocalCameraTrack();
      if (cameraTrack && cameraTrack.id !== videoTrack?.id) {
        const extraCameraSender = peerConnection.addTrack(cameraTrack, state.localStream);
        screenShareSenderByPeerId.set(peerId, extraCameraSender);
      }
    }
    logOutgoingSenders(peerId, "ensurePeerConnection:after-addTrack");

    const scheduleRemoteMediaUi = () => {
      refreshRemoteTileMediaStatus(peerId);
    };

    peerConnection.ontrack = (event) => {
      const tile = getOrCreateRemoteTile(peerId);
      let stream = state.remoteStreamsByPeerId.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        state.remoteStreamsByPeerId.set(peerId, stream);
      }
      if (!stream.getTracks().some((t) => t.id === event.track.id)) {
        stream.addTrack(event.track);
      }
      if (event.track.kind === "video") {
        const existingOrder = remoteVideoTrackOrderByPeerId.get(peerId) ?? [];
        if (!existingOrder.includes(event.track.id)) {
          existingOrder.push(event.track.id);
          remoteVideoTrackOrderByPeerId.set(peerId, existingOrder);
        }
      }
      const reported = remoteMediaStateByPeerId.get(peerId);
      normalizeRemoteVideoTracksForPeer(peerId);
      syncRemoteTileVideoLayout(tile, stream, {
        isRemoteScreenSharing: Boolean(reported?.screenSharing),
        isRemoteCameraEnabled: reported?.cameraEnabled ?? true,
        remotePrimaryVideoSource: reported?.primaryVideoSource ?? "none",
        remoteScreenTrackId: reported?.screenTrackId ?? null,
        remoteCameraTrackId: reported?.cameraTrackId ?? null,
        remoteTrackOrder: remoteVideoTrackOrderByPeerId.get(peerId) ?? [],
      });
      logRemoteVideoTracks(peerId, `ontrack:${event.track.kind}`);
      bindStreamToTileIndicators(tile, stream, scheduleRemoteMediaUi);
      refreshRemoteTileMediaStatus(peerId);
      attachSpeakerToTileStream(tile, stream);
      event.track.addEventListener("ended", () => {
        const latest = state.remoteStreamsByPeerId.get(peerId);
        if (!latest) return;
        const stale = latest.getTracks().find((t) => t.id === event.track.id);
        if (stale) {
          latest.removeTrack(stale);
        }
        if (event.track.kind === "video") {
          const existingOrder = remoteVideoTrackOrderByPeerId.get(peerId) ?? [];
          remoteVideoTrackOrderByPeerId.set(
            peerId,
            existingOrder.filter((trackId) => trackId !== event.track.id),
          );
        }
        normalizeRemoteVideoTracksForPeer(peerId);
        const latestReported = remoteMediaStateByPeerId.get(peerId);
        syncRemoteTileVideoLayout(tile, latest, {
          isRemoteScreenSharing: Boolean(latestReported?.screenSharing),
          isRemoteCameraEnabled: latestReported?.cameraEnabled ?? true,
          remotePrimaryVideoSource: latestReported?.primaryVideoSource ?? "none",
          remoteScreenTrackId: latestReported?.screenTrackId ?? null,
          remoteCameraTrackId: latestReported?.cameraTrackId ?? null,
          remoteTrackOrder: remoteVideoTrackOrderByPeerId.get(peerId) ?? [],
        });
        logRemoteVideoTracks(peerId, `track-ended:${event.track.kind}`);
      });
    };

    peerConnection.onicecandidate = async (event) => {
      if (!event.candidate) return;
      try {
        await signaling.emitWithAck("rtcIceCandidate", {
          targetPeerId: peerId,
          candidate: event.candidate,
        });
      } catch (error) {
        log(`ICE send error: ${error.message}`);
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const st = peerConnection.connectionState;
      log(`PC ${peerId.slice(0, 5)} connectionState=${st}`);
      void qualityReporter.emitOnce();
      if (st === "failed") {
        if (disconnectCleanupTimers.has(peerId)) {
          clearTimeout(disconnectCleanupTimers.get(peerId));
          disconnectCleanupTimers.delete(peerId);
        }
        cleanupRemoteByPeer(peerId);
        return;
      }
      if (st === "disconnected") {
        if (disconnectCleanupTimers.has(peerId)) {
          clearTimeout(disconnectCleanupTimers.get(peerId));
        }
        const t = window.setTimeout(() => {
          disconnectCleanupTimers.delete(peerId);
          if (peerConnections.get(peerId) !== peerConnection) return;
          if (peerConnection.connectionState === "disconnected" || peerConnection.connectionState === "failed") {
            cleanupRemoteByPeer(peerId);
          }
        }, 15000);
        disconnectCleanupTimers.set(peerId, t);
        return;
      }
      if (st === "connected") {
        void broadcastMyMediaState();
        if (disconnectCleanupTimers.has(peerId)) {
          clearTimeout(disconnectCleanupTimers.get(peerId));
          disconnectCleanupTimers.delete(peerId);
        }
      }
    };

    peerConnection.onsignalingstatechange = () => {
      if (peerConnection.signalingState !== "stable") return;
      if (!pendingRenegotiationByPeerId.has(peerId)) return;
      void renegotiatePeer(peerId, "Pending");
    };

    peerConnections.set(peerId, peerConnection);
    return peerConnection;
  }

  async function flushPendingCandidates(peerId) {
    const peerConnection = peerConnections.get(peerId);
    if (!peerConnection || !peerConnection.remoteDescription) return;
    const queue = pendingCandidatesByPeerId.get(peerId) || [];
    while (queue.length) {
      const candidate = queue.shift();
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        log(`ICE add error: ${error.message}`);
      }
    }
    pendingCandidatesByPeerId.set(peerId, queue);
  }

  async function createOffer(peerId) {
    const peerConnection = ensurePeerConnection(peerId);
    const senders = peerConnection.getSenders();
    const sendingAudio = senders.some((s) => s.track && s.track.kind === "audio");
    const sendingVideo = senders.some((s) => s.track && s.track.kind === "video");
    if (!sendingAudio) {
      peerConnection.addTransceiver("audio", { direction: "recvonly" });
    }
    if (!sendingVideo) {
      peerConnection.addTransceiver("video", { direction: "recvonly" });
    }
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await signaling.emitWithAck("rtcOffer", {
      targetPeerId: peerId,
      sdp: offer,
    });
  }

  function cleanupRemoteByPeer(peerId) {
    if (disconnectCleanupTimers.has(peerId)) {
      clearTimeout(disconnectCleanupTimers.get(peerId));
      disconnectCleanupTimers.delete(peerId);
    }
    const peerConnection = peerConnections.get(peerId);
    if (peerConnection) {
      peerConnection.close();
      peerConnections.delete(peerId);
    }
    screenShareSenderByPeerId.delete(peerId);
    remoteVideoTrackOrderByPeerId.delete(peerId);
    pendingCandidatesByPeerId.delete(peerId);
    pendingRenegotiationByPeerId.delete(peerId);
    state.remoteStreamsByPeerId.delete(peerId);
    remoteMediaStateByPeerId.delete(peerId);
    remoteQualityStateByPeerId.delete(peerId);
    removeRemoteTile(peerId);
  }

  function cleanupCallResources() {
    stopPeerStatusPolling();
    stopMediaReconcileLoop();
    exitFullscreenIfParticipantTile();
    for (const peerConnection of peerConnections.values()) {
      peerConnection.close();
    }
    peerConnections.clear();
    pendingCandidatesByPeerId.clear();
    pendingRenegotiationByPeerId.clear();
    pendingRtcOffers.length = 0;
    screenShareSenderByPeerId.clear();
    remoteVideoTrackOrderByPeerId.clear();
    for (const t of disconnectCleanupTimers.values()) {
      clearTimeout(t);
    }
    disconnectCleanupTimers.clear();

    speaker.reset();

    stopMediaStream(state.localStream);
    state.localStream = null;
    localVideo.srcObject = null;
    setLocalSharePreview(false);
    baseCameraTrack = null;
    screenShareTrack = null;
    screenShareStream = null;
    isScreenSharing = false;
    currentCameraStreamRef = null;
    currentScreenStreamRef = null;
    cameraMachine.setState("off");
    screenMachine.setState("off");
    updateShareButtonLabel();
    qualityReporter.stop();

    removeAllRemoteTiles();
    state.remoteStreamsByPeerId.clear();
    remoteMediaStateByPeerId.clear();
    remoteQualityStateByPeerId.clear();
    resetCopyInviteUi();
    updateMediaButtonLabels();
    updateGridLayout();
  }

  async function startCall() {
    if (state.joined) return;
    startCallButton.disabled = true;

    try {
      state.localStream = await acquireLocalCallStreamWithFallback();
      baseCameraTrack = state.localStream.getVideoTracks()[0] ?? null;
      cameraMachine.setState(baseCameraTrack ? "on" : "off");
      micMachine.setEnabled(Boolean(state.localStream.getAudioTracks()[0]?.enabled));
      if (baseCameraTrack) {
        currentCameraStreamRef = nextCameraStreamRef();
      }
      if (state.localStream.getTracks().length === 0) {
        log("Нет доступа к камере/микрофону — только просмотр и прослушивание");
      }
      applyLocalPreviewTrack(baseCameraTrack);
      attachLocalStreamMediaListeners(state.localStream);
      const joinRes = await signaling.emitWithAck("joinRoom", { roomId: state.roomId });
      state.myPeerId = String(joinRes?.peerId ?? "");
      if (baseCameraTrack && (!currentCameraStreamRef || currentCameraStreamRef.startsWith("camera:local:"))) {
        currentCameraStreamRef = nextCameraStreamRef();
      }
      if (joinRes.roomId && typeof joinRes.roomId === "string") {
        state.roomId = joinRes.roomId;
        replaceHistoryWithCanonicalRoom(state.roomId);
        if (roomLabel) {
          roomLabel.textContent = state.roomId;
        }
      }
      for (const row of joinRes.peerMediaHints ?? []) {
        applyRemoteMediaHint(String(row.peerId), row);
      }
      for (const row of joinRes.peerQualityStates ?? []) {
        remoteQualityStateByPeerId.set(String(row.peerId), row);
      }
      conferenceState.applySnapshot(joinRes.conferenceSnapshot ?? null);
      roomScalabilityMode = joinRes.scalabilityMode ?? "full";
      await applyAdaptiveTrackLimits();
      state.joined = true;
      setCallUiJoined(true);
      await syncConferenceSnapshot("join");
      await speaker.resumeAudio();
      bindStreamToTileIndicators(getLocalTile(), state.localStream);
      attachSpeakerToTileStream(getLocalTile(), state.localStream);
      setControlsEnabled(true);
      updateMediaButtonLabels();
      qualityReporter.start();
      startPeerStatusPolling();
      startMediaReconcileLoop();
      updateGridLayout();

      while (pendingRtcOffers.length) {
        const offer = pendingRtcOffers.shift();
        if (offer) {
          try {
            await handleRtcOffer(offer);
          } catch (err) {
            log(`Deferred offer error: ${err.message}`);
          }
        }
      }

      log(`Joined room ${state.roomId}`);
    } catch (error) {
      cleanupCallResources();
      setCallUiJoined(false);
      log(`Error: ${error.message}`);
    } finally {
      startCallButton.disabled = false;
    }
  }

  async function leaveCall() {
    if (!state.joined) return;

    try {
      await signaling.emitWithAck("leaveRoom");
    } catch (_error) {
      // Ignore leave errors; continue local cleanup.
    }

    cleanupCallResources();
    state.joined = false;
    setControlsEnabled(false);
    setCallUiJoined(false);
    log("Call ended");
  }

  function toggleAudio() {
    const audioTrack = state.localStream?.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    micMachine.setEnabled(audioTrack.enabled);
    updateMediaButtonLabels();
  }

  async function toggleVideo() {
    const videoTrack = state.localStream?.getVideoTracks()[0];
    if (!videoTrack) return;
    await publishMachine.runPrepareAndCommit({
      prepare: async () => {
        if (videoTrack.enabled) {
          cameraMachine.setState("disabling");
        } else {
          cameraMachine.setState("enabling");
          if (!currentCameraStreamRef) {
            currentCameraStreamRef = nextCameraStreamRef();
          }
        }
        videoTrack.enabled = !videoTrack.enabled;
        if (isScreenSharing) {
          await syncScreenShareCameraSenders("toggleVideo");
        }
      },
      commit: async () => {
        cameraMachine.setState(videoTrack.enabled ? "on" : "off");
        updateMediaButtonLabels();
      },
      rollback: async () => {
        cameraMachine.setState(videoTrack.enabled ? "on" : "off");
      },
    });
  }

  signaling.on("peerJoined", async ({ peerId }) => {
    if (!state.joined) return;
    void broadcastMyMediaState();
    void qualityReporter.emitOnce();
    try {
      await createOffer(peerId);
      log(`Peer joined: ${peerId.slice(0, 5)}`);
    } catch (error) {
      log(`Offer error: ${error.message}`);
    }
  });

  async function handleRtcOffer({ fromPeerId, sdp }) {
    const peerConnection = ensurePeerConnection(fromPeerId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    await flushPendingCandidates(fromPeerId);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await signaling.emitWithAck("rtcAnswer", {
      targetPeerId: fromPeerId,
      sdp: answer,
    });
  }

  signaling.on("peerLeft", ({ peerId }) => {
    cleanupRemoteByPeer(peerId);
    log(`Peer left: ${peerId.slice(0, 5)}`);
  });

  signaling.on("rtcOffer", async ({ fromPeerId, sdp }) => {
    if (!state.joined || !state.localStream) {
      pendingRtcOffers.push({ fromPeerId, sdp });
      return;
    }
    try {
      await handleRtcOffer({ fromPeerId, sdp });
    } catch (error) {
      log(`Offer handle error: ${error.message}`);
    }
  });

  signaling.on("rtcAnswer", async ({ fromPeerId, sdp }) => {
    const peerConnection = peerConnections.get(fromPeerId);
    if (!peerConnection) return;
    try {
      if (peerConnection.signalingState !== "have-local-offer") {
        log(`Skip answer from ${fromPeerId.slice(0, 5)} in state ${peerConnection.signalingState}`);
        return;
      }
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingCandidates(fromPeerId);
    } catch (error) {
      log(`Answer handle error: ${error.message}`);
    }
  });

  function handleIncomingPeerMediaState({
    fromPeerId,
    audioEnabled,
    videoEnabled,
    cameraEnabled,
    screenSharing,
    primaryVideoSource,
    streamRef,
    screenTrackId,
    cameraTrackId,
  }) {
    if (!state.joined) return;
    const pid = String(fromPeerId);
    log(
      `[signal-media] peer=${pid} incoming `
      + `audio=${Boolean(audioEnabled)} video=${Boolean(videoEnabled)} `
      + `camera=${typeof cameraEnabled === "boolean" ? cameraEnabled : "-"} `
      + `screen=${Boolean(screenSharing)} primary=${primaryVideoSource ?? "-"} `
      + `streamRef=${streamRef ?? "-"}`,
    );
    applyRemoteMediaHint(pid, {
      audioEnabled,
      videoEnabled,
      cameraEnabled: typeof cameraEnabled === "boolean" ? cameraEnabled : undefined,
      screenSharing: Boolean(screenSharing),
      primaryVideoSource:
        primaryVideoSource === "screen" || primaryVideoSource === "camera" || primaryVideoSource === "none"
          ? primaryVideoSource
          : undefined,
      streamRef: typeof streamRef === "string" ? streamRef : null,
      screenTrackId: screenTrackId ?? null,
      cameraTrackId: cameraTrackId ?? null,
    });
    const tile = findTileByPeerId(pid);
    const stream = state.remoteStreamsByPeerId.get(pid);
    if (tile && stream) {
      normalizeRemoteVideoTracksForPeer(pid);
      syncRemoteTileVideoLayout(tile, stream, {
        isRemoteScreenSharing: Boolean(screenSharing),
        isRemoteCameraEnabled: typeof cameraEnabled === "boolean" ? cameraEnabled : true,
        remotePrimaryVideoSource:
          primaryVideoSource === "screen" || primaryVideoSource === "camera" || primaryVideoSource === "none"
            ? primaryVideoSource
            : "none",
        remoteScreenTrackId: screenTrackId ?? null,
        remoteCameraTrackId: cameraTrackId ?? null,
        remoteTrackOrder: remoteVideoTrackOrderByPeerId.get(pid) ?? [],
      });
    }
    logRemoteVideoTracks(pid, "peerMediaState");
    refreshRemoteTileMediaStatus(pid);
  }

  signaling.on("peerMediaStateChanged", async ({ roomId, peerId, version, patch }) => {
    if (!state.joined) return;
    if (roomId && state.roomId && roomId !== state.roomId) return;
    const result = conferenceState.applyPatch({
      peerId: String(peerId ?? ""),
      version,
      patch: patch ?? {},
    });
    if (result.needSnapshot) {
      await syncConferenceSnapshot("version-gap");
      return;
    }
    if (!result.applied) return;
    handleIncomingPeerMediaState({
      fromPeerId: peerId,
      ...patch,
    });
  });

  signaling.on("peerMediaState", (payload) => {
    handleIncomingPeerMediaState(payload);
  });

  signaling.on("peerQualityState", (payload) => {
    if (!state.joined) return;
    const pid = String(payload?.fromPeerId ?? "");
    if (!pid) return;
    remoteQualityStateByPeerId.set(pid, payload);
  });

  signaling.on("conferenceSnapshot", ({ roomId, conferenceSnapshot }) => {
    if (!state.joined) return;
    if (roomId && state.roomId && roomId !== state.roomId) return;
    conferenceState.applySnapshot(conferenceSnapshot ?? null);
    for (const peer of conferenceSnapshot?.peers ?? []) {
      const peerId = String(peer?.peerId ?? "");
      if (!peerId || peerId === state.myPeerId) continue;
      applyRemoteMediaHint(peerId, {
        audioEnabled: Boolean(peer.mic?.enabled),
        videoEnabled: Boolean(peer.camera?.enabled || peer.screen?.enabled),
        cameraEnabled: Boolean(peer.camera?.enabled),
        screenSharing: Boolean(peer.screen?.enabled),
        primaryVideoSource: peer.screen?.enabled ? "screen" : (peer.camera?.enabled ? "camera" : "none"),
        streamRef: peer.screen?.enabled ? (peer.screen?.streamRef ?? null) : (peer.camera?.streamRef ?? null),
        screenTrackId: peer.screen?.trackRef ?? null,
        cameraTrackId: peer.camera?.trackRef ?? null,
      });
      refreshRemoteTileMediaStatus(peerId);
    }
    updateGridLayout();
  });

  signaling.on("kickedFromRoom", ({ roomId, byPeerId }) => {
    if (!state.joined) return;
    log(`[signal-media] kicked room=${roomId ?? "-"} by=${byPeerId ?? "-"}`);
    void leaveCall();
  });

  signaling.onSocketReady(() => {
    if (state.joined && state.localStream) {
      void broadcastMyMediaState();
      void syncConferenceSnapshot("reconnect");
      void qualityReporter.emitOnce();
    }
  });

  signaling.on("rtcIceCandidate", async ({ fromPeerId, candidate }) => {
    const peerConnection = peerConnections.get(fromPeerId);
    if (!peerConnection || !peerConnection.remoteDescription) {
      const queue = pendingCandidatesByPeerId.get(fromPeerId) || [];
      queue.push(candidate);
      pendingCandidatesByPeerId.set(fromPeerId, queue);
      return;
    }
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      log(`ICE add error: ${error.message}`);
    }
  });

  startCallButton.addEventListener("click", () => {
    void startCall();
  });

  bindToolbarAction(copyInviteButton, () => {
    void copyInviteLink();
  }, { resumeAudio: false });
  bindToolbarAction(toggleMicButton, () => {
    if (toggleMicButton.disabled) return;
    toggleAudio();
  });
  bindToolbarAction(toggleCamButton, () => {
    if (toggleCamButton.disabled) return;
    void toggleVideo();
  });
  bindToolbarAction(toggleShareButton, () => {
    if (!toggleShareButton || toggleShareButton.disabled) return;
    void toggleScreenShare();
  });
  bindToolbarAction(leaveCallButton, () => {
    if (leaveCallButton.disabled) return;
    void leaveCall();
  });

  if (copyInviteMain) {
    copyInviteMain.addEventListener("click", () => {
      void copyInviteLink();
    });
  }
  if (copyMeetingMini) {
    copyMeetingMini.addEventListener("click", () => {
      void copyInviteLink();
    });
  }
  if (copyInvitePrejoin) {
    copyInvitePrejoin.addEventListener("click", () => {
      void copyInviteLink();
    });
  }

  window.addEventListener("resize", () => {
    if (state.joined) {
      updateGridLayout();
    }
  }, { signal: abortSignal });

  window.addEventListener("beforeunload", () => {
    cleanupCallResources();
  }, { signal: abortSignal });

  if (participantCountBadge) {
    participantCountBadge.addEventListener("click", (event) => {
      event.preventDefault();
      setParticipantListOpen(participantListPopover?.hidden ?? true);
    });
    participantCountBadge.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setParticipantListOpen(participantListPopover?.hidden ?? true);
    });
  }
  document.addEventListener("click", (event) => {
    if (!participantListPopover || participantListPopover.hidden) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (participantListPopover.contains(target)) return;
    if (participantCountBadge?.contains(target)) return;
    setParticipantListOpen(false);
  }, { signal: abortSignal });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setParticipantListOpen(false);
  }, { signal: abortSignal });

  bindTileFullscreen(getLocalTile());

  setCallUiJoined(false);
  setParticipantListOpen(false);
  setControlsEnabled(false);
  updateShareButtonLabel();
  updateMediaButtonLabels();

  let shutdownInvoked = false;
  async function shutdown() {
    if (shutdownInvoked) return;
    shutdownInvoked = true;
    try {
      if (state.joined) {
        await leaveCall();
      } else {
        cleanupCallResources();
      }
    } catch (_) {
      // best-effort; continue cleanup
      try {
        cleanupCallResources();
      } catch (_) {
        // noop
      }
    }
    try {
      signaling.disconnect();
    } catch (_) {
      // noop
    }
    try {
      abortController.abort();
    } catch (_) {
      // noop
    }
  }

  return { shutdown };
}

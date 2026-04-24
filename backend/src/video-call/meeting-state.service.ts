import { Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

type PeerUser = {
  id: number | null;
  username: string;
};

type PeerMediaHint = {
  audioEnabled: boolean;
  videoEnabled: boolean;
  cameraEnabled?: boolean;
  screenSharing?: boolean;
  primaryVideoSource?: 'none' | 'camera' | 'screen';
  streamRef?: string | null;
  screenTrackId?: string | null;
  cameraTrackId?: string | null;
};

type PeerQualityState = Record<string, unknown>;

type ConferencePeerState = {
  peerId: string;
  user: PeerUser | null;
  mic: { enabled: boolean; updatedAt: string };
  camera: { enabled: boolean; streamRef: string | null; trackRef: string | null; updatedAt: string };
  screen: { enabled: boolean; streamRef: string | null; trackRef: string | null; updatedAt: string };
  publishedStreams: Record<string, { streamRef: string; kind: string; active: boolean; updatedAt: string }>;
  connectionState: 'connected' | 'disconnected';
  updatedAt: string;
};

type ConferenceState = {
  roomId: number;
  version: number;
  peers: Map<string, ConferencePeerState>;
  updatedAt: string;
};

@Injectable()
export class MeetingStateService {
  private readonly peerMediaHints = new Map<string, PeerMediaHint>();
  private readonly peerQualityStates = new Map<string, PeerQualityState>();
  private readonly peerUsers = new Map<string, PeerUser>();
  private readonly conferences = new Map<number, ConferenceState>();

  getDefaultPeerMediaHint(): PeerMediaHint {
    return {
      audioEnabled: true,
      videoEnabled: true,
      cameraEnabled: true,
      screenSharing: false,
      primaryVideoSource: 'camera',
      streamRef: null,
      screenTrackId: null,
      cameraTrackId: null,
    };
  }

  private createConferencePeerState(peerId: string): ConferencePeerState {
    const now = new Date().toISOString();
    return {
      peerId,
      user: this.peerUsers.get(peerId) ?? null,
      mic: { enabled: true, updatedAt: now },
      camera: { enabled: true, streamRef: null, trackRef: null, updatedAt: now },
      screen: { enabled: false, streamRef: null, trackRef: null, updatedAt: now },
      publishedStreams: {},
      connectionState: 'connected',
      updatedAt: now,
    };
  }

  private ensureConference(chatId: number) {
    const existing = this.conferences.get(chatId);
    if (existing) return existing;
    const created: ConferenceState = {
      roomId: chatId,
      version: 0,
      peers: new Map(),
      updatedAt: new Date().toISOString(),
    };
    this.conferences.set(chatId, created);
    return created;
  }

  private nextConferenceVersion(chatId: number) {
    const conference = this.ensureConference(chatId);
    conference.version += 1;
    conference.updatedAt = new Date().toISOString();
    return conference.version;
  }

  setPeerUser(peerId: string, user: PeerUser) {
    this.peerUsers.set(peerId, user);
  }

  getPeerUser(peerId: string) {
    return this.peerUsers.get(peerId) ?? null;
  }

  getPeerDirectory(peerIds: string[]) {
    return peerIds.map((peerId) => ({
      peerId,
      user: this.getPeerUser(peerId),
    }));
  }

  getPeerMediaHints(peerIds: string[]) {
    return peerIds.map((peerId) => ({
      peerId,
      ...(this.peerMediaHints.get(peerId) ?? this.getDefaultPeerMediaHint()),
    }));
  }

  getPeerQualityStates(peerIds: string[]) {
    return peerIds.map((peerId) => ({
      peerId,
      ...(this.peerQualityStates.get(peerId) ?? {}),
    }));
  }

  setPeerQualityState(peerId: string, qualityState: PeerQualityState) {
    this.peerQualityStates.set(peerId, {
      ...qualityState,
      updatedAt: new Date().toISOString(),
    });
  }

  applyPeerMediaState(peerId: string, chatId: number, patch: PeerMediaHint) {
    if (!chatId) {
      throw new WsException('Join room before sending media state');
    }
    this.peerMediaHints.set(peerId, {
      audioEnabled: patch.audioEnabled,
      videoEnabled: patch.videoEnabled,
      cameraEnabled: typeof patch.cameraEnabled === 'boolean' ? patch.cameraEnabled : patch.videoEnabled,
      screenSharing: Boolean(patch.screenSharing),
      primaryVideoSource: patch.primaryVideoSource ?? 'none',
      streamRef: patch.streamRef ?? null,
      screenTrackId: patch.screenTrackId ?? null,
      cameraTrackId: patch.cameraTrackId ?? null,
    });

    const now = new Date().toISOString();
    const conference = this.ensureConference(chatId);
    const peerState = conference.peers.get(peerId) ?? this.createConferencePeerState(peerId);
    const nextPeerState: ConferencePeerState = {
      ...peerState,
      user: this.getPeerUser(peerId),
      mic: { ...peerState.mic },
      camera: { ...peerState.camera },
      screen: { ...peerState.screen },
      publishedStreams: { ...peerState.publishedStreams },
      updatedAt: now,
    };
    if (typeof patch.audioEnabled === 'boolean') {
      nextPeerState.mic.enabled = patch.audioEnabled;
      nextPeerState.mic.updatedAt = now;
    }
    if (typeof patch.cameraEnabled === 'boolean') {
      nextPeerState.camera.enabled = patch.cameraEnabled;
      nextPeerState.camera.streamRef =
        patch.primaryVideoSource === 'camera' ? (patch.streamRef ?? null) : nextPeerState.camera.streamRef;
      nextPeerState.camera.trackRef = patch.cameraTrackId ?? null;
      nextPeerState.camera.updatedAt = now;
    }
    if (typeof patch.screenSharing === 'boolean') {
      nextPeerState.screen.enabled = patch.screenSharing;
      nextPeerState.screen.streamRef = patch.primaryVideoSource === 'screen' ? (patch.streamRef ?? null) : null;
      nextPeerState.screen.trackRef = patch.screenTrackId ?? null;
      nextPeerState.screen.updatedAt = now;
    }
    if (patch.streamRef && patch.primaryVideoSource) {
      nextPeerState.publishedStreams[patch.streamRef] = {
        streamRef: patch.streamRef,
        kind: patch.primaryVideoSource,
        active: true,
        updatedAt: now,
      };
    }
    conference.peers.set(peerId, nextPeerState);
    const version = this.nextConferenceVersion(chatId);
    return { chatId, version };
  }

  getConferenceSnapshot(chatId: number) {
    const conference = this.conferences.get(chatId);
    if (!conference) return null;
    return {
      roomId: conference.roomId,
      version: conference.version,
      updatedAt: conference.updatedAt,
      peers: [...conference.peers.values()].map((peer) => ({
        peerId: peer.peerId,
        user: peer.user ? { ...peer.user } : null,
        mic: { ...peer.mic },
        camera: { ...peer.camera },
        screen: { ...peer.screen },
        publishedStreams: { ...peer.publishedStreams },
        connectionState: peer.connectionState,
        updatedAt: peer.updatedAt,
      })),
    };
  }

  joinPeerToConference(chatId: number, peerId: string) {
    const conference = this.ensureConference(chatId);
    if (!conference.peers.has(peerId)) {
      conference.peers.set(peerId, this.createConferencePeerState(peerId));
      this.nextConferenceVersion(chatId);
    }
  }

  leavePeerFromConference(chatId: number, peerId: string, roomWillBeEmpty: boolean) {
    const conference = this.conferences.get(chatId);
    if (!conference) return;
    conference.peers.delete(peerId);
    this.peerMediaHints.delete(peerId);
    this.peerQualityStates.delete(peerId);
    this.peerUsers.delete(peerId);
    if (roomWillBeEmpty) {
      this.conferences.delete(chatId);
      return;
    }
    this.nextConferenceVersion(chatId);
  }

  getPeerStatus(peerIds: string[]) {
    return peerIds.map((peerId) => ({
      peerId,
      media: this.peerMediaHints.get(peerId) ?? this.getDefaultPeerMediaHint(),
      quality: this.peerQualityStates.get(peerId) ?? null,
    }));
  }
}

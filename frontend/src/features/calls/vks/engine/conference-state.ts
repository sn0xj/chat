import type { ConferencePeerSnapshot, ConferenceSnapshotDto } from './types';

function normalizePeerSnapshot(peer: Partial<ConferencePeerSnapshot> | null | undefined): ConferencePeerSnapshot | null {
  if (!peer || typeof peer !== 'object' || !peer.peerId) return null;
  return {
    peerId: String(peer.peerId),
    mic: {
      enabled: Boolean(peer.mic?.enabled),
      updatedAt: peer.mic?.updatedAt ?? null,
    },
    camera: {
      enabled: Boolean(peer.camera?.enabled),
      streamRef: peer.camera?.streamRef ?? null,
      trackRef: peer.camera?.trackRef ?? null,
      updatedAt: peer.camera?.updatedAt ?? null,
    },
    screen: {
      enabled: Boolean(peer.screen?.enabled),
      streamRef: peer.screen?.streamRef ?? null,
      trackRef: peer.screen?.trackRef ?? null,
      updatedAt: peer.screen?.updatedAt ?? null,
    },
    publishedStreams:
      peer.publishedStreams && typeof peer.publishedStreams === 'object' ? peer.publishedStreams : {},
    connectionState: peer.connectionState ?? 'unknown',
    updatedAt: peer.updatedAt ?? null,
  };
}

export type ApplyPatchInput = {
  peerId: string;
  version?: number;
  patch: {
    audioEnabled?: boolean;
    videoEnabled?: boolean;
    cameraEnabled?: boolean;
    screenSharing?: boolean;
    primaryVideoSource?: 'none' | 'camera' | 'screen';
    streamRef?: string | null;
    cameraTrackId?: string | null;
    screenTrackId?: string | null;
  };
};

export type ApplyPatchResult = { applied: boolean; needSnapshot: boolean };

export type ConferenceState = {
  applySnapshot: (snapshot: ConferenceSnapshotDto | null | undefined) => boolean;
  applyPatch: (input: ApplyPatchInput) => ApplyPatchResult;
  getPeer: (peerId: string) => ConferencePeerSnapshot | null;
  getVersion: () => number;
  getRoomSize: () => number;
  getRoomId: () => string | null;
};

export function createConferenceState(): ConferenceState {
  let roomId: string | null = null;
  let version = 0;
  const peers = new Map<string, ConferencePeerSnapshot>();

  return {
    applySnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return false;
      roomId = snapshot.roomId ?? roomId;
      version = Number(snapshot.version || 0);
      peers.clear();
      for (const raw of snapshot.peers ?? []) {
        const peer = normalizePeerSnapshot(raw);
        if (peer) peers.set(peer.peerId, peer);
      }
      return true;
    },
    applyPatch({ peerId, version: nextVersion, patch }) {
      if (!peerId || typeof patch !== 'object') {
        return { applied: false, needSnapshot: false };
      }
      const numericVersion = Number(nextVersion || 0);
      if (!Number.isFinite(numericVersion) || numericVersion <= 0) {
        return { applied: false, needSnapshot: false };
      }
      if (numericVersion <= version) {
        return { applied: false, needSnapshot: false };
      }
      if (numericVersion !== version + 1) {
        return { applied: false, needSnapshot: true };
      }
      const existing =
        peers.get(peerId) ?? normalizePeerSnapshot({ peerId } as ConferencePeerSnapshot);
      if (!existing) return { applied: false, needSnapshot: false };
      const now = new Date().toISOString();
      existing.mic.enabled = Boolean(patch.audioEnabled);
      existing.mic.updatedAt = now;
      existing.camera.enabled = Boolean(patch.cameraEnabled);
      existing.camera.streamRef =
        patch.primaryVideoSource === 'camera' ? patch.streamRef ?? null : existing.camera.streamRef;
      existing.camera.trackRef = patch.cameraTrackId ?? null;
      existing.camera.updatedAt = now;
      existing.screen.enabled = Boolean(patch.screenSharing);
      existing.screen.streamRef =
        patch.primaryVideoSource === 'screen' ? patch.streamRef ?? null : null;
      existing.screen.trackRef = patch.screenTrackId ?? null;
      existing.screen.updatedAt = now;
      if (patch.streamRef) {
        existing.publishedStreams[patch.streamRef] = {
          streamRef: patch.streamRef,
          kind: patch.primaryVideoSource ?? 'unknown',
          active: true,
          updatedAt: now,
        };
      }
      existing.updatedAt = now;
      peers.set(peerId, existing);
      version = numericVersion;
      return { applied: true, needSnapshot: false };
    },
    getPeer(peerId) {
      return peers.get(peerId) ?? null;
    },
    getVersion: () => version,
    getRoomSize: () => peers.size,
    getRoomId: () => roomId,
  };
}

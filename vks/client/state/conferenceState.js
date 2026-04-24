function normalizePeerSnapshot(peer) {
  if (!peer || typeof peer !== "object") return null;
  return {
    peerId: String(peer.peerId || ""),
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
    publishedStreams: peer.publishedStreams && typeof peer.publishedStreams === "object"
      ? peer.publishedStreams
      : {},
    connectionState: peer.connectionState ?? "unknown",
    updatedAt: peer.updatedAt ?? null,
  };
}

export function createConferenceState() {
  let roomId = null;
  let version = 0;
  /** @type {Map<string, ReturnType<typeof normalizePeerSnapshot>>} */
  const peers = new Map();

  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return false;
    roomId = snapshot.roomId ?? roomId;
    version = Number(snapshot.version || 0);
    peers.clear();
    for (const rawPeer of snapshot.peers ?? []) {
      const peer = normalizePeerSnapshot(rawPeer);
      if (!peer?.peerId) continue;
      peers.set(peer.peerId, peer);
    }
    return true;
  }

  function applyPatch({ peerId, version: nextVersion, patch }) {
    if (!peerId || typeof patch !== "object") {
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
    const existing = peers.get(peerId) ?? normalizePeerSnapshot({ peerId });
    if (!existing) {
      return { applied: false, needSnapshot: false };
    }
    existing.mic.enabled = Boolean(patch.audioEnabled);
    existing.mic.updatedAt = new Date().toISOString();
    existing.camera.enabled = Boolean(patch.cameraEnabled);
    existing.camera.streamRef = patch.primaryVideoSource === "camera" ? (patch.streamRef ?? null) : existing.camera.streamRef;
    existing.camera.trackRef = patch.cameraTrackId ?? null;
    existing.camera.updatedAt = new Date().toISOString();
    existing.screen.enabled = Boolean(patch.screenSharing);
    existing.screen.streamRef = patch.primaryVideoSource === "screen" ? (patch.streamRef ?? null) : null;
    existing.screen.trackRef = patch.screenTrackId ?? null;
    existing.screen.updatedAt = new Date().toISOString();
    if (patch.streamRef) {
      existing.publishedStreams[patch.streamRef] = {
        streamRef: patch.streamRef,
        kind: patch.primaryVideoSource ?? "unknown",
        active: true,
        updatedAt: new Date().toISOString(),
      };
    }
    existing.updatedAt = new Date().toISOString();
    peers.set(peerId, existing);
    version = numericVersion;
    return { applied: true, needSnapshot: false };
  }

  function getPeer(peerId) {
    return peers.get(peerId) ?? null;
  }

  function getVersion() {
    return version;
  }

  function getRoomSize() {
    return peers.size;
  }

  return {
    applySnapshot,
    applyPatch,
    getPeer,
    getVersion,
    getRoomSize,
    getRoomId: () => roomId,
  };
}

function clampNumber(input, min, max) {
  if (typeof input !== "number" || Number.isNaN(input)) return undefined;
  return Math.max(min, Math.min(max, input));
}

function toReadyState(track) {
  if (!track) return "unknown";
  if (track.readyState === "live" || track.readyState === "ended") {
    return track.readyState;
  }
  return "unknown";
}

function mapConnectionSnapshot(statsSnapshot) {
  if (!statsSnapshot) return undefined;
  return {
    iceConnectionState: statsSnapshot.iceConnectionState,
    connectionState: statsSnapshot.connectionState,
    rttMs: statsSnapshot.rttMs,
    jitterMs: statsSnapshot.jitterMs,
    packetLossPct: statsSnapshot.packetLossPct,
    audioBitrateKbps: statsSnapshot.audioBitrateKbps,
    videoBitrateKbps: statsSnapshot.videoBitrateKbps,
    availableOutgoingBitrateKbps: statsSnapshot.availableOutgoingBitrateKbps,
    availableIncomingBitrateKbps: statsSnapshot.availableIncomingBitrateKbps,
  };
}

function createMicLevelMeter() {
  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let levelArray = null;
  let noiseThreshold = 0.055;
  let noiseFrames = 0;

  function disconnect() {
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    analyser = null;
    levelArray = null;
  }

  async function bindStream(stream) {
    disconnect();
    const audioTrack = stream?.getAudioTracks?.()[0];
    if (!audioTrack) return;
    if (!audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioContext = new Ctx();
    }
    if (audioContext.state === "suspended") {
      await audioContext.resume().catch(() => {});
    }
    const measuredStream = new MediaStream([audioTrack]);
    sourceNode = audioContext.createMediaStreamSource(measuredStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.65;
    levelArray = new Float32Array(analyser.fftSize);
    sourceNode.connect(analyser);
  }

  function readLevel() {
    if (!analyser || !levelArray) {
      return { level: undefined, noiseDetected: false };
    }
    analyser.getFloatTimeDomainData(levelArray);
    let sumSquares = 0;
    for (const sample of levelArray) {
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / levelArray.length);
    const level = clampNumber(rms, 0, 1);
    if (level && level > noiseThreshold) {
      noiseFrames += 1;
    } else {
      noiseFrames = Math.max(0, noiseFrames - 1);
    }
    return {
      level,
      noiseDetected: noiseFrames >= 2,
    };
  }

  function stop() {
    disconnect();
    if (audioContext) {
      void audioContext.close().catch(() => {});
      audioContext = null;
    }
    noiseFrames = 0;
  }

  return { bindStream, readLevel, stop };
}

async function collectConnectionStats(peerConnections) {
  let rttMs;
  let jitterMs;
  let packetLossPct;
  let audioBitrateKbps = 0;
  let videoBitrateKbps = 0;
  let availableOutgoingBitrateKbps;
  let availableIncomingBitrateKbps;
  let iceConnectionState = "new";
  let connectionState = "new";
  let consideredConnections = 0;

  for (const pc of peerConnections.values()) {
    iceConnectionState = pc.iceConnectionState || iceConnectionState;
    connectionState = pc.connectionState || connectionState;
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      continue;
    }
    consideredConnections += 1;
    const report = await pc.getStats();
    for (const stat of report.values()) {
      if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.nominated) {
        if (typeof stat.currentRoundTripTime === "number") {
          const value = stat.currentRoundTripTime * 1000;
          rttMs = typeof rttMs === "number" ? Math.max(rttMs, value) : value;
        }
        if (typeof stat.availableOutgoingBitrate === "number") {
          const out = stat.availableOutgoingBitrate / 1000;
          availableOutgoingBitrateKbps = typeof availableOutgoingBitrateKbps === "number"
            ? Math.min(availableOutgoingBitrateKbps, out)
            : out;
        }
        if (typeof stat.availableIncomingBitrate === "number") {
          const incoming = stat.availableIncomingBitrate / 1000;
          availableIncomingBitrateKbps = typeof availableIncomingBitrateKbps === "number"
            ? Math.min(availableIncomingBitrateKbps, incoming)
            : incoming;
        }
      }

      if (stat.type === "outbound-rtp" && !stat.isRemote) {
        if (typeof stat.bitrateMean === "number") {
          const meanKbps = stat.bitrateMean / 1000;
          if (stat.kind === "audio") audioBitrateKbps += meanKbps;
          if (stat.kind === "video") videoBitrateKbps += meanKbps;
        }
      }

      if (stat.type === "remote-inbound-rtp") {
        if (typeof stat.jitter === "number") {
          const value = stat.jitter * 1000;
          jitterMs = typeof jitterMs === "number" ? Math.max(jitterMs, value) : value;
        }
        if (typeof stat.fractionLost === "number") {
          const value = stat.fractionLost * 100;
          packetLossPct = typeof packetLossPct === "number" ? Math.max(packetLossPct, value) : value;
        }
      }
    }
  }

  return {
    iceConnectionState,
    connectionState,
    rttMs: clampNumber(rttMs, 0, 60000),
    jitterMs: clampNumber(jitterMs, 0, 60000),
    packetLossPct: clampNumber(packetLossPct, 0, 100),
    audioBitrateKbps: clampNumber(audioBitrateKbps, 0, 20000),
    videoBitrateKbps: clampNumber(videoBitrateKbps, 0, 200000),
    availableOutgoingBitrateKbps: clampNumber(availableOutgoingBitrateKbps, 0, 200000),
    availableIncomingBitrateKbps: clampNumber(availableIncomingBitrateKbps, 0, 200000),
    connectedPeers: consideredConnections,
  };
}

async function detectPermissionsState() {
  if (!navigator.permissions?.query) return {};
  const out = {};
  try {
    const micPermission = await navigator.permissions.query({ name: "microphone" });
    out.microphonePermission = micPermission.state;
  } catch {
    /* ignore unsupported permission query */
  }
  try {
    const camPermission = await navigator.permissions.query({ name: "camera" });
    out.cameraPermission = camPermission.state;
  } catch {
    /* ignore unsupported permission query */
  }
  return out;
}

function getSystemNetworkSnapshot() {
  const info = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!info) return undefined;
  return {
    networkType: typeof info.effectiveType === "string" ? info.effectiveType : undefined,
    downlinkMbps: clampNumber(info.downlink, 0, 10000),
    networkRttMs: clampNumber(info.rtt, 0, 60000),
  };
}

export function createPeerQualityReporter({
  getLocalStream,
  getPeerConnections,
  sendQualityState,
  intervalMs = 2000,
}) {
  const micLevelMeter = createMicLevelMeter();
  let timerId = null;
  let lastConnectionSnapshot = null;
  let staticPermissionsPromise = null;

  async function collectPayload() {
    const stream = getLocalStream();
    const audioTrack = stream?.getAudioTracks?.()[0];
    const videoTrack = stream?.getVideoTracks?.()[0];

    if (!staticPermissionsPromise) {
      staticPermissionsPromise = detectPermissionsState();
    }
    const permissions = await staticPermissionsPromise;

    const micLevels = micLevelMeter.readLevel();
    const audioSettings = audioTrack?.getSettings?.() ?? {};
    const videoSettings = videoTrack?.getSettings?.() ?? {};

    return {
      microphone: {
        enabled: Boolean(audioTrack?.enabled),
        muted: Boolean(audioTrack?.muted),
        readyState: toReadyState(audioTrack),
        level: micLevels.level,
        noiseDetected: micLevels.noiseDetected,
        noiseSuppressionEnabled:
          typeof audioSettings.noiseSuppression === "boolean"
            ? audioSettings.noiseSuppression
            : undefined,
        echoCancellationEnabled:
          typeof audioSettings.echoCancellation === "boolean" ? audioSettings.echoCancellation : undefined,
        autoGainControlEnabled:
          typeof audioSettings.autoGainControl === "boolean" ? audioSettings.autoGainControl : undefined,
      },
      camera: {
        enabled: Boolean(videoTrack?.enabled),
        muted: Boolean(videoTrack?.muted),
        readyState: toReadyState(videoTrack),
        width: clampNumber(videoSettings.width, 0, 7680),
        height: clampNumber(videoSettings.height, 0, 4320),
        frameRate: clampNumber(videoSettings.frameRate, 0, 240),
      },
      connection: mapConnectionSnapshot(lastConnectionSnapshot),
      system: {
        ...getSystemNetworkSnapshot(),
        ...permissions,
      },
    };
  }

  async function emitOnce() {
    try {
      const peerConnections = getPeerConnections();
      lastConnectionSnapshot = await collectConnectionStats(peerConnections);
      const payload = await collectPayload();
      sendQualityState(payload);
    } catch {
      /* avoid crashing call flow on unsupported browser stats */
    }
  }

  async function rebindLocalStream() {
    await micLevelMeter.bindStream(getLocalStream());
  }

  function start() {
    if (timerId) return;
    void rebindLocalStream();
    timerId = window.setInterval(() => {
      void emitOnce();
    }, intervalMs);
    void emitOnce();
  }

  function stop() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    micLevelMeter.stop();
  }

  return {
    start,
    stop,
    emitOnce,
    rebindLocalStream,
  };
}

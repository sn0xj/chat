type Entry = {
  peerId: string;
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
  source: MediaStreamAudioSourceNode;
  useFloat: boolean;
  /** Whether microphone is currently considered live for this peer. */
  micLive: boolean;
};

/**
 * Pure audio-level analyser that emits the id of the currently active speaker (or null).
 * No DOM access; the UI layer is responsible for highlighting.
 */
export type SpeakingActivity = {
  primaryPeerId: string | null;
  activePeerIds: string[];
};

export type SpeakingMonitor = {
  resumeAudio: () => Promise<void>;
  bind: (peerId: string, stream: MediaStream) => Promise<void>;
  unbind: (peerId: string) => void;
  setMicLive: (peerId: string, live: boolean) => void;
  reset: () => void;
  subscribe: (listener: (activity: SpeakingActivity) => void) => () => void;
};

export function createSpeakingMonitor(): SpeakingMonitor {
  let audioContext: AudioContext | null = null;
  const entries = new Map<string, Entry>();
  let rafId = 0;
  let lastPrimary: string | null = null;
  let lastPrimarySwitchAt = 0;
  const listeners = new Set<(activity: SpeakingActivity) => void>();
  const PRIMARY_HOLD_MS = 380;
  const RELEASE_HOLD_MS = 320;
  let lastEmitKey = '';

  const emit = (activity: SpeakingActivity) => {
    const key = `${activity.primaryPeerId ?? ''}|${activity.activePeerIds.join(',')}`;
    if (key === lastEmitKey) return;
    lastEmitKey = key;
    for (const listener of listeners) {
      listener(activity);
    }
  };

  const stopLoop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const disconnectEntry = (entry: Entry) => {
    try {
      entry.source.disconnect();
    } catch {
      /* ignore */
    }
    try {
      entry.analyser.disconnect();
    } catch {
      /* ignore */
    }
  };

  const ensureContext = async (): Promise<AudioContext | null> => {
    const AC =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!audioContext) {
      audioContext = new AC();
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => undefined);
    }
    return audioContext;
  };

  const measureRms = (entry: Entry): number => {
    const n = entry.analyser.fftSize;
    if (entry.useFloat) {
      const float = new Float32Array(n);
      entry.analyser.getFloatTimeDomainData(float);
      let sumSq = 0;
      for (let i = 0; i < float.length; i += 1) {
        sumSq += float[i] * float[i];
      }
      return Math.sqrt(sumSq / float.length);
    }
    entry.analyser.getByteTimeDomainData(entry.buffer);
    let sumSq = 0;
    for (let i = 0; i < entry.buffer.length; i += 1) {
      const d = entry.buffer[i] - 128;
      sumSq += d * d;
    }
    return Math.sqrt(sumSq / entry.buffer.length);
  };

  const tick = () => {
    if (entries.size === 0) {
      rafId = 0;
      const now = Date.now();
      if (lastPrimary && now - lastPrimarySwitchAt < RELEASE_HOLD_MS) {
        emit({ primaryPeerId: lastPrimary, activePeerIds: [lastPrimary] });
      } else {
        lastPrimary = null;
        emit({ primaryPeerId: null, activePeerIds: [] });
      }
      return;
    }
    type Level = { peerId: string; rms: number; useFloat: boolean };
    const levels: Level[] = [];
    for (const entry of entries.values()) {
      if (!entry.micLive) continue;
      levels.push({ peerId: entry.peerId, rms: measureRms(entry), useFloat: entry.useFloat });
    }
    levels.sort((a, b) => b.rms - a.rms);
    const now = Date.now();
    const top = levels[0];
    const second = levels[1]?.rms ?? 0;
    const minAbs = top?.useFloat ? 0.0012 : 1;
    let activePeerIds = levels.filter((l) => l.rms >= minAbs).map((l) => l.peerId);
    // Some browser/device combos report very low RMS for valid voice input.
    // If strict thresholding yielded no actives, keep the top speaker as a
    // soft fallback so 1:1 calls don't appear "dead".
    if (!activePeerIds.length && top && top.rms >= minAbs * 0.55) {
      activePeerIds = [top.peerId];
    }
    if (!activePeerIds.length) {
      if (lastPrimary && now - lastPrimarySwitchAt < RELEASE_HOLD_MS) {
        emit({ primaryPeerId: lastPrimary, activePeerIds: [lastPrimary] });
      } else {
        lastPrimary = null;
        emit({ primaryPeerId: null, activePeerIds: [] });
      }
      rafId = requestAnimationFrame(tick);
      return;
    }
    const topPeerId = top?.peerId ?? activePeerIds[0] ?? null;
    let primaryPeerId = topPeerId;
    if (
      lastPrimary &&
      lastPrimary !== topPeerId &&
      activePeerIds.includes(lastPrimary) &&
      now - lastPrimarySwitchAt < PRIMARY_HOLD_MS
    ) {
      primaryPeerId = lastPrimary;
    } else if (topPeerId && topPeerId !== lastPrimary) {
      lastPrimarySwitchAt = now;
    }
    lastPrimary = primaryPeerId;
    emit({ primaryPeerId, activePeerIds });
    rafId = requestAnimationFrame(tick);
  };

  const startLoop = () => {
    if (!rafId && entries.size > 0) {
      rafId = requestAnimationFrame(tick);
    }
  };

  return {
    async resumeAudio() {
      await ensureContext();
    },

    async bind(peerId, stream) {
      if (!peerId || !stream) return;
      const ctx = await ensureContext();
      if (!ctx) return;
      this.unbind(peerId);
      const audioTrack = stream.getAudioTracks().find((t) => t.readyState !== 'ended');
      if (!audioTrack) return;
      let source: MediaStreamAudioSourceNode;
      try {
        source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      } catch {
        return;
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize)) as Uint8Array<ArrayBuffer>;
      const useFloat = typeof analyser.getFloatTimeDomainData === 'function';
      entries.set(peerId, { peerId, analyser, buffer, source, useFloat, micLive: true });
      startLoop();
    },

    unbind(peerId) {
      const entry = entries.get(peerId);
      if (!entry) return;
      disconnectEntry(entry);
      entries.delete(peerId);
      if (lastPrimary === peerId) {
        lastPrimary = null;
        emit({ primaryPeerId: null, activePeerIds: [] });
      }
      if (entries.size === 0) stopLoop();
    },

    setMicLive(peerId, live) {
      const entry = entries.get(peerId);
      if (!entry) return;
      entry.micLive = live;
      if (!live && lastPrimary === peerId) {
        lastPrimary = null;
        emit({ primaryPeerId: null, activePeerIds: [] });
      }
    },

    reset() {
      stopLoop();
      for (const entry of entries.values()) disconnectEntry(entry);
      entries.clear();
      lastPrimary = null;
      lastPrimarySwitchAt = 0;
      lastEmitKey = '';
      emit({ primaryPeerId: null, activePeerIds: [] });
      if (audioContext) {
        audioContext.close().catch(() => undefined);
        audioContext = null;
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

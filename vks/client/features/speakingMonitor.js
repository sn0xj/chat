/**
 * Подсветка активного говорящего: анализ громкости по time-domain (лучше для речи).
 */
export function createActiveSpeakerHighlight() {
  let audioCtx = null;
  /** @type {{ tile: HTMLElement, analyser: AnalyserNode, buf: Uint8Array, src: MediaStreamAudioSourceNode, useFloat: boolean }[]} */
  const entries = [];
  let rafId = 0;

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function disconnectEntry(e) {
    try {
      e.src.disconnect();
    } catch (_err) {
      /* ignore */
    }
    try {
      e.analyser.disconnect();
    } catch (_err) {
      /* ignore */
    }
    e.tile.classList.remove("participant-tile--speaking");
  }

  async function ensureContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) {
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") {
      await audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function measureRms(e) {
    const n = e.analyser.fftSize;
    if (e.useFloat) {
      const f = new Float32Array(n);
      e.analyser.getFloatTimeDomainData(f);
      let sumSq = 0;
      for (let i = 0; i < f.length; i += 1) {
        sumSq += f[i] * f[i];
      }
      return Math.sqrt(sumSq / f.length);
    }
    e.analyser.getByteTimeDomainData(e.buf);
    let sumSq = 0;
    for (let i = 0; i < e.buf.length; i += 1) {
      const d = e.buf[i] - 128;
      sumSq += d * d;
    }
    return Math.sqrt(sumSq / e.buf.length);
  }

  function tick() {
    if (entries.length === 0) {
      rafId = 0;
      return;
    }
    /** @type {{ tile: HTMLElement, rms: number, useFloat: boolean }[]} */
    const levels = [];
    for (const e of entries) {
      if (e.tile.dataset.peerMicLive === "0") {
        e.tile.classList.remove("participant-tile--speaking");
        continue;
      }
      const rms = measureRms(e);
      levels.push({ tile: e.tile, rms, useFloat: e.useFloat });
    }
    levels.sort((a, b) => b.rms - a.rms);
    const top = levels[0];
    const second = levels[1]?.rms ?? 0;
    const minAbs = top?.useFloat ? 0.006 : 3;
    const active =
      top &&
      top.rms >= minAbs &&
      (levels.length < 2 || top.rms >= second * 1.15 || second < minAbs * 0.5);
    const winner = active ? top.tile : null;
    for (const e of entries) {
      e.tile.classList.toggle("participant-tile--speaking", Boolean(winner && e.tile === winner));
    }
    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (!rafId && entries.length) {
      rafId = requestAnimationFrame(tick);
    }
  }

  return {
    async resumeAudio() {
      await ensureContext();
    },

    async bindTile(tile, stream) {
      if (!tile || !stream) return;
      const ctx = await ensureContext();
      if (!ctx) return;

      this.unbindTile(tile);

      const audioTrack = stream.getAudioTracks().find((t) => t.readyState !== "ended");
      if (!audioTrack) return;

      let src;
      try {
        src = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      } catch (_err) {
        return;
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const useFloat = typeof analyser.getFloatTimeDomainData === "function";
      entries.push({ tile, analyser, buf, src, useFloat });
      startLoop();
    },

    unbindTile(tile) {
      const idx = entries.findIndex((e) => e.tile === tile);
      if (idx === -1) return;
      disconnectEntry(entries[idx]);
      entries.splice(idx, 1);
      if (entries.length === 0) {
        stopLoop();
      }
    },

    reset() {
      stopLoop();
      const copy = [...entries];
      entries.length = 0;
      for (const e of copy) {
        disconnectEntry(e);
      }
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
    },
  };
}

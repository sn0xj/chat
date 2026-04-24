/**
 * @param {{ ignoreAudioMuted?: boolean }} [opts]
 * — у локального превью `audioTrack.muted` часто true при том что `enabled` true → путает UI с тулбаром.
 */
export function micCamFromStream(stream, opts = {}) {
  const a = stream.getAudioTracks()[0];
  const v = stream.getVideoTracks()[0];
  const ignoreAudioMuted = Boolean(opts.ignoreAudioMuted);
  const micOn = Boolean(
    a && a.readyState === "live" && a.enabled && (ignoreAudioMuted || !a.muted)
  );
  const camOn = Boolean(v && v.readyState === "live" && v.enabled);
  return { micOn, camOn };
}

const FILL_ON = '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 20';
const FILL_OFF = '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 20';

function ensureParticipantFallbackStructure(tile) {
  if (!tile || tile.querySelector(".participant-tile__fallback")) return;
  const status = tile.querySelector(".participant-status");
  const fb = document.createElement("div");
  fb.className = "participant-tile__fallback";
  fb.hidden = true;
  const av = document.createElement("div");
  av.className = "participant-tile__avatar";
  av.setAttribute("aria-hidden", "true");
  const fn = document.createElement("span");
  fn.className = "participant-tile__fallback-name";
  fb.append(av, fn);
  if (status) {
    tile.insertBefore(fb, status);
  } else {
    tile.appendChild(fb);
  }
}

function computeShowLiveVideo(stream, reported, isLocal) {
  const tracks = stream?.getVideoTracks?.() ?? [];
  const hasLive = tracks.some((track) => (
    track.readyState === "live" && track.enabled
  ));
  if (isLocal) return hasLive;
  // Remote may report camera disabled while a separate screen-share video track is still live.
  // Keep live video only while screen sharing is explicitly active.
  if (hasLive && reported?.screenSharing) {
    return true;
  }
  if (typeof reported?.videoEnabled === "boolean" && !reported.videoEnabled && !reported?.screenSharing) {
    return false;
  }
  return hasLive;
}

/** Аватар + имя по центру, когда нет живого видео; верхний бейдж скрыт в этом режиме. */
export function syncTileAvatarFallback(tile, stream, reported, isLocal) {
  if (!tile) return;
  ensureParticipantFallbackStructure(tile);
  const showVideo = computeShowLiveVideo(stream, reported, isLocal);
  const video = tile.querySelector("video");
  const fb = tile.querySelector(".participant-tile__fallback");
  const nameEl = tile.querySelector(".participant-name");
  const av = tile.querySelector(".participant-tile__avatar");
  const fn = tile.querySelector(".participant-tile__fallback-name");
  const displayName = nameEl?.textContent?.trim() || "?";
  if (av) {
    const ch = displayName.charAt(0);
    av.textContent = ch ? ch.toLocaleUpperCase() : "?";
  }
  if (fn) {
    fn.textContent = displayName;
  }
  if (nameEl) {
    nameEl.hidden = !showVideo;
  }
  if (fb) {
    fb.hidden = showVideo;
  }
  if (video) {
    video.classList.toggle("participant-tile__video--hidden", !showVideo);
  }
}

function ensureParticipantStatusIcons(tile) {
  const el = tile.querySelector(".participant-status");
  if (!el) return null;
  let mic = el.querySelector("[data-media='mic']");
  let cam = el.querySelector("[data-media='cam']");
  if (!mic || !cam) {
    el.replaceChildren();
    mic = document.createElement("span");
    mic.className = "participant-status__icon material-symbols-outlined";
    mic.dataset.media = "mic";
    mic.setAttribute("aria-hidden", "true");
    cam = document.createElement("span");
    cam.className = "participant-status__icon material-symbols-outlined";
    cam.dataset.media = "cam";
    cam.setAttribute("aria-hidden", "true");
    el.append(mic, cam);
  }
  return { root: el, mic, cam };
}

/** Два состояния как у MUI Mic / MicOff и Videocam / VideocamOff (через Material Symbols). */
export function setParticipantStatusText(tile, micOn, camOn) {
  const parts = ensureParticipantStatusIcons(tile);
  if (!parts) return;
  const { root, mic, cam } = parts;
  mic.textContent = micOn ? "mic" : "mic_off";
  cam.textContent = camOn ? "videocam" : "videocam_off";
  mic.style.fontVariationSettings = micOn ? FILL_ON : FILL_OFF;
  cam.style.fontVariationSettings = camOn ? FILL_ON : FILL_OFF;
  tile.dataset.peerMicLive = micOn ? "1" : "0";
  tile.dataset.peerCamLive = camOn ? "1" : "0";
  root.setAttribute(
    "aria-label",
    `Микрофон ${micOn ? "включён" : "выключен"}, камера ${camOn ? "включена" : "выключена"}`
  );
}

/** Только сигналинг (ещё нет MediaStream на плитке). */
export function paintParticipantMediaFromReported(tile, reported) {
  if (!tile || !reported) return;
  const micOn = typeof reported.audioEnabled === "boolean" ? reported.audioEnabled : true;
  const camOn = typeof reported.videoEnabled === "boolean" ? reported.videoEnabled : true;
  setParticipantStatusText(tile, micOn, camOn);
  syncTileAvatarFallback(tile, null, reported, false);
}

export function updateTileFromStream(tile, stream) {
  const { micOn, camOn } = micCamFromStream(stream, { ignoreAudioMuted: true });
  setParticipantStatusText(tile, micOn, camOn);
  syncTileAvatarFallback(tile, stream, null, true);
}

/**
 * Удалённый участник: приоритет у состояния с сервера (отправитель выключил мик/кам в getUserMedia),
 * т.к. у приёмника `audioTrack.enabled` часто остаётся true.
 * @param {{ audioEnabled?: boolean, videoEnabled?: boolean } | null | undefined} reported
 */
export function updateRemoteParticipantIndicators(tile, stream, reported) {
  const fromStream = micCamFromStream(stream);
  const micOn =
    typeof reported?.audioEnabled === "boolean" ? reported.audioEnabled : fromStream.micOn;
  const camOn =
    typeof reported?.cameraEnabled === "boolean"
      ? reported.cameraEnabled
      : (typeof reported?.videoEnabled === "boolean" ? reported.videoEnabled : fromStream.camOn);
  setParticipantStatusText(tile, micOn, camOn);
  syncTileAvatarFallback(tile, stream, reported ?? null, false);
}

const wiredTracks = new WeakSet();

function wireTrack(track, upd) {
  if (wiredTracks.has(track)) return;
  wiredTracks.add(track);
  track.addEventListener("mute", upd);
  track.addEventListener("unmute", upd);
  track.addEventListener("ended", upd);
}

/**
 * @param {HTMLElement} tile
 * @param {MediaStream} stream
 * @param {(() => void) | undefined} refreshCallback — для удалённых: вызывать updateRemoteParticipantIndicators внутри
 */
export function bindStreamToTileIndicators(tile, stream, refreshCallback) {
  const upd = () => {
    if (typeof refreshCallback === "function") {
      refreshCallback();
    } else {
      updateTileFromStream(tile, stream);
    }
  };
  stream.getTracks().forEach((t) => wireTrack(t, upd));
  upd();
}

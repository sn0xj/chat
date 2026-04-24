/**
 * Полноэкранный режим плитки: кнопка (как Fullscreen / FullscreenExit из MUI) + двойной клик по плитке.
 * Иконки — Material Symbols (проект без React).
 */
const GLYPH_IN = "fullscreen";
const GLYPH_OUT = "fullscreen_exit";

let documentListenerAttached = false;
let immersiveTile = null;
let exitFab = null;

function ensureTileImmersiveExitButton(tile) {
  let btn = tile.querySelector(".participant-tile__immersive-exit");
  if (btn) return btn;
  btn = document.createElement("button");
  btn.type = "button";
  btn.className = "participant-tile__immersive-exit";
  btn.hidden = true;
  btn.setAttribute("aria-label", "Свернуть");
  const span = document.createElement("span");
  span.className = "material-symbols-outlined";
  span.textContent = GLYPH_OUT;
  span.setAttribute("aria-hidden", "true");
  span.style.fontVariationSettings = '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 22';
  btn.appendChild(span);
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    exitFullscreenIfParticipantTile();
  });
  tile.appendChild(btn);
  return btn;
}

function syncImmersiveTileExitButtons() {
  for (const tile of document.querySelectorAll(".participant-tile")) {
    const btn = tile.querySelector(".participant-tile__immersive-exit");
    if (!btn) continue;
    btn.hidden = immersiveTile !== tile;
  }
}

function ensureExitFab() {
  if (exitFab) return exitFab;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vks-fullscreen-exit-fab";
  btn.hidden = true;
  btn.setAttribute("aria-label", "Выйти из полноэкранного режима");
  const span = document.createElement("span");
  span.className = "material-symbols-outlined";
  span.textContent = GLYPH_OUT;
  span.setAttribute("aria-hidden", "true");
  span.style.fontVariationSettings = '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 22';
  btn.appendChild(span);
  btn.addEventListener("click", () => {
    exitFullscreenIfParticipantTile();
  });
  document.body.appendChild(btn);
  exitFab = btn;
  return btn;
}

function syncExitFabVisibility() {
  const btn = ensureExitFab();
  const isActive = Boolean(document.fullscreenElement || immersiveTile);
  btn.hidden = !isActive;
}

function syncAllFullscreenGlyphs() {
  for (const btn of document.querySelectorAll(".participant-tile__fullscreen")) {
    const tile = btn.closest(".participant-tile");
    const span = btn.querySelector(".material-symbols-outlined");
    if (!tile || !span) continue;
    const on = document.fullscreenElement === tile || immersiveTile === tile;
    span.textContent = on ? GLYPH_OUT : GLYPH_IN;
    btn.setAttribute("aria-label", on ? "Выйти из полноэкранного режима" : "На весь экран");
    span.style.fontVariationSettings = on
      ? '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 20'
      : '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 20';
  }
  syncImmersiveTileExitButtons();
  syncExitFabVisibility();
}

function enterImmersiveTile(tile) {
  if (immersiveTile && immersiveTile !== tile) {
    immersiveTile.classList.remove("participant-tile--immersive");
  }
  immersiveTile = tile;
  tile.classList.add("participant-tile--immersive");
  document.documentElement.classList.add("vks-immersive-active");
  syncAllFullscreenGlyphs();
}

function exitImmersiveTile() {
  if (!immersiveTile) return;
  immersiveTile.classList.remove("participant-tile--immersive");
  immersiveTile = null;
  document.documentElement.classList.remove("vks-immersive-active");
  syncAllFullscreenGlyphs();
}

async function toggleTileFullscreen(tile) {
  try {
    if (immersiveTile === tile) {
      exitImmersiveTile();
      return;
    }
    if (immersiveTile && immersiveTile !== tile) {
      exitImmersiveTile();
    }
    if (document.fullscreenElement === tile) {
      await document.exitFullscreen();
      return;
    }
    if (tile.requestFullscreen) {
      await tile.requestFullscreen();
      return;
    }
    enterImmersiveTile(tile);
  } catch (_err) {
    enterImmersiveTile(tile);
  }
}

function ensureDocumentListener() {
  if (documentListenerAttached) return;
  documentListenerAttached = true;
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
      exitImmersiveTile();
    }
    syncAllFullscreenGlyphs();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    exitFullscreenIfParticipantTile();
  });
}

/**
 * @param {HTMLElement | null} tile
 */
export function bindTileFullscreen(tile) {
  if (!tile || tile.dataset.vksFsBound === "1") return;
  tile.dataset.vksFsBound = "1";
  ensureDocumentListener();
  ensureExitFab();
  ensureTileImmersiveExitButton(tile);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "participant-tile__fullscreen";
  btn.setAttribute("aria-label", "На весь экран");
  const span = document.createElement("span");
  span.className = "material-symbols-outlined";
  span.textContent = GLYPH_IN;
  span.setAttribute("aria-hidden", "true");
  span.style.fontVariationSettings = '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 20';
  btn.appendChild(span);
  tile.appendChild(btn);

  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void toggleTileFullscreen(tile);
  });

  tile.addEventListener("dblclick", (ev) => {
    if (ev.target.closest(".participant-tile__fullscreen")) return;
    void toggleTileFullscreen(tile);
  });
  tile.addEventListener("click", (ev) => {
    const touchLike = ev.pointerType === "touch" || window.matchMedia?.("(pointer: coarse)")?.matches;
    if (!touchLike) return;
    if (ev.target.closest(".participant-tile__fullscreen")) return;
    void toggleTileFullscreen(tile);
  });
}

export function exitFullscreenIfParticipantTile() {
  exitImmersiveTile();
  const el = document.fullscreenElement;
  if (el && el.classList?.contains("participant-tile")) {
    void document.exitFullscreen().catch(() => {});
  }
}

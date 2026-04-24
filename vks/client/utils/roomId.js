/**
 * Одинаковый id комнаты из query, hash или запасных имён параметров.
 * Без React/MUI — только для шаринга ссылок и joinRoom.
 */
export function resolveRoomIdFromLocation() {
  const trim = (v) => (v != null ? String(v).trim() : "");

  const params = new URLSearchParams(window.location.search);
  let id =
    trim(params.get("roomId")) ||
    trim(params.get("room")) ||
    trim(params.get("meetingId")) ||
    trim(params.get("meeting"));

  if (!id && window.location.hash.length > 1) {
    const raw = window.location.hash.slice(1);
    const hashQuery = raw.includes("=") ? raw : raw.replace(/^\/?/, "");
    try {
      const hp = new URLSearchParams(hashQuery.startsWith("?") ? hashQuery.slice(1) : hashQuery);
      id =
        trim(hp.get("roomId")) ||
        trim(hp.get("room")) ||
        trim(hp.get("meetingId")) ||
        trim(hp.get("meeting"));
    } catch {
      /* ignore */
    }
  }

  try {
    id = id ? decodeURIComponent(id) : "";
  } catch {
    /* keep id */
  }

  return id || "demo-room";
}

function stripAlternateRoomParams(url) {
  url.searchParams.delete("room");
  url.searchParams.delete("meetingId");
  url.searchParams.delete("meeting");
}

/** Подставить ?roomId= в адресную строку, чтобы копирование URL без кнопки не ломало встречу */
export function replaceHistoryWithCanonicalRoom(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("roomId", roomId);
  stripAlternateRoomParams(url);
  const next = `${url.pathname}${url.search}${url.hash || ""}`;
  const cur = `${window.location.pathname}${window.location.search}${window.location.hash || ""}`;
  if (next !== cur) {
    window.history.replaceState(null, "", next);
  }
}

export function buildShareUrlWithRoom(currentHref, roomId) {
  const url = new URL(currentHref);
  url.searchParams.set("roomId", roomId);
  stripAlternateRoomParams(url);
  return url.toString();
}

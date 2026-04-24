export function buildGuestMeetingUrl(token: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/guest-meeting/${encodeURIComponent(token)}`;
}

export function buildGuestCallUrl(token: string, guestName?: string | null) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = `${origin}/guest-call/${encodeURIComponent(String(token))}`;
  const name = (guestName || '').trim();
  if (!name) return base;
  return `${base}?name=${encodeURIComponent(name)}`;
}

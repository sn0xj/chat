/**
 * Единая функция генерации цвета аватара по строке (username/title).
 * Один и тот же вход всегда даёт один и тот же цвет во всём приложении.
 */

const PALETTE = [
  '#5b67c7',
  '#1e93a0',
  '#9a5fbf',
  '#c2533a',
  '#2b8a5a',
  '#c17b2a',
  '#b73a7a',
  '#3d76c7',
  '#4a7d2b',
  '#a14a7d',
  '#2c7a8d',
  '#c4602a',
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function getAvatarColor(input: string | null | undefined): string {
  if (!input) {
    return PALETTE[0];
  }
  const hash = hashString(input);
  return PALETTE[hash % PALETTE.length];
}

export function getAvatarInitial(input: string | null | undefined): string {
  if (!input) return '?';
  const trimmed = input.trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

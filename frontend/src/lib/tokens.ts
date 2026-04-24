/**
 * Единые дизайн-токены.
 * Пиксельные значения; для MUI sx используем либо напрямую (`px: `${space.md}px``),
 * либо через `theme.spacing` (1 = 8px).
 */
export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const fontSize = {
  micro: 11,
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  bold: 700,
} as const;

export const lineHeight = {
  tight: 1.25,
  body: 1.46,
  relaxed: 1.6,
} as const;

export const shadow = {
  sm: '0 1px 3px rgba(0,0,0,0.08)',
  md: '0 4px 12px rgba(0,0,0,0.12)',
  lg: '0 12px 32px rgba(0,0,0,0.18)',
  smDark: '0 1px 3px rgba(0,0,0,0.35)',
  mdDark: '0 4px 12px rgba(0,0,0,0.4)',
  lgDark: '0 12px 32px rgba(0,0,0,0.5)',
} as const;

export const transition = {
  fast: '120ms ease',
  base: '160ms ease',
  slow: '240ms ease',
} as const;

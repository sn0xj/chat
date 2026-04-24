/**
 * Цветовая палитра «современный Slack».
 * Сайдбар и правая зона синхронно следуют теме (light / dark).
 * Для обратной совместимости `SLACK.sidebar*` ссылаются на тёмные значения;
 * для корректного переключения используйте `useSidebarPalette()`.
 */
export const SLACK_SIDEBAR_DARK = {
  sidebar: '#19171d',
  sidebarText: '#d1d2d3',
  sidebarTextMuted: '#abadb1',
  sidebarTextHover: '#ffffff',
  sidebarHoverBg: 'rgba(255,255,255,0.06)',
  sidebarSelectedBg: '#1164a3',
  sidebarSelectedText: '#ffffff',
  sidebarDivider: 'rgba(255,255,255,0.08)',
  sidebarUnreadBadgeBg: '#cd2553',
  sidebarUnreadBadgeText: '#ffffff',
} as const;

export const SLACK_SIDEBAR_LIGHT = {
  sidebar: '#f4f4f5',
  sidebarText: '#1d1c1d',
  sidebarTextMuted: '#616061',
  sidebarTextHover: '#0f172a',
  sidebarHoverBg: 'rgba(15,23,42,0.05)',
  sidebarSelectedBg: '#1264a3',
  sidebarSelectedText: '#ffffff',
  sidebarDivider: 'rgba(15,23,42,0.08)',
  sidebarUnreadBadgeBg: '#cd2553',
  sidebarUnreadBadgeText: '#ffffff',
} as const;

export const SLACK = {
  ...SLACK_SIDEBAR_DARK,

  canvasDark: '#1a1d21',
  canvasLight: '#ffffff',
  paperDark: '#222529',
  paperLight: '#f8f8f8',

  textDarkPrimary: '#d1d2d3',
  textDarkSecondary: '#abadb1',
  textLightPrimary: '#1d1c1d',
  textLightSecondary: '#616061',

  dividerDark: 'rgba(255,255,255,0.08)',
  dividerLight: 'rgba(29,28,29,0.13)',

  primary: '#1264a3',
  primaryHover: '#0b5892',
  success: '#007a5a',
  error: '#e01e5a',
  warning: '#ecb22e',

  rowHoverDark: 'rgba(255,255,255,0.04)',
  rowHoverLight: 'rgba(29,28,29,0.04)',
  rowHighlightDark: 'rgba(236,178,46,0.12)',
  rowHighlightLight: 'rgba(236,178,46,0.18)',
} as const;

export type SidebarPalette = {
  readonly sidebar: string;
  readonly sidebarText: string;
  readonly sidebarTextMuted: string;
  readonly sidebarTextHover: string;
  readonly sidebarHoverBg: string;
  readonly sidebarSelectedBg: string;
  readonly sidebarSelectedText: string;
  readonly sidebarDivider: string;
  readonly sidebarUnreadBadgeBg: string;
  readonly sidebarUnreadBadgeText: string;
};

export function getSidebarPalette(mode: 'light' | 'dark'): SidebarPalette {
  return mode === 'light' ? SLACK_SIDEBAR_LIGHT : SLACK_SIDEBAR_DARK;
}

import type { SxProps, Theme } from '@mui/material/styles';

/** Тёмный скроллбар (thumb — белый полупрозрачный) для тёмных панелей. */
export const darkScrollbarSx: SxProps<Theme> = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(255,255,255,0.18) transparent',
  '&::-webkit-scrollbar': { width: 8 },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': {
    background: 'rgba(255,255,255,0.14)',
    borderRadius: 8,
    backgroundClip: 'padding-box',
    border: '2px solid transparent',
  },
  '&::-webkit-scrollbar-thumb:hover': {
    background: 'rgba(255,255,255,0.24)',
    backgroundClip: 'padding-box',
    border: '2px solid transparent',
  },
};

/** Светлый скроллбар (thumb — тёмный полупрозрачный) для светлых панелей. */
export const lightScrollbarSx: SxProps<Theme> = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(15,23,42,0.25) transparent',
  '&::-webkit-scrollbar': { width: 8 },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': {
    background: 'rgba(15,23,42,0.2)',
    borderRadius: 8,
    backgroundClip: 'padding-box',
    border: '2px solid transparent',
  },
  '&::-webkit-scrollbar-thumb:hover': {
    background: 'rgba(15,23,42,0.32)',
    backgroundClip: 'padding-box',
    border: '2px solid transparent',
  },
};

/** Возвращает стили скроллбара под режим темы. */
export function getSidebarScrollbarSx(mode: 'light' | 'dark'): SxProps<Theme> {
  return mode === 'light' ? lightScrollbarSx : darkScrollbarSx;
}

/** Скроллбар на canvas (chat area) — адаптируется к theme mode. */
export const canvasScrollbarSx: SxProps<Theme> = {
  scrollbarWidth: 'thin',
  '&::-webkit-scrollbar': { width: 10 },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': {
    background: (t: Theme) =>
      t.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.15)',
    borderRadius: 8,
    backgroundClip: 'padding-box',
    border: '2px solid transparent',
  },
  '&::-webkit-scrollbar-thumb:hover': {
    background: (t: Theme) =>
      t.palette.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.25)',
    backgroundClip: 'padding-box',
    border: '2px solid transparent',
  },
};

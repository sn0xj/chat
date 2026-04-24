import { useTheme } from '@mui/material/styles';
import { getSidebarPalette, type SidebarPalette } from './slackColors';

/** Возвращает палитру сайдбара, подстроенную под текущий режим темы. */
export function useSidebarPalette(): SidebarPalette {
  const theme = useTheme();
  return getSidebarPalette(theme.palette.mode);
}

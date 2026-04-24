import { CssBaseline, ThemeProvider } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { useMemo, type ReactNode } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { useChatStore } from '@/store/chat-store';
import { createAppTheme } from '@/theme/theme';

dayjs.locale('ru');

export function AppProviders({ children }: { children: ReactNode }) {
  const mode = useChatStore((s) => s.theme);
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="ru">
        {children}
      </LocalizationProvider>
    </ThemeProvider>
  );
}

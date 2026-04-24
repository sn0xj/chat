import { Box, InputBase } from '@mui/material';
import { Search } from '@mui/icons-material';
import { getSidebarPalette } from '@/theme/slackColors';
import { fontSize, radius } from '@/lib/tokens';

type Props = {
  value: string;
  onChange: (value: string) => void;
  themeMode?: 'light' | 'dark';
  placeholder?: string;
};

export function SidebarSearch({ value, onChange, themeMode = 'dark', placeholder = 'Найти чат' }: Props) {
  const palette = getSidebarPalette(themeMode);
  const bgBase = themeMode === 'light' ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.08)';
  const bgFocus = themeMode === 'light' ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.12)';
  const borderBase = themeMode === 'light' ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.1)';
  const borderFocus = themeMode === 'light' ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.2)';

  return (
    <Box sx={{ px: 1.5, py: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          height: 32,
          borderRadius: `${radius.sm}px`,
          bgcolor: bgBase,
          border: `1px solid ${borderBase}`,
          '&:focus-within': {
            bgcolor: bgFocus,
            borderColor: borderFocus,
          },
        }}
      >
        <Search sx={{ fontSize: 16, color: palette.sidebarTextMuted }} />
        <InputBase
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          sx={{
            flex: 1,
            fontSize: fontSize.sm,
            color: palette.sidebarTextHover,
            '& input::placeholder': {
              color: palette.sidebarTextMuted,
              opacity: 1,
            },
          }}
        />
      </Box>
    </Box>
  );
}

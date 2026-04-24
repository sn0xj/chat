import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { DarkMode, LightMode, Logout } from '@mui/icons-material';
import { getSidebarPalette } from '@/theme/slackColors';
import { fontSize, fontWeight } from '@/lib/tokens';

type Props = {
  workspaceName?: string;
  userLabel?: string;
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout?: () => void;
};

export function WorkspaceHeader({
  workspaceName,
  userLabel,
  themeMode,
  onToggleTheme,
  onLogout,
}: Props) {
  const palette = getSidebarPalette(themeMode);
  return (
    <Box
      sx={{
        flexShrink: 0,
        px: 2,
        py: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        borderBottom: `1px solid ${palette.sidebarDivider}`,
        pt: 'max(12px, env(safe-area-inset-top))',
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {userLabel ? (
          <Typography
            sx={{
              color: palette.sidebarTextHover,
              fontWeight: fontWeight.bold,
              fontSize: fontSize.md,
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {userLabel}
          </Typography>
        ) : workspaceName ? (
          <Typography
            sx={{
              color: palette.sidebarTextHover,
              fontWeight: fontWeight.bold,
              fontSize: fontSize.md,
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {workspaceName}
          </Typography>
        ) : null}
      </Box>
      <Tooltip title={themeMode === 'dark' ? 'Светлая тема' : 'Тёмная тема'} placement="bottom">
        <IconButton
          size="small"
          onClick={onToggleTheme}
          sx={{ color: palette.sidebarTextMuted, '&:hover': { color: palette.sidebarTextHover, bgcolor: palette.sidebarHoverBg } }}
        >
          {themeMode === 'dark' ? <LightMode sx={{ fontSize: 18 }} /> : <DarkMode sx={{ fontSize: 18 }} />}
        </IconButton>
      </Tooltip>
      {onLogout ? (
        <Tooltip title="Выйти" placement="bottom">
          <IconButton
            size="small"
            onClick={onLogout}
            sx={{
              color: palette.sidebarTextMuted,
              '&:hover': { color: palette.sidebarTextHover, bgcolor: palette.sidebarHoverBg },
            }}
          >
            <Logout sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );
}

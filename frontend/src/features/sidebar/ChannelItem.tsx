import type { MouseEvent as ReactMouseEvent } from 'react';
import { Box, Typography } from '@mui/material';
import { getSidebarPalette } from '@/theme/slackColors';
import { fontSize, fontWeight, radius } from '@/lib/tokens';

type Props = {
  title: string;
  isActive: boolean;
  hasUnread: boolean;
  themeMode?: 'light' | 'dark';
  unreadCount?: number;
  isMuted?: boolean;
  onClick: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

export function ChannelItem({
  title,
  isActive,
  hasUnread,
  themeMode = 'dark',
  unreadCount = 0,
  isMuted,
  onClick,
  onContextMenu,
}: Props) {
  const palette = getSidebarPalette(themeMode);
  const textColor = isActive
    ? palette.sidebarSelectedText
    : hasUnread
      ? palette.sidebarTextHover
      : palette.sidebarText;

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        height: 28,
        px: 1.5,
        mx: 1,
        borderRadius: `${radius.xs}px`,
        cursor: 'pointer',
        userSelect: 'none',
        bgcolor: isActive ? palette.sidebarSelectedBg : 'transparent',
        '&:hover': {
          bgcolor: isActive ? palette.sidebarSelectedBg : palette.sidebarHoverBg,
        },
      }}
    >
      <Typography
        component="span"
        sx={{
          color: textColor,
          fontSize: fontSize.md,
          fontWeight: fontWeight.regular,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        #
      </Typography>
      <Typography
        component="span"
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: textColor,
          fontSize: fontSize.sm,
          fontWeight: hasUnread && !isActive ? fontWeight.bold : fontWeight.regular,
          opacity: isMuted && !hasUnread && !isActive ? 0.55 : 1,
        }}
      >
        {title}
      </Typography>
      {hasUnread && !isActive ? (
        <Box
          sx={{
            minWidth: 18,
            height: 18,
            px: 0.75,
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: palette.sidebarUnreadBadgeBg,
            color: palette.sidebarUnreadBadgeText,
            fontSize: 11,
            fontWeight: fontWeight.bold,
            lineHeight: 1,
          }}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </Box>
      ) : null}
    </Box>
  );
}

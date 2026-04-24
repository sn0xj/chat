import { type ReactNode } from 'react';
import { Badge, Box, Tooltip } from '@mui/material';
import {
  ChatBubbleOutline,
} from '@mui/icons-material';
import ContactsIcon from '@mui/icons-material/Contacts';
import GroupsIcon from '@mui/icons-material/Groups';
import { getSidebarPalette, SLACK } from '@/theme/slackColors';

export type NavRailKey = 'chat' | 'calls' | 'people';

type Item = {
  key: NavRailKey;
  label: string;
  icon: ReactNode;
  badge?: number;
};

type Props = {
  selected: NavRailKey;
  onSelect: (key: NavRailKey) => void;
  themeMode?: 'light' | 'dark';
  unreadChats?: number;
  activeCalls?: number;
  userAvatar?: ReactNode;
};

export function NavRail({
  selected,
  onSelect,
  themeMode = 'dark',
  unreadChats = 0,
  activeCalls = 0,
  userAvatar,
}: Props) {
  const palette = getSidebarPalette(themeMode);
  const items: Item[] = [
    { key: 'chat', label: 'Чаты', icon: <ChatBubbleOutline fontSize="small" />, badge: unreadChats },
    { key: 'calls', label: 'Встречи', icon: <GroupsIcon fontSize="small" />, badge: activeCalls },
    { key: 'people', label: 'Контакты', icon: <ContactsIcon fontSize="small" /> },
  ];

  return (
    <Box
      component="nav"
      aria-label="Основная навигация"
      sx={{
        width: 56,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 1,
        gap: 0.5,
        bgcolor: palette.sidebar,
        borderRight: `1px solid ${palette.sidebarDivider}`,
      }}
    >
      {items.map((item) => {
        const active = selected === item.key;
        return (
          <Tooltip title={item.label} placement="right" key={item.key} arrow>
            <Box
              role="button"
              tabIndex={0}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelect(item.key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(item.key);
                }
              }}
              sx={{
                position: 'relative',
                width: 44,
                height: 48,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 1,
                cursor: 'pointer',
                color: active ? palette.sidebarTextHover : palette.sidebarTextMuted,
                transition: 'background-color 120ms ease, color 120ms ease',
                outline: 'none',
                '&:hover': {
                  color: palette.sidebarTextHover,
                  bgcolor: palette.sidebarHoverBg,
                },
                '&:focus-visible': {
                  boxShadow: `0 0 0 2px ${SLACK.primary}`,
                },
                '&::before': active
                  ? {
                      content: '""',
                      position: 'absolute',
                      left: -6,
                      top: 8,
                      bottom: 8,
                      width: 3,
                      bgcolor: SLACK.primary,
                      borderRadius: 2,
                    }
                  : undefined,
              }}
            >
              <Badge
                badgeContent={item.badge || 0}
                color="error"
                max={99}
                overlap="circular"
                invisible={!item.badge}
                sx={{
                  '& .MuiBadge-badge': {
                    fontSize: 10,
                    height: 16,
                    minWidth: 16,
                    padding: '0 4px',
                  },
                }}
              >
                <Box sx={{ display: 'grid', placeItems: 'center', color: 'inherit' }}>
                  {item.icon}
                </Box>
              </Badge>
            </Box>
          </Tooltip>
        );
      })}

      <Box sx={{ flex: 1 }} />

      {userAvatar ? (
        <Box
          sx={{
            width: 44,
            height: 44,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
          }}
        >
          {userAvatar}
        </Box>
      ) : null}
    </Box>
  );
}

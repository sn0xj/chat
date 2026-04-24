import { useEffect, useState, type ReactNode } from 'react';
import {
  Avatar,
  Box,
  Button,
  IconButton,
  InputBase,
  Paper,
  Typography,
} from '@mui/material';
import {
  ChevronLeft,
  Close,
  KeyboardArrowDown,
  KeyboardArrowUp,
  MoreHoriz,
  Phone,
  Search,
  Settings,
} from '@mui/icons-material';
import type { Chat } from '@/lib/types';
import { formatPresenceByLastActivity, isUserOnline } from '@/lib/formatLastSeen';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';
import { fontSize, fontWeight, radius } from '@/lib/tokens';
import { SLACK } from '@/theme/slackColors';
import { ConnectionStatus } from './ConnectionStatus';

export type ChatHeaderTab = 'chat' | 'files';

type Props = {
  chat: Chat;
  currentUserId?: number;
  onOpenSettings: () => void;
  onOpenMoreMenu?: (event: React.MouseEvent<HTMLElement>) => void;
  onOpenProfile?: () => void;
  searchOpen?: boolean;
  searchQuery?: string;
  searchMatchesCount?: number;
  activeSearchIndex?: number;
  onToggleSearch?: () => void;
  onSearchQueryChange?: (value: string) => void;
  onSearchPrev?: () => void;
  onSearchNext?: () => void;
  onCloseSearch?: () => void;
  onBackToList?: () => void;
  onStartCall?: (event: React.MouseEvent<HTMLElement>) => void;
  onJoinCall?: () => void;
  isCallActive?: boolean;
  callParticipants?: number;
  activeTab?: ChatHeaderTab;
  onTabChange?: (tab: ChatHeaderTab) => void;
};

export function ChatHeader({
  chat,
  currentUserId,
  onOpenSettings,
  onOpenMoreMenu,
  onOpenProfile,
  searchOpen,
  searchQuery = '',
  searchMatchesCount = 0,
  activeSearchIndex = 0,
  onToggleSearch,
  onSearchQueryChange,
  onSearchPrev,
  onSearchNext,
  onCloseSearch,
  onBackToList,
  onStartCall,
  onJoinCall,
  isCallActive = false,
  callParticipants = 0,
  activeTab = 'chat',
  onTabChange,
}: Props) {
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setMinuteTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const peer =
    chat.type === 'private' && currentUserId
      ? chat.members.find((m) => m.id !== currentUserId)
      : undefined;

  const rawTitle =
    (chat.type === 'group' || chat.type === 'meeting')
      ? chat.title || 'Группа'
      : peer?.firstname || peer?.username || 'Личный чат';

  const displayTitle = chat.type === 'group' || chat.type === 'meeting' ? `# ${rawTitle}` : rawTitle;

  const statusLine: string | null = isCallActive
    ? `Идёт звонок${callParticipants > 0 ? ` · ${callParticipants} уч.` : ''}`
    : chat.type === 'group' || chat.type === 'meeting'
      ? `${chat.members.length} участников`
      : peer
        ? formatPresenceByLastActivity(peer.last_activity)
        : null;

  const peerOnline = chat.type === 'private' && peer ? isUserOnline(peer.last_activity) : false;

  return (
    <Paper
      component="header"
      elevation={0}
      square
      sx={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minHeight: 56,
          px: { xs: 1, sm: 2 },
          py: 0.5,
          pt: 'max(8px, env(safe-area-inset-top))',
        }}
      >
      {onBackToList ? (
        <IconButton
          size="small"
          onClick={onBackToList}
          aria-label="К списку чатов"
          sx={{ display: { xs: 'inline-flex', md: 'none' }, color: 'text.secondary' }}
        >
          <ChevronLeft />
        </IconButton>
      ) : null}
      {searchOpen ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
          <Search sx={{ fontSize: 18, color: 'text.secondary', ml: 0.5 }} />
          <InputBase
            autoFocus
            value={searchQuery}
            onChange={(e) => onSearchQueryChange?.(e.target.value)}
            placeholder="Поиск по сообщениям"
            sx={{ flex: 1, fontSize: fontSize.sm }}
          />
          <Typography
            sx={{
              minWidth: 52,
              textAlign: 'center',
              fontWeight: fontWeight.medium,
              fontSize: fontSize.xs,
              color: 'text.secondary',
            }}
          >
            {searchMatchesCount ? `${activeSearchIndex + 1}/${searchMatchesCount}` : '0/0'}
          </Typography>
          <IconButton size="small" onClick={onSearchPrev} disabled={!searchMatchesCount} aria-label="Назад">
            <KeyboardArrowUp fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onSearchNext} disabled={!searchMatchesCount} aria-label="Вперёд">
            <KeyboardArrowDown fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onCloseSearch} aria-label="Закрыть поиск">
            <Close fontSize="small" />
          </IconButton>
        </Box>
      ) : (
        <Box
          onClick={chat.type === 'private' ? onOpenProfile : onOpenSettings}
          role="button"
          aria-label={
            chat.type === 'private' ? 'Открыть профиль пользователя' : 'Открыть настройки чата'
          }
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            minWidth: 0,
            flex: 1,
            cursor: 'pointer',
            borderRadius: `${radius.xs}px`,
            px: 0.5,
            py: 0.25,
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Box sx={{ position: 'relative', flexShrink: 0 }}>
            <Avatar
              sx={{
                width: 36,
                height: 36,
                fontWeight: fontWeight.bold,
                fontSize: fontSize.sm,
                bgcolor: getAvatarColor(rawTitle),
                color: '#fff',
                borderRadius: `${radius.sm}px`,
              }}
            >
              {getAvatarInitial(rawTitle)}
            </Avatar>
            {chat.type === 'private' && peerOnline ? (
              <Box
                sx={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  bgcolor: SLACK.success,
                  border: '2px solid',
                  borderColor: 'background.paper',
                }}
              />
            ) : null}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              noWrap
              sx={{
                fontSize: fontSize.md,
                fontWeight: fontWeight.bold,
                lineHeight: 1.2,
                color: 'text.primary',
                letterSpacing: '-0.01em',
              }}
            >
              {displayTitle}
            </Typography>
            {statusLine ? (
              <Typography
                noWrap
                sx={{
                  fontSize: fontSize.xs,
                  lineHeight: 1.2,
                  color: isCallActive ? 'success.main' : 'text.secondary',
                }}
              >
                {statusLine}
              </Typography>
            ) : (
              <ConnectionStatus />
            )}
          </Box>
        </Box>
      )}
      {!searchOpen ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
          {isCallActive ? (
            <Button
              size="small"
              variant="outlined"
              onClick={onJoinCall}
              sx={{
                mr: 0.25,
                px: 1,
                minWidth: 0,
                textTransform: 'none',
                borderRadius: `${radius.sm}px`,
                borderColor: 'success.main',
                color: 'success.main',
                display: { xs: 'none', sm: 'inline-flex' },
                '&:hover': {
                  borderColor: 'success.dark',
                  bgcolor: 'action.hover',
                },
              }}
            >
              Подключиться
            </Button>
          ) : null}
          <IconButton
            size="small"
            aria-label="Поиск"
            onClick={onToggleSearch}
            sx={{ color: 'text.secondary' }}
          >
            <Search sx={{ fontSize: 20 }} />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Звонок"
            onClick={(event) => onStartCall?.(event)}
            sx={{
              color: isCallActive ? 'success.main' : 'text.secondary',
            }}
          >
            <Phone sx={{ fontSize: 20 }} />
          </IconButton>
          {chat.type === 'group' || chat.type === 'meeting' ? (
            <IconButton
              size="small"
              onClick={onOpenSettings}
              aria-label="Настройки группы"
              sx={{ color: 'text.secondary' }}
            >
              <Settings sx={{ fontSize: 20 }} />
            </IconButton>
          ) : null}
          <IconButton
            size="small"
            aria-label="Ещё"
            onClick={onOpenMoreMenu}
            sx={{ color: 'text.secondary' }}
          >
            <MoreHoriz sx={{ fontSize: 22 }} />
          </IconButton>
        </Box>
      ) : null}
      </Box>
      {!searchOpen ? (
        <Box
          role="tablist"
          aria-label="Вкладки чата"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: { xs: 1, sm: 2 },
            borderTop: '1px solid',
            borderColor: 'divider',
            minHeight: 36,
          }}
        >
          <HeaderTab
            label="Чат"
            active={activeTab === 'chat'}
            onClick={() => onTabChange?.('chat')}
          />
          <HeaderTab
            label="Файлы"
            active={activeTab === 'files'}
            onClick={() => onTabChange?.('files')}
          />
        </Box>
      ) : null}
    </Paper>
  );
}

function HeaderTab({
  label,
  active,
  disabled,
  hint,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  hint?: string;
  onClick?: () => void;
}): ReactNode {
  return (
    <Box
      role="tab"
      aria-selected={Boolean(active)}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      sx={{
        position: 'relative',
        px: 1.25,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        cursor: disabled ? 'default' : 'pointer',
        color: active ? 'primary.main' : 'text.secondary',
        fontSize: fontSize.sm,
        fontWeight: active ? fontWeight.bold : fontWeight.medium,
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
        '&::after': active
          ? {
              content: '""',
              position: 'absolute',
              left: 6,
              right: 6,
              bottom: -1,
              height: 2,
              bgcolor: 'primary.main',
              borderRadius: 2,
            }
          : undefined,
        '&:hover': disabled
          ? undefined
          : {
              color: active ? 'primary.main' : 'text.primary',
            },
      }}
    >
      <span>{label}</span>
      {hint ? (
        <Typography
          component="span"
          sx={{
            fontSize: 10,
            px: 0.5,
            py: 0.1,
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            color: 'text.secondary',
            lineHeight: 1.3,
          }}
        >
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

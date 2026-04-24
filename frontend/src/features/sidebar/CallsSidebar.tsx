import { useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { Box, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CallOutlined, PhoneInTalkRounded } from '@mui/icons-material';
import { Chat } from '@/lib/types';
import { getSidebarPalette } from '@/theme/slackColors';
import { getSidebarScrollbarSx } from '@/lib/scrollbar';
import { WorkspaceHeader } from './WorkspaceHeader';
import { UpcomingMeetingsPanel } from '@/features/calls/components/UpcomingMeetingsPanel';
import { CallHistoryList } from '@/features/calls/components/CallHistoryList';
import type { MeetingOccurrence } from '@/features/calls/types';

type Props = {
  workspaceName?: string;
  userLabel?: string;
  themeMode: 'light' | 'dark';
  chats: Chat[];
  currentChatId?: number;
  currentUserId?: number;
  activeCallChats: number[];
  upcomingMeetings?: MeetingOccurrence[];
  onCreateMeeting?: () => void;
  onJoinMeeting?: (occurrence: MeetingOccurrence) => void;
  onShareMeetingLink?: (occurrence: MeetingOccurrence) => void;
  onToggleTheme: () => void;
  onSelectChat: (chat: Chat) => void;
  onJoinActiveCall?: (chat: Chat) => void;
  onLogout?: () => void;
  onChatContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, chat: Chat) => void;
};

export function CallsSidebar({
  workspaceName = 'Super Chat',
  userLabel,
  themeMode,
  chats,
  currentChatId,
  currentUserId,
  activeCallChats,
  upcomingMeetings = [],
  onCreateMeeting,
  onJoinMeeting,
  onShareMeetingLink,
  onToggleTheme,
  onSelectChat,
  onJoinActiveCall,
  onLogout,
  onChatContextMenu,
}: Props) {
  const palette = getSidebarPalette(themeMode);
  const activeSet = useMemo(() => new Set(activeCallChats), [activeCallChats]);
  const activeMeetings = useMemo(
    () => chats.filter((chat) => chat.type === 'meeting' && activeSet.has(chat.id)),
    [chats, activeSet],
  );

  return (
    <Box
      component="aside"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        bgcolor: palette.sidebar,
        color: palette.sidebarText,
        borderRight: { xs: 'none', md: `1px solid ${palette.sidebarDivider}` },
      }}
    >
      <WorkspaceHeader
        workspaceName={workspaceName}
        userLabel={userLabel}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
      />
      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(palette.sidebarTextMuted, 0.14),
            color: palette.sidebarText,
          }}
        >
          <CallOutlined sx={{ fontSize: 16 }} />
        </Box>
        <Typography
          sx={{
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: '-0.01em',
            color: palette.sidebarText,
            flex: 1,
          }}
        >
          Встречи
        </Typography>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          ...getSidebarScrollbarSx(themeMode),
        }}
      >
        {activeMeetings.length ? (
          <Box sx={{ px: 1.5, pt: 0.5, pb: 1 }}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1, px: 0.25 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: 'success.main',
                  boxShadow: (t) => `0 0 0 3px ${alpha(t.palette.success.main, 0.25)}`,
                }}
              />
              <Typography
                sx={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: palette.sidebarTextMuted,
                  letterSpacing: '0.09em',
                  textTransform: 'uppercase',
                }}
              >
                Идут сейчас
              </Typography>
            </Stack>
            <Stack spacing={0.5}>
              {activeMeetings.map((chat) => (
                <Box
                  key={chat.id}
                  onContextMenu={(event) => onChatContextMenu?.(event, chat)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.75,
                    borderRadius: 1.25,
                    bgcolor: chat.id === currentChatId ? alpha('#fff', 0.08) : alpha('#fff', 0.03),
                  }}
                >
                  <Box
                    sx={{ minWidth: 0, flex: 1, cursor: 'pointer' }}
                    onClick={() => (onJoinActiveCall ? onJoinActiveCall(chat) : onSelectChat(chat))}
                  >
                    <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: palette.sidebarText }}>
                      {chat.title || 'Встреча'}
                    </Typography>
                    <Typography noWrap sx={{ fontSize: 11, color: palette.sidebarTextMuted }}>
                      Активная встреча
                    </Typography>
                  </Box>
                  {onJoinActiveCall ? (
                    <Tooltip title="Подключиться" placement="left">
                      <IconButton
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          onJoinActiveCall(chat);
                        }}
                        sx={(t) => ({
                          bgcolor: t.palette.success.main,
                          color: t.palette.success.contrastText,
                          width: { xs: 34, sm: 30 },
                          height: { xs: 34, sm: 30 },
                          '&:hover': { bgcolor: t.palette.success.dark },
                        })}
                        aria-label="Подключиться к встрече"
                      >
                        <PhoneInTalkRounded sx={{ fontSize: 17 }} />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </Box>
              ))}
            </Stack>
            <Divider sx={{ mt: 1.25, borderColor: palette.sidebarDivider }} />
          </Box>
        ) : null}

        <UpcomingMeetingsPanel
          occurrences={upcomingMeetings}
          onJoin={onJoinMeeting}
          onShareLink={onShareMeetingLink}
          onCreate={onCreateMeeting}
        />
        <Divider sx={{ mx: 1.5, my: 0.5, borderColor: palette.sidebarDivider }} />
        <CallHistoryList />
      </Box>
    </Box>
  );
}

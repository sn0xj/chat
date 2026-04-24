import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Box } from '@mui/material';
import { Chat } from '@/lib/types';
import { getSidebarPalette } from '@/theme/slackColors';
import { getSidebarScrollbarSx } from '@/lib/scrollbar';
import { isUserOnline } from '@/lib/formatLastSeen';
import { WorkspaceHeader } from './WorkspaceHeader';
import { SidebarSearch } from './SidebarSearch';
import { SidebarSection } from './SidebarSection';
import { ChannelItem } from './ChannelItem';
import { DmItem } from './DmItem';

type Props = {
  workspaceName?: string;
  userLabel?: string;
  themeMode: 'light' | 'dark';
  chats: Chat[];
  currentChatId?: number;
  currentUserId?: number;
  unreadByChat: Record<number, number>;
  mutedChatIds: number[];
  onToggleTheme: () => void;
  onSelectChat: (chat: Chat) => void;
  onCreateChannel?: () => void;
  onCreateDm?: () => void;
  onLogout?: () => void;
  onChatContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, chat: Chat) => void;
};

export function Sidebar({
  workspaceName = 'Super Chat',
  userLabel,
  themeMode,
  chats,
  currentChatId,
  currentUserId,
  unreadByChat,
  mutedChatIds,
  onToggleTheme,
  onSelectChat,
  onCreateChannel,
  onCreateDm,
  onLogout,
  onChatContextMenu,
}: Props) {
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();

  const getChatTitle = (chat: Chat) => {
    if (chat.type === 'meeting') return chat.title || 'Встреча';
    if (chat.type === 'group') return chat.title || 'Групповой чат';
    const peer = chat.members.find((m) => m.id !== currentUserId);
    return peer?.firstname || peer?.username || 'Личный чат';
  };

  const { channels, dms } = useMemo(() => {
    const channelList: Chat[] = [];
    const dmList: Chat[] = [];
    for (const chat of chats) {
      const title = getChatTitle(chat);
      if (normalizedQuery && !title.toLowerCase().includes(normalizedQuery)) {
        continue;
      }
      if (chat.type === 'group') {
        channelList.push(chat);
      } else {
        dmList.push(chat);
      }
    }
    return { channels: channelList, dms: dmList };
  }, [chats, normalizedQuery, currentUserId]);

  const mutedSet = useMemo(() => new Set(mutedChatIds), [mutedChatIds]);
  const palette = getSidebarPalette(themeMode);

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
      <SidebarSearch value={query} onChange={setQuery} themeMode={themeMode} />
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          pb: 'max(8px, env(safe-area-inset-bottom))',
          ...getSidebarScrollbarSx(themeMode),
        }}
      >
        <SidebarSection themeMode={themeMode} title="Группы" onAdd={onCreateChannel} addLabel="Создать группу">
          {channels.length ? (
            channels.map((chat) => {
              const title = getChatTitle(chat);
              const unread = unreadByChat[chat.id] || 0;
              const isActive = chat.id === currentChatId;
              return (
                <ChannelItem
                  key={chat.id}
                  themeMode={themeMode}
                  title={title}
                  isActive={isActive}
                  hasUnread={unread > 0}
                  unreadCount={unread}
                  isMuted={mutedSet.has(chat.id)}
                  onClick={() => onSelectChat(chat)}
                  onContextMenu={(event) => onChatContextMenu?.(event, chat)}
                />
              );
            })
          ) : (
            <Box sx={{ px: 2.5, py: 0.75, fontSize: 12, color: palette.sidebarTextMuted }}>
              {normalizedQuery ? 'Нет совпадений' : 'Нет групп'}
            </Box>
          )}
        </SidebarSection>
        <SidebarSection themeMode={themeMode} title="Личные сообщения" onAdd={onCreateDm} addLabel="Новое личное сообщение">
          {dms.length ? (
            dms.map((chat) => {
              const peer = chat.members.find((m) => m.id !== currentUserId);
              const title = peer?.firstname || peer?.username || 'Личный чат';
              const unread = unreadByChat[chat.id] || 0;
              const isActive = chat.id === currentChatId;
              return (
                <DmItem
                  key={chat.id}
                  themeMode={themeMode}
                  title={title}
                  isActive={isActive}
                  hasUnread={unread > 0}
                  unreadCount={unread}
                  isOnline={isUserOnline(peer?.last_activity)}
                  isMuted={mutedSet.has(chat.id)}
                  onClick={() => onSelectChat(chat)}
                  onContextMenu={(event) => onChatContextMenu?.(event, chat)}
                />
              );
            })
          ) : (
            <Box sx={{ px: 2.5, py: 0.75, fontSize: 12, color: palette.sidebarTextMuted }}>
              {normalizedQuery ? 'Нет совпадений' : 'Нет личных чатов'}
            </Box>
          )}
        </SidebarSection>
      </Box>
    </Box>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  ChatBubble,
  Close,
  DeleteOutline,
  Forward,
  GroupAdd,
  Logout,
  Notifications,
  NotificationsOff,
  Reply,
  Settings,
} from '@mui/icons-material';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { NavRail, type NavRailKey } from '@/features/sidebar/NavRail';
import { CallsSidebar } from '@/features/sidebar/CallsSidebar';
import { PeopleSidebar } from '@/features/sidebar/PeopleSidebar';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';
import {
  Autocomplete,
  Box,
  Avatar,
  Button,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemAvatar,
  ListItemIcon,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ChatHeader, type ChatHeaderTab } from '@/components/chat/ChatHeader';
import { ChatFilesView } from '@/features/files/ChatFilesView';
import { CallFullscreenDialog } from '@/features/calls/components/CallFullscreenDialog';
import { PrecallSettingsDialog } from '@/features/calls/dialogs/PrecallSettingsDialog';
import { DeleteChatDialog } from '@/features/dialogs/DeleteChatDialog';
import { GuestLinkField } from '@/features/calls/components/GuestLinkField';
import {
  IncomingCallDialog,
} from '@/features/calls/components/IncomingCallDialog';
import { CreateMeetingDialog } from '@/features/calls/dialogs/CreateMeetingDialog';
import { ShareGuestLinkDialog } from '@/features/calls/dialogs/ShareGuestLinkDialog';
import { useCallPresence } from '@/features/calls/hooks/useCallPresence';
import { useIncomingCall } from '@/features/calls/hooks/useIncomingCall';
import { useUpcomingMeetings } from '@/features/calls/hooks/useUpcomingMeetings';
import { useMeetingReminders } from '@/features/calls/hooks/useMeetingReminders';
import type { Meeting, MeetingOccurrence } from '@/features/calls/types';
import { buildGuestCallUrl, buildGuestMeetingUrl } from '@/features/calls/utils/guestLink';
import { createGuestCallLinkToken, listCallSessions } from '@/features/calls/api/callSessions';
import type { CallSessionRecord } from '@/features/calls/types';
import { EmptyState } from '@/components/chat/EmptyState';
import {
  MessageComposer,
  type MessageEditTarget,
  type MessageReplyTarget,
} from '@/features/composer/MessageComposer';
import { MessageList } from '@/features/messages/MessageList';
import { formatPresenceByLastActivity } from '@/lib/formatLastSeen';
import {
  addChatMembers,
  createGroupChat,
  createPrivateChat,
  deleteGroupChat,
  getChats,
  leaveChat as leaveManagedChat,
  removeChatMember,
  updateGroupTitle,
} from '@/services/chat';
import { getMessages } from '@/services/message';
import { setAuthToken } from '@/services/api';
import {
  connectSocket,
  clearHistoryForAllSocket,
  declineIncomingCallSocket,
  deleteMessageSocket,
  editMessageSocket,
  onChatHistoryCleared,
  joinChat,
  onMessageDeleted,
  onMessageUpdated,
  onNewMessage,
  onChatUpdated,
  onSocketStatus,
  inviteUsersToCallSocket,
  startCallSocket,
  sendMessageSocket,
} from '@/services/socket';
import { getUsers, me } from '@/services/auth';
import { useChatStore } from '@/store/chat-store';
import { Chat, Message } from '@/lib/types';
import { parseMessageContent } from '@/lib/messageContent';
import {
  ensureBrowserNotificationPermission,
  showBrowserNotification,
} from '@/lib/browserNotifications';

function hueFromString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = s.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

function withBumpedMemberActivity(chat: Chat, chatId: number, userId: number, at: string): Chat {
  if (chat.id !== chatId) {
    return chat;
  }
  return {
    ...chat,
    members: chat.members.map((m) => (m.id === userId ? { ...m, last_activity: at } : m)),
  };
}

function formatCallHistoryTimestamp(iso: string) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCallHistoryDuration(session: CallSessionRecord) {
  if (!session.endedAt) return 'в процессе';
  const startedMs = new Date(session.startedAt).getTime();
  const endedMs = new Date(session.endedAt).getTime();
  if (Number.isNaN(startedMs) || Number.isNaN(endedMs) || endedMs <= startedMs) return '0 минут';
  const totalMinutes = Math.max(1, Math.round((endedMs - startedMs) / 60000));
  return `${totalMinutes} минут`;
}

function computeNextAutoGroupTitle(chats: Chat[]) {
  const autoTitles = chats
    .filter((chat) => chat.type === 'group')
    .map((chat) => (chat.title || '').trim())
    .filter((title) => /^Группа \d+$/i.test(title))
    .map((title) => Number(title.replace(/^Группа\s+/i, '')))
    .filter((n) => Number.isFinite(n));
  const maxAutoNumber = autoTitles.length ? Math.max(...autoTitles) : 0;
  return `Группа ${maxAutoNumber + 1}`;
}

function mapCallSessionToHistoryMessage(
  session: CallSessionRecord,
  chatMembers: Array<{ id: number; username: string; firstname?: string | null; lastname?: string | null }>,
): Message {
  const createdAt = session.endedAt ?? session.startedAt;
  const stateLabel = session.endedAt ? 'Звонок завершён' : 'Идёт звонок';
  const initiator = session.participantUsernames.find((name) => Boolean(name)) || 'неизвестно';
  const initiatorMember = chatMembers.find((member) => member.username === initiator) || null;
  const isMeetingEvent = Boolean(session.meetingId);
  return {
    id: -1_000_000_000 - session.id,
    chat_id: session.chatId,
    sender_id: initiatorMember?.id ?? 0,
    type: isMeetingEvent ? 'meeting_event' : 'call_event',
    text: `${stateLabel}\n${formatCallHistoryDuration(session)} — ${formatCallHistoryTimestamp(createdAt)}`,
    created_at: createdAt,
    edited_at: null,
    sender: {
      id: initiatorMember?.id ?? 0,
      username: initiatorMember?.username || initiator,
      firstname: initiatorMember?.firstname ?? null,
      lastname: initiatorMember?.lastname ?? null,
    },
    crypto_metadata: null,
  };
}

export function ChatPage() {
  type CreateDialogMode = 'dm' | 'group';
  type PendingCallRequest = {
    chatId: number;
    invitees: number[];
    mode: 'start' | 'join';
    asGuest?: boolean;
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState<
    Array<{
      id: number;
      username: string;
      firstname?: string | null;
      lastname?: string | null;
      last_activity?: string | null;
    }>
  >([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createDialogMode, setCreateDialogMode] = useState<CreateDialogMode>('dm');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [dmContactQuery, setDmContactQuery] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [settingsTitle, setSettingsTitle] = useState('');
  const [settingsSelectedIds, setSettingsSelectedIds] = useState<number[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    message: Message;
  } | null>(null);
  const [chatContextMenu, setChatContextMenu] = useState<{
    x: number;
    y: number;
    chat: Chat;
  } | null>(null);
  const [chatHeaderMenuAnchor, setChatHeaderMenuAnchor] = useState<HTMLElement | null>(null);
  const [profileDialogUser, setProfileDialogUser] = useState<{
    id: number;
    username: string;
    firstname?: string | null;
    lastname?: string | null;
    last_activity?: string | null;
  } | null>(null);
  const [editMessageTarget, setEditMessageTarget] = useState<MessageEditTarget | null>(null);
  const [replyMessageTarget, setReplyMessageTarget] = useState<MessageReplyTarget | null>(null);
  const [messageSelectionActive, setMessageSelectionActive] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
  const isCompactSelection = useMediaQuery('(max-width: 720px)');
  const [forwardMessageTarget, setForwardMessageTarget] = useState<Message[] | null>(null);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchActiveIndex, setChatSearchActiveIndex] = useState(0);
  const [activeChatTab, setActiveChatTab] = useState<ChatHeaderTab>('chat');
  const [callChatId, setCallChatId] = useState<number | null>(null);
  const [pendingCall, setPendingCall] = useState<PendingCallRequest | null>(null);
  const [callInitialMic, setCallInitialMic] = useState(true);
  const [callInitialCam, setCallInitialCam] = useState(true);
  const [inviteUsersOpen, setInviteUsersOpen] = useState(false);
  const [inviteUserIds, setInviteUserIds] = useState<number[]>([]);
  const [guestCallInviteUrl, setGuestCallInviteUrl] = useState('');
  const [createMeetingOpen, setCreateMeetingOpen] = useState(false);
  const [shareLinkOpen, setShareLinkOpen] = useState(false);
  const [shareLinkOccurrence, setShareLinkOccurrence] = useState<MeetingOccurrence | null>(null);
  const [navRailKey, setNavRailKey] = useState<NavRailKey>('chat');
  const callPresenceByChat = useCallPresence();
  const { incomingCall, setIncomingCall } = useIncomingCall();
  useMeetingReminders();
  const { occurrences: upcomingForCurrentChat, refresh: refreshUpcoming } = useUpcomingMeetings({
    chatId: undefined,
  });
  const {
    user,
    token,
    chats,
    currentChat,
    messagesByChat,
    unreadByChat,
    setChats,
    setCurrentChat,
    setMessages,
    appendMessage,
    upsertChat,
    incrementUnread,
    resetUnread,
    setUser,
    setToken,
    setRefreshToken,
    setSocketStatus,
    theme,
    toggleTheme,
    mutedChatIds,
    clearedForMeByChat,
    hiddenChatIds,
    toggleChatMuted,
    clearChatForMe,
    hideChatForMe,
    unhideChatForMe,
  } = useChatStore();

  useEffect(() => {
    const raw = searchParams.get('callRoomId') || searchParams.get('roomId');
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const chatId = Math.trunc(parsed);
    setPendingCall({ chatId, invitees: [], mode: 'join' });
    const targetChat = chats.find((chat) => chat.id === chatId);
    if (targetChat) {
      setCurrentChat(targetChat);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('callRoomId');
    next.delete('roomId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, chats, setCurrentChat]);

  useEffect(() => {
    ensureBrowserNotificationPermission();
  }, []);

  useEffect(() => {
    if (!token) return;
    const bootstrap = async () => {
      try {
        setAuthToken(token);
        const currentUser = await me();
        setUser(currentUser);
        const usersList = await getUsers();
        setUsers(usersList);
        const chatList = await getChats();
        setChats(chatList);
      } catch {
        setToken(null);
        setRefreshToken(null);
        setUser(null);
      }
    };
    bootstrap();
  }, [token, setChats, setRefreshToken, setToken, setUser]);

  useEffect(() => {
    if (!token) return;
    connectSocket(token);
    const unsubscribeStatus = onSocketStatus((status) => setSocketStatus(status));
    const unsubscribeNewMessage = onNewMessage((message) => {
      appendMessage(message.chat_id, message);
      // Auto-unhide a chat that was locally deleted "for me only" when a new message arrives.
      const hiddenIds = useChatStore.getState().hiddenChatIds;
      if (hiddenIds.includes(message.chat_id)) {
        useChatStore.getState().unhideChatForMe(message.chat_id);
      }
      const activityAt = message.created_at || new Date().toISOString();
      useChatStore.setState((state) => ({
        chats: state.chats.map((c) =>
          withBumpedMemberActivity(c, message.chat_id, message.sender_id, activityAt),
        ),
        currentChat: state.currentChat
          ? withBumpedMemberActivity(
              state.currentChat,
              message.chat_id,
              message.sender_id,
              activityAt,
            )
          : null,
      }));
      const activeChatId = useChatStore.getState().currentChat?.id;
      const currentUserId = useChatStore.getState().user?.id;
      if (currentUserId && message.sender_id !== currentUserId) {
        if (activeChatId !== message.chat_id) {
          incrementUnread(message.chat_id);
        }
        if (mutedChatIds.includes(message.chat_id)) {
          return;
        }
        const senderName = message.sender.firstname || message.sender.username;
        const parsed = parseMessageContent(message.text);
        const previewText = parsed.text || (parsed.attachments.length ? 'Вложение' : 'Новое сообщение');
        const chat = useChatStore.getState().chats.find((item) => item.id === message.chat_id);
        const chatLabel =
          chat?.type === 'group' || chat?.type === 'meeting'
            ? chat.title || 'Группа'
            : chat?.members.find((member) => member.id !== currentUserId)?.firstname ||
              chat?.members.find((member) => member.id !== currentUserId)?.username ||
              'Личный чат';
        showBrowserNotification(chatLabel, `${senderName}: ${previewText}`, {
          tag: `chat-message-${message.chat_id}`,
          onClick: () => {
            const state = useChatStore.getState();
            const targetChat = state.chats.find((item) => item.id === message.chat_id);
            if (targetChat) {
              setCurrentChat(targetChat);
              setNavRailKey('chat');
              resetUnread(message.chat_id);
            }
          },
        });
      }
    });
    const unsubscribeMessageUpdated = onMessageUpdated((message) => {
      const currentMessages = useChatStore.getState().messagesByChat[message.chat_id] || [];
      const hasMessage = currentMessages.some((item) => item.id === message.id);
      if (!hasMessage) {
        return;
      }
      setMessages(
        message.chat_id,
        currentMessages.map((item) => (item.id === message.id ? message : item)),
      );
    });
    const unsubscribeMessageDeleted = onMessageDeleted(({ chatId, messageId }) => {
      const currentMessages = useChatStore.getState().messagesByChat[chatId] || [];
      const hasMessage = currentMessages.some((item) => item.id === messageId);
      if (!hasMessage) {
        return;
      }
      setMessages(
        chatId,
        currentMessages.filter((item) => item.id !== messageId),
      );
    });
    const unsubscribeHistoryCleared = onChatHistoryCleared(({ chatId, updatedAt }) => {
      setMessages(chatId, []);
      const currentChats = useChatStore.getState().chats;
      setChats(
        currentChats.map((chat) =>
          chat.id === chatId ? { ...chat, lastMessage: null, updated_at: updatedAt } : chat,
        ),
      );
    });
    const unsubscribeChatUpdated = onChatUpdated(({ chat, createdMeeting, sourceChatId }) => {
      // Emitted by the backend after auto-promoting a private chat to group on
      // 3rd-participant join (see VideoCallGateway.joinRoom). The payload
      // includes a fresh chat snapshot so we just upsert it into the cache.
      upsertChat(chat);
      joinChat(chat.id);
      if (createdMeeting) {
        const state = useChatStore.getState();
        const activeChat = state.currentChat;
        const sourceChatKnown = Boolean(
          sourceChatId &&
            state.chats.some((item) => item.id === sourceChatId),
        );
        // Fallback for races: if the user knows the source chat locally, force
        // promotion to the meeting snapshot so member lists stay consistent.
        const shouldPromoteUi =
          sourceChatKnown ||
          activeChat?.id === sourceChatId ||
          callChatId === sourceChatId ||
          pendingCall?.chatId === sourceChatId;
        if (shouldPromoteUi) {
          setCurrentChat(chat);
          setNavRailKey('calls');
        }
        // Keep all clients in sync after promotion (especially users that were
        // already in the source private chat) and ensure they can join the new
        // meeting room subscriptions.
        void getChats()
          .then((chatList) => {
            setChats(chatList);
            const promoted = chatList.find((item) => item.id === chat.id);
            if (promoted) {
              joinChat(promoted.id);
              if (sourceChatKnown || activeChat?.id === promoted.id) {
                setCurrentChat(promoted);
              }
            }
          })
          .catch(() => {
            /* keep local cache if refresh fails */
          });
      }
    });
    return () => {
      unsubscribeStatus?.();
      unsubscribeNewMessage?.();
      unsubscribeMessageUpdated?.();
      unsubscribeMessageDeleted?.();
      unsubscribeHistoryCleared?.();
      unsubscribeChatUpdated?.();
    };
  }, [
    token,
    appendMessage,
    incrementUnread,
    mutedChatIds,
    setChats,
    setMessages,
    setSocketStatus,
    upsertChat,
    currentChat?.id,
    callChatId,
    pendingCall?.chatId,
  ]);

  useEffect(() => {
    if (!token || !chats.length) return;
    chats.forEach((chat) => joinChat(chat.id));
  }, [token, chats]);

  useEffect(() => {
    setEditMessageTarget(null);
    setReplyMessageTarget(null);
    setChatSearchOpen(false);
    setChatSearchQuery('');
    setChatSearchActiveIndex(0);
    setActiveChatTab('chat');
  }, [currentChat?.id]);

  useEffect(() => {
    setMessageSelectionActive(false);
    setSelectedMessageIds([]);
  }, [currentChat?.id]);

  useEffect(() => {
    if (!currentChat) return;
    resetUnread(currentChat.id);
    joinChat(currentChat.id);
    Promise.all([getMessages(currentChat.id), listCallSessions({ chatId: currentChat.id, limit: 100 })])
      .then(([messages, sessions]) => {
        const historyMessages = sessions.map((session) =>
          mapCallSessionToHistoryMessage(session, currentChat.members),
        );
        const merged = [...messages, ...historyMessages].sort((a, b) => {
          const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
          if (aTs !== bTs) return aTs - bTs;
          return a.id - b.id;
        });
        const marker = clearedForMeByChat[currentChat.id] || 0;
        const filtered = marker ? merged.filter((item) => item.id > marker) : merged;
        setMessages(currentChat.id, filtered);
      })
      .catch(() => {
        /* keep cached messages if load fails */
      });
  }, [clearedForMeByChat, currentChat, resetUnread, setMessages]);

  useEffect(() => {
    if (!currentChat) return;
    setSettingsTitle(currentChat.title || '');
  }, [currentChat]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    const closeOnContext = () => setContextMenu(null);
    const closeChatMenu = () => setChatContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', closeOnContext);
    window.addEventListener('scroll', close);
    window.addEventListener('resize', close);
    window.addEventListener('click', closeChatMenu);
    window.addEventListener('contextmenu', closeChatMenu);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', closeOnContext);
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('click', closeChatMenu);
      window.removeEventListener('contextmenu', closeChatMenu);
    };
  }, []);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return;
      }
      if (isCreateOpen) {
        setIsCreateOpen(false);
        e.preventDefault();
        return;
      }
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        e.preventDefault();
        return;
      }
      if (editMessageTarget) {
        setEditMessageTarget(null);
        e.preventDefault();
        return;
      }
      if (replyMessageTarget) {
        setReplyMessageTarget(null);
        e.preventDefault();
        return;
      }
      if (messageSelectionActive) {
        setMessageSelectionActive(false);
        setSelectedMessageIds([]);
        e.preventDefault();
        return;
      }
      if (chatSearchOpen) {
        setChatSearchOpen(false);
        setChatSearchQuery('');
        setChatSearchActiveIndex(0);
        e.preventDefault();
        return;
      }
      if (contextMenu) {
        setContextMenu(null);
        e.preventDefault();
        return;
      }
      if (chatContextMenu) {
        setChatContextMenu(null);
        e.preventDefault();
        return;
      }
      if (chatHeaderMenuAnchor) {
        setChatHeaderMenuAnchor(null);
        e.preventDefault();
        return;
      }
      if (currentChat) {
        setCurrentChat(null);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [
    chatContextMenu,
    chatHeaderMenuAnchor,
    contextMenu,
    currentChat,
    editMessageTarget,
    isCreateOpen,
    isSettingsOpen,
    messageSelectionActive,
    chatSearchOpen,
    replyMessageTarget,
    setCurrentChat,
  ]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  const currentMessages = currentChat ? messagesByChat[currentChat.id] || [] : [];
  const searchMatchedMessages = useMemo(() => {
    const needle = chatSearchQuery.trim().toLowerCase();
    if (!needle) {
      return [];
    }
    return currentMessages.filter((message) =>
      parseMessageContent(message.text).text.toLowerCase().includes(needle),
    );
  }, [chatSearchQuery, currentMessages]);
  const searchMatchedIds = searchMatchedMessages.map((message) => message.id);
  const activeSearchMessageId =
    searchMatchedMessages.length > 0
      ? searchMatchedMessages[Math.min(chatSearchActiveIndex, searchMatchedMessages.length - 1)]?.id || null
      : null;
  const selectedMessages = selectedMessageIds
    .map((id) => currentMessages.find((m) => m.id === id))
    .filter((m): m is Message => Boolean(m));
  const selectedOwnMessages = user
    ? selectedMessages.filter((message) => message.sender_id === user.id)
    : [];
  const currentMessageIdsKey = currentMessages
    .map((m) => m.id)
    .sort((a, b) => a - b)
    .join(',');

  useEffect(() => {
    const currentMessageIds = new Set(currentMessages.map((message) => message.id));
    setSelectedMessageIds((selectedIds) => {
      const filtered = selectedIds.filter((id) => currentMessageIds.has(id));
      if (filtered.length === selectedIds.length) {
        return selectedIds;
      }
      return filtered;
    });
  }, [currentMessageIdsKey]);

  useEffect(() => {
    if (!searchMatchedMessages.length) {
      setChatSearchActiveIndex(0);
      return;
    }
    setChatSearchActiveIndex((prev) =>
      prev >= searchMatchedMessages.length ? searchMatchedMessages.length - 1 : prev,
    );
  }, [searchMatchedMessages.length]);

  const onToggleChatSearch = () => {
    setChatSearchOpen((prev) => {
      const next = !prev;
      if (!next) {
        setChatSearchQuery('');
        setChatSearchActiveIndex(0);
      }
      return next;
    });
  };

  const onCloseChatSearch = () => {
    setChatSearchOpen(false);
    setChatSearchQuery('');
    setChatSearchActiveIndex(0);
  };

  const onSearchNext = () => {
    if (!searchMatchedMessages.length) return;
    setChatSearchActiveIndex((prev) => (prev + 1) % searchMatchedMessages.length);
  };

  const onSearchPrev = () => {
    if (!searchMatchedMessages.length) return;
    setChatSearchActiveIndex((prev) =>
      prev === 0 ? searchMatchedMessages.length - 1 : prev - 1,
    );
  };

  const onSend = async (text: string) => {
    if (!currentChat) return;
    try {
      const nextText = replyMessageTarget
        ? `↪ ${replyMessageTarget.senderName}: ${replyMessageTarget.originalText}\n${text}`
        : text;
      await sendMessageSocket({ chatId: currentChat.id, text: nextText });
      if (replyMessageTarget) {
        setReplyMessageTarget(null);
      }
    } catch {
      /* send failed */
    }
  };

  const onCompleteMessageEdit = async (messageId: number, text: string) => {
    if (!currentChat) return;
    try {
      await editMessageSocket({ chatId: currentChat.id, messageId, text });
      setEditMessageTarget(null);
    } catch {
      /* edit failed */
    }
  };

  const onDeleteMessage = async (messageId: number) => {
    if (!currentChat) return;
    const ok = await openConfirmDialog({
      title: 'Удалить сообщение',
      message: 'Удалить сообщение?',
      confirmText: 'Удалить',
    });
    if (!ok) return;
    try {
      await deleteMessageSocket({ chatId: currentChat.id, messageId });
    } catch {
      /* delete failed */
    }
  };

  const exitMessageSelection = () => {
    setMessageSelectionActive(false);
    setSelectedMessageIds([]);
  };

  const toggleMessageSelection = (messageId: number) => {
    setMessageSelectionActive(true);
    setSelectedMessageIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId],
    );
  };

  const onPickMessageForSelection = () => {
    if (!contextMenu) return;
    const id = contextMenu.message.id;
    setMessageSelectionActive(true);
    setSelectedMessageIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setContextMenu(null);
  };

  const onReplyToMessage = () => {
    if (!contextMenu) return;
    const senderName = contextMenu.message.sender.firstname || contextMenu.message.sender.username;
    const parsed = parseMessageContent(contextMenu.message.text);
    setReplyMessageTarget({
      messageId: contextMenu.message.id,
      senderName,
      originalText: parsed.text || (parsed.attachments.length ? 'Вложение' : ''),
    });
    setEditMessageTarget(null);
    setContextMenu(null);
  };

  const onForwardMessage = () => {
    if (!contextMenu) return;
    setForwardMessageTarget([contextMenu.message]);
    setContextMenu(null);
  };

  const onForwardToChat = async (targetChatId: number) => {
    if (!forwardMessageTarget?.length) return;
    try {
      for (const message of forwardMessageTarget) {
        const senderName = message.sender.firstname || message.sender.username;
        const payloadText = `Переслано от ${senderName}\n${message.text || ''}`;
        await sendMessageSocket({ chatId: targetChatId, text: payloadText });
      }
      setForwardMessageTarget(null);
    } catch {
      /* forward failed */
    }
  };

  const onBulkDeleteSelectedMessages = async () => {
    if (!currentChat || !user) return;
    if (!selectedOwnMessages.length) {
      return;
    }
    const ok = await openConfirmDialog({
      title: 'Удалить у всех',
      message: `Удалить у всех ваши выбранные сообщения (${selectedOwnMessages.length})?`,
      confirmText: 'Удалить',
    });
    if (!ok) return;
    try {
      for (const m of selectedOwnMessages) {
        await deleteMessageSocket({ chatId: currentChat.id, messageId: m.id });
      }
      exitMessageSelection();
    } catch {
      /* bulk delete failed */
    }
  };

  const onDeleteSelectedMessagesOnlyForMe = async () => {
    if (!currentChat || !selectedMessages.length) return;
    const ok = await openConfirmDialog({
      title: 'Удалить у вас',
      message: `Удалить выбранные сообщения только у вас (${selectedMessages.length})?`,
      confirmText: 'Удалить',
    });
    if (!ok) return;
    const selectedIdsSet = new Set(selectedMessages.map((message) => message.id));
    setMessages(
      currentChat.id,
      currentMessages.filter((message) => !selectedIdsSet.has(message.id)),
    );
    exitMessageSelection();
  };

  const onReplyToSelectedMessage = () => {
    if (selectedMessages.length !== 1) {
      return;
    }
    const [message] = selectedMessages;
    const senderName = message.sender.firstname || message.sender.username;
    const parsed = parseMessageContent(message.text);
    setReplyMessageTarget({
      messageId: message.id,
      senderName,
      originalText: parsed.text || (parsed.attachments.length ? 'Вложение' : ''),
    });
    setEditMessageTarget(null);
    exitMessageSelection();
  };

  const onForwardSelectedMessages = () => {
    if (!selectedMessages.length) return;
    setForwardMessageTarget(selectedMessages);
    exitMessageSelection();
  };

  const onMessageContextMenu = (event: React.MouseEvent, message: Message) => {
    event.preventDefault();
    event.stopPropagation();
    if (messageSelectionActive) {
      toggleMessageSelection(message.id);
      return;
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      message,
    });
  };

  const onChatContextMenu = (event: React.MouseEvent<HTMLDivElement>, chat: Chat) => {
    event.preventDefault();
    event.stopPropagation();
    setChatContextMenu({ x: event.clientX, y: event.clientY, chat });
  };

  const closeChatHeaderMenu = () => setChatHeaderMenuAnchor(null);

  const onOpenChatHeaderMenu = (event: React.MouseEvent<HTMLElement>) => {
    setChatHeaderMenuAnchor(event.currentTarget);
  };

  const onOpenProfileFromHeader = () => {
    if (!currentChat || currentChat.type !== 'private' || !user) {
      return;
    }
    const peerMember = currentChat.members.find((member) => member.id !== user.id);
    if (!peerMember) {
      return;
    }
    const peerFromUsers = users.find((item) => item.id === peerMember.id);
    setProfileDialogUser({
      id: peerMember.id,
      username: peerMember.username,
      firstname: peerMember.firstname,
      lastname: peerMember.lastname,
      last_activity: peerFromUsers?.last_activity || peerMember.last_activity || null,
    });
  };

  const onCreateChat = async (userId: number) => {
    try {
      const chat = await createPrivateChat(userId);
      const chatList = await getChats();
      setChats(chatList);
      const selected = chatList.find((item) => item.id === chat.id);
      if (selected) {
        setCurrentChat(selected);
      }
    } catch {
      /* create chat failed */
    }
  };

  const createDialogUsers = useMemo(
    () => users.filter((item) => item.id !== user?.id),
    [users, user?.id],
  );
  const filteredDmUsers = useMemo(() => {
    const q = dmContactQuery.trim().toLowerCase();
    if (!q) return createDialogUsers;
    return createDialogUsers.filter((item) => {
      const fullName = [item.firstname, item.lastname].filter(Boolean).join(' ').toLowerCase();
      return item.username.toLowerCase().includes(q) || fullName.includes(q);
    });
  }, [createDialogUsers, dmContactQuery]);
  const createDialogSelectedUsers = useMemo(
    () => createDialogUsers.filter((item) => selectedUserIds.includes(item.id)),
    [createDialogUsers, selectedUserIds],
  );

  const onToggleSettingsUser = (userId: number) => {
    setSettingsSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const onCreateFromSelection = async () => {
    if (!selectedUserIds.length) {
      return;
    }
    if (createDialogMode === 'dm') {
      await onCreateChat(selectedUserIds[0]);
      setIsCreateOpen(false);
      setSelectedUserIds([]);
      setGroupTitle('');
      return;
    }
    if (selectedUserIds.length < 2) {
      return;
    }
    if (!groupTitle.trim()) {
      return;
    }
    try {
      const chat = await createGroupChat({
        title: groupTitle.trim(),
        memberIds: selectedUserIds,
      });
      const chatList = await getChats();
      setChats(chatList);
      const selected = chatList.find((item) => item.id === chat.id);
      if (selected) {
        setCurrentChat(selected);
      }
      setIsCreateOpen(false);
      setSelectedUserIds([]);
      setGroupTitle('');
    } catch {
      /* create group failed */
    }
  };

  const clearHistoryForEveryone = async (chat: Chat) => {
    try {
      await clearHistoryForAllSocket({ chatId: chat.id });
    } catch {
      /* clear history failed */
    }
  };

  const clearHistoryOnlyForMe = (chat: Chat) => {
    const localMessages = messagesByChat[chat.id] || [];
    const localLastId = localMessages[localMessages.length - 1]?.id || 0;
    const backendLastId = chat.lastMessage?.id || 0;
    clearChatForMe(chat.id, Math.max(localLastId, backendLastId));
  };

  const availableForCurrentChat =
    currentChat?.type === 'group' || currentChat?.type === 'meeting'
      ? users.filter((u) => !currentChat.members.some((member) => member.id === u.id))
      : [];

  const visibleChats = useMemo(
    () => chats.filter((chat) => chat.type !== 'meeting' && !hiddenChatIds.includes(chat.id)),
    [chats, hiddenChatIds],
  );

  const canManageGroup = Boolean(
    currentChat &&
      (currentChat.type === 'group' || currentChat.type === 'meeting') &&
      currentChat.members.find((member) => member.id === user?.id)?.role !== 'member',
  );

  const isOwner = Boolean(
    currentChat &&
      (currentChat.type === 'group' || currentChat.type === 'meeting') &&
      currentChat.members.find((member) => member.id === user?.id)?.role === 'owner',
  );

  const roleLabel = (role: 'owner' | 'admin' | 'member') => {
    if (role === 'owner') return 'владелец';
    if (role === 'admin') return 'администратор';
    return 'участник';
  };

  const refreshChats = async () => {
    const chatList = await getChats();
    setChats(chatList);
    if (currentChat) {
      const selected = chatList.find((item) => item.id === currentChat.id) || null;
      setCurrentChat(selected);
    }
  };

  const onSaveTitle = async () => {
    if (!currentChat || (currentChat.type !== 'group' && currentChat.type !== 'meeting')) return;
    try {
      await updateGroupTitle(currentChat.id, settingsTitle.trim());
      await refreshChats();
    } catch {
      /* save title failed */
    }
  };

  const onAddMembers = async () => {
    if (
      !currentChat ||
      (currentChat.type !== 'group' && currentChat.type !== 'meeting') ||
      !settingsSelectedIds.length
    ) {
      return;
    }
    try {
      await addChatMembers(currentChat.id, settingsSelectedIds);
      setSettingsSelectedIds([]);
      await refreshChats();
    } catch {
      /* add members failed */
    }
  };

  const onRemoveMember = async (targetUserId: number) => {
    if (!currentChat || (currentChat.type !== 'group' && currentChat.type !== 'meeting')) return;
    try {
      await removeChatMember(currentChat.id, targetUserId);
      await refreshChats();
    } catch {
      /* remove member failed */
    }
  };

  const onLeaveManagedChat = async () => {
    if (!currentChat) return;
    try {
      await leaveManagedChat(currentChat.id);
      await refreshChats();
      setCurrentChat(null);
      setIsSettingsOpen(false);
    } catch {
      /* leave group failed */
    }
  };

  const [deleteChatTarget, setDeleteChatTarget] = useState<Chat | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
  }>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Подтвердить',
    cancelText: 'Отмена',
  });
  const confirmResolveRef = useRef<((result: boolean) => void) | null>(null);

  const openConfirmDialog = useCallback(
    ({
      title = 'Подтверждение',
      message,
      confirmText = 'Подтвердить',
      cancelText = 'Отмена',
    }: {
      title?: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
    }) =>
      new Promise<boolean>((resolve) => {
        confirmResolveRef.current = resolve;
        setConfirmDialog({
          open: true,
          title,
          message,
          confirmText,
          cancelText,
        });
      }),
    [],
  );

  const resolveConfirmDialog = useCallback((result: boolean) => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    resolve?.(result);
    setConfirmDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const requestDeleteChat = (chat?: Chat) => {
    const target = chat ?? currentChat;
    if (!target) return;
    setDeleteChatTarget(target);
  };

  const performDeleteChat = async (
    target: Chat,
    options: { deleteForEveryone: boolean },
  ) => {
    const isGroup = target.type === 'group' || target.type === 'meeting';
    try {
      if (isGroup || options.deleteForEveryone) {
        await deleteGroupChat(target.id);
        await refreshChats();
      } else {
        const localMessages = messagesByChat[target.id] || [];
        const localLastId = localMessages[localMessages.length - 1]?.id || 0;
        const backendLastId = target.lastMessage?.id || 0;
        clearChatForMe(target.id, Math.max(localLastId, backendLastId));
        hideChatForMe(target.id);
      }
      if (currentChat?.id === target.id) {
        setCurrentChat(null);
        setIsSettingsOpen(false);
      }
      setDeleteChatTarget(null);
    } catch {
      /* delete chat failed */
    }
  };

  const startCallForChat = async (chatId: number, usersToInvite: number[] = []) => {
    try {
      await startCallSocket({ chatId });
      if (usersToInvite.length) {
        await inviteUsersToCallSocket({ chatId, userIds: usersToInvite });
      }
    } catch {
      /* start call / invite failed */
    }
    setCallChatId(chatId);
  };

  const inviteUsersToCall = async () => {
    if (!callChatId || !inviteUserIds.length) return;
    try {
      await inviteUsersToCallSocket({ chatId: callChatId, userIds: inviteUserIds });
      setInviteUsersOpen(false);
      setInviteUserIds([]);
    } catch {
      /* invite failed */
    }
  };

  useEffect(() => {
    if (!inviteUsersOpen || !callChatId) {
      setGuestCallInviteUrl('');
      return;
    }
    let cancelled = false;
    createGuestCallLinkToken(callChatId)
      .then(({ token: guestToken }) => {
        if (!cancelled) {
          setGuestCallInviteUrl(buildGuestCallUrl(guestToken));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGuestCallInviteUrl(`${window.location.origin}/guest-call?roomId=${callChatId}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inviteUsersOpen, callChatId]);

  const onPhoneStartNow = () => {
    if (!currentChat) return;
    if (callPresenceByChat[currentChat.id]?.active) {
      setPendingCall({ chatId: currentChat.id, invitees: [], mode: 'join' });
      return;
    }
    const otherMemberIds = currentChat.members
      .filter((member) => member.id !== user?.id)
      .map((member) => member.id);
    setPendingCall({ chatId: currentChat.id, invitees: otherMemberIds, mode: 'start' });
  };

  const onJoinExistingCall = () => {
    if (!currentChat) return;
    setPendingCall({ chatId: currentChat.id, invitees: [], mode: 'join' });
  };

  const confirmPendingCall = (payload: { micEnabled: boolean; camEnabled: boolean }) => {
    if (!pendingCall) return;
    const { chatId, invitees, mode, asGuest } = pendingCall;
    setCallInitialMic(payload.micEnabled);
    setCallInitialCam(payload.camEnabled);
    setPendingCall(null);
    if (asGuest) {
      const state = useChatStore.getState();
      const guestName = state.user?.firstname || state.user?.username || 'Guest';
      void createGuestCallLinkToken(chatId)
        .then(({ token: guestToken }) => {
          window.location.assign(buildGuestCallUrl(guestToken, guestName));
        })
        .catch(() => {
          window.location.assign(
            `/guest-call?roomId=${encodeURIComponent(String(chatId))}&name=${encodeURIComponent(guestName)}`,
          );
        });
      return;
    }
    if (mode === 'start') {
      void startCallForChat(chatId, invitees);
      return;
    }
    setCallChatId(chatId);
  };

  return (
    <Box
      sx={{
        display: 'grid',
        height: '100dvh',
        minHeight: 0,
        width: '100%',
        maxWidth: '100vw',
        overflow: 'hidden',
        bgcolor: 'background.default',
        gridTemplateColumns: {
          xs: '1fr',
          md: '56px 260px 1fr',
        },
      }}
    >
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <NavRail
          selected={navRailKey}
          themeMode={theme}
          onSelect={(key) => {
            setNavRailKey(key);
          }}
          unreadChats={Object.values(unreadByChat).reduce((sum, n) => sum + (n || 0), 0)}
          activeCalls={
            Object.entries(callPresenceByChat).filter(([id, p]) => {
              if (!p.active) return false;
              const chat = chats.find((item) => item.id === Number(id));
              return chat?.type === 'meeting';
            }).length
          }
        />
      </Box>

      <Box
        sx={{
          display: { xs: currentChat ? 'none' : 'flex', md: 'flex' },
          minHeight: 0,
          minWidth: 0,
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{
            display: { xs: 'flex', md: 'none' },
            px: 1,
            pt: 'max(8px, env(safe-area-inset-top))',
            pb: 0.75,
            gap: 0.75,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.default',
          }}
        >
          <Button
            size="small"
            variant={navRailKey === 'chat' ? 'contained' : 'text'}
            onClick={() => setNavRailKey('chat')}
            sx={{ textTransform: 'none', borderRadius: 999, minWidth: 0, px: 1.5 }}
          >
            Чаты
          </Button>
          <Button
            size="small"
            variant={navRailKey === 'calls' ? 'contained' : 'text'}
            onClick={() => setNavRailKey('calls')}
            sx={{ textTransform: 'none', borderRadius: 999, minWidth: 0, px: 1.5 }}
          >
            Встречи
          </Button>
          <Button
            size="small"
            variant={navRailKey === 'people' ? 'contained' : 'text'}
            onClick={() => setNavRailKey('people')}
            sx={{ textTransform: 'none', borderRadius: 999, minWidth: 0, px: 1.5 }}
          >
            Люди
          </Button>
        </Box>

        {navRailKey === 'calls' ? (
          <CallsSidebar
            workspaceName="Super Chat"
            userLabel={user?.firstname || user?.username}
            themeMode={theme}
            chats={chats}
            currentChatId={currentChat?.id}
            currentUserId={user?.id}
            activeCallChats={Object.entries(callPresenceByChat)
              .filter(([, p]) => p.active)
              .map(([id]) => Number(id))}
            upcomingMeetings={upcomingForCurrentChat}
            onCreateMeeting={() => setCreateMeetingOpen(true)}
            onJoinMeeting={(occ) => {
              if (occ.chatId) {
                setCallChatId(occ.chatId);
              } else {
                window.open(
                  buildGuestMeetingUrl(occ.inviteToken),
                  '_blank',
                );
              }
            }}
            onShareMeetingLink={(occ) => {
              setShareLinkOccurrence(occ);
              setShareLinkOpen(true);
            }}
            onToggleTheme={toggleTheme}
            onSelectChat={(chat) => {
              setNavRailKey('chat');
              setCurrentChat(chat);
            }}
            onJoinActiveCall={(chat) => {
              setNavRailKey('chat');
              setCurrentChat(chat);
              setPendingCall({ chatId: chat.id, invitees: [], mode: 'join' });
            }}
            onChatContextMenu={onChatContextMenu}
            onLogout={() => {
              setToken(null);
              setRefreshToken(null);
              setUser(null);
              setAuthToken(null);
            }}
          />
        ) : navRailKey === 'people' ? (
          <PeopleSidebar
            workspaceName="Super Chat"
            userLabel={user?.firstname || user?.username}
            themeMode={theme}
            people={users}
            currentUserId={user?.id}
            onToggleTheme={toggleTheme}
            onMessageUser={(person) => {
              void onCreateChat(person.id);
              setNavRailKey('chat');
            }}
            onCallUser={async (person) => {
              try {
                const chat = await createPrivateChat(person.id);
                const chatList = await getChats();
                setChats(chatList);
                const selected = chatList.find((item) => item.id === chat.id);
                if (selected) {
                  setCurrentChat(selected);
                }
                setNavRailKey('chat');
                setPendingCall({ chatId: chat.id, invitees: [person.id], mode: 'start' });
              } catch {
                /* start call from directory failed */
              }
            }}
            onToggleMuteUser={async (person) => {
              const existing = chats.find(
                (c) =>
                  c.type === 'private' &&
                  c.members.some((m) => m.id === person.id) &&
                  c.members.some((m) => m.id === user?.id),
              );
              try {
                const chat = existing || (await createPrivateChat(person.id));
                if (!existing) {
                  const chatList = await getChats();
                  setChats(chatList);
                }
                toggleChatMuted(chat.id);
              } catch {
                /* toggle mute failed */
              }
            }}
            isUserMuted={(person) => {
              const existing = chats.find(
                (c) =>
                  c.type === 'private' &&
                  c.members.some((m) => m.id === person.id) &&
                  c.members.some((m) => m.id === user?.id),
              );
              if (!existing) return null;
              return mutedChatIds.includes(existing.id);
            }}
            onLogout={() => {
              setToken(null);
              setRefreshToken(null);
              setUser(null);
              setAuthToken(null);
            }}
          />
        ) : (
          <Sidebar
            workspaceName="Super Chat"
            userLabel={user?.firstname || user?.username}
            themeMode={theme}
            chats={visibleChats}
            currentChatId={currentChat?.id}
            currentUserId={user?.id}
            unreadByChat={unreadByChat}
            mutedChatIds={mutedChatIds}
            onToggleTheme={toggleTheme}
            onSelectChat={setCurrentChat}
            onCreateChannel={() => {
              setCreateDialogMode('group');
              setSelectedUserIds([]);
              setDmContactQuery('');
              setGroupTitle(computeNextAutoGroupTitle(chats));
              setIsCreateOpen(true);
            }}
            onCreateDm={() => {
              setCreateDialogMode('dm');
              setSelectedUserIds([]);
              setDmContactQuery('');
              setGroupTitle('');
              setIsCreateOpen(true);
            }}
            onChatContextMenu={onChatContextMenu}
            onLogout={() => {
              setToken(null);
              setRefreshToken(null);
              setUser(null);
              setAuthToken(null);
            }}
          />
        )}
      </Box>

      <Box
        component="section"
        sx={{
          position: 'relative',
          display: { xs: currentChat ? 'flex' : 'none', md: 'flex' },
          minHeight: 0,
          minWidth: 0,
          flexDirection: 'column',
          bgcolor: 'background.default',
        }}
        onContextMenu={() => setContextMenu(null)}
      >
        {currentChat ? (
          <>
            {messageSelectionActive ? (
              <Paper
                elevation={0}
                square
                sx={{
                  borderBottom: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: { xs: 0.5, sm: 1 },
                    px: { xs: 0.75, sm: 1.5 },
                    py: 0.75,
                    minHeight: 52,
                    pt: 'max(4px, env(safe-area-inset-top))',
                    flexWrap: 'nowrap',
                    overflowX: 'auto',
                  }}
                >
                  <IconButton aria-label="Отменить выбор" onClick={exitMessageSelection} size="small" color="inherit">
                    <Close />
                  </IconButton>
                  <Typography
                    variant="subtitle2"
                    fontWeight={600}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontSize: { xs: 13, sm: 14 },
                    }}
                  >
                    Выбрано: {selectedMessageIds.length}
                  </Typography>
                  {isCompactSelection ? (
                    <>
                      <Tooltip title="Ответить">
                        <span>
                          <IconButton
                            size="small"
                            disabled={selectedMessageIds.length !== 1}
                            onClick={onReplyToSelectedMessage}
                            aria-label="Ответить"
                          >
                            <Reply fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Переслать">
                        <span>
                          <IconButton
                            size="small"
                            disabled={!selectedMessageIds.length}
                            onClick={onForwardSelectedMessages}
                            aria-label="Переслать"
                          >
                            <Forward fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Удалить у меня">
                        <span>
                          <IconButton
                            size="small"
                            disabled={!selectedMessageIds.length}
                            onClick={onDeleteSelectedMessagesOnlyForMe}
                            aria-label="Удалить у меня"
                          >
                            <DeleteOutline fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      {selectedOwnMessages.length ? (
                        <Tooltip title="Удалить у всех">
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => void onBulkDeleteSelectedMessages()}
                              aria-label="Удалить у всех"
                            >
                              <DeleteOutline fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<Reply />}
                        disabled={selectedMessageIds.length !== 1}
                        onClick={onReplyToSelectedMessage}
                      >
                        Ответить
                      </Button>
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<Forward />}
                        disabled={!selectedMessageIds.length}
                        onClick={onForwardSelectedMessages}
                      >
                        Переслать
                      </Button>
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<DeleteOutline />}
                        disabled={!selectedMessageIds.length}
                        onClick={onDeleteSelectedMessagesOnlyForMe}
                      >
                        Удалить у меня
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        variant="text"
                        startIcon={<DeleteOutline />}
                        disabled={!selectedOwnMessages.length}
                        onClick={() => void onBulkDeleteSelectedMessages()}
                      >
                        Удалить у всех
                      </Button>
                    </>
                  )}
                </Box>
              </Paper>
            ) : (
              <ChatHeader
                chat={currentChat}
                currentUserId={user?.id}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenMoreMenu={onOpenChatHeaderMenu}
                onOpenProfile={onOpenProfileFromHeader}
                searchOpen={chatSearchOpen}
                searchQuery={chatSearchQuery}
                searchMatchesCount={searchMatchedMessages.length}
                activeSearchIndex={chatSearchActiveIndex}
                onToggleSearch={onToggleChatSearch}
                onSearchQueryChange={(value) => {
                  setChatSearchQuery(value);
                  setChatSearchActiveIndex(0);
                }}
                onSearchPrev={onSearchPrev}
                onSearchNext={onSearchNext}
                onCloseSearch={onCloseChatSearch}
                onBackToList={() => setCurrentChat(null)}
                onStartCall={() => onPhoneStartNow()}
                onJoinCall={onJoinExistingCall}
                isCallActive={Boolean(callPresenceByChat[currentChat.id]?.active)}
                callParticipants={callPresenceByChat[currentChat.id]?.participants ?? 0}
                activeTab={activeChatTab}
                onTabChange={(next) => {
                  setActiveChatTab(next);
                  if (next === 'files') {
                    setChatSearchOpen(false);
                    setMessageSelectionActive(false);
                    setSelectedMessageIds([]);
                  }
                }}
              />
            )}
            {activeChatTab === 'chat' ? (
              <>
                <MessageList
                  key={currentChat.id}
                  messages={currentMessages}
                  currentUserId={user?.id}
                  isGroupChat={currentChat.type === 'group' || currentChat.type === 'meeting'}
                  searchQuery={chatSearchQuery}
                  highlightedMessageIds={searchMatchedIds}
                  activeMessageId={activeSearchMessageId}
                  selectionMode={messageSelectionActive}
                  selectedMessageIds={selectedMessageIds}
                  onToggleMessageSelect={toggleMessageSelection}
                  onMessageContextMenu={onMessageContextMenu}
                />
                <Box sx={{ opacity: messageSelectionActive ? 0.45 : 1, pointerEvents: messageSelectionActive ? 'none' : 'auto' }}>
                  <MessageComposer
                    onSend={onSend}
                    chatId={currentChat.id}
                    editTarget={editMessageTarget}
                    replyTarget={replyMessageTarget}
                    onCancelReply={() => setReplyMessageTarget(null)}
                    onCancelEdit={() => setEditMessageTarget(null)}
                    onCompleteEdit={onCompleteMessageEdit}
                  />
                </Box>
              </>
            ) : (
              <ChatFilesView key={`files-${currentChat.id}`} chatId={currentChat.id} />
            )}
          </>
        ) : (
          <EmptyState />
        )}

        <Menu
          open={Boolean(contextMenu)}
          onClose={() => setContextMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined
          }
        >
          <MenuItem onClick={onPickMessageForSelection}>Выбрать</MenuItem>
          <MenuItem onClick={onReplyToMessage}>
            <Reply sx={{ fontSize: 18, mr: 1 }} />
            Ответить
          </MenuItem>
          <MenuItem onClick={onForwardMessage}>
            <Forward sx={{ fontSize: 18, mr: 1 }} />
            Переслать
          </MenuItem>
          {contextMenu &&
          user &&
          contextMenu.message.sender_id === user.id &&
          parseMessageContent(contextMenu.message.text).attachments.length === 0 ? (
            <MenuItem
              onClick={() => {
                if (!contextMenu) return;
                setEditMessageTarget({
                  messageId: contextMenu.message.id,
                  originalText: parseMessageContent(contextMenu.message.text).text,
                });
                setContextMenu(null);
              }}
            >
              Редактировать
            </MenuItem>
          ) : null}
          {contextMenu && user && contextMenu.message.sender_id === user.id ? (
            <MenuItem
              sx={{ color: 'error.main' }}
              onClick={() => {
                if (!contextMenu) return;
                onDeleteMessage(contextMenu.message.id);
                setContextMenu(null);
              }}
            >
              Удалить
            </MenuItem>
          ) : null}
        </Menu>

        <Dialog
          open={Boolean(forwardMessageTarget)}
          onClose={() => setForwardMessageTarget(null)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Переслать сообщение</DialogTitle>
          <DialogContent dividers>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              Выберите чат для пересылки
              {forwardMessageTarget?.length && forwardMessageTarget.length > 1
                ? ` (${forwardMessageTarget.length} сообщ.)`
                : ''}
            </Typography>
            <Box sx={{ maxHeight: 280, overflowY: 'auto' }}>
              {chats.map((chat) => {
                const title =
                  chat.type === 'group' || chat.type === 'meeting'
                    ? chat.title || 'Группа'
                    : chat.members.find((m) => m.id !== user?.id)?.firstname ||
                      chat.members.find((m) => m.id !== user?.id)?.username ||
                      'Личный чат';
                return (
                  <ListItemButton
                    key={chat.id}
                    onClick={() => void onForwardToChat(chat.id)}
                    sx={{ borderRadius: 1.5, mb: 0.5 }}
                  >
                    <ListItemText
                      primary={title}
                      secondary={chat.type === 'group' || chat.type === 'meeting' ? 'Групповой чат' : 'Личный чат'}
                      primaryTypographyProps={{ noWrap: true }}
                      secondaryTypographyProps={{ noWrap: true }}
                    />
                  </ListItemButton>
                );
              })}
            </Box>
          </DialogContent>
        </Dialog>

        <Menu
          open={Boolean(chatContextMenu)}
          onClose={() => setChatContextMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={
            chatContextMenu ? { top: chatContextMenu.y, left: chatContextMenu.x } : undefined
          }
          slotProps={{
            paper: {
              sx: {
                mt: 0.25,
                minWidth: 300,
                borderRadius: 2.5,
                p: 0.75,
                border: 1,
                borderColor: (t) =>
                  t.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)',
                boxShadow: (t) =>
                  t.palette.mode === 'dark'
                    ? '0 10px 30px rgba(0,0,0,0.4)'
                    : '0 10px 28px rgba(15,23,42,0.15)',
              },
            },
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', px: 1.25, pb: 0.25, fontWeight: 700, letterSpacing: '0.02em' }}
          >
            Действия с чатом
          </Typography>
          <MenuItem
            onClick={() => {
              if (!chatContextMenu) return;
              toggleChatMuted(chatContextMenu.chat.id);
              setChatContextMenu(null);
            }}
            sx={{
              minHeight: 40,
              borderRadius: 1.5,
              gap: 1,
              px: 1.25,
              '&.Mui-focusVisible': { bgcolor: 'action.hover' },
            }}
          >
            <ListItemIcon sx={{ minWidth: 28, color: 'text.secondary' }}>
              {chatContextMenu && mutedChatIds.includes(chatContextMenu.chat.id) ? (
                <Notifications fontSize="small" />
              ) : (
                <NotificationsOff fontSize="small" />
              )}
            </ListItemIcon>
            {chatContextMenu && mutedChatIds.includes(chatContextMenu.chat.id)
              ? 'Включить уведомления'
              : 'Отключить уведомления'}
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!chatContextMenu) return;
              clearHistoryOnlyForMe(chatContextMenu.chat);
              setChatContextMenu(null);
            }}
            sx={{
              minHeight: 40,
              borderRadius: 1.5,
              gap: 1,
              px: 1.25,
              '&.Mui-focusVisible': { bgcolor: 'action.hover' },
            }}
          >
            <ListItemIcon sx={{ minWidth: 28, color: 'text.secondary' }}>
              <DeleteOutline fontSize="small" />
            </ListItemIcon>
            Очистить историю только у меня
          </MenuItem>
          <Divider sx={{ my: 0.5 }} />
          <MenuItem
            onClick={() => {
              if (!chatContextMenu) return;
              clearHistoryForEveryone(chatContextMenu.chat);
              setChatContextMenu(null);
            }}
            sx={{
              minHeight: 40,
              borderRadius: 1.5,
              gap: 1,
              px: 1.25,
              color: 'error.main',
              '&.Mui-focusVisible': { bgcolor: 'action.hover' },
            }}
          >
            <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>
              <DeleteOutline fontSize="small" />
            </ListItemIcon>
            Очистить историю у всех
          </MenuItem>
          {chatContextMenu &&
          (chatContextMenu.chat.type === 'private' ||
            chatContextMenu.chat.members.find((m) => m.id === user?.id)?.role === 'owner') ? (
            <MenuItem
              onClick={() => {
                const target = chatContextMenu.chat;
                setChatContextMenu(null);
                requestDeleteChat(target);
              }}
              sx={{
                minHeight: 40,
                borderRadius: 1.5,
                gap: 1,
                px: 1.25,
                color: 'error.main',
                '&.Mui-focusVisible': { bgcolor: 'action.hover' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>
                <DeleteOutline fontSize="small" />
              </ListItemIcon>
              {chatContextMenu.chat.type === 'group' || chatContextMenu.chat.type === 'meeting' ? 'Удалить группу' : 'Удалить чат'}
            </MenuItem>
          ) : null}
        </Menu>

        <Menu
          open={Boolean(chatHeaderMenuAnchor)}
          onClose={closeChatHeaderMenu}
          anchorEl={chatHeaderMenuAnchor}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{
            paper: {
              sx: {
                mt: 0.75,
                minWidth: 300,
                borderRadius: 2.5,
                p: 0.75,
                border: 1,
                borderColor: (t) =>
                  t.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)',
                boxShadow: (t) =>
                  t.palette.mode === 'dark'
                    ? '0 10px 30px rgba(0,0,0,0.4)'
                    : '0 10px 28px rgba(15,23,42,0.15)',
              },
            },
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', px: 1.25, pb: 0.25, fontWeight: 700, letterSpacing: '0.02em' }}
          >
            Действия с чатом
          </Typography>
          {currentChat ? (
            <MenuItem
              dense
              onClick={() => {
                toggleChatMuted(currentChat.id);
                closeChatHeaderMenu();
              }}
              sx={{
                minHeight: 40,
                borderRadius: 1.5,
                gap: 1,
                px: 1.25,
                '&.Mui-focusVisible': { bgcolor: 'action.hover' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: 'text.secondary' }}>
                {mutedChatIds.includes(currentChat.id) ? (
                  <Notifications fontSize="small" />
                ) : (
                  <NotificationsOff fontSize="small" />
                )}
              </ListItemIcon>
              {mutedChatIds.includes(currentChat.id)
                ? 'Включить уведомления'
                : 'Отключить уведомления'}
            </MenuItem>
          ) : null}
          {currentChat ? (
            <MenuItem
              dense
              onClick={() => {
                clearHistoryOnlyForMe(currentChat);
                closeChatHeaderMenu();
              }}
              sx={{
                minHeight: 40,
                borderRadius: 1.5,
                gap: 1,
                px: 1.25,
                '&.Mui-focusVisible': { bgcolor: 'action.hover' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: 'text.secondary' }}>
                <DeleteOutline fontSize="small" />
              </ListItemIcon>
              Очистить историю только у меня
            </MenuItem>
          ) : null}
          {currentChat ? (
            <MenuItem
              dense
              onClick={() => {
                void clearHistoryForEveryone(currentChat);
                closeChatHeaderMenu();
              }}
              sx={{
                minHeight: 40,
                borderRadius: 1.5,
                gap: 1,
                px: 1.25,
                color: 'error.main',
                '&.Mui-focusVisible': { bgcolor: 'action.hover' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>
                <DeleteOutline fontSize="small" />
              </ListItemIcon>
              Очистить историю у всех
            </MenuItem>
          ) : null}
          <Divider sx={{ my: 0.5 }} />
          {currentChat?.type === 'group' || currentChat?.type === 'meeting' ? (
            <MenuItem
              dense
              onClick={() => {
                setIsSettingsOpen(true);
                closeChatHeaderMenu();
              }}
              sx={{
                minHeight: 40,
                borderRadius: 1.5,
                gap: 1,
                px: 1.25,
                '&.Mui-focusVisible': { bgcolor: 'action.hover' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: 'text.secondary' }}>
                <Settings fontSize="small" />
              </ListItemIcon>
              Настройки группы
            </MenuItem>
          ) : null}
          {currentChat?.type === 'group' || currentChat?.type === 'meeting' ? (
            <MenuItem
              dense
              onClick={() => {
                void onLeaveManagedChat();
                closeChatHeaderMenu();
              }}
              sx={{
                minHeight: 40,
                borderRadius: 1.5,
                gap: 1,
                px: 1.25,
                '&.Mui-focusVisible': { bgcolor: 'action.hover' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: 'text.secondary' }}>
                <Logout fontSize="small" />
              </ListItemIcon>
              Выйти из группы
            </MenuItem>
          ) : null}
          {currentChat && (currentChat.type === 'private' || isOwner) ? (
            <MenuItem
              dense
              onClick={() => {
                requestDeleteChat(currentChat);
                closeChatHeaderMenu();
              }}
              sx={{
                minHeight: 40,
                borderRadius: 1.5,
                gap: 1,
                px: 1.25,
                color: 'error.main',
                '&.Mui-focusVisible': { bgcolor: 'action.hover' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>
                <DeleteOutline fontSize="small" />
              </ListItemIcon>
              {currentChat.type === 'group' || currentChat.type === 'meeting' ? 'Удалить группу' : 'Удалить чат'}
            </MenuItem>
          ) : null}
        </Menu>
      </Box>

      <Dialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            pt: { xs: 1.5, sm: 2.25 },
            px: { xs: 1.5, sm: 2.25 },
            pb: { xs: 0.75, sm: 1 },
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ minWidth: 0, flex: 1 }}
          >
            <Box
              sx={(t) => ({
                width: { xs: 36, sm: 44 },
                height: { xs: 36, sm: 44 },
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.2 : 0.12),
                color: 'primary.main',
                flexShrink: 0,
              })}
            >
              <ChatBubble sx={{ fontSize: { xs: 20, sm: 24 } }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="h6"
                fontWeight={800}
                letterSpacing="-0.02em"
                lineHeight={1.15}
                sx={{ fontSize: { xs: '1.1rem', sm: '1.25rem' } }}
              >
                {createDialogMode === 'group' ? 'Новая группа' : 'Новый личный чат'}
              </Typography>
            </Box>
          </Stack>
          <IconButton
            size="small"
            aria-label="Закрыть"
            onClick={() => setIsCreateOpen(false)}
            sx={{
              color: 'text.secondary',
              mt: 0,
              mr: -0.25,
            }}
          >
            <Close fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ px: 2.25, py: 2.25 }}>
          <Stack spacing={2}>
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.75, px: 0.25, fontWeight: 600 }}
              >
                Участники
              </Typography>
              {createDialogMode === 'group' ? (
                <Autocomplete
                  multiple
                  disableCloseOnSelect
                  size="small"
                  options={createDialogUsers}
                  value={createDialogSelectedUsers}
                  onChange={(_, nextValue) => {
                    const nextUsers = Array.isArray(nextValue) ? nextValue : [];
                    setSelectedUserIds(nextUsers.map((item) => item.id));
                  }}
                  getOptionLabel={(item) => {
                    const name =
                      [item.firstname, item.lastname].filter(Boolean).join(' ') ||
                      item.firstname ||
                      item.username;
                    return `${name} (@${item.username})`;
                  }}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  filterOptions={(options, state) => {
                    const query = state.inputValue.trim().toLowerCase();
                    if (!query) return options;
                    return options.filter((item) => {
                      const name = [item.firstname, item.lastname].filter(Boolean).join(' ');
                      return (
                        item.username.toLowerCase().includes(query) || name.toLowerCase().includes(query)
                      );
                    });
                  }}
                  noOptionsText="Никого не нашли"
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Начните вводить имя или @username" />
                  )}
                  renderOption={(props, option) => {
                    const displayName =
                      [option.firstname, option.lastname].filter(Boolean).join(' ') ||
                      option.firstname ||
                      option.username;
                    return (
                      <li {...props}>
                        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0, py: 0.25 }}>
                          <Avatar
                            sx={{
                              width: 30,
                              height: 30,
                              bgcolor: getAvatarColor(displayName),
                              color: '#fff',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {getAvatarInitial(displayName)}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>
                              {displayName}
                            </Typography>
                            <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.2 }}>
                              @{option.username}
                            </Typography>
                          </Box>
                        </Stack>
                      </li>
                    );
                  }}
                  slotProps={{
                    paper: {
                      sx: {
                        borderRadius: 2,
                        border: 1,
                        borderColor: 'divider',
                      },
                    },
                  }}
                />
              ) : (
                <Stack spacing={1}>
                  <TextField
                    size="small"
                    placeholder="Поиск контакта"
                    value={dmContactQuery}
                    onChange={(e) => setDmContactQuery(e.target.value)}
                  />
                  <Paper
                    variant="outlined"
                    sx={{
                      borderRadius: 2,
                      maxHeight: 260,
                      overflowY: 'auto',
                    }}
                  >
                    {filteredDmUsers.length ? (
                      filteredDmUsers.map((item) => {
                        const displayName =
                          [item.firstname, item.lastname].filter(Boolean).join(' ') ||
                          item.firstname ||
                          item.username;
                        const selected = selectedUserIds[0] === item.id;
                        return (
                          <ListItemButton
                            key={item.id}
                            selected={selected}
                            onClick={() => setSelectedUserIds([item.id])}
                            sx={{
                              py: 1,
                              px: 1.25,
                              '&.Mui-selected': {
                                bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.22 : 0.1),
                              },
                            }}
                          >
                            <ListItemAvatar sx={{ minWidth: 42 }}>
                              <Avatar
                                sx={{
                                  width: 30,
                                  height: 30,
                                  bgcolor: getAvatarColor(displayName),
                                  color: '#fff',
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                {getAvatarInitial(displayName)}
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                              primary={displayName}
                              secondary={`@${item.username}`}
                              primaryTypographyProps={{ noWrap: true, fontSize: 14, fontWeight: 600 }}
                              secondaryTypographyProps={{ noWrap: true, fontSize: 12 }}
                            />
                          </ListItemButton>
                        );
                      })
                    ) : (
                      <Box sx={{ px: 1.25, py: 1.5, fontSize: 13, color: 'text.secondary' }}>
                        Ничего не найдено
                      </Box>
                    )}
                  </Paper>
                </Stack>
              )}
            </Box>
          </Stack>
          {createDialogMode === 'group' ? (
            <Box sx={{ mt: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.75, px: 0.25, fontWeight: 600 }}
              >
                Название группы
              </Typography>
              <TextField
                fullWidth
                size="small"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="Например: Команда"
                InputLabelProps={{ shrink: false }}
              />
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions
          sx={{
            px: 2.25,
            py: 1.75,
            justifyContent: 'space-between',
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: (t) => alpha(t.palette.mode === 'dark' ? '#000' : '#0f172a', t.palette.mode === 'dark' ? 0.2 : 0.03),
          }}
        >
          <Button variant="text" color="inherit" onClick={() => setIsCreateOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="contained"
            disableElevation
            onClick={onCreateFromSelection}
            disabled={
              createDialogMode === 'group'
                ? selectedUserIds.length < 2 || !groupTitle.trim()
                : selectedUserIds.length !== 1
            }
            sx={{ borderRadius: 2, fontWeight: 700 }}
          >
            {createDialogMode === 'group' ? 'Создать группу' : 'Начать чат'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Настройки чата</DialogTitle>
        <DialogContent dividers>
          {currentChat?.type === 'group' || currentChat?.type === 'meeting' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Название группы
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: { sm: 'stretch' } }}>
                  <TextField
                    size="small"
                    fullWidth
                    value={settingsTitle}
                    onChange={(e) => setSettingsTitle(e.target.value)}
                  />
                  <Button variant="contained" onClick={onSaveTitle} disabled={!canManageGroup} sx={{ flexShrink: 0 }}>
                    Сохранить
                  </Button>
                </Box>
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Добавить участников
                </Typography>
                <Box
                  sx={{
                    maxHeight: 144,
                    overflowY: 'auto',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1,
                  }}
                >
                  {availableForCurrentChat.map((item) => (
                    <ListItemButton
                      key={item.id}
                      dense
                      onClick={() => onToggleSettingsUser(item.id)}
                      sx={{ borderRadius: 1 }}
                    >
                      <Box
                        sx={{
                          width: 14,
                          height: 14,
                          borderRadius: 0.5,
                          border: 1,
                          borderColor: settingsSelectedIds.includes(item.id) ? 'primary.main' : 'text.disabled',
                          bgcolor: settingsSelectedIds.includes(item.id) ? 'primary.main' : 'transparent',
                          flexShrink: 0,
                          mr: 1,
                        }}
                      />
                      <ListItemText primary={item.firstname || item.username} />
                    </ListItemButton>
                  ))}
                </Box>
                <Button
                  sx={{ mt: 1 }}
                  variant="contained"
                  onClick={onAddMembers}
                  disabled={!canManageGroup || !settingsSelectedIds.length}
                >
                  Добавить выбранных
                </Button>
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Участники
                </Typography>
                <Box
                  sx={{
                    maxHeight: 160,
                    overflowY: 'auto',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1,
                  }}
                >
                  {currentChat.members.map((member) => (
                    <Box
                      key={member.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        py: 0.5,
                        px: 1,
                      }}
                    >
                      <Typography variant="body2">
                        {member.firstname || member.username} ({roleLabel(member.role)})
                      </Typography>
                      {canManageGroup && member.role !== 'owner' && (
                        <Button size="small" variant="outlined" onClick={() => onRemoveMember(member.id)}>
                          Удалить
                        </Button>
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1, justifyContent: 'space-between' }}>
                <Button variant="outlined" onClick={onLeaveManagedChat} disabled={isOwner}>
                  Выйти из группы
                </Button>
                <Button variant="outlined" color="error" onClick={() => requestDeleteChat()} disabled={!isOwner}>
                  Удалить группу
                </Button>
              </Box>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Настройки доступны только для групповых чатов.
            </Typography>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(profileDialogUser)}
        onClose={() => setProfileDialogUser(null)}
        fullWidth
        maxWidth="xs"
      >
        {profileDialogUser ? (
          <>
            <Box
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                px: 1.5,
                pt: 1.5,
              }}
            >
              <IconButton
                size="small"
                aria-label="Закрыть"
                onClick={() => setProfileDialogUser(null)}
                sx={{ color: 'text.secondary' }}
              >
                <Close fontSize="small" />
              </IconButton>
            </Box>
            <DialogContent sx={{ px: 3, pb: 3, pt: 1, textAlign: 'center' }}>
              <Avatar
                sx={{
                  width: 88,
                  height: 88,
                  mx: 'auto',
                  mb: 1.75,
                  fontSize: '2rem',
                  fontWeight: 700,
                  bgcolor: getAvatarColor(profileDialogUser.firstname || profileDialogUser.username),
                  color: '#fff',
                  borderRadius: 2,
                }}
              >
                {getAvatarInitial(profileDialogUser.firstname || profileDialogUser.username)}
              </Avatar>
              <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 700 }}>
                {profileDialogUser.firstname || profileDialogUser.username}
                {profileDialogUser.lastname ? ` ${profileDialogUser.lastname}` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                @{profileDialogUser.username}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                sx={{ mt: 1.5 }}
                label={formatPresenceByLastActivity(profileDialogUser.last_activity)}
              />
            </DialogContent>
          </>
        ) : null}
      </Dialog>

      <CallFullscreenDialog
        chatId={callChatId}
        onClose={() => setCallChatId(null)}
        onOpenInviteUsers={() => setInviteUsersOpen(true)}
        initialMicEnabled={callInitialMic}
        initialCamEnabled={callInitialCam}
      />

      <PrecallSettingsDialog
        open={Boolean(pendingCall)}
        onClose={() => setPendingCall(null)}
        onConfirm={confirmPendingCall}
      />

      <DeleteChatDialog
        open={Boolean(deleteChatTarget)}
        chat={deleteChatTarget}
        currentUserId={user?.id}
        onClose={() => setDeleteChatTarget(null)}
        onConfirm={async ({ deleteForEveryone }) => {
          if (!deleteChatTarget) return;
          await performDeleteChat(deleteChatTarget, { deleteForEveryone });
        }}
      />

      <IncomingCallDialog
        incomingCall={incomingCall}
        onDecline={() => {
          const call = incomingCall;
          setIncomingCall(null);
          if (!call) return;
          void declineIncomingCallSocket({ chatId: call.chatId, callerId: call.callerId }).catch(() => {
            return;
          });
        }}
        onAccept={(call) => {
          setPendingCall({
            chatId: call.chatId,
            invitees: [],
            mode: 'join',
            asGuest: Boolean(call.asGuest),
          });
          setIncomingCall(null);
        }}
      />

      <Dialog
        open={inviteUsersOpen}
        onClose={() => setInviteUsersOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            pt: 2.25,
            px: 2.25,
            pb: 1,
          }}
        >
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box
              sx={(t) => ({
                width: 44,
                height: 44,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.2 : 0.12),
                color: 'primary.main',
              })}
            >
              <GroupAdd sx={{ fontSize: 24 }} />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={800} letterSpacing="-0.02em" lineHeight={1.2}>
                Пригласить в звонок
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                Получат уведомление и смогут подключиться
              </Typography>
            </Box>
          </Stack>
          <IconButton size="small" aria-label="Закрыть" onClick={() => setInviteUsersOpen(false)} sx={{ color: 'text.secondary' }}>
            <Close fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ px: 2.25, py: 2 }}>
          {callChatId ? (
            <GuestLinkField
              url={guestCallInviteUrl || `${window.location.origin}/guest-call?roomId=${callChatId}`}
              onCopy={async (url) => {
                try {
                  await navigator.clipboard.writeText(url);
                } catch {
                  /* clipboard failed */
                }
              }}
            />
          ) : null}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 0.75, mt: callChatId ? 1.5 : 0 }}
          >
            Или выберите пользователей
          </Typography>
          <Paper
            variant="outlined"
            sx={{
              maxHeight: 260,
              overflowY: 'auto',
              borderRadius: 2,
              p: 0.5,
              bgcolor: (t) => alpha(t.palette.mode === 'dark' ? '#fff' : '#0f172a', 0.03),
            }}
          >
            {users
              .filter((u) => u.id !== user?.id)
              .map((item) => {
                const selected = inviteUserIds.includes(item.id);
                const display = item.firstname || item.username;
                const hue = hueFromString(item.username);
                return (
                  <ListItemButton
                    key={item.id}
                    selected={selected}
                    onClick={() =>
                      setInviteUserIds((prev) =>
                        prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
                      )
                    }
                    sx={{
                      borderRadius: 1.5,
                      mb: 0.25,
                      py: 1,
                      '&.Mui-selected': {
                        bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.22 : 0.1),
                      },
                    }}
                  >
                    <ListItemAvatar sx={{ minWidth: 52 }}>
                      <Avatar
                        sx={{
                          width: 40,
                          height: 40,
                          fontSize: '0.95rem',
                          bgcolor: (t) =>
                            selected
                              ? t.palette.primary.main
                              : `hsl(${hue} 52% ${t.palette.mode === 'dark' ? '38%' : '46%'})`,
                          color: '#fff',
                        }}
                      >
                        {display.slice(0, 1).toUpperCase()}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={display}
                      secondary={`@${item.username}`}
                      primaryTypographyProps={{ fontWeight: selected ? 600 : 500 }}
                    />
                  </ListItemButton>
                );
              })}
          </Paper>
        </DialogContent>
        <DialogActions
          sx={{
            px: 2.25,
            py: 1.75,
            justifyContent: 'space-between',
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: (t) => alpha(t.palette.mode === 'dark' ? '#000' : '#0f172a', t.palette.mode === 'dark' ? 0.2 : 0.03),
          }}
        >
          <Button variant="text" color="inherit" onClick={() => setInviteUsersOpen(false)}>
            Отмена
          </Button>
          <Button
            variant="contained"
            disabled={!inviteUserIds.length}
            onClick={() => void inviteUsersToCall()}
            sx={{ borderRadius: 2, fontWeight: 700 }}
          >
            Отправить
          </Button>
        </DialogActions>
      </Dialog>

      <CreateMeetingDialog
        open={createMeetingOpen}
        onClose={() => setCreateMeetingOpen(false)}
        defaultParticipantIds={
          currentChat
            ? currentChat.members.filter((m) => m.id !== user?.id).map((m) => m.id)
            : []
        }
        users={users.filter((u) => u.id !== user?.id)}
        onCreated={(meeting: Meeting) => {
          setCreateMeetingOpen(false);
          void refreshUpcoming();
          const startsAtMs = new Date(meeting.startsAt).getTime();
          const endsAt = Number.isFinite(startsAtMs)
            ? new Date(startsAtMs + meeting.durationMin * 60_000).toISOString()
            : meeting.startsAt;
          setShareLinkOccurrence({
            meetingId: meeting.id,
            occurrenceDate: meeting.startsAt,
            startsAt: meeting.startsAt,
            endsAt,
            title: meeting.title,
            description: meeting.description ?? null,
            chatId: meeting.chatId ?? null,
            hostName:
              [meeting.host.firstname, meeting.host.lastname].filter(Boolean).join(' ') ||
              meeting.host.firstname ||
              meeting.host.username,
            inviteToken: meeting.inviteToken,
            durationMin: meeting.durationMin,
            participantUserIds: meeting.participants.map((p) => p.userId),
          });
          setShareLinkOpen(true);
        }}
      />

      <ShareGuestLinkDialog
        open={shareLinkOpen}
        onClose={() => setShareLinkOpen(false)}
        occurrence={shareLinkOccurrence}
      />
      <Dialog
        open={confirmDialog.open}
        onClose={() => resolveConfirmDialog(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{confirmDialog.title}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {confirmDialog.message}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => resolveConfirmDialog(false)} color="inherit">
            {confirmDialog.cancelText}
          </Button>
          <Button onClick={() => resolveConfirmDialog(true)} color="error" variant="contained">
            {confirmDialog.confirmText}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

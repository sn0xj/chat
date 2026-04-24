import { create } from 'zustand';
import { AuthUser, Chat, Message } from '@/lib/types';

type ChatStore = {
  user: AuthUser | null;
  token: string | null;
  refreshToken: string | null;
  chats: Chat[];
  currentChat: Chat | null;
  messagesByChat: Record<number, Message[]>;
  unreadByChat: Record<number, number>;
  loading: boolean;
  errors: string | null;
  socketStatus: 'connected' | 'disconnected';
  theme: 'light' | 'dark';
  mutedChatIds: number[];
  clearedForMeByChat: Record<number, number>;
  hiddenChatIds: number[];
  setUser: (user: AuthUser | null) => void;
  setToken: (token: string | null) => void;
  setRefreshToken: (refreshToken: string | null) => void;
  setChats: (chats: Chat[]) => void;
  setCurrentChat: (chat: Chat | null) => void;
  upsertChat: (chat: Chat) => void;
  setMessages: (chatId: number, messages: Message[]) => void;
  appendMessage: (chatId: number, message: Message) => void;
  incrementUnread: (chatId: number) => void;
  resetUnread: (chatId: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSocketStatus: (status: 'connected' | 'disconnected') => void;
  toggleTheme: () => void;
  toggleChatMuted: (chatId: number) => void;
  clearChatForMe: (chatId: number, lastMessageId?: number) => void;
  hideChatForMe: (chatId: number) => void;
  unhideChatForMe: (chatId: number) => void;
};

const loadNumberArray = (key: string) => {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'number') : [];
  } catch {
    return [];
  }
};

const loadRecord = (key: string) => {
  const raw = localStorage.getItem(key);
  if (!raw) return {} as Record<number, number>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([k, v]) => [Number(k), Number(v)])
        .filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v)),
    );
  } catch {
    return {};
  }
};

export const useChatStore = create<ChatStore>((set) => ({
  user: null,
  token: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  chats: [],
  currentChat: null,
  messagesByChat: {},
  unreadByChat: {},
  loading: false,
  errors: null,
  socketStatus: 'disconnected',
  theme: (localStorage.getItem('theme') as 'light' | 'dark') || 'light',
  mutedChatIds: loadNumberArray('mutedChatIds'),
  clearedForMeByChat: loadRecord('clearedForMeByChat'),
  hiddenChatIds: loadNumberArray('hiddenChatIds'),
  setUser: (user) => set({ user }),
  setToken: (token) => {
    if (token) localStorage.setItem('accessToken', token);
    else localStorage.removeItem('accessToken');
    set({ token });
  },
  setRefreshToken: (refreshToken) => {
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
    else localStorage.removeItem('refreshToken');
    set({ refreshToken });
  },
  setChats: (chats) => set({ chats }),
  setCurrentChat: (chat) => set({ currentChat: chat }),
  upsertChat: (chat) =>
    set((state) => {
      const existingIndex = state.chats.findIndex((c) => c.id === chat.id);
      let chats: Chat[];
      if (existingIndex >= 0) {
        const existing = state.chats[existingIndex];
        const merged: Chat = {
          ...existing,
          ...chat,
          // Preserve the newest `lastMessage` we have locally if the incoming
          // snapshot doesn't include one (we don't want `chat_updated` to wipe
          // out a recent inbound message we already rendered).
          lastMessage: chat.lastMessage ?? existing.lastMessage,
        };
        chats = [...state.chats];
        chats[existingIndex] = merged;
      } else {
        chats = [chat, ...state.chats];
      }
      const currentChat =
        state.currentChat?.id === chat.id
          ? { ...state.currentChat, ...chat, lastMessage: chat.lastMessage ?? state.currentChat.lastMessage }
          : state.currentChat;
      return { chats, currentChat };
    }),
  setMessages: (chatId, messages) =>
    set((state) => ({
      messagesByChat: { ...state.messagesByChat, [chatId]: messages },
    })),
  appendMessage: (chatId, message) =>
    set((state) => ({
      messagesByChat: {
        ...state.messagesByChat,
        [chatId]: (state.messagesByChat[chatId] || []).some((item) => item.id === message.id)
          ? state.messagesByChat[chatId] || []
          : [...(state.messagesByChat[chatId] || []), message],
      },
    })),
  incrementUnread: (chatId) =>
    set((state) => ({
      unreadByChat: {
        ...state.unreadByChat,
        [chatId]: (state.unreadByChat[chatId] || 0) + 1,
      },
    })),
  resetUnread: (chatId) =>
    set((state) => ({
      unreadByChat: {
        ...state.unreadByChat,
        [chatId]: 0,
      },
    })),
  setLoading: (loading) => set({ loading }),
  setError: (errors) => set({ errors }),
  setSocketStatus: (socketStatus) => set({ socketStatus }),
  toggleTheme: () =>
    set((state) => {
      const nextTheme = state.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', nextTheme);
      return { theme: nextTheme };
    }),
  toggleChatMuted: (chatId) =>
    set((state) => {
      const nextMuted = state.mutedChatIds.includes(chatId)
        ? state.mutedChatIds.filter((id) => id !== chatId)
        : [...state.mutedChatIds, chatId];
      localStorage.setItem('mutedChatIds', JSON.stringify(nextMuted));
      return { mutedChatIds: nextMuted };
    }),
  clearChatForMe: (chatId, lastMessageId) =>
    set((state) => {
      const marker = lastMessageId || 0;
      const nextCleared = { ...state.clearedForMeByChat, [chatId]: marker };
      localStorage.setItem('clearedForMeByChat', JSON.stringify(nextCleared));
      return {
        clearedForMeByChat: nextCleared,
        messagesByChat: { ...state.messagesByChat, [chatId]: [] },
        unreadByChat: { ...state.unreadByChat, [chatId]: 0 },
      };
    }),
  hideChatForMe: (chatId) =>
    set((state) => {
      if (state.hiddenChatIds.includes(chatId)) return state;
      const next = [...state.hiddenChatIds, chatId];
      localStorage.setItem('hiddenChatIds', JSON.stringify(next));
      return { hiddenChatIds: next };
    }),
  unhideChatForMe: (chatId) =>
    set((state) => {
      if (!state.hiddenChatIds.includes(chatId)) return state;
      const next = state.hiddenChatIds.filter((id) => id !== chatId);
      localStorage.setItem('hiddenChatIds', JSON.stringify(next));
      return { hiddenChatIds: next };
    }),
}));

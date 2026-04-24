import { io, Socket } from 'socket.io-client';
import { Chat, Message } from '@/lib/types';

let socket: Socket | null = null;
const joinedChatIds = new Set<number>();

const resolveApiBaseUrl = () => {
  const enforceTls = import.meta.env.VITE_REQUIRE_TLS !== 'false';
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  const runtimeBaseUrl = `${protocol}://${window.location.hostname}:3025`;
  const envBaseUrl = import.meta.env.VITE_API_URL;
  if (!envBaseUrl) {
    return runtimeBaseUrl;
  }

  try {
    const envUrl = new URL(envBaseUrl);
    const isEnvLocalhost = envUrl.hostname === 'localhost' || envUrl.hostname === '127.0.0.1';
    const isRuntimeLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isEnvLocalhost && !isRuntimeLocalhost) {
      return runtimeBaseUrl;
    }
  } catch {
    return runtimeBaseUrl;
  }

  if (enforceTls) {
    try {
      const resolved = new URL(envBaseUrl);
      if (window.location.protocol === 'https:' && resolved.protocol !== 'https:') {
        throw new Error('Insecure socket URL is not allowed when app is served via HTTPS');
      }
    } catch {
      throw new Error('VITE_API_URL must be a valid absolute URL when TLS enforcement is enabled');
    }
  }

  return envBaseUrl;
};

export const connectSocket = (token: string) => {
  if (socket) {
    socket.auth = { token };
    if (!socket.connected) {
      socket.connect();
    }
    return socket;
  }
  const baseUrl = resolveApiBaseUrl();
  const target = baseUrl && baseUrl.length > 0 ? baseUrl : window.location.origin;
  console.debug('[chat-socket] creating socket for', target);
  socket = io(target, {
    transports: ['websocket'],
    auth: { token },
  });
  socket.on('connect', () => {
    console.debug('[chat-socket] connected', socket?.id);
    joinedChatIds.forEach((chatId) => {
      socket?.emit('join_chat', { chatId });
    });
  });
  socket.on('disconnect', (reason) => {
    console.debug('[chat-socket] disconnected', reason);
  });
  socket.on('connect_error', (err) => {
    console.error('[chat-socket] connect_error', (err as Error)?.message || err, err);
  });
  return socket;
};

const emitWithAck = <T>(event: string, payload: unknown) =>
  new Promise<T>((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Socket is not connected'));
      return;
    }

    socket.timeout(5000).emit(event, payload, (err: Error | null, data: T | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      if (data === undefined) {
        reject(new Error('Invalid socket response'));
        return;
      }
      resolve(data);
    });
  });

export const joinChat = (chatId: number) => {
  joinedChatIds.add(chatId);
  if (socket?.connected) {
    socket.emit('join_chat', { chatId });
  }
};

export const leaveChat = (chatId: number) => {
  joinedChatIds.delete(chatId);
  if (socket?.connected) {
    socket.emit('leave_chat', { chatId });
  }
};

export const sendMessageSocket = (payload: { chatId: number; text: string }) => {
  return emitWithAck<Message>('send_message', payload);
};

export const editMessageSocket = (payload: { chatId: number; messageId: number; text: string }) =>
  emitWithAck<Message>('edit_message', payload);

export const deleteMessageSocket = (payload: { chatId: number; messageId: number }) =>
  emitWithAck<{ chatId: number; messageId: number }>('delete_message', payload);

export const clearHistoryForAllSocket = (payload: { chatId: number }) =>
  emitWithAck<{ chatId: number; updatedAt: string }>('clear_history_for_all', payload);

export const startCallSocket = (payload: { chatId: number }) =>
  emitWithAck<{ ok: true }>('start_call', payload);

export const inviteUsersToCallSocket = (payload: { chatId: number; userIds: number[] }) =>
  emitWithAck<{ ok: true }>('invite_users_to_call', payload);

export const declineIncomingCallSocket = (payload: { chatId: number; callerId: number }) =>
  emitWithAck<{ ok: true }>('decline_call', payload);

export const onNewMessage = (handler: (message: Message) => void) => {
  socket?.on('new_message', handler);
  return () => socket?.off('new_message', handler);
};

export const onMessageUpdated = (handler: (message: Message) => void) => {
  socket?.on('message_updated', handler);
  return () => socket?.off('message_updated', handler);
};

export const onMessageDeleted = (handler: (payload: { chatId: number; messageId: number }) => void) => {
  socket?.on('message_deleted', handler);
  return () => socket?.off('message_deleted', handler);
};

export const onChatHistoryCleared = (handler: (payload: { chatId: number; updatedAt: string }) => void) => {
  socket?.on('chat_history_cleared', handler);
  return () => socket?.off('chat_history_cleared', handler);
};

export const onSocketStatus = (handler: (status: 'connected' | 'disconnected') => void) => {
  const onConnect = () => handler('connected');
  const onDisconnect = () => handler('disconnected');
  socket?.on('connect', onConnect);
  socket?.on('disconnect', onDisconnect);
  return () => {
    socket?.off('connect', onConnect);
    socket?.off('disconnect', onDisconnect);
  };
};

export type IncomingCallPayload = {
  chatId: number;
  callerId: number;
  callerName: string;
  startedAt: string;
  asGuest?: boolean;
};

export const onIncomingCall = (handler: (payload: IncomingCallPayload) => void) => {
  socket?.on('incoming_call', handler);
  return () => socket?.off('incoming_call', handler);
};

export type CallDeclinedPayload = {
  chatId: number;
  callerId: number;
  declinedById: number;
  declinedByName: string;
  declinedAt: string;
};

export const onCallDeclined = (handler: (payload: CallDeclinedPayload) => void) => {
  socket?.on('call_declined', handler);
  return () => socket?.off('call_declined', handler);
};

export type CallPresencePayload = {
  chatId: number;
  active: boolean;
  participants: number;
};

export const onCallPresence = (handler: (payload: CallPresencePayload) => void) => {
  socket?.on('call_presence', handler);
  return () => socket?.off('call_presence', handler);
};

export type ChatUpdatedPayload = {
  chatId: number;
  sourceChatId?: number;
  createdMeeting?: boolean;
  addedMemberIds: number[];
  chat: Chat;
};

export const onChatUpdated = (handler: (payload: ChatUpdatedPayload) => void) => {
  socket?.on('chat_updated', handler);
  return () => socket?.off('chat_updated', handler);
};

export const onSocketEvent = <T = unknown>(event: string, handler: (payload: T) => void) => {
  socket?.on(event, handler as (payload: unknown) => void);
  return () => socket?.off(event, handler as (payload: unknown) => void);
};

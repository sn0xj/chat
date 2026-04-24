import { api } from '@/services/api';
import type { CallSessionRecord } from '../types';

export const listCallSessions = async (params: { chatId?: number; limit?: number }) => {
  const { data } = await api.get<CallSessionRecord[]>('/call-sessions', { params });
  return data;
};

export type ActiveRoomSnapshot = { chatId: number; participants: number };

export const listActiveRooms = async (): Promise<ActiveRoomSnapshot[]> => {
  const { data } = await api.get<{ rooms: ActiveRoomSnapshot[] }>('/api/rooms/active');
  return data.rooms ?? [];
};

export const createGuestCallLinkToken = async (chatId: number) => {
  const { data } = await api.post<{ token: string; expiresAt: string }>(`/api/rooms/${chatId}/guest-link`);
  return data;
};

export const resolveGuestCallLinkToken = async (token: string) => {
  const { data } = await api.get<{ chatId: number }>(`/api/rooms/guest/${encodeURIComponent(token)}`);
  return data;
};

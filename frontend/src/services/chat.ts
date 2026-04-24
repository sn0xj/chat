import { Chat } from '@/lib/types';
import { api } from './api';

export const getChats = async () => {
  const { data } = await api.get<Chat[]>('/chats');
  return data;
};

export const createPrivateChat = async (userId: number) => {
  const { data } = await api.post(`/chats/private/${userId}`);
  return data;
};

export const createGroupChat = async (payload: { title: string; memberIds: number[] }) => {
  const { data } = await api.post('/chats/group', payload);
  return data;
};

export const updateGroupTitle = async (chatId: number, title: string) => {
  const { data } = await api.patch(`/chats/${chatId}/title`, { title });
  return data;
};

export const addChatMembers = async (chatId: number, memberIds: number[]) => {
  const { data } = await api.post(`/chats/${chatId}/members`, { memberIds });
  return data;
};

export const removeChatMember = async (chatId: number, userId: number) => {
  const { data } = await api.delete(`/chats/${chatId}/members/${userId}`);
  return data;
};

export const leaveChat = async (chatId: number) => {
  const { data } = await api.post(`/chats/${chatId}/leave`);
  return data;
};

export const deleteGroupChat = async (chatId: number) => {
  const { data } = await api.delete(`/chats/${chatId}`);
  return data;
};

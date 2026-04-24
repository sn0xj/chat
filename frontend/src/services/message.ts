import { Message } from '@/lib/types';
import { api } from './api';

export const getMessages = async (chatId: number, beforeId?: number) => {
  const params = beforeId ? { beforeId } : undefined;
  const { data } = await api.get<Message[]>(`/messages/${chatId}`, { params });
  return data;
};

export const sendMessage = async (chatId: number, text: string) => {
  const { data } = await api.post<Message>(`/messages/${chatId}`, { text });
  return data;
};

export const editMessage = async (chatId: number, messageId: number, text: string) => {
  const { data } = await api.patch<Message>(`/messages/${chatId}/${messageId}`, { text });
  return data;
};

export type DeletedMessageRef = { id: number; chat_id: number };

export const deleteMessage = async (chatId: number, messageId: number) => {
  const { data } = await api.delete<DeletedMessageRef>(`/messages/${chatId}/${messageId}`);
  return data;
};

export type UploadedAttachment = {
  name: string;
  mimeType: string;
  size: number;
  url: string;
  kind: 'image' | 'file';
};

export const uploadAttachment = async (chatId: number, file: File) => {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<UploadedAttachment>(`/messages/${chatId}/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export type ChatFileItem = {
  messageId: number;
  createdAt: string;
  sender: {
    id: number;
    username: string;
    firstname: string | null;
    lastname: string | null;
  } | null;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  kind: 'image' | 'file';
};

export type ChatFilesResponse = {
  items: ChatFileItem[];
  nextBeforeMessageId: number | null;
};

export const getChatFiles = async (
  chatId: number,
  params: { beforeMessageId?: number; limit?: number } = {},
) => {
  const query: Record<string, number> = {};
  if (params.beforeMessageId) query.beforeMessageId = params.beforeMessageId;
  if (params.limit) query.limit = params.limit;
  const { data } = await api.get<ChatFilesResponse>(`/messages/${chatId}/files`, {
    params: query,
  });
  return data;
};

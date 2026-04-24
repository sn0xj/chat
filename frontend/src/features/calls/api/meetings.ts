import { api } from '@/services/api';
import type {
  CreateMeetingPayload,
  GuestMeetingInfo,
  Meeting,
  MeetingOccurrence,
  UpdateMeetingPayload,
} from '../types';

export const createMeeting = async (payload: CreateMeetingPayload) => {
  const { data } = await api.post<Meeting>('/meetings', payload);
  return data;
};

export const listUpcomingMeetings = async (params: {
  chatId?: number;
  from?: string;
  to?: string;
  limit?: number;
}) => {
  const { data } = await api.get<MeetingOccurrence[]>('/meetings/upcoming', {
    params,
  });
  return data;
};

export const getMeeting = async (meetingId: number) => {
  const { data } = await api.get<Meeting>(`/meetings/${meetingId}`);
  return data;
};

export const updateMeeting = async (meetingId: number, payload: UpdateMeetingPayload) => {
  const { data } = await api.patch<Meeting>(`/meetings/${meetingId}`, payload);
  return data;
};

export const cancelMeeting = async (
  meetingId: number,
  params?: { scope?: 'master' | 'single'; occurrenceDate?: string },
) => {
  const { data } = await api.delete<{ ok: true }>(`/meetings/${meetingId}`, { params });
  return data;
};

export const getGuestMeeting = async (token: string) => {
  const { data } = await api.get<GuestMeetingInfo>(`/meetings/guest/${token}`);
  return data;
};

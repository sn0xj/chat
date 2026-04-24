export type CallPresence = {
  active: boolean;
  participants: number;
};

export type IncomingCall = {
  chatId: number;
  callerId: number;
  callerName: string;
  asGuest?: boolean;
};

export type MeetingParticipantSummary = {
  userId: number;
  username: string;
  firstname?: string | null;
  lastname?: string | null;
  invitedAt: string;
};

export type Meeting = {
  id: number;
  title: string;
  description?: string | null;
  chatId?: number | null;
  hostId: number;
  host: {
    id: number;
    username: string;
    firstname?: string | null;
    lastname?: string | null;
  };
  startsAt: string;
  durationMin: number;
  rrule?: string | null;
  recurrenceEndsAt?: string | null;
  inviteToken: string;
  cancelledAt?: string | null;
  participants: MeetingParticipantSummary[];
  createdAt: string;
};

export type MeetingOccurrence = {
  meetingId: number;
  occurrenceDate: string;
  startsAt: string;
  endsAt: string;
  title: string;
  description?: string | null;
  chatId?: number | null;
  hostName: string;
  inviteToken: string;
  durationMin: number;
  participantUserIds: number[];
};

export type CallSessionRecord = {
  id: number;
  chatId: number;
  meetingId?: number | null;
  startedAt: string;
  endedAt?: string | null;
  participantUsernames: string[];
};

export type GuestMeetingInfo = {
  id: number;
  title: string;
  description?: string | null;
  startsAt: string;
  durationMin: number;
  hostName: string;
  chatId?: number | null;
  rrule?: string | null;
};

export type CreateMeetingPayload = {
  title: string;
  description?: string | null;
  chatId?: number | null;
  startsAt: string;
  durationMin: number;
  rrule?: string | null;
  participantUserIds: number[];
};

export type UpdateMeetingPayload = Partial<
  Pick<CreateMeetingPayload, 'title' | 'description' | 'startsAt' | 'durationMin' | 'rrule' | 'participantUserIds'>
> & {
  scope?: 'master' | 'single';
  occurrenceDate?: string;
};

export type MeetingReminderPayload = {
  meetingId: number;
  occurrenceDate: string;
  startsAt: string;
  title: string;
  chatId?: number | null;
  minutesBefore: number;
  hostName?: string;
};

export type MeetingStartingPayload = {
  meetingId: number;
  occurrenceDate: string;
  startsAt: string;
  title: string;
  chatId?: number | null;
  hostName?: string;
};

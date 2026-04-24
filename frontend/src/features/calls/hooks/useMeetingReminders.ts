import { useEffect } from 'react';
import { onSocketEvent } from '@/services/socket';
import { useChatStore } from '@/store/chat-store';
import {
  ensureBrowserNotificationPermission,
  showBrowserNotification,
} from '@/lib/browserNotifications';
import type { MeetingReminderPayload, MeetingStartingPayload } from '../types';

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function useMeetingReminders() {
  useEffect(() => {
    ensureBrowserNotificationPermission();
  }, []);

  useEffect(() => {
    const unsubscribeReminder = onSocketEvent<MeetingReminderPayload>('meeting_reminder', (payload) => {
      const mutedChatIds = useChatStore.getState().mutedChatIds;
      if (payload.chatId && mutedChatIds.includes(payload.chatId)) {
        return;
      }
      const title = `Встреча скоро: ${payload.title}`;
      const body = `Начало в ${formatTime(payload.startsAt)} (через ~${payload.minutesBefore} мин)`;
      showBrowserNotification(title, body, {
        tag: `meeting-reminder-${payload.meetingId}-${payload.occurrenceDate}`,
      });
    });
    const unsubscribeStarting = onSocketEvent<MeetingStartingPayload>('meeting_starting', (payload) => {
      const mutedChatIds = useChatStore.getState().mutedChatIds;
      if (payload.chatId && mutedChatIds.includes(payload.chatId)) {
        return;
      }
      const title = `Встреча началась: ${payload.title}`;
      const body = payload.hostName ? `Организатор: ${payload.hostName}` : 'Пора подключаться';
      showBrowserNotification(title, body, {
        tag: `meeting-starting-${payload.meetingId}-${payload.occurrenceDate}`,
      });
    });
    return () => {
      unsubscribeReminder?.();
      unsubscribeStarting?.();
    };
  }, []);
}

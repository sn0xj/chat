import { useCallback, useEffect, useState } from 'react';
import { listUpcomingMeetings } from '../api/meetings';
import { onSocketEvent } from '@/services/socket';
import type { MeetingOccurrence } from '../types';

type Options = {
  chatId?: number;
  enabled?: boolean;
  windowDays?: number;
  limit?: number;
};

export function useUpcomingMeetings(options: Options = {}) {
  const { chatId, enabled = true, windowDays = 14, limit = 100 } = options;
  const [occurrences, setOccurrences] = useState<MeetingOccurrence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const from = new Date().toISOString();
      const to = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000).toISOString();
      const data = await listUpcomingMeetings({ chatId, from, to, limit });
      setOccurrences(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить встречи');
    } finally {
      setLoading(false);
    }
  }, [chatId, enabled, windowDays, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribes = [
      onSocketEvent('meeting_created', () => {
        void refresh();
      }),
      onSocketEvent('meeting_updated', () => {
        void refresh();
      }),
      onSocketEvent('meeting_cancelled', () => {
        void refresh();
      }),
    ];
    return () => {
      unsubscribes.forEach((u) => u?.());
    };
  }, [enabled, refresh]);

  return { occurrences, loading, error, refresh } as const;
}

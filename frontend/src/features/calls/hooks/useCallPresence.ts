import { useEffect, useState } from 'react';
import { onCallPresence } from '@/services/socket';
import { useChatStore } from '@/store/chat-store';
import { listActiveRooms } from '../api/callSessions';
import type { CallPresence } from '../types';

export function useCallPresence() {
  const [callPresenceByChat, setCallPresenceByChat] = useState<Record<number, CallPresence>>({});

  useEffect(() => {
    let cancelled = false;
    const reconcileFromSnapshot = () => {
      // Pull the authoritative snapshot of currently active rooms so the
      // presence state self-heals if a socket event is missed.
      listActiveRooms()
        .then((rooms) => {
          if (cancelled) return;
          setCallPresenceByChat((prev) => {
            const next: Record<number, CallPresence> = {};
            for (const { chatId, participants } of rooms) {
              next[chatId] = { active: participants > 0, participants };
            }
            // Mark every previously-active chat that is no longer in the
            // snapshot as finished.
            for (const id of Object.keys(prev)) {
              const chatId = Number(id);
              if (!next[chatId]) {
                next[chatId] = { active: false, participants: 0 };
              }
            }
            return next;
          });
        })
        .catch(() => {
          /* soft-fail: live events may still update presence */
        });
    };

    reconcileFromSnapshot();
    const intervalId = window.setInterval(reconcileFromSnapshot, 7000);
    const onFocus = () => reconcileFromSnapshot();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        reconcileFromSnapshot();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    const unsubscribe = onCallPresence(({ chatId, active, participants }) => {
      setCallPresenceByChat((prev) => ({
        ...prev,
        [chatId]: { active, participants },
      }));
      if (!active) {
        return;
      }
      const activeChatId = useChatStore.getState().currentChat?.id;
      if (activeChatId !== chatId) {
        // Presence state is still updated in the store so sidebars can show
        // active-call badges, but we intentionally avoid extra snackbars here:
        // incoming-call UI already notifies the user and duplicate toasts feel noisy.
      }
    });
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe?.();
    };
  }, []);

  return callPresenceByChat;
}

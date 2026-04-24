import { useEffect, useState } from 'react';
import { onIncomingCall } from '@/services/socket';
import { useChatStore } from '@/store/chat-store';
import {
  ensureBrowserNotificationPermission,
  showBrowserNotification,
} from '@/lib/browserNotifications';
import type { IncomingCall } from '../types';

export function useIncomingCall() {
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  useEffect(() => {
    ensureBrowserNotificationPermission();
  }, []);

  useEffect(() => {
    const unsubscribe = onIncomingCall(({ chatId, callerId, callerName, asGuest }) => {
      const currentUserId = useChatStore.getState().user?.id;
      if (currentUserId && callerId === currentUserId) {
        return;
      }
      setIncomingCall({ chatId, callerId, callerName, asGuest });
      showBrowserNotification('Входящий звонок', `${callerName} приглашает в звонок`, {
        tag: `incoming-call-${chatId}`,
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  return { incomingCall, setIncomingCall } as const;
}

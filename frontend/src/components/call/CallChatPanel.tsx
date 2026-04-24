import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, IconButton, Typography, CircularProgress } from '@mui/material';
import { Close, ChatBubbleOutline } from '@mui/icons-material';
import type { Message } from '@/lib/types';
import { useCallStore } from '@/features/calls/vks/store/call-store';
import { MessageList } from '@/features/messages/MessageList';
import { MessageComposer } from '@/features/composer/MessageComposer';

type Props = {
  chatId: number;
  currentUserId?: number;
  onClose: () => void;
};

export function CallChatPanel({ chatId, currentUserId, onClose }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const engine = useCallStore((s) => s.engine);
  const connectionState = useCallStore((s) => s.connectionState);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!engine || connectionState !== 'joined') {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    engine
      .getCallChatHistory(60)
      .then((list) => {
        if (cancelled) return;
        const normalized = (Array.isArray(list) ? list : []) as Message[];
        setMessages(
          normalized
            .sort((a, b) => {
              const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
              const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
              if (aTs !== bTs) return aTs - bTs;
              return a.id - b.id;
            }),
        );
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const offChat = engine.onCallChatMessage((payload) => {
      const message = payload as Message;
      if (!message) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
    });

    return () => {
      cancelled = true;
      offChat?.();
    };
  }, [chatId, engine, connectionState]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!engine) return;
      try {
        await engine.sendCallChatMessage(text);
      } catch {
        /* send failed */
      }
    },
    [engine],
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <ChatBubbleOutline sx={{ fontSize: 20, color: 'text.secondary' }} />
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          Чат встречи
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="Закрыть чат">
          <Close fontSize="small" />
        </IconButton>
      </Box>

      {loading ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      ) : messages.length ? (
        <MessageList messages={messages} currentUserId={currentUserId} />
      ) : (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', px: 2 }}>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            Напишите первое сообщение — участники без камеры и микрофона смогут участвовать текстом.
          </Typography>
        </Box>
      )}

      <MessageComposer chatId={chatId} onSend={handleSend} />
    </Box>
  );
}

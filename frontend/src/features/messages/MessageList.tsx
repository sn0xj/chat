import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import dayjs from 'dayjs';
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Message } from '@/lib/types';
import { formatMessageDateSeparator } from '@/lib/formatRelativeDate';
import { fontSize, fontWeight } from '@/lib/tokens';
import { MessageRow } from './MessageRow';
import { computeGroupMeta } from './groupMessages';

type Props = {
  messages: Message[];
  currentUserId?: number;
  isGroupChat?: boolean;
  searchQuery?: string;
  highlightedMessageIds?: number[];
  activeMessageId?: number | null;
  selectionMode?: boolean;
  selectedMessageIds?: number[];
  onToggleMessageSelect?: (messageId: number) => void;
  onMessageContextMenu?: (event: React.MouseEvent, message: Message) => void;
};

function DateSeparator({ label }: { label: string }) {
  return (
    <Box
      sx={{
        position: 'sticky',
        top: 6,
        zIndex: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        pointerEvents: 'none',
        mx: { xs: 1.25, sm: 2 },
        my: 1.5,
      }}
      aria-label={label}
    >
      <Box
        sx={{
          flex: 1,
          height: 1,
          bgcolor: 'divider',
        }}
      />
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          px: 1.25,
          py: 0.375,
          borderRadius: 999,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: (t) =>
            t.palette.mode === 'dark'
              ? alpha(t.palette.background.paper, 0.94)
              : alpha('#fff', 0.96),
          pointerEvents: 'auto',
        }}
      >
        <Typography
          sx={{
            fontSize: fontSize.xs,
            fontWeight: fontWeight.bold,
            color: 'text.secondary',
            letterSpacing: '0.02em',
            textTransform: 'capitalize',
          }}
        >
          {label}
        </Typography>
      </Box>
      <Box
        sx={{
          flex: 1,
          height: 1,
          bgcolor: 'divider',
        }}
      />
    </Box>
  );
}

export function MessageList({
  messages,
  currentUserId,
  isGroupChat,
  searchQuery,
  highlightedMessageIds = [],
  activeMessageId = null,
  selectionMode,
  selectedMessageIds = [],
  onToggleMessageSelect,
  onMessageContextMenu,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const lastLengthRef = useRef<number>(0);
  const initializedRef = useRef<boolean>(false);
  const wasNearBottomRef = useRef<boolean>(true);

  const selectedSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds]);
  const highlightedSet = useMemo(() => new Set(highlightedMessageIds), [highlightedMessageIds]);
  const groupMeta = useMemo(() => computeGroupMeta(messages), [messages]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distanceFromBottom < 120;
  };

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (!messages.length) {
      initializedRef.current = false;
      lastLengthRef.current = 0;
      return;
    }
    const prevLength = lastLengthRef.current;
    lastLengthRef.current = messages.length;

    if (!initializedRef.current) {
      el.scrollTop = el.scrollHeight;
      initializedRef.current = true;
      wasNearBottomRef.current = true;
      return;
    }

    if (messages.length > prevLength && wasNearBottomRef.current) {
      anchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages]);

  useEffect(() => {
    if (!activeMessageId) return;
    const node = itemRefs.current[activeMessageId];
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeMessageId]);

  return (
    <Box
      ref={scrollerRef}
      onScroll={onScroll}
      sx={{
        minHeight: 0,
        minWidth: 0,
        flex: 1,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'thin',
        bgcolor: 'background.default',
        '&::-webkit-scrollbar': { width: 10 },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': {
          background: (t) =>
            t.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.15)',
          borderRadius: 8,
          backgroundClip: 'padding-box',
          border: '2px solid transparent',
        },
        '&::-webkit-scrollbar-thumb:hover': {
          background: (t) =>
            t.palette.mode === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.25)',
          backgroundClip: 'padding-box',
          border: '2px solid transparent',
        },
      }}
    >
      <Box sx={{ pt: 1.5, pb: 1.5 }}>
        {messages.map((message, index) => {
          const meta = groupMeta[index];
          const prev = index > 0 ? messages[index - 1] : null;
          const showDate =
            !prev ||
            (prev.created_at &&
              message.created_at &&
              !dayjs(prev.created_at).isSame(message.created_at, 'day'));
          return (
            <Box key={message.id}>
              {showDate ? (
                <DateSeparator label={formatMessageDateSeparator(message.created_at)} />
              ) : null}
              <Box
                ref={(node: HTMLDivElement | null) => {
                  itemRefs.current[message.id] = node;
                }}
              >
                <MessageRow
                  message={message}
                  isOwn={message.sender_id === currentUserId}
                  isFirstInGroup={meta.isFirstInGroup}
                  showSenderName={Boolean(isGroupChat)}
                  isGroupChat={Boolean(isGroupChat)}
                  searchQuery={searchQuery}
                  highlighted={highlightedSet.has(message.id)}
                  activeSearchHit={activeMessageId === message.id}
                  selectionMode={selectionMode}
                  selected={selectedSet.has(message.id)}
                  onToggleSelect={onToggleMessageSelect}
                  onContextMenu={onMessageContextMenu}
                />
              </Box>
            </Box>
          );
        })}
        <div ref={anchorRef} />
      </Box>
    </Box>
  );
}

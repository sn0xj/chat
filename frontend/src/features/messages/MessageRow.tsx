import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react';
import { Avatar, Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Check } from '@mui/icons-material';
import { CallRounded } from '@mui/icons-material';
import type { Message } from '@/lib/types';
import { parseMessageContent } from '@/lib/messageContent';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';
import { formatMessageTime } from '@/lib/formatRelativeDate';
import { fontSize, fontWeight, lineHeight, radius } from '@/lib/tokens';
import { SLACK } from '@/theme/slackColors';
import { MessageAttachments } from './MessageAttachments';

const SELECT_RING = SLACK.primary;
const AVATAR_SIZE = 36;
const AVATAR_GAP = 12;

type Props = {
  message: Message;
  isOwn: boolean;
  isFirstInGroup: boolean;
  showSenderName: boolean;
  isGroupChat: boolean;
  searchQuery?: string;
  highlighted?: boolean;
  activeSearchHit?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (messageId: number) => void;
  onContextMenu?: (event: ReactMouseEvent, message: Message) => void;
};

function renderTextWithHighlight(text: string, query: string, active: boolean): ReactNode {
  if (!query) return text;
  const normalized = query.trim();
  if (!normalized) return text;
  const lower = text.toLowerCase();
  const needle = normalized.toLowerCase();
  const chunks: ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(needle);
  while (idx !== -1) {
    if (idx > cursor) chunks.push(text.slice(cursor, idx));
    chunks.push(
      <Box
        key={`hit-${idx}`}
        component="mark"
        sx={{
          px: 0.25,
          borderRadius: 0.5,
          bgcolor: active ? 'warning.main' : alpha('#facc15', 0.5),
          color: active ? 'warning.contrastText' : 'inherit',
        }}
      >
        {text.slice(idx, idx + normalized.length)}
      </Box>,
    );
    cursor = idx + normalized.length;
    idx = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) chunks.push(text.slice(cursor));
  return chunks;
}

export function MessageRow({
  message,
  isOwn,
  isFirstInGroup,
  showSenderName,
  isGroupChat,
  searchQuery,
  highlighted,
  activeSearchHit,
  selectionMode,
  selected,
  onToggleSelect,
  onContextMenu,
}: Props) {
  const senderName = message.sender.firstname || message.sender.username;
  const initial = getAvatarInitial(senderName);
  const avatarColor = getAvatarColor(senderName);
  const { text, attachments } = parseMessageContent(message.text);
  const timeLabel = formatMessageTime(message.created_at);
  const isCallEvent = message.type === 'call_event';
  const isMeetingEvent = message.type === 'meeting_event';
  const isCenteredEvent = isMeetingEvent;
  const callHistoryLines = (isCallEvent || isMeetingEvent)
    ? (text || '').split('\n').map((line) => line.trim()).filter(Boolean)
    : [];
  const callHistoryTitle = callHistoryLines[0] || 'Звонок';
  const callHistoryMeta = callHistoryLines[1] || timeLabel;

  const toggle = () => onToggleSelect?.(message.id);
  const showHeader = isFirstInGroup;
  const showName = !isOwn && (showSenderName || isGroupChat);
  const showInlineTime = !showName && !(isCallEvent || isMeetingEvent);

  return (
    <Box
      className="message-row"
      onContextMenu={(event) => onContextMenu?.(event, message)}
      onClick={
        selectionMode
          ? (e) => {
              e.stopPropagation();
              toggle();
            }
          : undefined
      }
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: isCenteredEvent ? 'center' : isOwn ? 'flex-end' : 'flex-start',
        px: { xs: 1.25, sm: 2 },
        py: 0.25,
        mt: isFirstInGroup ? 0.8 : 0.15,
        cursor: selectionMode ? 'pointer' : 'default',
        transition: 'background-color 80ms ease',
        bgcolor: highlighted
          ? (t) =>
              activeSearchHit
                ? t.palette.mode === 'dark'
                  ? SLACK.rowHighlightDark
                  : SLACK.rowHighlightLight
                : alpha(t.palette.warning.main, 0.08)
          : 'transparent',
        '&:hover': {
          bgcolor: (t) =>
            highlighted
              ? undefined
              : t.palette.mode === 'dark'
                ? alpha('#fff', 0.03)
                : alpha('#0f172a', 0.03),
        },
        ...(selected && selectionMode
          ? {
              outline: `2px solid ${SELECT_RING}`,
              outlineOffset: -2,
              borderRadius: `${radius.xs}px`,
            }
          : {}),
      }}
    >
      {!isCenteredEvent && !isOwn ? (
        <Box
          sx={{
            width: AVATAR_SIZE,
            minWidth: AVATAR_SIZE,
            mr: `${AVATAR_GAP}px`,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            alignSelf: 'flex-start',
            pt: isFirstInGroup ? 0.25 : 0.375,
          }}
        >
          {selectionMode ? (
            <Box
              component="button"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              aria-label={selected ? 'Снять выбор' : 'Выбрать'}
              aria-pressed={Boolean(selected)}
              sx={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                cursor: 'pointer',
                p: 0,
                display: 'grid',
                placeItems: 'center',
                border: `1.5px solid ${selected ? SELECT_RING : alpha('#888', 0.6)}`,
                bgcolor: selected ? SELECT_RING : 'transparent',
                color: '#fff',
              }}
            >
              {selected ? <Check sx={{ fontSize: 14 }} /> : null}
            </Box>
          ) : isFirstInGroup ? (
            <Avatar
              sx={{
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                fontSize: 14,
                fontWeight: fontWeight.bold,
                bgcolor: avatarColor,
                color: '#fff',
                borderRadius: '50%',
              }}
            >
              {initial}
            </Avatar>
          ) : (
            <Typography
              component="span"
              className="message-row__gutter-time"
              sx={{
                fontSize: 10,
                lineHeight: 1,
                color: 'text.secondary',
                opacity: 0,
                transition: 'opacity 80ms ease',
                fontVariantNumeric: 'tabular-nums',
                '.message-row:hover &': { opacity: 0.7 },
              }}
            >
              {timeLabel}
            </Typography>
          )}
        </Box>
      ) : null}

      <Box
        sx={{
          flex: isCenteredEvent ? '0 1 auto' : undefined,
          minWidth: 0,
          maxWidth: isCenteredEvent ? 560 : { xs: '88%', sm: '80%', md: '74%' },
        }}
      >
        {isCallEvent || isMeetingEvent ? (
          <Box
            sx={(t) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              px: 1.25,
              py: 0.9,
              borderRadius: `${radius.md}px`,
              bgcolor: t.palette.mode === 'dark' ? alpha('#ffffff', 0.05) : alpha('#0f172a', 0.05),
              border: '1px solid',
              borderColor: t.palette.mode === 'dark' ? alpha('#ffffff', 0.08) : alpha('#0f172a', 0.08),
              maxWidth: isCenteredEvent ? 560 : '100%',
            })}
          >
            <Box
              sx={(t) => ({
                width: 30,
                height: 30,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                bgcolor: t.palette.mode === 'dark' ? alpha(t.palette.primary.main, 0.22) : alpha(t.palette.primary.main, 0.12),
                color: 'primary.main',
                flexShrink: 0,
              })}
            >
              <CallRounded sx={{ fontSize: 17 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: fontSize.md,
                  lineHeight: lineHeight.tight,
                  color: 'text.primary',
                  fontWeight: fontWeight.bold,
                }}
              >
                {callHistoryTitle}
              </Typography>
              <Typography
                sx={{
                  fontSize: fontSize.sm,
                  lineHeight: lineHeight.tight,
                  color: 'text.secondary',
                }}
              >
                {callHistoryMeta}
              </Typography>
            </Box>
          </Box>
        ) : showHeader && showName ? (
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.125 }}>
            {showName ? (
              <Typography
                component="span"
                sx={{
                  fontWeight: fontWeight.bold,
                  fontSize: fontSize.md,
                  lineHeight: lineHeight.tight,
                  color: 'text.primary',
                  letterSpacing: '-0.01em',
                }}
              >
                {senderName}
              </Typography>
            ) : null}
            <Typography
              component="span"
              sx={{
                fontSize: fontSize.xs,
                lineHeight: lineHeight.tight,
                color: 'text.secondary',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {timeLabel}
            </Typography>
            {message.edited_at ? (
              <Typography
                component="span"
                sx={{ fontSize: fontSize.micro, color: 'text.secondary' }}
              >
                (изменено)
              </Typography>
            ) : null}
          </Box>
        ) : null}
        {text && !(isCallEvent || isMeetingEvent) ? (
          <Box
            sx={(t) => ({
              display: 'inline-flex',
              alignItems: 'flex-end',
              gap: 0.75,
              width: 'fit-content',
              maxWidth: '100%',
              px: 1.1,
              py: 0.5,
              borderRadius: isOwn ? '14px 14px 6px 14px' : '14px 14px 14px 6px',
              bgcolor:
                t.palette.mode === 'dark'
                  ? isOwn
                    ? alpha('#3b82f6', 0.3)
                    : alpha('#ffffff', 0.06)
                  : isOwn
                    ? alpha('#2563eb', 0.16)
                    : alpha('#0f172a', 0.05),
            })}
          >
            <Typography
              component="div"
              sx={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                fontSize: fontSize.md,
                lineHeight: lineHeight.body,
                color: 'text.primary',
                minWidth: 0,
              }}
            >
              {renderTextWithHighlight(text, searchQuery || '', Boolean(activeSearchHit))}
              {!showHeader && message.edited_at ? (
                <Typography
                  component="span"
                  sx={{
                    fontSize: fontSize.micro,
                    color: 'text.secondary',
                    ml: 0.75,
                    opacity: 0.7,
                  }}
                >
                  (изменено)
                </Typography>
              ) : null}
            </Typography>
            {showInlineTime ? (
              <Typography
                component="span"
                sx={{
                  fontSize: fontSize.micro,
                  lineHeight: 1,
                  color: 'text.secondary',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                  opacity: 0.85,
                  flexShrink: 0,
                  mb: 0.05,
                }}
              >
                {timeLabel}
              </Typography>
            ) : null}
          </Box>
        ) : null}
        {attachments.length && !(isCallEvent || isMeetingEvent) ? <MessageAttachments attachments={attachments} /> : null}
      </Box>
    </Box>
  );
}

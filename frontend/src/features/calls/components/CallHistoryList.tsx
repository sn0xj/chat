import { useEffect, useMemo, useState } from 'react';
import { Avatar, Box, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { HistoryOutlined, VideoCameraFrontOutlined, PeopleAltOutlined } from '@mui/icons-material';
import { listCallSessions } from '../api/callSessions';
import type { CallSessionRecord } from '../types';
import { useChatStore } from '@/store/chat-store';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';
import type { Chat } from '@/lib/types';

type Props = {
  chatId?: number;
  limit?: number;
};

type ChatMeta = {
  title: string;
  isGroup: boolean;
  peerDisplayName?: string;
  peerUsername?: string;
};

function buildChatMeta(chat: Chat | undefined, currentUserId: number | undefined): ChatMeta | null {
  if (!chat) return null;
  if (chat.type === 'meeting') {
    return { title: chat.title || 'Встреча', isGroup: true };
  }
  if (chat.type === 'group') {
    return { title: chat.title || 'Групповой чат', isGroup: true };
  }
  const peer = chat.members.find((m) => m.id !== currentUserId);
  const title = peer?.firstname || peer?.username || 'Личный чат';
  return {
    title,
    isGroup: false,
    peerDisplayName: peer?.firstname || peer?.username,
    peerUsername: peer?.username,
  };
}

function formatDuration(session: CallSessionRecord) {
  if (!session.endedAt) return 'в процессе';
  const ms = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
  if (ms <= 0) return '—';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes === 0) return `${seconds} сек`;
  return `${minutes} мин${seconds ? ` ${seconds} сек` : ''}`;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Сегодня · ${time}`;
  if (isYesterday) return `Вчера · ${time}`;
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })} · ${time}`;
}

export function CallHistoryList({ chatId, limit = 50 }: Props) {
  const [sessions, setSessions] = useState<CallSessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chats = useChatStore((s) => s.chats);
  const currentUserId = useChatStore((s) => s.user?.id);
  const currentUsername = useChatStore((s) => s.user?.username);

  const chatById = useMemo(() => {
    const map = new Map<number, Chat>();
    for (const c of chats) map.set(c.id, c);
    return map;
  }, [chats]);

  const meetingChatIds = useMemo(
    () => new Set(chats.filter((chat) => chat.type === 'meeting').map((chat) => chat.id)),
    [chats],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listCallSessions({ chatId, limit })
      .then((data) => {
        if (!cancelled) setSessions(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить историю');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, limit]);

  // Calls sidebar must show meeting conversations only:
  // either an explicit meeting-linked call session or a session from a meeting chat.
  const meetingSessions = useMemo(
    () => sessions.filter((session) => Boolean(session.meetingId) || meetingChatIds.has(session.chatId)),
    [sessions, meetingChatIds],
  );
  const count = useMemo(() => meetingSessions.length, [meetingSessions]);

  return (
    <Box sx={{ px: 1.25, pt: 1.25, pb: 1.5 }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
        <HistoryOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 700,
            color: 'text.secondary',
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            flex: 1,
          }}
        >
          История встреч
        </Typography>
        {count > 0 ? (
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.disabled' }}>
            {count}
          </Typography>
        ) : null}
      </Stack>
      {loading ? (
        <Typography sx={{ fontSize: 12, color: 'text.secondary', px: 0.5 }}>Загрузка…</Typography>
      ) : error ? (
        <Typography sx={{ fontSize: 12, color: 'error.main', px: 0.5 }}>{error}</Typography>
      ) : meetingSessions.length === 0 ? (
        <Box
          sx={(t) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5,
            py: 2,
            px: 1,
            borderRadius: 2,
            border: '1px dashed',
            borderColor: t.palette.mode === 'dark' ? alpha('#fff', 0.08) : alpha('#0f172a', 0.08),
          })}
        >
          <HistoryOutlined sx={{ fontSize: 22, color: 'text.disabled' }} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center' }}>
            Встреч пока нет
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0.5}>
          {meetingSessions.map((s) => {
            const active = !s.endedAt;
            const meta = buildChatMeta(chatById.get(s.chatId), currentUserId);
            const otherPeers = s.participantUsernames.filter(
              (u) => u && u !== currentUsername,
            );
            const noAnswer = !active && otherPeers.length === 0;
            let primary = meta?.title || `Звонок #${s.chatId}`;
            if (s.meetingId && !meta) primary = 'Встреча';
            const avatarLabel = meta?.isGroup
              ? meta.title
              : meta?.peerDisplayName || meta?.peerUsername || '?';
            const isGroup = Boolean(meta?.isGroup);
            return (
              <Box
                key={s.id}
                sx={(t) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  p: 1,
                  borderRadius: 1.75,
                  bgcolor: 'transparent',
                  border: '1px solid transparent',
                  transition: 'background-color 0.15s, border-color 0.15s',
                  '&:hover': {
                    bgcolor: t.palette.mode === 'dark' ? alpha('#fff', 0.03) : alpha('#0f172a', 0.03),
                    borderColor:
                      t.palette.mode === 'dark' ? alpha('#fff', 0.05) : alpha('#0f172a', 0.05),
                  },
                })}
              >
                {isGroup || s.meetingId ? (
                  <Box
                    sx={(t) => ({
                      flexShrink: 0,
                      width: 36,
                      height: 36,
                      borderRadius: 1.75,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: active
                        ? alpha(t.palette.success.main, t.palette.mode === 'dark' ? 0.22 : 0.14)
                        : t.palette.mode === 'dark'
                          ? alpha('#fff', 0.05)
                          : alpha('#0f172a', 0.05),
                      color: active ? 'success.main' : 'text.secondary',
                    })}
                  >
                    {s.meetingId ? (
                      <VideoCameraFrontOutlined sx={{ fontSize: 18 }} />
                    ) : (
                      <PeopleAltOutlined sx={{ fontSize: 18 }} />
                    )}
                  </Box>
                ) : (
                  <Avatar
                    sx={{
                      width: 36,
                      height: 36,
                      fontSize: 14,
                      fontWeight: 700,
                      bgcolor: getAvatarColor(avatarLabel),
                      outline: (t) =>
                        active ? `2px solid ${t.palette.success.main}` : 'none',
                      outlineOffset: -2,
                    }}
                  >
                    {getAvatarInitial(avatarLabel)}
                  </Avatar>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" alignItems="baseline" gap={0.75} sx={{ minWidth: 0 }}>
                    <Typography
                      noWrap
                      sx={{
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                        color: 'text.primary',
                      }}
                    >
                      {primary}
                    </Typography>
                  </Stack>
                  <Stack direction="row" alignItems="baseline" gap={0.5} sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }} noWrap>
                      {formatWhen(s.startedAt)}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 11,
                        color: noAnswer ? 'error.main' : 'text.secondary',
                        fontWeight: noAnswer ? 700 : 400,
                      }}
                      noWrap
                    >
                      · {noAnswer ? 'нет ответа' : formatDuration(s)}
                    </Typography>
                  </Stack>
                  {isGroup && otherPeers.length ? (
                    <Tooltip title={otherPeers.join(', ')}>
                      <Typography sx={{ fontSize: 11, color: 'text.disabled' }} noWrap>
                        {otherPeers.slice(0, 3).join(', ')}
                        {otherPeers.length > 3 ? ` +${otherPeers.length - 3}` : ''}
                      </Typography>
                    </Tooltip>
                  ) : null}
                </Box>
                {active ? (
                  <Box
                    sx={(t) => ({
                      px: 0.75,
                      py: 0.25,
                      borderRadius: 1,
                      bgcolor: alpha(t.palette.success.main, t.palette.mode === 'dark' ? 0.2 : 0.14),
                      color: 'success.main',
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    })}
                  >
                    ● live
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

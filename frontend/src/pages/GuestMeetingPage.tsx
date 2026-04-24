import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { PhoneInTalk, Schedule } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { VksCallEmbed } from '@/components/call/VksCallEmbed';
import { AppDialog } from '@/features/dialogs/AppDialog';
import { getGuestMeeting } from '@/features/calls/api/meetings';
import type { GuestMeetingInfo } from '@/features/calls/types';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; meeting: GuestMeetingInfo };

function formatCountdown(msLeft: number) {
  if (msLeft <= 0) return '00:00';
  const totalSeconds = Math.floor(msLeft / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function GuestMeetingPage() {
  const [searchParams] = useSearchParams();
  const params = useParams<{ token?: string }>();
  const token = params.token || searchParams.get('token') || '';
  const initialName = searchParams.get('name') || '';

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const [nameInput, setNameInput] = useState(initialName);
  const [guestName, setGuestName] = useState<string | null>(initialName || null);
  const [inCall, setInCall] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const meeting = await getGuestMeeting(token);
        if (!cancelled) setState({ status: 'ready', meeting });
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : 'Не удалось загрузить встречу';
          setState({ status: 'error', message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const timing = useMemo(() => {
    if (state.status !== 'ready') return null;
    const startsAtMs = new Date(state.meeting.startsAt).getTime();
    const endsAtMs = startsAtMs + state.meeting.durationMin * 60 * 1000;
    const msToStart = startsAtMs - now;
    const msToEnd = endsAtMs - now;
    return {
      startsAtMs,
      endsAtMs,
      msToStart,
      msToEnd,
      canJoin: msToStart <= 5 * 60 * 1000 && msToEnd > 0,
      isOver: msToEnd <= 0,
    };
  }, [state, now]);

  if (!token) {
    return <Navigate to="/" replace />;
  }

  const roomId = state.status === 'ready' ? state.meeting.chatId ?? state.meeting.id : 0;

  if (inCall && state.status === 'ready' && guestName) {
    return (
      <Box
        sx={{
          width: '100vw',
          height: '100dvh',
          overflow: 'hidden',
          bgcolor: 'background.default',
        }}
      >
        <VksCallEmbed
          chatId={roomId}
          guestName={guestName}
          onClose={() => setInCall(false)}
        />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: '100vw',
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: 2,
        py: 4,
      }}
    >
      {state.status === 'loading' ? (
        <Typography color="text.secondary">Загрузка встречи…</Typography>
      ) : state.status === 'error' ? (
        <Stack spacing={2} alignItems="center">
          <Typography variant="h6" fontWeight={700}>
            Встреча не найдена
          </Typography>
          <Typography color="text.secondary">{state.message}</Typography>
        </Stack>
      ) : (
        <Box
          sx={(t) => ({
            maxWidth: 480,
            width: '100%',
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 3,
            p: 3,
            boxShadow: t.palette.mode === 'dark' ? 'none' : '0 10px 30px rgba(0,0,0,0.04)',
          })}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
            <Box
              sx={(t) => ({
                width: 44,
                height: 44,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(
                  t.palette.primary.main,
                  t.palette.mode === 'dark' ? 0.2 : 0.12,
                ),
                color: 'primary.main',
              })}
            >
              <Schedule sx={{ fontSize: 24 }} />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={800} letterSpacing="-0.02em" lineHeight={1.2}>
                {state.meeting.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Организатор: {state.meeting.hostName}
              </Typography>
            </Box>
          </Stack>

          {state.meeting.description ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {state.meeting.description}
            </Typography>
          ) : null}

          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Начало
            </Typography>
            <Typography variant="body1" fontWeight={600}>
              {new Date(state.meeting.startsAt).toLocaleString('ru-RU', {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Длительность: {state.meeting.durationMin} мин
            </Typography>
          </Stack>

          {timing?.isOver ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Встреча уже завершилась.
            </Typography>
          ) : timing && timing.msToStart > 0 ? (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 2,
                textAlign: 'center',
                mb: 2,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                До начала
              </Typography>
              <Typography variant="h4" fontWeight={800} letterSpacing="-0.03em">
                {formatCountdown(timing.msToStart)}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" color="success.main" sx={{ mb: 2, fontWeight: 600 }}>
              Встреча уже идёт — можно подключаться.
            </Typography>
          )}

          <TextField
            fullWidth
            size="small"
            label="Ваше имя"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            sx={{ mb: 2 }}
            placeholder="Например: Анна"
          />

          <Button
            variant="contained"
            fullWidth
            size="large"
            disableElevation
            startIcon={<PhoneInTalk />}
            disabled={!nameInput.trim() || !timing?.canJoin}
            onClick={() => {
              const name = nameInput.trim();
              if (!name) return;
              setGuestName(name);
              setInCall(true);
            }}
            sx={{ borderRadius: 2, fontWeight: 700 }}
          >
            {timing?.canJoin ? 'Подключиться' : 'Дождитесь начала'}
          </Button>
          {!timing?.canJoin && !timing?.isOver ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', textAlign: 'center', mt: 1 }}
            >
              Можно подключиться за 5 минут до начала
            </Typography>
          ) : null}
        </Box>
      )}
      {guestName === null && inCall ? (
        <AppDialog
          open
          onClose={() => undefined}
          disableClose
          maxWidth="xs"
          title="Гостевой вход"
          subtitle="Укажите имя — его увидят участники встречи"
          icon={<PhoneInTalk sx={{ fontSize: 20 }} />}
          actions={
            <Button
              variant="contained"
              disableElevation
              onClick={() => setGuestName(nameInput.trim() || null)}
              disabled={!nameInput.trim()}
              sx={{ fontWeight: 600 }}
            >
              Продолжить
            </Button>
          }
        >
          <TextField
            label="Ваше имя"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            autoFocus
            fullWidth
          />
        </AppDialog>
      ) : null}
    </Box>
  );
}

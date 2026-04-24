import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ContentCopyOutlined, VideoCallRounded } from '@mui/icons-material';
import type { MeetingOccurrence } from '../types';

type Props = {
  occurrence: MeetingOccurrence;
  onJoin?: (occurrence: MeetingOccurrence) => void;
  onShareLink?: (occurrence: MeetingOccurrence) => void;
};

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

function formatRelative(startIso: string) {
  const diff = new Date(startIso).getTime() - Date.now();
  if (diff < 0) return 'идёт';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'сейчас';
  if (minutes < 60) return `через ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `через ${hours} ч`;
  const days = Math.floor(hours / 24);
  return `через ${days} д`;
}

export function MeetingCard({ occurrence, onJoin, onShareLink }: Props) {
  const start = new Date(occurrence.startsAt).getTime();
  const now = Date.now();
  const canJoin = now >= start - 5 * 60 * 1000;
  const isLive = now >= start && now <= new Date(occurrence.endsAt).getTime();

  return (
    <Box
      onClick={() => (canJoin && onJoin ? onJoin(occurrence) : undefined)}
      sx={(t) => {
        const surface =
          t.palette.mode === 'dark' ? alpha('#fff', 0.03) : alpha('#0f172a', 0.025);
        const surfaceHover =
          t.palette.mode === 'dark' ? alpha('#fff', 0.05) : alpha('#0f172a', 0.05);
        return {
          position: 'relative',
          display: 'flex',
          alignItems: 'stretch',
          gap: 1.25,
          p: 1,
          pl: 1.25,
          borderRadius: 2,
          bgcolor: surface,
          border: '1px solid',
          borderColor: t.palette.mode === 'dark' ? alpha('#fff', 0.06) : alpha('#0f172a', 0.06),
          cursor: canJoin && onJoin ? 'pointer' : 'default',
          transition: 'background-color 0.15s, transform 0.15s, border-color 0.15s',
          overflow: 'hidden',
          '&:hover': {
            bgcolor: canJoin && onJoin ? surfaceHover : surface,
            borderColor:
              canJoin && onJoin
                ? alpha(t.palette.primary.main, 0.35)
                : t.palette.mode === 'dark'
                  ? alpha('#fff', 0.06)
                  : alpha('#0f172a', 0.06),
          },
        };
      }}
    >
      <Box
        sx={(t) => ({
          flexShrink: 0,
          width: 44,
          borderRadius: 1.5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: isLive
            ? alpha(t.palette.success.main, t.palette.mode === 'dark' ? 0.2 : 0.14)
            : alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.18 : 0.1),
          color: isLive ? 'success.main' : 'primary.main',
        })}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>
          {formatTime(occurrence.startsAt)}
        </Typography>
        <Typography sx={{ fontSize: 10, fontWeight: 600, mt: 0.25, opacity: 0.75 }}>
          {occurrence.durationMin}м
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography
          sx={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.25 }}
          noWrap
        >
          {occurrence.title}
        </Typography>
        <Stack direction="row" alignItems="center" gap={0.75} sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }} noWrap>
            {occurrence.hostName}
          </Typography>
          <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'text.disabled' }} />
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }} noWrap>
            {occurrence.participantUserIds.length} уч.
          </Typography>
        </Stack>
        <Typography
          sx={(t) => ({
            fontSize: 11,
            fontWeight: 600,
            mt: 0.25,
            color: isLive ? t.palette.success.main : 'text.secondary',
          })}
        >
          {isLive ? '● идёт сейчас' : formatRelative(occurrence.startsAt)}
        </Typography>
      </Box>
      <Stack direction="row" alignItems="center" gap={0.25}>
        {onShareLink ? (
          <Tooltip title="Копировать ссылку">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onShareLink(occurrence);
              }}
              sx={{ color: 'text.secondary' }}
            >
              <ContentCopyOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : null}
        {onJoin ? (
          <Tooltip title={canJoin ? 'Присоединиться' : 'Доступно за 5 мин до начала'}>
            <span>
              <IconButton
                size="small"
                disabled={!canJoin}
                onClick={(e) => {
                  e.stopPropagation();
                  onJoin(occurrence);
                }}
                sx={(t) => ({
                  color: canJoin ? '#fff' : 'text.disabled',
                  bgcolor: canJoin ? t.palette.primary.main : 'transparent',
                  '&:hover': {
                    bgcolor: canJoin ? t.palette.primary.dark : 'action.hover',
                  },
                })}
              >
                <VideoCallRounded sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Stack>
    </Box>
  );
}

import { useMemo } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AddRounded, EventAvailableOutlined, EventOutlined } from '@mui/icons-material';
import type { MeetingOccurrence } from '../types';
import { MeetingCard } from './MeetingCard';

type Props = {
  occurrences: MeetingOccurrence[];
  onJoin?: (occurrence: MeetingOccurrence) => void;
  onShareLink?: (occurrence: MeetingOccurrence) => void;
  onCreate?: () => void;
};

function bucketFor(dateIso: string): 'today' | 'tomorrow' | 'week' | 'later' {
  const now = new Date();
  const d = new Date(dateIso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTomorrow = startOfToday + 24 * 3600_000;
  const startOfDayAfter = startOfTomorrow + 24 * 3600_000;
  const endOfWeek = startOfToday + 7 * 24 * 3600_000;
  const t = d.getTime();
  if (t < startOfTomorrow) return 'today';
  if (t < startOfDayAfter) return 'tomorrow';
  if (t < endOfWeek) return 'week';
  return 'later';
}

const BUCKET_LABELS: Record<'today' | 'tomorrow' | 'week' | 'later', string> = {
  today: 'Сегодня',
  tomorrow: 'Завтра',
  week: 'На этой неделе',
  later: 'Позже',
};

export function UpcomingMeetingsPanel({ occurrences, onJoin, onShareLink, onCreate }: Props) {
  const grouped = useMemo(() => {
    const buckets: Record<'today' | 'tomorrow' | 'week' | 'later', MeetingOccurrence[]> = {
      today: [],
      tomorrow: [],
      week: [],
      later: [],
    };
    const sorted = [...occurrences].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
    sorted.forEach((occ) => {
      buckets[bucketFor(occ.startsAt)].push(occ);
    });
    return buckets;
  }, [occurrences]);

  const empty = occurrences.length === 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', px: 1.25, pt: 1.25, pb: 0.5 }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1 }}>
        <EventAvailableOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
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
          Предстоящие встречи
        </Typography>
        {onCreate ? (
          <Button
            size="small"
            startIcon={<AddRounded sx={{ fontSize: 16 }} />}
            onClick={onCreate}
            sx={{
              minWidth: 0,
              fontWeight: 700,
              fontSize: 12,
              px: 1,
              py: 0.25,
              borderRadius: 1.5,
              textTransform: 'none',
            }}
          >
            Создать
          </Button>
        ) : null}
      </Stack>
      {empty ? (
        <Box
          sx={(t) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            py: 2.5,
            px: 1,
            borderRadius: 2,
            border: '1px dashed',
            borderColor: t.palette.mode === 'dark' ? alpha('#fff', 0.1) : alpha('#0f172a', 0.1),
            bgcolor: t.palette.mode === 'dark' ? alpha('#fff', 0.015) : alpha('#0f172a', 0.015),
          })}
        >
          <EventOutlined sx={{ fontSize: 24, color: 'text.disabled' }} />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center' }}>
            Нет запланированных встреч
          </Typography>
          {onCreate ? (
            <Button
              variant="text"
              size="small"
              onClick={onCreate}
              sx={{ fontWeight: 700, fontSize: 12, textTransform: 'none', mt: 0.25 }}
            >
              Запланировать первую
            </Button>
          ) : null}
        </Box>
      ) : (
        <Stack spacing={1.25}>
          {(['today', 'tomorrow', 'week', 'later'] as const).map((bucket) =>
            grouped[bucket].length ? (
              <Box key={bucket}>
                <Typography
                  sx={{
                    display: 'block',
                    fontSize: 10.5,
                    color: 'text.secondary',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    mb: 0.75,
                    ml: 0.25,
                  }}
                >
                  {BUCKET_LABELS[bucket]}
                </Typography>
                <Stack spacing={0.75}>
                  {grouped[bucket].map((occ) => (
                    <MeetingCard
                      key={`${occ.meetingId}-${occ.occurrenceDate}`}
                      occurrence={occ}
                      onJoin={onJoin}
                      onShareLink={onShareLink}
                    />
                  ))}
                </Stack>
              </Box>
            ) : null,
          )}
        </Stack>
      )}
    </Box>
  );
}

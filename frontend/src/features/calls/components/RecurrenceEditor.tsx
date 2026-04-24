import { Box, Chip, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import type { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';

type Frequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';

type Props = {
  value: string | null;
  onChange: (rrule: string | null) => void;
  startsAt: string | null;
};

const WEEKDAYS: Array<{ key: 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'; label: string }> = [
  { key: 'MO', label: 'Пн' },
  { key: 'TU', label: 'Вт' },
  { key: 'WE', label: 'Ср' },
  { key: 'TH', label: 'Чт' },
  { key: 'FR', label: 'Пт' },
  { key: 'SA', label: 'Сб' },
  { key: 'SU', label: 'Вс' },
];

function isoToUntil(iso: string | null) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  } catch {
    return '';
  }
}

function buildRRule(opts: {
  frequency: Frequency;
  byWeekday: string[];
  count: number | null;
  until: string | null;
  custom: string;
}): string | null {
  if (opts.frequency === 'none') return null;
  if (opts.frequency === 'custom') {
    const c = opts.custom.trim();
    return c || null;
  }
  const parts: string[] = [];
  if (opts.frequency === 'daily') parts.push('FREQ=DAILY');
  if (opts.frequency === 'weekly') {
    parts.push('FREQ=WEEKLY');
    if (opts.byWeekday.length) parts.push(`BYDAY=${opts.byWeekday.join(',')}`);
  }
  if (opts.frequency === 'monthly') parts.push('FREQ=MONTHLY');
  if (opts.count && opts.count > 0) parts.push(`COUNT=${opts.count}`);
  if (opts.until) {
    const untilIso = isoToUntil(opts.until);
    if (untilIso) parts.push(`UNTIL=${untilIso}`);
  }
  return parts.join(';');
}

export function RecurrenceEditor({ value, onChange, startsAt }: Props) {
  const initial = useMemo<Frequency>(() => {
    if (!value) return 'none';
    if (value.includes('FREQ=DAILY')) return 'daily';
    if (value.includes('FREQ=WEEKLY')) return 'weekly';
    if (value.includes('FREQ=MONTHLY')) return 'monthly';
    return 'custom';
  }, [value]);

  const [frequency, setFrequency] = useState<Frequency>(initial);
  const [byWeekday, setByWeekday] = useState<string[]>(() => {
    if (!value) return [];
    const m = value.match(/BYDAY=([^;]+)/);
    return m ? m[1].split(',') : [];
  });
  const [count, setCount] = useState<number | null>(() => {
    if (!value) return null;
    const m = value.match(/COUNT=(\d+)/);
    return m ? Number(m[1]) : null;
  });
  const [until, setUntil] = useState<Dayjs | null>(null);
  const untilIso = until && until.isValid() ? until.toDate().toISOString() : null;
  const [custom, setCustom] = useState<string>(frequency === 'custom' ? value || '' : '');

  useEffect(() => {
    const rr = buildRRule({ frequency, byWeekday, count, until: untilIso, custom });
    onChange(rr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, byWeekday, count, untilIso, custom]);

  const toggleWeekday = (key: string) => {
    setByWeekday((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Повтор
        </Typography>
        <Select
          size="small"
          fullWidth
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
        >
          <MenuItem value="none">Не повторять</MenuItem>
          <MenuItem value="daily">Ежедневно</MenuItem>
          <MenuItem value="weekly">Еженедельно</MenuItem>
          <MenuItem value="monthly">Ежемесячно</MenuItem>
          <MenuItem value="custom">Свой RRULE</MenuItem>
        </Select>
      </Box>
      {frequency === 'weekly' ? (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Дни недели
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            {WEEKDAYS.map((wd) => (
              <Chip
                key={wd.key}
                label={wd.label}
                size="small"
                color={byWeekday.includes(wd.key) ? 'primary' : 'default'}
                variant={byWeekday.includes(wd.key) ? 'filled' : 'outlined'}
                onClick={() => toggleWeekday(wd.key)}
                sx={{ mb: 0.5 }}
              />
            ))}
          </Stack>
        </Box>
      ) : null}
      {frequency !== 'none' && frequency !== 'custom' ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            size="small"
            type="number"
            label="Количество повторов"
            value={count ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCount(Number.isFinite(n) && n > 0 ? n : null);
            }}
            InputProps={{ inputProps: { min: 1 } }}
            fullWidth
          />
          <DateTimePicker
            label="Окончание (UNTIL)"
            value={until}
            onChange={(v) => setUntil(v)}
            minutesStep={5}
            ampm={false}
            format="DD.MM.YYYY HH:mm"
            slotProps={{
              textField: { fullWidth: true, size: 'small' },
              popper: { placement: 'bottom-start' },
              actionBar: { actions: ['clear', 'today', 'accept'] },
            }}
          />
        </Stack>
      ) : null}
      {frequency === 'custom' ? (
        <TextField
          size="small"
          fullWidth
          label="Свой RRULE (RFC 5545)"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
          helperText={startsAt ? `Начало: ${new Date(startsAt).toLocaleString('ru-RU')}` : undefined}
        />
      ) : null}
    </Stack>
  );
}

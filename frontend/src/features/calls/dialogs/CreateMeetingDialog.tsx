import { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Close, Schedule } from '@mui/icons-material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { createMeeting } from '../api/meetings';
import type { Meeting } from '../types';
import { RecurrenceEditor } from '../components/RecurrenceEditor';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';

type SimpleUser = {
  id: number;
  username: string;
  firstname?: string | null;
  lastname?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  users: SimpleUser[];
  defaultParticipantIds?: number[];
  onCreated?: (meeting: Meeting) => void;
};

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

function computeDefaultStart(): Dayjs {
  const now = dayjs();
  const add = 15 - (now.minute() % 15);
  return now.add(add, 'minute').second(0).millisecond(0);
}

export function CreateMeetingDialog({
  open,
  onClose,
  users,
  defaultParticipantIds = [],
  onCreated,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState<Dayjs | null>(() => computeDefaultStart());
  const [durationMin, setDurationMin] = useState(30);
  const [participantIds, setParticipantIds] = useState<number[]>(defaultParticipantIds);
  const [rrule, setRrule] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setStartsAt(computeDefaultStart());
      setDurationMin(30);
      setParticipantIds(defaultParticipantIds);
      setRrule(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startsAtIso = useMemo(() => {
    if (!startsAt || !startsAt.isValid()) return null;
    return startsAt.toDate().toISOString();
  }, [startsAt]);

  const userById = useMemo(() => {
    const map = new Map<number, SimpleUser>();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);
  const selectedUsers = useMemo(
    () =>
      participantIds
        .map((id) => userById.get(id))
        .filter((u): u is SimpleUser => Boolean(u)),
    [participantIds, userById],
  );

  const onSubmit = async () => {
    if (!title.trim()) {
      return;
    }
    if (!startsAtIso) {
      return;
    }
    setSubmitting(true);
    try {
      const meeting = await createMeeting({
        title: title.trim(),
        description: description.trim() || null,
        chatId: null,
        startsAt: startsAtIso,
        durationMin,
        rrule,
        participantUserIds: participantIds,
      });
      onCreated?.(meeting);
    } catch {
      /* create meeting failed */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          pt: { xs: 1.5, sm: 2.25 },
          px: { xs: 1.5, sm: 2.25 },
          pb: { xs: 0.75, sm: 1 },
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
          <Box
            sx={(t) => ({
              width: { xs: 36, sm: 44 },
              height: { xs: 36, sm: 44 },
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.2 : 0.12),
              color: 'primary.main',
              flexShrink: 0,
            })}
          >
            <Schedule sx={{ fontSize: { xs: 20, sm: 24 } }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h6"
              fontWeight={800}
              letterSpacing="-0.02em"
              lineHeight={1.15}
              sx={{ fontSize: { xs: '1.1rem', sm: '1.25rem' } }}
            >
              Запланировать встречу
            </Typography>
          </Box>
        </Stack>
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary', mr: -0.25 }}>
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ px: 2.25, py: 2 }}>
        <Stack spacing={2}>
          <TextField
            fullWidth
            size="small"
            label="Название"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <TextField
            fullWidth
            size="small"
            label="Описание (опционально)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            maxRows={3}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <DateTimePicker
              label="Начало"
              value={startsAt}
              onChange={(v) => setStartsAt(v)}
              minutesStep={5}
              ampm={false}
              format="DD.MM.YYYY HH:mm"
              slotProps={{
                textField: { fullWidth: true, size: 'small' },
                popper: { placement: 'bottom-start' },
              }}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Длительность</InputLabel>
              <Select
                label="Длительность"
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
              >
                {DURATION_OPTIONS.map((d) => (
                  <MenuItem key={d} value={d}>{`${d} мин`}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Autocomplete
            multiple
            disableCloseOnSelect
            size="small"
            options={users}
            value={selectedUsers}
            onChange={(_, next) => setParticipantIds(next.map((u) => u.id))}
            getOptionLabel={(u) => {
              const name = [u.firstname, u.lastname].filter(Boolean).join(' ') || u.firstname || u.username;
              return `${name} (@${u.username})`;
            }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            filterOptions={(opts, state) => {
              const q = state.inputValue.trim().toLowerCase();
              if (!q) return opts;
              return opts.filter((u) => {
                const name = [u.firstname, u.lastname].filter(Boolean).join(' ');
                return (
                  u.username.toLowerCase().includes(q) ||
                  name.toLowerCase().includes(q)
                );
              });
            }}
            noOptionsText="Никого не нашли"
            renderOption={(props, option, { selected }) => {
              const { key, ...optionProps } = props as typeof props & { key: React.Key };
              const name = [option.firstname, option.lastname].filter(Boolean).join(' ') || option.firstname || option.username;
              return (
                <li key={key} {...optionProps}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: '100%' }}>
                    <Avatar
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor: getAvatarColor(name),
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {getAvatarInitial(name)}
                    </Avatar>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2 }} noWrap>
                        {name}
                      </Typography>
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.2 }} noWrap>
                        @{option.username}
                      </Typography>
                    </Box>
                    {selected ? (
                      <Box
                        sx={(t) => ({
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: t.palette.primary.main,
                          flexShrink: 0,
                        })}
                      />
                    ) : null}
                  </Box>
                </li>
              );
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const name = [option.firstname, option.lastname].filter(Boolean).join(' ') || option.firstname || option.username;
                const tagProps = getTagProps({ index });
                return (
                  <Chip
                    {...tagProps}
                    key={option.id}
                    size="small"
                    avatar={
                      <Avatar
                        sx={{
                          bgcolor: getAvatarColor(name),
                          color: '#fff !important',
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {getAvatarInitial(name)}
                      </Avatar>
                    }
                    label={name}
                  />
                );
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Участники"
                placeholder={selectedUsers.length ? '' : 'Начните вводить имя или @username'}
              />
            )}
          />
          <RecurrenceEditor value={rrule} onChange={setRrule} startsAt={startsAtIso} />
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          px: 2.25,
          py: 1.75,
          gap: 1,
          justifyContent: 'space-between',
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Button variant="text" color="inherit" onClick={onClose} disabled={submitting}>
          Отмена
        </Button>
        <Button
          variant="contained"
          disableElevation
          onClick={() => void onSubmit()}
          disabled={submitting}
          sx={{ borderRadius: 2, fontWeight: 700, px: 2.5 }}
        >
          {submitting ? 'Создание…' : 'Создать встречу'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

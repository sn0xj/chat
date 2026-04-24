import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Close, ContentCopy, Share } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import type { MeetingOccurrence } from '../types';
import { buildGuestMeetingUrl } from '../utils/guestLink';

type Props = {
  open: boolean;
  onClose: () => void;
  occurrence: MeetingOccurrence | null;
};

export function ShareGuestLinkDialog({ open, onClose, occurrence }: Props) {
  const url = occurrence ? buildGuestMeetingUrl(occurrence.inviteToken) : '';

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard failed */
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          pt: 2.25,
          px: 2.25,
          pb: 1,
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box
            sx={(t) => ({
              width: 44,
              height: 44,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.2 : 0.12),
              color: 'primary.main',
            })}
          >
            <Share sx={{ fontSize: 24 }} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={800} letterSpacing="-0.02em" lineHeight={1.2}>
              Гостевая ссылка
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {occurrence?.title || ''}
            </Typography>
          </Box>
        </Stack>
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ px: 2.25, py: 2 }}>
        <TextField
          fullWidth
          size="small"
          value={url}
          InputProps={{ readOnly: true }}
          sx={{ '& input': { fontSize: 13.5, fontWeight: 500 } }}
        />
        {occurrence ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Начало: {new Date(occurrence.startsAt).toLocaleString('ru-RU')} · длительность{' '}
            {occurrence.durationMin} мин
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 2.25, py: 1.75, gap: 1 }}>
        <Button variant="text" color="inherit" onClick={onClose}>
          Закрыть
        </Button>
        <Button
          variant="contained"
          startIcon={<ContentCopy />}
          disableElevation
          onClick={() => void copy()}
          disabled={!url}
          sx={{ borderRadius: 2, fontWeight: 700 }}
        >
          Копировать
        </Button>
      </DialogActions>
    </Dialog>
  );
}

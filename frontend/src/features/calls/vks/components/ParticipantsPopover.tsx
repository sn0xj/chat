import {
  Box,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Popover,
  Stack,
  Typography,
} from '@mui/material';
import {
  LogoutRounded,
  MicRounded,
  MicOffRounded,
  VideocamRounded,
  VideocamOffRounded,
} from '@mui/icons-material';
import type { RemoteParticipant } from '../engine/types';
import { radius, space } from '@/lib/tokens';

type LocalInfo = {
  displayName: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
};

type Props = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  local: LocalInfo;
  remotes: RemoteParticipant[];
  onKick?: (peerId: string) => void;
};

export function ParticipantsPopover({ anchorEl, onClose, local, remotes, onKick }: Props) {
  const total = remotes.length + 1;
  const open = Boolean(anchorEl);
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            width: 320,
            borderRadius: `${radius.md}px`,
            overflow: 'hidden',
          },
        },
      }}
    >
      <Box sx={{ p: `${space.md}px`, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Участники
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {total}
          </Typography>
        </Stack>
      </Box>
      <List dense disablePadding sx={{ maxHeight: 320, overflowY: 'auto' }}>
        <Row
          name={local.displayName}
          micEnabled={local.micEnabled}
          cameraEnabled={local.cameraEnabled}
        />
        {remotes.map((p) => (
          <Row
            key={p.peerId}
            name={p.displayName}
            micEnabled={p.media.audioEnabled}
            cameraEnabled={p.media.cameraEnabled}
            onKick={onKick ? () => onKick(p.peerId) : undefined}
          />
        ))}
      </List>
    </Popover>
  );
}

type RowProps = {
  name: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  onKick?: () => void;
};

function Row({ name, micEnabled, cameraEnabled, onKick }: RowProps) {
  return (
    <ListItem
      sx={{ py: `${space.sm}px`, px: `${space.md}px` }}
      secondaryAction={
        <Stack direction="row" spacing={`${space.xs}px`} alignItems="center">
          {micEnabled ? (
            <MicRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
          ) : (
            <MicOffRounded sx={{ fontSize: 18, color: 'error.main' }} />
          )}
          {cameraEnabled ? (
            <VideocamRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
          ) : (
            <VideocamOffRounded sx={{ fontSize: 18, color: 'error.main' }} />
          )}
          {onKick ? (
            <IconButton
              size="small"
              onClick={onKick}
              aria-label="Удалить из звонка"
              sx={{ color: 'error.main' }}
            >
              <LogoutRounded sx={{ fontSize: 18 }} />
            </IconButton>
          ) : null}
        </Stack>
      }
    >
      <ListItemText
        primary={name}
        primaryTypographyProps={{
          noWrap: true,
          sx: { fontSize: 14, fontWeight: 500 },
        }}
      />
    </ListItem>
  );
}

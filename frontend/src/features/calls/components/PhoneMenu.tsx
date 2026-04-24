import { ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import { Call, Schedule, ContentCopy } from '@mui/icons-material';

type Props = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  hasUpcomingMeeting: boolean;
  onStartNow: () => void;
  onScheduleMeeting: () => void;
  onCopyGuestLink: () => void;
};

export function PhoneMenu({
  anchorEl,
  onClose,
  hasUpcomingMeeting,
  onStartNow,
  onScheduleMeeting,
  onCopyGuestLink,
}: Props) {
  return (
    <Menu
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: {
            mt: 0.75,
            minWidth: 260,
            borderRadius: 2.5,
            p: 0.5,
          },
        },
      }}
    >
      <MenuItem onClick={onStartNow} sx={{ minHeight: 40, borderRadius: 1.5, gap: 1, px: 1.25 }}>
        <ListItemIcon sx={{ minWidth: 28, color: 'success.main' }}>
          <Call fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Позвонить сейчас" />
      </MenuItem>
      <MenuItem onClick={onScheduleMeeting} sx={{ minHeight: 40, borderRadius: 1.5, gap: 1, px: 1.25 }}>
        <ListItemIcon sx={{ minWidth: 28, color: 'primary.main' }}>
          <Schedule fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Запланировать встречу" />
      </MenuItem>
      <MenuItem
        onClick={onCopyGuestLink}
        disabled={!hasUpcomingMeeting}
        sx={{ minHeight: 40, borderRadius: 1.5, gap: 1, px: 1.25 }}
      >
        <ListItemIcon sx={{ minWidth: 28, color: 'text.secondary' }}>
          <ContentCopy fontSize="small" />
        </ListItemIcon>
        <ListItemText
          primary="Копировать гостевую ссылку"
          secondary={hasUpcomingMeeting ? undefined : 'Сначала создайте встречу'}
          secondaryTypographyProps={{ sx: { fontSize: 11 } }}
        />
      </MenuItem>
    </Menu>
  );
}

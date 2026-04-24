import { useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { DeleteOutline } from '@mui/icons-material';
import type { Chat } from '@/lib/types';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';

type Props = {
  open: boolean;
  chat: Chat | null;
  currentUserId?: number;
  onClose: () => void;
  onConfirm: (payload: { deleteForEveryone: boolean }) => void | Promise<void>;
};

export function DeleteChatDialog({ open, chat, currentUserId, onClose, onConfirm }: Props) {
  const [deleteForEveryone, setDeleteForEveryone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setDeleteForEveryone(false);
      setSubmitting(false);
    }
  }, [open]);

  if (!chat) return null;

  const isGroup = chat.type === 'group' || chat.type === 'meeting';
  const peer = !isGroup
    ? chat.members.find((m) => m.id !== currentUserId) || chat.members[0]
    : null;
  const peerName = peer
    ? [peer.firstname, peer.lastname].filter(Boolean).join(' ') || peer.firstname || peer.username
    : '';
  const displayName = isGroup ? chat.title || 'Группа' : peerName;

  const title = isGroup ? 'Удалить группу' : 'Удалить чат';
  const body = isGroup
    ? `Вы уверены, что хотите удалить группу «${displayName}»?`
    : `Вы уверены, что хотите удалить всю историю переписки с ${displayName}?`;

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm({
        deleteForEveryone: isGroup ? true : deleteForEveryone,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            p: 0,
          },
        },
      }}
    >
      <DialogContent sx={{ px: 3, pt: 3, pb: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
          <Avatar
            sx={{
              width: 44,
              height: 44,
              bgcolor: getAvatarColor(displayName),
              color: '#fff',
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            {getAvatarInitial(displayName)}
          </Avatar>
          <Typography variant="h6" fontWeight={800} letterSpacing="-0.01em" sx={{ flex: 1, minWidth: 0 }}>
            {title}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ mb: 1.25, lineHeight: 1.5 }}>
          {body}
        </Typography>
        <Typography
          variant="body2"
          sx={(t) => ({
            color: alpha(t.palette.text.primary, 0.6),
            fontStyle: 'italic',
            mb: isGroup ? 0 : 1.5,
          })}
        >
          Это действие нельзя отменить.
        </Typography>
        {!isGroup ? (
          <Box
            sx={(t) => ({
              mt: 1,
              py: 0.75,
              px: 1,
              borderRadius: 1.5,
              bgcolor: alpha(t.palette.text.primary, t.palette.mode === 'dark' ? 0.04 : 0.03),
            })}
          >
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={deleteForEveryone}
                  onChange={(e) => setDeleteForEveryone(e.target.checked)}
                  sx={{ p: 0.75, mr: 0.5 }}
                />
              }
              label={
                <Typography variant="body2">
                  Удалить также у <b>{displayName}</b>
                </Typography>
              }
              sx={{ m: 0 }}
            />
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2, pt: 1, gap: 1 }}>
        <Button onClick={onClose} disabled={submitting} color="inherit" sx={{ fontWeight: 600 }}>
          Отмена
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={submitting}
          color="error"
          variant="contained"
          disableElevation
          startIcon={<DeleteOutline />}
          sx={{ fontWeight: 700, borderRadius: 2, px: 2 }}
        >
          Удалить
        </Button>
      </DialogActions>
    </Dialog>
  );
}

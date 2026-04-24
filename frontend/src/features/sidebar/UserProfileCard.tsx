import { useEffect, useState, type MouseEvent } from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  Divider,
  Drawer,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  CallOutlined,
  ChatBubbleOutline,
  ContentCopyOutlined,
  Close,
  MoreHorizRounded,
  NotificationsOffOutlined,
  NotificationsOutlined,
} from '@mui/icons-material';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';
import { SLACK } from '@/theme/slackColors';
import { formatPresenceByLastActivity, isUserOnline } from '@/lib/formatLastSeen';

export type UserCardPerson = {
  id: number;
  username: string;
  firstname?: string | null;
  lastname?: string | null;
  last_activity?: string | null;
};

type Props = {
  open: boolean;
  anchorEl: HTMLElement | null;
  user: UserCardPerson | null;
  muted: boolean | null;
  onClose: () => void;
  onMessage: (user: UserCardPerson) => void;
  onCall: (user: UserCardPerson) => void;
  onToggleMute: (user: UserCardPerson) => void;
};

export function UserProfileCard({
  open,
  anchorEl,
  user,
  muted,
  onClose,
  onMessage,
  onCall,
  onToggleMute,
}: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const closeMore = () => setMoreAnchor(null);

  useEffect(() => {
    if (!open) {
      setMoreAnchor(null);
    }
  }, [open]);

  if (!user) return null;

  const displayName =
    [user.firstname, user.lastname].filter(Boolean).join(' ') || user.firstname || user.username;
  const online = isUserOnline(user.last_activity);
  const status = formatPresenceByLastActivity(user.last_activity);

  const handleAction = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const openMore = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setMoreAnchor(e.currentTarget);
  };

  const copyUsername = async () => {
    try {
      await navigator.clipboard.writeText(`@${user.username}`);
    } catch {
      /* clipboard failed */
    }
    closeMore();
    onClose();
  };

  const cardContent = (
    <>
      <Box
        sx={{
          position: 'relative',
          px: 2.5,
          pt: 2.5,
          pb: 2,
          background: (t) =>
            `radial-gradient(120% 140% at 50% 0%, ${alpha(
              t.palette.primary.main,
              isDark ? 0.22 : 0.14,
            )} 0%, transparent 70%)`,
        }}
      >
        <IconButton
          size="small"
          onClick={onClose}
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            color: 'text.secondary',
            '&:hover': { color: 'text.primary' },
          }}
        >
          <Close fontSize="small" />
        </IconButton>

        <Stack alignItems="center" spacing={1.25}>
          <Box sx={{ position: 'relative' }}>
            <Avatar
              sx={{
                width: 72,
                height: 72,
                fontSize: 28,
                fontWeight: 700,
                bgcolor: getAvatarColor(user.username || displayName),
                boxShadow: isDark
                  ? '0 6px 18px rgba(0,0,0,0.45)'
                  : '0 6px 18px rgba(15,23,42,0.18)',
              }}
            >
              {getAvatarInitial(displayName)}
            </Avatar>
            {online ? (
              <Box
                sx={{
                  position: 'absolute',
                  right: 2,
                  bottom: 2,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  bgcolor: SLACK.success,
                  border: (t) => `3px solid ${t.palette.background.paper}`,
                }}
              />
            ) : null}
          </Box>
          <Stack spacing={0.25} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
            <Typography
              variant="subtitle1"
              fontWeight={700}
              sx={{
                letterSpacing: '-0.01em',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              @{user.username}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                mt: 0.5,
                color: online ? SLACK.success : 'text.secondary',
                fontWeight: 500,
              }}
            >
              {status}
            </Typography>
          </Stack>
        </Stack>
      </Box>

      <Divider />

      <Stack direction="row" sx={{ px: 1, py: 1, gap: 0.5 }}>
        <ActionButton
          label="Чат"
          icon={<ChatBubbleOutline fontSize="small" />}
          onClick={handleAction(() => onMessage(user))}
        />
        <ActionButton
          label={muted ? 'Вкл. уведом.' : 'Без звука'}
          icon={
            muted ? (
              <NotificationsOutlined fontSize="small" />
            ) : (
              <NotificationsOffOutlined fontSize="small" />
            )
          }
          disabled={muted === null}
          onClick={handleAction(() => onToggleMute(user))}
        />
        <ActionButton
          label="Звонок"
          icon={<CallOutlined fontSize="small" />}
          onClick={handleAction(() => onCall(user))}
        />
        <ActionButton
          label="Ещё"
          icon={<MoreHorizRounded fontSize="small" />}
          onClick={openMore}
        />
      </Stack>

      <Menu
        anchorEl={moreAnchor}
        open={Boolean(moreAnchor)}
        onClose={closeMore}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={() => void copyUsername()}>
          <ListItemIcon>
            <ContentCopyOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>Скопировать @username</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );

  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        slotProps={{
          paper: {
            sx: {
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              overflow: 'hidden',
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              boxShadow: isDark
                ? '0 -12px 36px rgba(0,0,0,0.55)'
                : '0 -12px 36px rgba(15,23,42,0.2)',
            },
          },
        }}
      >
        {cardContent}
      </Drawer>
    );
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
      transformOrigin={{ vertical: 'center', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            ml: 1.5,
            width: { xs: 280, sm: 300 },
            maxWidth: 'calc(100vw - 24px)',
            borderRadius: 3,
            overflow: 'hidden',
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            boxShadow: isDark
              ? '0 18px 48px rgba(0,0,0,0.55)'
              : '0 18px 48px rgba(15,23,42,0.18)',
          },
        },
      }}
    >
      {cardContent}
    </Popover>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: (e: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
}) {
  return (
    <ButtonBase
      focusRipple
      onClick={onClick}
      disabled={disabled}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        py: 1.25,
        borderRadius: 2,
        color: disabled ? 'text.disabled' : 'text.primary',
        transition: 'background-color .15s ease, color .15s ease',
        '&:hover': !disabled
          ? {
              bgcolor: (t) =>
                alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.18 : 0.1),
              color: 'primary.main',
            }
          : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</Box>
      <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>
        {label}
      </Typography>
    </ButtonBase>
  );
}

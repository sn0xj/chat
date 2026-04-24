import { Box, IconButton, Tooltip } from '@mui/material';
import { Delete, Edit, Forward, MoreHoriz, Reply } from '@mui/icons-material';
import type { Message } from '@/lib/types';
import { radius } from '@/lib/tokens';
import type { OnMessageAction } from './types';

type Props = {
  message: Message;
  isOwn: boolean;
  onAction: OnMessageAction;
};

export function HoverActions({ message, isOwn, onAction }: Props) {
  return (
    <Box
      className="message-hover-actions"
      sx={{
        position: 'absolute',
        top: '50%',
        right: isOwn ? 'auto' : 12,
        left: isOwn ? 12 : 'auto',
        transform: 'translateY(-50%)',
        display: 'none',
        alignItems: 'center',
        gap: 0.125,
        px: 0.25,
        py: 0.25,
        borderRadius: `${radius.sm}px`,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: (t) =>
          t.palette.mode === 'dark'
            ? '0 4px 14px rgba(0,0,0,0.45)'
            : '0 4px 14px rgba(15,23,42,0.1)',
        zIndex: 3,
        '.message-row:hover &': {
          display: 'flex',
        },
        '@media (hover: none)': {
          display: 'flex',
          top: 8,
          right: isOwn ? 'auto' : 8,
          left: isOwn ? 8 : 'auto',
          transform: 'none',
          py: 0.375,
        },
        '& .MuiIconButton-root': {
          width: 28,
          height: 28,
          borderRadius: 1,
          color: 'text.secondary',
          '@media (hover: none)': {
            width: 32,
            height: 32,
          },
          '&:hover': {
            bgcolor: 'action.hover',
            color: 'text.primary',
          },
        },
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip title="Ответить" placement="top">
        <IconButton size="small" onClick={(e) => onAction('reply', message, e)}>
          <Reply sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Переслать" placement="top">
        <IconButton size="small" onClick={(e) => onAction('forward', message, e)}>
          <Forward sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      {isOwn ? (
        <Tooltip title="Редактировать" placement="top">
          <IconButton size="small" onClick={(e) => onAction('edit', message, e)}>
            <Edit sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      ) : null}
      {isOwn ? (
        <Tooltip title="Удалить" placement="top">
          <IconButton
            size="small"
            onClick={(e) => onAction('delete', message, e)}
            sx={{ color: 'error.main' }}
          >
            <Delete sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      ) : null}
      <Tooltip title="Ещё" placement="top">
        <IconButton size="small" onClick={(e) => onAction('more', message, e)}>
          <MoreHoriz sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

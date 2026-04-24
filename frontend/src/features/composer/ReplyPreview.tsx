import { Box, IconButton, Paper, Typography } from '@mui/material';
import { Close, Edit, Reply } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { fontSize, fontWeight, radius } from '@/lib/tokens';

type Props =
  | {
      mode: 'edit';
      originalText: string;
      onCancel: () => void;
    }
  | {
      mode: 'reply';
      senderName: string;
      originalText: string;
      onCancel: () => void;
    };

export function ReplyPreview(props: Props) {
  const isEdit = props.mode === 'edit';
  const title = isEdit
    ? 'Редактировать сообщение'
    : `Ответ: ${props.senderName}`;
  const accent = isEdit ? 'primary.main' : 'info.main';
  const Icon = isEdit ? Edit : Reply;

  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 0.75,
        p: 1,
        borderRadius: `${radius.sm}px`,
        borderColor: 'divider',
        bgcolor: (t) =>
          alpha(
            (isEdit ? t.palette.primary.main : t.palette.info.main),
            t.palette.mode === 'dark' ? 0.08 : 0.05,
          ),
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
      }}
    >
      <Icon sx={{ mt: 0.25, fontSize: 16, color: accent, flexShrink: 0 }} aria-hidden />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: fontSize.xs,
            fontWeight: fontWeight.bold,
            color: accent,
            lineHeight: 1.3,
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            mt: 0.25,
            fontSize: fontSize.xs,
            color: 'text.secondary',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {props.originalText || '—'}
        </Typography>
      </Box>
      <IconButton
        size="small"
        onClick={props.onCancel}
        aria-label="Отменить"
        sx={{ color: 'text.secondary' }}
      >
        <Close fontSize="small" />
      </IconButton>
    </Paper>
  );
}

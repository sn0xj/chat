import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ContentCopyOutlined, LinkOutlined } from '@mui/icons-material';

type Props = {
  url: string;
  label?: string;
  hint?: string;
  onCopy: (url: string) => void | Promise<void>;
};

export function GuestLinkField({
  url,
  label = 'Гостевая ссылка',
  hint = 'Подключатся без аккаунта — просто по ссылке',
  onCopy,
}: Props) {
  return (
    <Box
      sx={(t) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1,
        pl: 1.25,
        borderRadius: 2,
        border: '1px solid',
        borderColor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.3 : 0.2),
        bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.08 : 0.05),
      })}
    >
      <Box
        sx={(t) => ({
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.22 : 0.14),
          color: 'primary.main',
        })}
      >
        <LinkOutlined sx={{ fontSize: 18 }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2 }} noWrap>
          {label}
        </Typography>
        <Tooltip title={url} placement="bottom-start">
          <Typography
            sx={{
              fontSize: 12,
              color: 'text.primary',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {url}
          </Typography>
        </Tooltip>
        {hint ? (
          <Typography sx={{ fontSize: 10.5, color: 'text.disabled', lineHeight: 1.2, mt: 0.25 }}>
            {hint}
          </Typography>
        ) : null}
      </Box>
      <Tooltip title="Скопировать ссылку">
        <IconButton
          size="small"
          onClick={() => void onCopy(url)}
          aria-label="Скопировать гостевую ссылку"
          sx={{ color: 'primary.main' }}
        >
          <ContentCopyOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

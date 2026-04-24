import { Box, Link, Typography } from '@mui/material';
import { Description } from '@mui/icons-material';
import type { MessageAttachment } from '@/lib/messageContent';
import { api } from '@/services/api';
import { useChatStore } from '@/store/chat-store';
import { radius } from '@/lib/tokens';

type Props = {
  attachments: MessageAttachment[];
};

function withAccessToken(url: string, token: string | null) {
  if (!token) return url;
  try {
    const apiBaseUrl =
      typeof api.defaults.baseURL === 'string' ? api.defaults.baseURL : window.location.origin;
    const target = new URL(url, apiBaseUrl);
    target.searchParams.set('token', token);
    return target.toString();
  } catch {
    return url;
  }
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageAttachments({ attachments }: Props) {
  const token = useChatStore((state) => state.token);

  if (!attachments.length) return null;

  return (
    <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {attachments.map((attachment, index) => {
        const secureUrl = withAccessToken(attachment.url, token);
        if (attachment.kind === 'image') {
          return (
            <Box
              key={`${attachment.name}-${attachment.size}-${index}`}
              sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}
            >
              <Box
                component="img"
                src={secureUrl}
                alt={attachment.name}
                sx={{
                  display: 'block',
                  width: 'auto',
                  height: 'auto',
                  maxWidth: { xs: '100%', sm: 360 },
                  maxHeight: { xs: 220, sm: 280 },
                  borderRadius: `${radius.sm}px`,
                  border: '1px solid',
                  borderColor: 'divider',
                  objectFit: 'cover',
                }}
              />
              <Link
                href={secureUrl}
                download={attachment.name}
                underline="hover"
                sx={{ fontSize: 12, color: 'text.secondary', width: 'fit-content' }}
              >
                {attachment.name} · {formatFileSize(attachment.size)}
              </Link>
            </Box>
          );
        }
        return (
          <Link
            key={`${attachment.name}-${attachment.size}-${index}`}
            href={secureUrl}
            download={attachment.name}
            underline="none"
            sx={{ display: 'block', width: 'fit-content', maxWidth: { xs: '100%', sm: 360 } }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 1,
                borderRadius: `${radius.sm}px`,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: (t) =>
                  t.palette.mode === 'dark'
                    ? 'rgba(255,255,255,0.02)'
                    : 'rgba(0,0,0,0.02)',
                transition: 'background-color 120ms ease',
                '&:hover': {
                  bgcolor: (t) =>
                    t.palette.mode === 'dark'
                      ? 'rgba(255,255,255,0.05)'
                      : 'rgba(0,0,0,0.04)',
                },
              }}
            >
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: `${radius.xs}px`,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  flexShrink: 0,
                }}
              >
                <Description sx={{ fontSize: 18 }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    color: 'text.primary',
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {attachment.name}
                </Typography>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: 11,
                    lineHeight: 1.3,
                  }}
                >
                  {formatFileSize(attachment.size)}
                </Typography>
              </Box>
            </Box>
          </Link>
        );
      })}
    </Box>
  );
}

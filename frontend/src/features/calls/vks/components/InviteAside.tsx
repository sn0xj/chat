import { useState } from 'react';
import { Box, Button, Card, CardContent, IconButton, Stack, Typography } from '@mui/material';
import { ContentCopyRounded, DoneAllRounded } from '@mui/icons-material';
import { radius, space } from '@/lib/tokens';

type Props = {
  roomId: string;
  onCopyInvite: () => Promise<void> | void;
};

export function InviteAside({ roomId, onCopyInvite }: Props) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await onCopyInvite();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };
  return (
    <Card
      elevation={0}
      sx={{
        width: 280,
        borderRadius: `${radius.lg}px`,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        alignSelf: 'stretch',
      }}
    >
      <CardContent sx={{ p: `${space.lg}px` }}>
        <Stack spacing={`${space.md}px`}>
          <Typography variant="body2" color="text.secondary">
            Чтобы пригласить других участников, отправьте им ссылку на встречу
          </Typography>
          <Button
            variant="contained"
            startIcon={copied ? <DoneAllRounded /> : <ContentCopyRounded />}
            onClick={handleCopy}
            sx={{ textTransform: 'none', borderRadius: `${radius.md}px` }}
          >
            {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
          </Button>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: `${space.sm}px`,
              p: `${space.sm}px ${space.md}px`,
              borderRadius: `${radius.md}px`,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              Встреча №
            </Typography>
            <Typography
              component="code"
              sx={{
                fontFamily: 'monospace',
                fontSize: 13,
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {roomId}
            </Typography>
            <IconButton
              size="small"
              onClick={handleCopy}
              aria-label="Копировать ссылку"
              sx={{ color: 'text.secondary' }}
            >
              <ContentCopyRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

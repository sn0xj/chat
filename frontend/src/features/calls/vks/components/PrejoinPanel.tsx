import { useState } from 'react';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { CallRounded, ContentCopyRounded, DoneAllRounded } from '@mui/icons-material';
import { radius, shadow, space } from '@/lib/tokens';

type Props = {
  roomId: string;
  connecting: boolean;
  onJoin: () => void;
  onCopyInvite: () => Promise<void> | void;
};

export function PrejoinPanel({ roomId, connecting, onJoin, onCopyInvite }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await onCopyInvite();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: { xs: `${space.md}px`, sm: `${space.lg}px` },
      }}
    >
      <Card
        elevation={0}
        sx={{
          width: '100%',
          maxWidth: 440,
          borderRadius: `${radius.lg}px`,
          boxShadow: shadow.md,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <CardContent sx={{ p: { xs: `${space.lg}px`, sm: `${space.xl}px` } }}>
          <Stack spacing={`${space.md}px`} alignItems="center" textAlign="center">
            <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
              Видеовстреча
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Встреча №{' '}
              <Typography
                component="code"
                sx={{
                  fontFamily: 'monospace',
                  bgcolor: 'action.hover',
                  px: `${space.sm}px`,
                  py: `${space.xs}px`,
                  borderRadius: `${radius.sm}px`,
                }}
              >
                {roomId}
              </Typography>
            </Typography>
            <Button
              variant="contained"
              size="large"
              startIcon={<CallRounded />}
              onClick={onJoin}
              disabled={connecting}
              sx={{
                borderRadius: `${radius.md}px`,
                textTransform: 'none',
                width: { xs: '100%', sm: 'auto' },
                minWidth: 200,
              }}
            >
              {connecting ? 'Подключение…' : 'Присоединиться'}
            </Button>
            <Button
              variant="text"
              size="small"
              startIcon={copied ? <DoneAllRounded /> : <ContentCopyRounded />}
              onClick={handleCopy}
              sx={{ textTransform: 'none' }}
            >
              {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

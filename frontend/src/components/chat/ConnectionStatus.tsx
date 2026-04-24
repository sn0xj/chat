import { Box, Typography } from '@mui/material';
import { FiberManualRecord } from '@mui/icons-material';
import { useChatStore } from '@/store/chat-store';

export function ConnectionStatus() {
  const status = useChatStore((s) => s.socketStatus);
  const connected = status === 'connected';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <FiberManualRecord sx={{ fontSize: 8, color: connected ? 'success.main' : 'text.disabled' }} />
      <Typography
        variant="caption"
        sx={{
          display: { xs: 'none', sm: 'inline' },
          fontWeight: 500,
          color: 'text.secondary',
          fontSize: '0.7rem',
        }}
      >
        {connected ? 'в сети' : 'не в сети'}
      </Typography>
    </Box>
  );
}

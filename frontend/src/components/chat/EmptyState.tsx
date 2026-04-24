import { Box, Typography } from '@mui/material';
import { ChatBubbleOutline } from '@mui/icons-material';
import { fontSize, fontWeight, radius } from '@/lib/tokens';

export function EmptyState() {
  return (
    <Box
      sx={{
        height: '100%',
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 3,
        bgcolor: 'background.default',
      }}
    >
      <Box
        sx={{
          px: 4,
          py: 3.5,
          borderRadius: `${radius.md}px`,
          maxWidth: 440,
          mx: 'auto',
          textAlign: 'center',
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box
          sx={{
            mb: 1.5,
            mx: 'auto',
            width: 48,
            height: 48,
            borderRadius: `${radius.sm}px`,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          }}
        >
          <ChatBubbleOutline sx={{ fontSize: 24 }} />
        </Box>
        <Typography
          sx={{
            fontSize: fontSize.lg,
            fontWeight: fontWeight.bold,
            letterSpacing: '-0.01em',
            mb: 0.5,
            color: 'text.primary',
          }}
        >
          Выберите чат
        </Typography>
        <Typography
          sx={{
            fontSize: fontSize.sm,
            color: 'text.secondary',
            lineHeight: 1.5,
          }}
        >
          Откройте переписку в списке слева или создайте новую
        </Typography>
      </Box>
    </Box>
  );
}

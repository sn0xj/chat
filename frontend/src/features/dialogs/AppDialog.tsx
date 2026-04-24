import { type ReactNode } from 'react';
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  Typography,
  type DialogProps,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { fontSize, fontWeight, radius } from '@/lib/tokens';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  maxWidth?: DialogProps['maxWidth'];
  fullWidth?: boolean;
  disableClose?: boolean;
  contentSx?: DialogContentProps;
};

type DialogContentProps = NonNullable<
  React.ComponentProps<typeof DialogContent>['sx']
>;

export function AppDialog({
  open,
  onClose,
  title,
  subtitle,
  icon,
  actions,
  children,
  maxWidth = 'sm',
  fullWidth = true,
  disableClose,
  contentSx,
}: Props) {
  return (
    <Dialog
      open={open}
      onClose={disableClose ? undefined : onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      PaperProps={{
        sx: {
          borderRadius: `${radius.md}px`,
          border: '1px solid',
          borderColor: 'divider',
          backgroundImage: 'none',
        },
      }}
    >
      {title ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.25,
            px: 2.5,
            pt: 2,
            pb: 1,
          }}
        >
          {icon ? (
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: `${radius.sm}px`,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                flexShrink: 0,
              }}
            >
              {icon}
            </Box>
          ) : null}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              component="h2"
              sx={{
                fontSize: fontSize.lg,
                fontWeight: fontWeight.bold,
                lineHeight: 1.3,
                letterSpacing: '-0.01em',
                color: 'text.primary',
              }}
            >
              {title}
            </Typography>
            {subtitle ? (
              <Typography
                sx={{
                  mt: 0.25,
                  fontSize: fontSize.sm,
                  color: 'text.secondary',
                  lineHeight: 1.4,
                }}
              >
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {!disableClose ? (
            <IconButton
              size="small"
              onClick={onClose}
              aria-label="Закрыть"
              sx={{ color: 'text.secondary' }}
            >
              <Close fontSize="small" />
            </IconButton>
          ) : null}
        </Box>
      ) : null}
      <DialogContent sx={{ px: 2.5, pt: title ? 1 : 2, pb: actions ? 1 : 2, ...contentSx }}>
        {children}
      </DialogContent>
      {actions ? (
        <DialogActions sx={{ px: 2.5, pb: 2, pt: 1, gap: 0.75 }}>{actions}</DialogActions>
      ) : null}
    </Dialog>
  );
}

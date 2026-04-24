import { type ReactNode, useState } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { Add, ArrowDropDown } from '@mui/icons-material';
import { getSidebarPalette } from '@/theme/slackColors';
import { fontSize, fontWeight } from '@/lib/tokens';

type Props = {
  title: string;
  themeMode?: 'light' | 'dark';
  defaultOpen?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
};

export function SidebarSection({
  title,
  themeMode = 'dark',
  defaultOpen = true,
  onAdd,
  addLabel,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const palette = getSidebarPalette(themeMode);

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          height: 28,
          px: 1.25,
          mx: 1,
        }}
      >
        <Box
          role="button"
          tabIndex={0}
          onClick={() => setOpen((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen((prev) => !prev);
            }
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            flex: 1,
            minWidth: 0,
            cursor: 'pointer',
            userSelect: 'none',
            color: palette.sidebarTextMuted,
            '&:hover': { color: palette.sidebarTextHover },
          }}
        >
          <ArrowDropDown
            sx={{
              fontSize: 18,
              transition: 'transform 120ms ease',
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
              flexShrink: 0,
            }}
          />
          <Typography
            component="span"
            sx={{
              fontSize: fontSize.sm,
              fontWeight: fontWeight.medium,
              lineHeight: 1,
              letterSpacing: '0.02em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </Typography>
        </Box>
        {onAdd ? (
          <IconButton
            aria-label={addLabel || 'Добавить'}
            onClick={onAdd}
            sx={{
              width: { xs: 30, sm: 20 },
              height: { xs: 30, sm: 20 },
              mr: { xs: -0.25, sm: 0 },
              color: palette.sidebarTextMuted,
              '&:hover': { color: palette.sidebarTextHover, bgcolor: palette.sidebarHoverBg },
            }}
          >
            <Add sx={{ fontSize: { xs: 20, sm: 16 } }} />
          </IconButton>
        ) : null}
      </Box>
      {open ? <Box>{children}</Box> : null}
    </Box>
  );
}

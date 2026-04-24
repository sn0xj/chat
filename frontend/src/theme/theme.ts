import { createTheme, alpha } from '@mui/material/styles';
import { SLACK } from './slackColors';
import { fontSize, fontWeight, lineHeight, radius } from '@/lib/tokens';

export type AppThemeMode = 'light' | 'dark';

export function createAppTheme(mode: AppThemeMode) {
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: SLACK.primary,
        dark: SLACK.primaryHover,
        contrastText: '#ffffff',
      },
      secondary: {
        main: SLACK.primary,
      },
      success: { main: SLACK.success },
      error: { main: SLACK.error },
      warning: { main: SLACK.warning },
      background: {
        default: isDark ? SLACK.canvasDark : SLACK.canvasLight,
        paper: isDark ? SLACK.paperDark : SLACK.paperLight,
      },
      divider: isDark ? SLACK.dividerDark : SLACK.dividerLight,
      text: {
        primary: isDark ? SLACK.textDarkPrimary : SLACK.textLightPrimary,
        secondary: isDark ? SLACK.textDarkSecondary : SLACK.textLightSecondary,
      },
      action: {
        hover: isDark ? SLACK.rowHoverDark : SLACK.rowHoverLight,
        selected: isDark
          ? alpha(SLACK.primary, 0.2)
          : alpha(SLACK.primary, 0.08),
      },
    },
    shape: { borderRadius: radius.md },
    typography: {
      fontFamily: [
        '"Inter"',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        'sans-serif',
      ].join(','),
      fontSize: fontSize.md,
      h5: {
        fontWeight: fontWeight.bold,
        letterSpacing: '-0.02em',
        fontSize: fontSize.xl,
        lineHeight: lineHeight.tight,
      },
      h6: {
        fontWeight: fontWeight.bold,
        letterSpacing: '-0.01em',
        fontSize: fontSize.lg,
        lineHeight: lineHeight.tight,
      },
      subtitle1: {
        fontWeight: fontWeight.bold,
        fontSize: fontSize.md,
        lineHeight: lineHeight.tight,
      },
      subtitle2: {
        fontWeight: fontWeight.bold,
        fontSize: fontSize.sm,
        lineHeight: lineHeight.tight,
      },
      body1: {
        fontSize: fontSize.md,
        lineHeight: lineHeight.body,
      },
      body2: {
        fontSize: fontSize.sm,
        lineHeight: lineHeight.body,
      },
      caption: {
        fontSize: fontSize.xs,
        lineHeight: lineHeight.body,
        letterSpacing: '0.01em',
      },
      button: {
        fontWeight: fontWeight.bold,
        fontSize: fontSize.sm,
        letterSpacing: '0.01em',
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            margin: 0,
          },
          '*::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.14)'
              : 'rgba(29,28,29,0.18)',
            borderRadius: 8,
          },
          '*::-webkit-scrollbar-track': {
            backgroundColor: 'transparent',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: radius.md,
            fontWeight: fontWeight.bold,
            transition: 'background-color 160ms ease',
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: radius.sm },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: radius.md,
            border: '1px solid',
            borderColor: isDark ? SLACK.dividerDark : SLACK.dividerLight,
            backgroundImage: 'none',
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontWeight: fontWeight.bold,
            letterSpacing: '-0.01em',
            fontSize: fontSize.lg,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: radius.md,
            border: '1px solid',
            borderColor: isDark ? SLACK.dividerDark : SLACK.dividerLight,
            backgroundImage: 'none',
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: radius.sm,
            margin: '2px 6px',
            minHeight: 34,
            fontSize: fontSize.sm,
          },
        },
      },
      MuiTextField: {
        defaultProps: { variant: 'outlined', size: 'small' },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: radius.md,
            fontSize: fontSize.md,
          },
        },
      },
      MuiFilledInput: {
        styleOverrides: {
          root: {
            borderRadius: radius.md,
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(29,28,29,0.04)',
            '&:hover': {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(29,28,29,0.06)',
            },
            '&.Mui-focused': {
              backgroundColor: isDark
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(29,28,29,0.06)',
            },
            '&:before, &:after': { display: 'none' },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { height: 2, borderRadius: 0 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: fontWeight.bold,
            fontSize: fontSize.sm,
            minHeight: 40,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: radius.sm,
            transition: 'background-color 140ms ease',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: fontWeight.medium,
            borderRadius: radius.sm,
            fontSize: fontSize.xs,
          },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            fontWeight: fontWeight.bold,
            fontSize: fontSize.sm,
            borderRadius: radius.sm,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: radius.xs,
            fontSize: fontSize.xs,
            fontWeight: fontWeight.medium,
            backgroundColor: isDark ? '#000' : '#1d1c1d',
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: {
            borderColor: isDark ? SLACK.dividerDark : SLACK.dividerLight,
          },
        },
      },
    },
  });
}

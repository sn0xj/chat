import { useState } from 'react';
import { Box, IconButton, Stack, Tooltip, useMediaQuery } from '@mui/material';
import {
  KeyboardArrowDownRounded,
  KeyboardArrowUpRounded,
  CallEndRounded,
  ChatBubbleOutline,
  MicRounded,
  MicOffRounded,
  PersonAddRounded,
  ScreenShareRounded,
  StopScreenShareRounded,
  VideocamRounded,
  VideocamOffRounded,
} from '@mui/icons-material';

type Props = {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  canShare: boolean;
  canToggleMic: boolean;
  canToggleCamera: boolean;
  chatOpen?: boolean;
  onToggleChat?: (() => void) | null;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
  onInvite: () => void;
};

type ToolbarSize = 'compact' | 'regular';

type ToolbarTokens = {
  btnSize: number;
  iconSize: number;
  gap: string;
  px: string;
  py: string;
};

const TOKENS: Record<ToolbarSize, ToolbarTokens> = {
  compact: { btnSize: 44, iconSize: 20, gap: '8px', px: '10px', py: '8px' },
  regular: { btnSize: 48, iconSize: 24, gap: '12px', px: '16px', py: '12px' },
};

// Визуал взят 1:1 из `vks/client/styles.css` (`.control-bar` / `.control-btn`):
// фиксированный тёмный pill-таблет с blur'ом, внутри — круглые кнопки
// с полупрозрачной белой обводкой и красной «трубкой» для выхода.
function buildBarSx(t: ToolbarTokens) {
  return {
    position: 'absolute',
    left: '50%',
    bottom: 0,
    transform: 'translate3d(-50%, 0, 0)',
    display: 'flex',
    alignItems: 'center',
    gap: t.gap,
    px: t.px,
    py: t.py,
    borderRadius: '999px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    bgcolor: 'rgba(10, 12, 19, 0.94)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55)',
    zIndex: 20,
    pointerEvents: 'auto',
    userSelect: 'none',
    touchAction: 'manipulation',
    maxWidth: 'calc(100vw - 16px)',
  } as const;
}

function buildBaseBtnSx(t: ToolbarTokens) {
  return {
    width: t.btnSize,
    height: t.btnSize,
    borderRadius: '999px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    bgcolor: 'rgba(26, 34, 50, 0.98)',
    color: '#fff',
    flex: '0 0 auto',
    '& svg': { fontSize: t.iconSize },
    '&:hover': { bgcolor: 'rgba(38, 48, 68, 0.98)' },
    '&.Mui-disabled': { opacity: 0.45, color: '#fff' },
  } as const;
}

function buildDangerBtnSx(t: ToolbarTokens) {
  return {
    ...buildBaseBtnSx(t),
    bgcolor: 'rgba(185, 28, 28, 0.98)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    '&:hover': { bgcolor: 'rgba(153, 27, 27, 0.98)' },
  } as const;
}

export function CallToolbar({
  micEnabled,
  cameraEnabled,
  screenSharing,
  canShare,
  canToggleMic,
  canToggleCamera,
  chatOpen = false,
  onToggleChat = null,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onLeave,
  onInvite,
}: Props) {
  // На узких экранах (мобильные в портрете, узкие окна) переходим на 40px
  // кнопки и меньший gap — 5–6 кнопок с запасом помещаются на 360 px ширины.
  const isCompact = useMediaQuery('(max-width: 520px)');
  const tokens = TOKENS[isCompact ? 'compact' : 'regular'];
  const barSx = buildBarSx(tokens);
  const baseBtnSx = buildBaseBtnSx(tokens);
  const dangerBtnSx = buildDangerBtnSx(tokens);
  const [isToolbarOpen, setIsToolbarOpen] = useState(() => isCompact);

  return (
    <Box
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: `calc(${tokens.btnSize + 34}px + env(safe-area-inset-bottom))`,
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'auto',
        }}
      >
        <Tooltip title={isToolbarOpen ? 'Скрыть управление' : 'Открыть управление'} placement="top">
          <Box
            component="button"
            onClick={() => setIsToolbarOpen((prev) => !prev)}
            aria-label={isToolbarOpen ? 'Скрыть управление' : 'Открыть управление'}
            aria-expanded={isToolbarOpen}
            sx={{
              display: { xs: 'none', md: 'inline-flex' },
              position: 'absolute',
              left: '50%',
              bottom: 'max(8px, env(safe-area-inset-bottom))',
              transform: 'translate3d(-50%, 0, 0)',
              alignItems: 'center',
              gap: '6px',
              px: isCompact ? '10px' : '12px',
              py: '6px',
              borderRadius: '999px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              bgcolor: 'rgba(10, 12, 19, 0.78)',
              color: '#fff',
              fontSize: isCompact ? 12 : 13,
              fontFamily: 'inherit',
              cursor: 'pointer',
              zIndex: 21,
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
              '&:hover': { bgcolor: 'rgba(10, 12, 19, 0.9)' },
            }}
          >
            {isToolbarOpen ? <KeyboardArrowDownRounded fontSize="small" /> : <KeyboardArrowUpRounded fontSize="small" />}
            {isToolbarOpen ? 'Скрыть' : 'Открыть'}
          </Box>
        </Tooltip>
        <Box
          className="call-toolbar-float"
          sx={{
            ...barSx,
            bottom: 'calc(max(16px, env(safe-area-inset-bottom)) + 34px)',
            opacity: isToolbarOpen ? 1 : 0,
            transform: isToolbarOpen ? 'translate3d(-50%, 0, 0)' : 'translate3d(-50%, 12px, 0)',
            transition: 'opacity 180ms ease, transform 180ms ease',
            pointerEvents: isToolbarOpen ? 'auto' : 'none',
          }}
        >
          <Stack direction="row" spacing={tokens.gap} alignItems="center">
            <Tooltip title="Пригласить" placement="top">
              <span>
                <IconButton aria-label="Пригласить" onClick={onInvite} sx={baseBtnSx}>
                  <PersonAddRounded />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip
              title={screenSharing ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
              placement="top"
            >
              <span>
                <IconButton
                  aria-label={screenSharing ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
                  aria-pressed={screenSharing}
                  onClick={onToggleScreenShare}
                  disabled={!canShare}
                  sx={baseBtnSx}
                >
                  {screenSharing ? <StopScreenShareRounded /> : <ScreenShareRounded />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={micEnabled ? 'Выключить микрофон' : 'Включить микрофон'} placement="top">
              <span>
                <IconButton
                  aria-label={micEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
                  aria-pressed={micEnabled}
                  onClick={onToggleMic}
                  disabled={!canToggleMic}
                  sx={baseBtnSx}
                >
                  {micEnabled ? <MicRounded /> : <MicOffRounded />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={cameraEnabled ? 'Выключить камеру' : 'Включить камеру'} placement="top">
              <span>
                <IconButton
                  aria-label={cameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
                  aria-pressed={cameraEnabled}
                  onClick={onToggleCamera}
                  disabled={!canToggleCamera}
                  sx={baseBtnSx}
                >
                  {cameraEnabled ? <VideocamRounded /> : <VideocamOffRounded />}
                </IconButton>
              </span>
            </Tooltip>
            {onToggleChat ? (
              <Tooltip title={chatOpen ? 'Скрыть чат' : 'Открыть чат встречи'} placement="top">
                <span>
                  <IconButton
                    aria-label={chatOpen ? 'Скрыть чат встречи' : 'Открыть чат встречи'}
                    aria-pressed={chatOpen}
                    onClick={onToggleChat}
                    sx={baseBtnSx}
                  >
                    <ChatBubbleOutline />
                  </IconButton>
                </span>
              </Tooltip>
            ) : null}
            <Tooltip title="Выйти из звонка" placement="top">
              <span>
                <IconButton aria-label="Выйти из звонка" onClick={onLeave} sx={dangerBtnSx}>
                  <CallEndRounded />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}

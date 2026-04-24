import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  GroupRounded,
  ErrorOutlineRounded,
  RefreshRounded,
} from '@mui/icons-material';
import { useChatStore } from '@/store/chat-store';
import { radius, shadow, space } from '@/lib/tokens';
import { createGuestCallLinkToken } from '@/features/calls/api/callSessions';
import { buildGuestCallUrl } from '@/features/calls/utils/guestLink';
import { useCallStore } from '../store/call-store';
import type { CallEngineOptions } from '../engine/types';
import { PrejoinPanel } from './PrejoinPanel';
import { ParticipantsGrid } from './ParticipantsGrid';
import { CallToolbar } from './CallToolbar';
import { ParticipantsPopover } from './ParticipantsPopover';

export type CallRoomProps = {
  roomId: string;
  onClose: () => void;
  guestName?: string | null;
  autoJoin?: boolean;
  onOpenInviteUsers?: (() => void) | null;
  onToggleInCallChat?: (() => void) | null;
  inCallChatOpen?: boolean;
  inCallChatEnabled?: boolean;
  initialMic?: boolean;
  initialCamera?: boolean;
};

function resolveApiBaseUrl(): string {
  const enforceTls = import.meta.env.VITE_REQUIRE_TLS !== 'false';
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  const runtimeBaseUrl = `${protocol}://${window.location.hostname}:3025`;
  const envBaseUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (!envBaseUrl) return runtimeBaseUrl;
  try {
    const envUrl = new URL(envBaseUrl);
    const isEnvLocalhost = envUrl.hostname === 'localhost' || envUrl.hostname === '127.0.0.1';
    const isRuntimeLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isEnvLocalhost && !isRuntimeLocalhost) return runtimeBaseUrl;
  } catch {
    return runtimeBaseUrl;
  }
  if (enforceTls) {
    try {
      const resolved = new URL(envBaseUrl);
      if (window.location.protocol === 'https:' && resolved.protocol !== 'https:') {
        return runtimeBaseUrl;
      }
    } catch {
      return runtimeBaseUrl;
    }
  }
  return envBaseUrl;
}

function buildShareUrl(roomId: string): string {
  return `${window.location.origin}/guest-call?roomId=${encodeURIComponent(roomId)}`;
}

async function copyToClipboard(text: string, onFallback: (value: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    onFallback(text);
  }
}

export function CallRoom({
  roomId,
  onClose,
  guestName = null,
  autoJoin = true,
  onOpenInviteUsers = null,
  onToggleInCallChat = null,
  inCallChatOpen = false,
  inCallChatEnabled = false,
  initialMic = true,
  initialCamera = true,
}: CallRoomProps) {
  const theme = useTheme();
  const token = useChatStore((s) => s.token);
  const currentUser = useChatStore((s) => s.user);
  const chats = useChatStore((s) => s.chats);

  const connectionState = useCallStore((s) => s.connectionState);
  const participants = useCallStore((s) => s.participants);
  const localMedia = useCallStore((s) => s.localMedia);
  const peerLabels = useCallStore((s) => s.peerLabels);
  const activeSpeaker = useCallStore((s) => s.activeSpeaker);
  const activeSpeakers = useCallStore((s) => s.activeSpeakers);
  const lastError = useCallStore((s) => s.lastError);
  const kickedByPeer = useCallStore((s) => s.kickedByPeer);
  const initEngine = useCallStore((s) => s.initEngine);
  const startCall = useCallStore((s) => s.start);
  const leaveCall = useCallStore((s) => s.leave);
  const disposeEngine = useCallStore((s) => s.disposeEngine);
  const toggleMic = useCallStore((s) => s.toggleMic);
  const toggleCamera = useCallStore((s) => s.toggleCamera);
  const toggleScreenShare = useCallStore((s) => s.toggleScreenShare);
  const kickPeer = useCallStore((s) => s.kickPeer);
  const clearError = useCallStore((s) => s.clearError);

  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null);
  const [clipboardFallbackValue, setClipboardFallbackValue] = useState<string | null>(null);
  const [guestInviteToken, setGuestInviteToken] = useState<string | null>(null);
  const isNarrow = useMediaQuery('(max-width: 600px)');

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const isJoined = connectionState === 'joined';
  const isConnecting = connectionState === 'connecting';
  const isLeaving = connectionState === 'leaving';
  const hasError = connectionState === 'error';

  // Init engine once per (roomId, token, guestName, initial prefs) tuple.
  const engineOptions = useMemo<CallEngineOptions>(
    () => ({
      roomId,
      baseUrl: resolveApiBaseUrl(),
      authToken: token,
      guestName,
      initialMic,
      initialCamera,
    }),
    [roomId, token, guestName, initialMic, initialCamera],
  );

  const pendingDisposeRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingDisposeRef.current !== null) {
      window.clearTimeout(pendingDisposeRef.current);
      pendingDisposeRef.current = null;
    }
    initEngine(engineOptions);
    return () => {
      // In React StrictMode the effect is intentionally mount → cleanup → mount.
      // Disposing synchronously kills the signaling socket that's still negotiating,
      // so defer it and let the next mount cancel the teardown if the component
      // is coming right back.
      if (pendingDisposeRef.current !== null) {
        window.clearTimeout(pendingDisposeRef.current);
      }
      pendingDisposeRef.current = window.setTimeout(() => {
        pendingDisposeRef.current = null;
        void disposeEngine();
      }, 80);
    };
  }, [engineOptions, initEngine, disposeEngine]);

  // Auto-join on mount.
  useEffect(() => {
    if (!autoJoin) return;
    // Re-read current state from the store — under StrictMode the closed-over
    // `connectionState` is still "idle" on both mount passes and would cause a
    // duplicate start().
    const live = useCallStore.getState().connectionState;
    if (live !== 'idle') return;
    void startCall();
  }, [autoJoin, connectionState, startCall]);

  // Close dialog when the call is left (either locally or kicked).
  useEffect(() => {
    if (connectionState === 'left') {
      closeRef.current();
    }
  }, [connectionState]);

  useEffect(() => {
    if (kickedByPeer) {
      closeRef.current();
    }
  }, [kickedByPeer]);

  const myPeerId = useMemo(() => {
    for (const [id, label] of peerLabels.entries()) {
      if (label.isLocal) return id;
    }
    return 'local';
  }, [peerLabels]);

  const localDisplayName =
    currentUser?.username?.trim() ||
    (guestName ?? '').trim() ||
    peerLabels.get(myPeerId)?.displayName ||
    'Вы';

  const canToggleMic = Boolean(localMedia.stream?.getAudioTracks()[0]);
  const canToggleCamera = Boolean(localMedia.stream?.getVideoTracks()[0]);
  const canShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function' && isJoined;

  const shareUrl = useMemo(
    () => (guestInviteToken ? buildGuestCallUrl(guestInviteToken) : buildShareUrl(roomId)),
    [guestInviteToken, roomId],
  );

  const handleCopyInvite = useCallback(async () => {
    if (token) {
      try {
        const { token: generatedToken } = await createGuestCallLinkToken(Number(roomId));
        setGuestInviteToken(generatedToken);
        await copyToClipboard(buildGuestCallUrl(generatedToken), setClipboardFallbackValue);
        return;
      } catch {
        // fallback to legacy roomId link below
      }
    }
    await copyToClipboard(shareUrl, setClipboardFallbackValue);
  }, [shareUrl, token, roomId]);

  const handleLeave = useCallback(() => {
    // Close the dialog immediately — the engine tears itself down in the
    // background and the remote side is notified via `leaveRoom` emit.
    closeRef.current();
    void leaveCall();
  }, [leaveCall]);

  const handleJoinClick = useCallback(() => {
    void startCall();
  }, [startCall]);

  const handleRetry = useCallback(() => {
    clearError();
    void startCall();
  }, [clearError, startCall]);

  const handleInviteClick = useCallback(() => {
    if (onOpenInviteUsers) onOpenInviteUsers();
    else void handleCopyInvite();
  }, [onOpenInviteUsers, handleCopyInvite]);

  const remoteParticipants = useMemo(
    () => participants.filter((p) => p.peerId !== myPeerId),
    [participants, myPeerId],
  );
  const canKickParticipants = useMemo(() => {
    const chatId = Number(roomId);
    if (!Number.isFinite(chatId) || !currentUser) return false;
    const linkedChat = chats.find((chat) => chat.id === chatId);
    if (!linkedChat || (linkedChat.type !== 'group' && linkedChat.type !== 'meeting')) return false;
    const myRole = linkedChat.members.find((member) => member.id === currentUser.id)?.role;
    return myRole === 'owner' || myRole === 'admin';
  }, [roomId, currentUser, chats]);

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        bgcolor: 'background.default',
        overflow: 'hidden',
      }}
    >
      {!isJoined ? (
        isLeaving || connectionState === 'left' ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              bgcolor: 'background.default',
              zIndex: 10,
            }}
          />
        ) : hasError ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'background.default',
              zIndex: 10,
              p: `${space.md}px`,
            }}
          >
            <Stack
              spacing={`${space.md}px`}
              alignItems="center"
              sx={{
                width: '100%',
                maxWidth: 440,
                textAlign: 'center',
                p: { xs: `${space.md}px`, sm: `${space.lg}px` },
                borderRadius: `${radius.lg}px`,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                boxShadow: shadow.md,
              }}
            >
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha(theme.palette.error.main, 0.12),
                  color: 'error.main',
                }}
              >
                <ErrorOutlineRounded sx={{ fontSize: 32 }} />
              </Box>
              <Typography sx={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}>
                Не удалось подключиться
              </Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                {lastError ||
                  'Проверьте доступ к микрофону и камере, а также подключение к интернету, и попробуйте ещё раз.'}
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={`${space.sm}px`}
                sx={{ width: '100%' }}
              >
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<RefreshRounded />}
                  onClick={handleRetry}
                  disabled={isConnecting}
                >
                  Повторить
                </Button>
                <Button fullWidth variant="outlined" onClick={onClose}>
                  Закрыть
                </Button>
              </Stack>
            </Stack>
          </Box>
        ) : autoJoin ? (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: `${space.md}px`,
              bgcolor: 'background.default',
              zIndex: 10,
            }}
          >
            <Box
              sx={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(theme.palette.text.primary, 0.05),
                border: '1px solid',
                borderColor: alpha(theme.palette.text.primary, 0.12),
              }}
            >
              <CircularProgress size={32} thickness={4} />
            </Box>
            <Typography sx={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}>
              Подключаемся к звонку…
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Разрешите доступ к микрофону и камере в браузере
            </Typography>
          </Box>
        ) : (
          <PrejoinPanel
            roomId={roomId}
            connecting={isConnecting}
            onJoin={handleJoinClick}
            onCopyInvite={handleCopyInvite}
          />
        )
      ) : (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'row',
            // Отступы с учётом safe-area (notch/home-bar на мобильных) и
            // компактные значения на узких экранах, чтобы плитки получили
            // максимум полезной площади.
            pt: `calc(${isNarrow ? space.xs : space.sm}px + env(safe-area-inset-top))`,
            // Резервируем место под нижнюю панель управления и её кнопку
            // переключения, чтобы панель не перекрывала плитки камер.
            pb: `calc(${isNarrow ? 88 : 104}px + env(safe-area-inset-bottom))`,
            pl: `calc(${isNarrow ? space.xs : space.sm}px + env(safe-area-inset-left))`,
            pr: `calc(${isNarrow ? space.xs : space.sm}px + env(safe-area-inset-right))`,
            gap: `${space.md}px`,
          }}
        >
          <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
            {/* Participant count badge (top-left) */}
            <Tooltip title="Список участников" placement="right">
              <Box
                component="button"
                onClick={(e) => setPopoverAnchor(e.currentTarget as HTMLElement)}
                sx={{
                  position: 'absolute',
                  top: isNarrow ? 6 : 12,
                  left: isNarrow ? 6 : 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: `${space.xs}px`,
                  px: isNarrow ? `${space.xs}px` : `${space.sm}px`,
                  py: `${space.xs}px`,
                  borderRadius: `${radius.pill}px`,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: alpha(theme.palette.background.paper, 0.9),
                  color: 'text.primary',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: isNarrow ? 12 : 13,
                  zIndex: 15,
                  boxShadow: shadow.sm,
                  '&:hover': { bgcolor: 'background.paper' },
                }}
                aria-label={`Участников: ${remoteParticipants.length + 1}`}
              >
                <GroupRounded sx={{ fontSize: isNarrow ? 16 : 18 }} />
                <span>{remoteParticipants.length + 1}</span>
              </Box>
            </Tooltip>
            <ParticipantsGrid
              local={{
                peerId: myPeerId,
                displayName: localDisplayName,
                stream: localMedia.stream,
                screenStream: localMedia.screenStream,
                micEnabled: localMedia.micEnabled,
                cameraEnabled: localMedia.cameraEnabled,
                screenSharing: localMedia.screenSharing,
              }}
              remotes={remoteParticipants}
              activeSpeakerPeerId={activeSpeaker}
              activeSpeakerPeerIds={activeSpeakers}
            />
          </Box>
        </Box>
      )}

      {isJoined ? (
        <CallToolbar
          micEnabled={localMedia.micEnabled}
          cameraEnabled={localMedia.cameraEnabled}
          screenSharing={localMedia.screenSharing}
          canShare={canShare}
          canToggleMic={canToggleMic && !isLeaving}
          canToggleCamera={canToggleCamera && !isLeaving}
          chatOpen={inCallChatOpen}
          onToggleChat={inCallChatEnabled && onToggleInCallChat ? onToggleInCallChat : null}
          onToggleMic={toggleMic}
          onToggleCamera={() => void toggleCamera()}
          onToggleScreenShare={() => void toggleScreenShare()}
          onLeave={() => handleLeave()}
          onInvite={handleInviteClick}
        />
      ) : null}

      <ParticipantsPopover
        anchorEl={popoverAnchor}
        onClose={() => setPopoverAnchor(null)}
        local={{
          displayName: localDisplayName,
          micEnabled: localMedia.micEnabled,
          cameraEnabled: localMedia.cameraEnabled,
        }}
        remotes={remoteParticipants}
        onKick={canKickParticipants ? (peerId) => void kickPeer(peerId) : undefined}
      />

      <Dialog open={Boolean(lastError)} onClose={clearError} fullWidth maxWidth="xs">
        <DialogTitle>Ошибка подключения</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {lastError}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={clearError}>Закрыть</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(clipboardFallbackValue)}
        onClose={() => setClipboardFallbackValue(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Ссылка для приглашения</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
            Не получилось скопировать автоматически. Скопируйте ссылку вручную:
          </Typography>
          <TextField value={clipboardFallbackValue || ''} fullWidth size="small" InputProps={{ readOnly: true }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClipboardFallbackValue(null)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}


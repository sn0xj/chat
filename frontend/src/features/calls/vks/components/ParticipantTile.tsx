import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Box, IconButton, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  FullscreenRounded,
  FullscreenExitRounded,
  MicRounded,
  MicOffRounded,
  VideocamRounded,
  VideocamOffRounded,
} from '@mui/icons-material';
import type { RemoteParticipant } from '../engine/types';
import { selectVideoTracks } from '../engine/select-video-tracks';
import { useVideoTrack } from '../hooks/useVideoTrack';
import { getAvatarColor, getAvatarInitial } from '@/lib/avatarColor';
import { radius, space } from '@/lib/tokens';

type LocalProps = {
  kind: 'local';
  displayName: string;
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  speakingState: 'none' | 'primary' | 'secondary';
};

type RemoteProps = {
  kind: 'remote';
  participant: RemoteParticipant;
  speakingState: 'none' | 'primary' | 'secondary';
};

type Props = LocalProps | RemoteProps;

type SizeBucket = 'tiny' | 'small' | 'normal';

function pickSizeBucket(width: number): SizeBucket {
  if (width < 240) return 'tiny';
  if (width < 420) return 'small';
  return 'normal';
}

export function ParticipantTile(props: Props) {
  const tileRef = useRef<HTMLDivElement | null>(null);
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sizeBucket, setSizeBucket] = useState<SizeBucket>('normal');

  // Observe the tile's own width so we can tone down chrome (badges, PiP,
  // fullscreen button) when the grid shrinks it instead of tying decisions
  // to the viewport — what matters is the tile size, not the screen.
  useEffect(() => {
    const el = tileRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      setSizeBucket(pickSizeBucket(el.clientWidth));
      return;
    }
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      setSizeBucket((prev) => {
        const next = pickSizeBucket(w);
        return next === prev ? prev : next;
      });
    });
    obs.observe(el);
    setSizeBucket(pickSizeBucket(el.clientWidth));
    return () => obs.disconnect();
  }, []);

  const isLocal = props.kind === 'local';
  const isPrimarySpeaking = props.speakingState === 'primary';
  const isSecondarySpeaking = props.speakingState === 'secondary';

  const { mainTrack, pipTrack, displayName, micEnabled, cameraEnabled, isScreenShareLayout } =
    useMemo(() => {
      if (props.kind === 'local') {
        const cameraTrack = props.stream?.getVideoTracks()[0] ?? null;
        const screenTrack = props.screenStream?.getVideoTracks()[0] ?? null;
        return {
          mainTrack: props.screenSharing ? screenTrack : cameraTrack,
          pipTrack: props.screenSharing ? cameraTrack : null,
          displayName: props.displayName,
          micEnabled: props.micEnabled,
          cameraEnabled: props.cameraEnabled,
          isScreenShareLayout: props.screenSharing,
        };
      }
      const { participant } = props;
      const selection = selectVideoTracks(
        participant.stream,
        participant.media,
        participant.videoTrackOrder,
      );
      return {
        mainTrack: selection.mainTrack,
        pipTrack: selection.pipTrack,
        displayName: participant.displayName,
        micEnabled: participant.media.audioEnabled,
        cameraEnabled: participant.media.cameraEnabled,
        isScreenShareLayout: selection.isScreenShareLayout,
      };
    }, [props]);

  // When the camera is muted locally or the remote flags it as off, don't attach
  // the disabled track to <video> — it would render a black frame and hide the
  // FallbackAvatar. Screen share is always shown if present; PiP (which is the
  // camera when screen is the main view) is hidden together with the camera.
  const attachedMainTrack = isScreenShareLayout
    ? mainTrack
    : cameraEnabled
      ? mainTrack
      : null;
  const attachedPipTrack =
    isScreenShareLayout && cameraEnabled && sizeBucket !== 'tiny' ? pipTrack : null;
  useVideoTrack(mainVideoRef, attachedMainTrack);
  useVideoTrack(pipVideoRef, attachedPipTrack);

  useEffect(() => {
    if (props.kind !== 'remote') return;
    const el = remoteAudioRef.current;
    if (!el) return;
    const stream = props.participant.stream;
    if (!stream) {
      el.dataset.audioTrackIds = '';
      el.srcObject = null;
      return;
    }
    const nextAudioTrackIds = stream
      .getAudioTracks()
      .filter((track) => track.readyState === 'live')
      .map((track) => track.id)
      .sort()
      .join(',');
    const currentAudioTrackIds = el.dataset.audioTrackIds ?? '';
    if (currentAudioTrackIds === nextAudioTrackIds) return;
    el.dataset.audioTrackIds = nextAudioTrackIds;
    el.srcObject = nextAudioTrackIds ? stream : null;
    if (nextAudioTrackIds) {
      void el.play().catch(() => undefined);
    }
  }, [props]);

  const hasLiveVideo = Boolean(attachedMainTrack);

  const handleToggleFullscreen = async () => {
    const tile = tileRef.current;
    if (!tile) return;
    try {
      if (document.fullscreenElement === tile) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await tile.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      setIsFullscreen((prev) => !prev);
    }
  };

  const badgeFontSize = sizeBucket === 'tiny' ? 10 : sizeBucket === 'small' ? 11 : 12;
  const badgeIconSize = sizeBucket === 'tiny' ? 12 : sizeBucket === 'small' ? 13 : 14;
  const badgePx = sizeBucket === 'tiny' ? 6 : space.sm;
  const badgePy = sizeBucket === 'tiny' ? 2 : space.xs;
  const fsBtnSize = sizeBucket === 'tiny' ? 26 : sizeBucket === 'small' ? 30 : 34;
  const fsIconSize = sizeBucket === 'tiny' ? 14 : sizeBucket === 'small' ? 16 : 18;
  const avatarSize = sizeBucket === 'tiny' ? 48 : sizeBucket === 'small' ? 64 : 88;
  const showDisplayName = sizeBucket !== 'tiny';

  return (
    <Box
      ref={tileRef}
      component="article"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('[data-tile-control]')) return;
        void handleToggleFullscreen();
      }}
      sx={{
        position: 'relative',
        borderRadius: `${radius.lg}px`,
        overflow: 'hidden',
        bgcolor: 'grey.900',
        color: 'common.white',
        // Let the grid cell drive dimensions: the tile fills the cell and
        // uses object-fit on the <video> to stay pretty. A strict 16:9 forced
        // blank bars on narrow/portrait layouts.
        width: '100%',
        height: '100%',
        minHeight: 96,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '2px solid',
        borderColor: 'transparent',
        boxShadow: (t) =>
          isPrimarySpeaking
            ? `0 0 0 1px ${alpha(t.palette.common.black, t.palette.mode === 'dark' ? 0.65 : 0.35)}`
            : isSecondarySpeaking
              ? `0 0 0 1px ${alpha(t.palette.common.black, t.palette.mode === 'dark' ? 0.4 : 0.22)}`
            : 'none',
        transition: 'box-shadow 120ms ease-out',
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          borderRadius: `${radius.lg}px`,
          border: '3px solid',
          borderColor: (t) =>
            isPrimarySpeaking
              ? alpha(t.palette.success.main, t.palette.mode === 'dark' ? 0.98 : 0.95)
              : isSecondarySpeaking
                ? alpha(t.palette.success.main, t.palette.mode === 'dark' ? 0.65 : 0.58)
              : 'transparent',
          boxShadow: (t) =>
            isPrimarySpeaking
              ? `0 0 0 1px ${alpha(t.palette.common.black, t.palette.mode === 'dark' ? 0.7 : 0.4)}`
              : isSecondarySpeaking
                ? `0 0 0 1px ${alpha(t.palette.common.black, t.palette.mode === 'dark' ? 0.45 : 0.26)}`
              : 'none',
          transition: 'border-color 120ms ease-out, box-shadow 120ms ease-out',
          zIndex: 8,
        },
        '&:fullscreen': {
          borderRadius: 0,
        },
      }}
    >
      {!isLocal ? <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} /> : null}
      {hasLiveVideo ? (
        <Box
          component="video"
          ref={mainVideoRef}
          autoPlay
          playsInline
          muted={isLocal}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: 'black',
          }}
        />
      ) : (
        <FallbackAvatar name={displayName} size={avatarSize} showLabel={showDisplayName} />
      )}

      {attachedPipTrack ? (
        <Box
          component="video"
          ref={pipVideoRef}
          autoPlay
          playsInline
          muted
          sx={{
            position: 'absolute',
            right: sizeBucket === 'small' ? 8 : 12,
            bottom: sizeBucket === 'small' ? 8 : 12,
            width: sizeBucket === 'small' ? '28%' : '22%',
            maxWidth: sizeBucket === 'small' ? 120 : 180,
            minWidth: 72,
            aspectRatio: '16 / 9',
            objectFit: 'contain',
            borderRadius: `${radius.md}px`,
            border: (t) => `1px solid ${alpha(t.palette.common.white, 0.25)}`,
            bgcolor: 'black',
          }}
        />
      ) : null}

      <Stack
        direction="row"
        spacing={`${space.xs}px`}
        alignItems="center"
        sx={{
          position: 'absolute',
          top: sizeBucket === 'tiny' ? 6 : 10,
          left: sizeBucket === 'tiny' ? 6 : 12,
          px: `${badgePx}px`,
          py: `${badgePy}px`,
          borderRadius: `${radius.pill}px`,
          bgcolor: (t) => alpha(t.palette.common.black, 0.55),
          color: 'common.white',
          backdropFilter: 'blur(6px)',
          maxWidth: 'calc(100% - 64px)',
        }}
      >
        {showDisplayName ? (
          <Typography
            variant="caption"
            sx={{
              fontWeight: 500,
              fontSize: badgeFontSize,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {displayName}
          </Typography>
        ) : null}
        {micEnabled ? (
          <MicRounded sx={{ fontSize: badgeIconSize }} />
        ) : (
          <MicOffRounded sx={{ fontSize: badgeIconSize, color: 'error.light' }} />
        )}
        {cameraEnabled ? (
          <VideocamRounded sx={{ fontSize: badgeIconSize }} />
        ) : (
          <VideocamOffRounded sx={{ fontSize: badgeIconSize, color: 'error.light' }} />
        )}
      </Stack>

      <IconButton
        data-tile-control="fullscreen"
        aria-label={isFullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}
        onClick={handleToggleFullscreen}
        size="small"
        sx={{
          position: 'absolute',
          top: sizeBucket === 'tiny' ? 4 : 8,
          right: sizeBucket === 'tiny' ? 4 : 8,
          width: fsBtnSize,
          height: fsBtnSize,
          color: 'common.white',
          bgcolor: (t) => alpha(t.palette.common.black, 0.5),
          '&:hover': { bgcolor: (t) => alpha(t.palette.common.black, 0.75) },
        }}
      >
        {isFullscreen ? (
          <FullscreenExitRounded sx={{ fontSize: fsIconSize }} />
        ) : (
          <FullscreenRounded sx={{ fontSize: fsIconSize }} />
        )}
      </IconButton>
    </Box>
  );
}

function FallbackAvatar({
  name,
  size,
  showLabel,
}: {
  name: string;
  size: number;
  showLabel: boolean;
}) {
  const theme = useTheme();
  const bg = getAvatarColor(name);
  const initial = getAvatarInitial(name);
  return (
    <Stack
      spacing={`${space.sm}px`}
      alignItems="center"
      justifyContent="center"
      sx={{ width: '100%', height: '100%', px: `${space.sm}px` }}
    >
      <Avatar
        sx={{
          width: size,
          height: size,
          bgcolor: bg,
          color: theme.palette.getContrastText(bg),
          fontSize: Math.round(size * 0.42),
          fontWeight: 600,
        }}
      >
        {initial || '?'}
      </Avatar>
      {showLabel ? (
        <Typography
          variant="body2"
          sx={{
            color: 'common.white',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
            textAlign: 'center',
          }}
        >
          {name}
        </Typography>
      ) : null}
    </Stack>
  );
}

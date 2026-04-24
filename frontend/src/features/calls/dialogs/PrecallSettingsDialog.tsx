import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Typography,
  CircularProgress,
  useMediaQuery,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Close,
  Mic,
  MicOff,
  Videocam,
  VideocamOff,
  CallRounded,
} from '@mui/icons-material';

const PREF_AUDIO_KEY = 'call.preferredAudioInputId';
const PREF_VIDEO_KEY = 'call.preferredVideoInputId';

export type PrecallConfirmPayload = {
  micEnabled: boolean;
  camEnabled: boolean;
  audioInputId: string | null;
  videoInputId: string | null;
};

type Props = {
  open: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onConfirm: (payload: PrecallConfirmPayload) => void;
};

type DeviceInfo = {
  deviceId: string;
  label: string;
};

function readStoredDeviceId(key: string): string | null {
  try {
    const value = window.localStorage?.getItem(key);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function writeStoredDeviceId(key: string, value: string | null) {
  try {
    if (value) {
      window.localStorage?.setItem(key, value);
    } else {
      window.localStorage?.removeItem(key);
    }
  } catch {
    // best-effort
  }
}

export function PrecallSettingsDialog({
  open,
  title = 'Настройки подключения',
  subtitle = 'Проверьте микрофон и камеру перед тем, как присоединиться',
  onClose,
  onConfirm,
}: Props) {
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [audioInputs, setAudioInputs] = useState<DeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<DeviceInfo[]>([]);
  const [audioInputId, setAudioInputId] = useState<string | null>(null);
  const [videoInputId, setVideoInputId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // noop
        }
      }
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics: DeviceInfo[] = [];
      const cams: DeviceInfo[] = [];
      devices.forEach((d, idx) => {
        if (d.kind === 'audioinput') {
          mics.push({ deviceId: d.deviceId, label: d.label || `Микрофон ${idx + 1}` });
        } else if (d.kind === 'videoinput') {
          cams.push({ deviceId: d.deviceId, label: d.label || `Камера ${idx + 1}` });
        }
      });
      if (!mountedRef.current) return;
      setAudioInputs(mics);
      setVideoInputs(cams);
    } catch {
      // ignore — will fall back to defaults
    }
  }, []);

  const startPreview = useCallback(
    async (nextMicEnabled: boolean, nextCamEnabled: boolean, nextAudioId: string | null, nextVideoId: string | null) => {
      stopStream();
      if (!nextMicEnabled && !nextCamEnabled) {
        return;
      }
      setBusy(true);
      try {
        const audio = nextMicEnabled
          ? nextAudioId
            ? { deviceId: { ideal: nextAudioId } }
            : true
          : false;
        const video = nextCamEnabled
          ? nextVideoId
            ? { deviceId: { ideal: nextVideoId } }
            : true
          : false;
        const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
        if (!mountedRef.current) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setError(null);
        // Re-run enumerate devices to pick up labels that only appear after permission is granted.
        void refreshDevices();
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Не удалось получить доступ к устройствам';
        setError(message);
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [stopStream, refreshDevices],
  );

  useEffect(() => {
    if (!open) {
      stopStream();
      setError(null);
      return;
    }
    const initialAudio = readStoredDeviceId(PREF_AUDIO_KEY);
    const initialVideo = readStoredDeviceId(PREF_VIDEO_KEY);
    setAudioInputId(initialAudio);
    setVideoInputId(initialVideo);
    setMicEnabled(true);
    setCamEnabled(true);
    void refreshDevices();
    void startPreview(true, true, initialAudio, initialVideo);
    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleMic = () => {
    const next = !micEnabled;
    setMicEnabled(next);
    void startPreview(next, camEnabled, audioInputId, videoInputId);
  };

  const toggleCam = () => {
    const next = !camEnabled;
    setCamEnabled(next);
    void startPreview(micEnabled, next, audioInputId, videoInputId);
  };

  const handleAudioChange = (id: string) => {
    setAudioInputId(id || null);
    void startPreview(micEnabled, camEnabled, id || null, videoInputId);
  };

  const handleVideoChange = (id: string) => {
    setVideoInputId(id || null);
    void startPreview(micEnabled, camEnabled, audioInputId, id || null);
  };

  const confirm = () => {
    writeStoredDeviceId(PREF_AUDIO_KEY, audioInputId);
    writeStoredDeviceId(PREF_VIDEO_KEY, videoInputId);
    // Release the preview devices immediately so the VKS client can acquire them.
    stopStream();
    onConfirm({
      micEnabled,
      camEnabled,
      audioInputId,
      videoInputId,
    });
  };

  const selectedAudioValue = useMemo(() => {
    if (!audioInputId) return '';
    return audioInputs.find((d) => d.deviceId === audioInputId) ? audioInputId : '';
  }, [audioInputId, audioInputs]);

  const selectedVideoValue = useMemo(() => {
    if (!videoInputId) return '';
    return videoInputs.find((d) => d.deviceId === videoInputId) ? videoInputId : '';
  }, [videoInputId, videoInputs]);

  const isMobile = useMediaQuery('(max-width: 600px)');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          pt: 2.25,
          px: 2.25,
          pb: 1,
        }}
      >
        <Box>
          <Typography variant="h6" fontWeight={800} letterSpacing="-0.02em" lineHeight={1.2}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ px: 2.25, py: 2 }}>
        <Box
          sx={(t) => ({
            position: 'relative',
            width: '100%',
            aspectRatio: '16 / 9',
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: t.palette.mode === 'dark' ? '#0b1020' : '#0f172a',
            mb: 2,
          })}
        >
          {camEnabled ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)',
                display: 'block',
              }}
            />
          ) : (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.7)',
                gap: 1,
              }}
            >
              <VideocamOff sx={{ fontSize: 40 }} />
              <Typography variant="body2">Камера выключена</Typography>
            </Box>
          )}
          {busy && camEnabled ? (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'rgba(0,0,0,0.3)',
              }}
            >
              <CircularProgress size={28} sx={{ color: '#fff' }} />
            </Box>
          ) : null}
          <Stack
            direction="row"
            spacing={1}
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 12,
              justifyContent: 'center',
            }}
          >
            <IconButton
              onClick={toggleMic}
              aria-pressed={micEnabled}
              sx={{
                bgcolor: micEnabled ? 'rgba(255,255,255,0.12)' : '#ef4444',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.25)',
                '&:hover': {
                  bgcolor: micEnabled ? 'rgba(255,255,255,0.2)' : '#dc2626',
                },
              }}
              aria-label={micEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
            >
              {micEnabled ? <Mic /> : <MicOff />}
            </IconButton>
            <IconButton
              onClick={toggleCam}
              aria-pressed={camEnabled}
              sx={{
                bgcolor: camEnabled ? 'rgba(255,255,255,0.12)' : '#ef4444',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.25)',
                '&:hover': {
                  bgcolor: camEnabled ? 'rgba(255,255,255,0.2)' : '#dc2626',
                },
              }}
              aria-label={camEnabled ? 'Выключить камеру' : 'Включить камеру'}
            >
              {camEnabled ? <Videocam /> : <VideocamOff />}
            </IconButton>
          </Stack>
        </Box>

        {error ? (
          <Box
            sx={(t) => ({
              mb: 2,
              p: 1.25,
              borderRadius: 1.5,
              bgcolor: alpha(t.palette.error.main, 0.08),
              border: '1px solid',
              borderColor: alpha(t.palette.error.main, 0.3),
              color: 'error.main',
              fontSize: 12.5,
              lineHeight: 1.4,
            })}
          >
            Не удалось получить доступ к устройствам: {error}. Разрешите доступ в браузере и попробуйте снова.
          </Box>
        ) : null}

        <Stack spacing={1.5}>
          <FormControl size="small" fullWidth disabled={audioInputs.length === 0}>
            <InputLabel shrink id="precall-mic-label">Микрофон</InputLabel>
            <Select
              labelId="precall-mic-label"
              value={selectedAudioValue}
              onChange={(e) => handleAudioChange(e.target.value as string)}
              displayEmpty
              input={<OutlinedInput notched label="Микрофон" />}
              renderValue={(value) => {
                if (!value) return 'По умолчанию';
                const dev = audioInputs.find((d) => d.deviceId === value);
                return dev?.label || 'По умолчанию';
              }}
            >
              <MenuItem value="">По умолчанию</MenuItem>
              {audioInputs.map((d) => (
                <MenuItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth disabled={videoInputs.length === 0}>
            <InputLabel shrink id="precall-cam-label">Камера</InputLabel>
            <Select
              labelId="precall-cam-label"
              value={selectedVideoValue}
              onChange={(e) => handleVideoChange(e.target.value as string)}
              displayEmpty
              input={<OutlinedInput notched label="Камера" />}
              renderValue={(value) => {
                if (!value) return 'По умолчанию';
                const dev = videoInputs.find((d) => d.deviceId === value);
                return dev?.label || 'По умолчанию';
              }}
            >
              <MenuItem value="">По умолчанию</MenuItem>
              {videoInputs.map((d) => (
                <MenuItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          px: 2.25,
          py: 1.75,
          gap: 1,
          justifyContent: 'space-between',
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Button variant="text" color="inherit" onClick={onClose}>
          Отмена
        </Button>
        <Button
          variant="contained"
          disableElevation
          onClick={confirm}
          startIcon={<CallRounded />}
          sx={{ borderRadius: 2, fontWeight: 700, px: 2.5 }}
        >
          Присоединиться
        </Button>
      </DialogActions>
    </Dialog>
  );
}

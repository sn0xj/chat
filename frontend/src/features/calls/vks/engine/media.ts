const PREF_AUDIO_KEY = 'call.preferredAudioInputId';
const PREF_VIDEO_KEY = 'call.preferredVideoInputId';

async function getUserMediaCompat(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  const legacyNav = navigator as Navigator & {
    getUserMedia?: (
      c: MediaStreamConstraints,
      s: (stream: MediaStream) => void,
      e: (err: Error) => void,
    ) => void;
    webkitGetUserMedia?: typeof legacyNav.getUserMedia;
    mozGetUserMedia?: typeof legacyNav.getUserMedia;
  };
  const legacyGetUserMedia =
    legacyNav.getUserMedia || legacyNav.webkitGetUserMedia || legacyNav.mozGetUserMedia;
  if (!legacyGetUserMedia) {
    if (!window.isSecureContext) {
      throw new Error('Доступ к камере/микрофону заблокирован вне HTTPS');
    }
    throw new Error('getUserMedia не поддерживается этим браузером');
  }
  return new Promise<MediaStream>((resolve, reject) => {
    legacyGetUserMedia.call(legacyNav, constraints, resolve, reject);
  });
}

export async function getDisplayMediaCompat(
  constraints: DisplayMediaStreamOptions = { video: true, audio: false },
): Promise<MediaStream> {
  if (navigator.mediaDevices?.getDisplayMedia) {
    return navigator.mediaDevices.getDisplayMedia(constraints);
  }
  throw new Error('Демонстрация экрана не поддерживается этим браузером');
}

function readPreferredDeviceId(kind: 'audio' | 'video'): string | null {
  try {
    const value = window.localStorage?.getItem(kind === 'audio' ? PREF_AUDIO_KEY : PREF_VIDEO_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function buildAudioConstraint(): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  const deviceId = readPreferredDeviceId('audio');
  if (deviceId) {
    return { ...base, deviceId: { ideal: deviceId } };
  }
  return base;
}

function buildVideoConstraint(): MediaTrackConstraints | boolean {
  const deviceId = readPreferredDeviceId('video');
  if (deviceId) {
    return { deviceId: { ideal: deviceId } };
  }
  return true;
}

/**
 * Try mic+cam first, then mic only, then cam only; if everything fails return an empty stream
 * (receive-only mode).
 */
export async function acquireLocalCallStreamWithFallback(): Promise<MediaStream> {
  const audio = buildAudioConstraint();
  const video = buildVideoConstraint();
  try {
    return await getUserMediaCompat({ audio, video });
  } catch {
    /* continue */
  }
  try {
    return await getUserMediaCompat({ audio, video: false });
  } catch {
    /* continue */
  }
  try {
    return await getUserMediaCompat({ audio: false, video });
  } catch {
    /* continue */
  }
  return new MediaStream();
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

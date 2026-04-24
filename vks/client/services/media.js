export async function getUserMediaCompat(constraints) {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const legacyGetUserMedia =
    navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

  if (!legacyGetUserMedia) {
    if (!window.isSecureContext) {
      throw new Error("Camera access is blocked in insecure context. Open over HTTPS.");
    }
    throw new Error("getUserMedia is not supported by this browser.");
  }

  return new Promise((resolve, reject) => {
    legacyGetUserMedia.call(navigator, constraints, resolve, reject);
  });
}

export async function getDisplayMediaCompat(constraints) {
  if (navigator.mediaDevices?.getDisplayMedia) {
    return navigator.mediaDevices.getDisplayMedia(constraints);
  }
  throw new Error("Screen sharing is not supported by this browser.");
}

function readPreferredDeviceId(kind) {
  try {
    const value = window.localStorage?.getItem(
      kind === "audio" ? "call.preferredAudioInputId" : "call.preferredVideoInputId",
    );
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

function buildAudioConstraint() {
  const base = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  const deviceId = readPreferredDeviceId("audio");
  if (deviceId) {
    return { ...base, deviceId: { ideal: deviceId } };
  }
  return base;
}

function buildVideoConstraint() {
  const deviceId = readPreferredDeviceId("video");
  if (deviceId) {
    return { deviceId: { ideal: deviceId } };
  }
  return true;
}

/** Пытается мик+кам, затем только мик / только камера; при отказе — пустой поток (только приём). */
export async function acquireLocalCallStreamWithFallback() {
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

export function stopMediaStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

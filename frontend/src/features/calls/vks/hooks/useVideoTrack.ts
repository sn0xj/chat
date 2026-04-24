import { useEffect, type RefObject } from 'react';

/**
 * Attaches a single video track to a <video> element, updating srcObject only when the
 * underlying track id changes (avoids flicker / re-subscription on identical-track re-renders).
 */
export function useVideoTrack(
  videoRef: RefObject<HTMLVideoElement | null>,
  track: MediaStreamTrack | null,
): void {
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const nextId = track?.id ?? '';
    const currentId = el.dataset.trackId ?? '';
    if (currentId === nextId) return;
    el.dataset.trackId = nextId;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) {
      void el.play().catch(() => undefined);
    }
  }, [videoRef, track]);
}

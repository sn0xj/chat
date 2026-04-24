import type { RemoteMediaHint } from './types';

/**
 * Selects which video track to show as main (and optionally as PiP) for a remote participant.
 * Pure function — no DOM, safe for both engine hinting and direct UI use.
 */
export type VideoSelection = {
  mainTrack: MediaStreamTrack | null;
  pipTrack: MediaStreamTrack | null;
  isScreenShareLayout: boolean;
};

function isRenderableTrack(track: MediaStreamTrack | null | undefined): track is MediaStreamTrack {
  return Boolean(track && track.readyState === 'live' && track.enabled);
}

function isStrongTrack(track: MediaStreamTrack | null | undefined): track is MediaStreamTrack {
  return Boolean(track && track.readyState === 'live' && track.enabled && !track.muted);
}

function scoreTrackAsScreen(track: MediaStreamTrack): number {
  const label = String(track.label || '').toLowerCase();
  const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
  const displaySurface = String((settings as { displaySurface?: string }).displaySurface || '').toLowerCase();
  const contentHint = String(track.contentHint || '').toLowerCase();
  const width = Number(settings.width || 0);
  const height = Number(settings.height || 0);
  const area = width > 0 && height > 0 ? width * height : 0;
  let score = 0;
  if (displaySurface) score += 10000;
  if (displaySurface === 'monitor' || displaySurface === 'window' || displaySurface === 'browser') {
    score += 5000;
  }
  if (
    label.includes('screen') ||
    label.includes('display') ||
    label.includes('window') ||
    label.includes('monitor') ||
    label.includes('tab')
  ) {
    score += 2500;
  }
  if (contentHint === 'detail' || contentHint === 'text') score += 1200;
  if (track.enabled === false) score -= 7000;
  if (track.muted) score -= 4500;
  score += Math.min(Math.round(area / 100000), 120);
  return score;
}

export function selectVideoTracks(
  stream: MediaStream | null,
  media: RemoteMediaHint | null,
  trackOrder: string[],
): VideoSelection {
  const empty: VideoSelection = { mainTrack: null, pipTrack: null, isScreenShareLayout: false };
  if (!stream) return empty;
  const liveTracks = stream.getVideoTracks().filter((t) => t.readyState === 'live');
  if (liveTracks.length === 0) return empty;
  if (media && !media.screenSharing && media.cameraEnabled === false) {
    return empty;
  }
  const tracksById = new Map(liveTracks.map((t) => [t.id, t]));
  const ordered = (trackOrder ?? [])
    .map((id) => tracksById.get(id) ?? null)
    .filter((t): t is MediaStreamTrack => t !== null);
  for (const t of liveTracks) {
    if (!ordered.some((o) => o.id === t.id)) ordered.push(t);
  }

  const cameraFromSignal = media?.cameraTrackId ? tracksById.get(media.cameraTrackId) ?? null : null;
  const freshest = ordered[ordered.length - 1] ?? liveTracks[liveTracks.length - 1] ?? null;

  const confirmedScreenSharing = Boolean(
    media?.primaryVideoSource === 'screen' || media?.screenSharing || media?.screenTrackId,
  );

  const scored = liveTracks.map((track) => ({ track, score: scoreTrackAsScreen(track) }));
  const pickBest = (candidates: MediaStreamTrack[], predicate: 'max' | 'min') => {
    if (candidates.length === 0) return null;
    let best = candidates[0];
    let bestScore = scoreTrackAsScreen(best);
    for (const t of candidates) {
      const s = scoreTrackAsScreen(t);
      if (predicate === 'max' ? s > bestScore : s < bestScore) {
        best = t;
        bestScore = s;
      }
    }
    return best;
  };

  const nonCameraTracks = ordered.filter((t) => t.id !== cameraFromSignal?.id);
  const shareTrack = confirmedScreenSharing
    ? (media?.screenTrackId ? tracksById.get(media.screenTrackId) ?? null : null) ??
      pickBest(nonCameraTracks.length ? nonCameraTracks : ordered, 'max') ??
      freshest
    : null;
  const fallbackCamera = pickBest(scored.map((r) => r.track), 'min');

  const bestStrong = ordered.find((t) => isStrongTrack(t)) ?? null;
  const bestRenderable = ordered.find((t) => isRenderableTrack(t)) ?? null;
  const mainTrack = confirmedScreenSharing
    ? (isStrongTrack(shareTrack) ? shareTrack : null) ??
      (isStrongTrack(cameraFromSignal) ? cameraFromSignal : null) ??
      (isStrongTrack(fallbackCamera) ? fallbackCamera : null) ??
      bestStrong ??
      (isRenderableTrack(shareTrack) ? shareTrack : null) ??
      (isRenderableTrack(cameraFromSignal) ? cameraFromSignal : null) ??
      (isRenderableTrack(fallbackCamera) ? fallbackCamera : null) ??
      bestRenderable ??
      shareTrack ??
      freshest
    : (isStrongTrack(cameraFromSignal) ? cameraFromSignal : null) ??
      (isStrongTrack(fallbackCamera) ? fallbackCamera : null) ??
      bestStrong ??
      (isRenderableTrack(cameraFromSignal) ? cameraFromSignal : null) ??
      (isRenderableTrack(fallbackCamera) ? fallbackCamera : null) ??
      bestRenderable ??
      freshest;

  if (!mainTrack) return empty;

  const pipCandidate = confirmedScreenSharing ? cameraFromSignal ?? fallbackCamera ?? null : null;
  const canShowPip =
    Boolean(media?.cameraEnabled) &&
    confirmedScreenSharing &&
    pipCandidate &&
    pipCandidate.id !== mainTrack.id &&
    isRenderableTrack(pipCandidate);

  return {
    mainTrack,
    pipTrack: canShowPip ? pipCandidate : null,
    isScreenShareLayout: confirmedScreenSharing,
  };
}

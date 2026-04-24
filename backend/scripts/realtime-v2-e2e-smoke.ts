import { MeetingStateService } from '../src/video-call/meeting-state.service';

type Metric = { scenario: string; convergedMs: number; version: number; ok: boolean };

const now = () => Date.now();

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  const svc = new MeetingStateService();
  const metrics: Metric[] = [];

  const roomId = 777;
  const t0 = now();
  svc.setPeerUser('a', { id: 1, username: 'a' });
  svc.setPeerUser('b', { id: 2, username: 'b' });
  svc.joinPeerToConference(roomId, 'a');
  svc.joinPeerToConference(roomId, 'b');
  const snapJoin = svc.getConferenceSnapshot(roomId);
  assert((snapJoin?.peers.length ?? 0) === 2, 'simultaneous join failed');
  metrics.push({
    scenario: 'simultaneous-join',
    convergedMs: now() - t0,
    version: snapJoin?.version ?? 0,
    ok: true,
  });

  const t1 = now();
  svc.applyPeerMediaState('a', roomId, {
    audioEnabled: true,
    videoEnabled: true,
    cameraEnabled: true,
    screenSharing: true,
    primaryVideoSource: 'screen',
    streamRef: 'screen-a-1',
    screenTrackId: 'screen-track-a',
    cameraTrackId: 'camera-track-a',
  });
  svc.applyPeerMediaState('b', roomId, {
    audioEnabled: true,
    videoEnabled: true,
    cameraEnabled: true,
    screenSharing: true,
    primaryVideoSource: 'screen',
    streamRef: 'screen-b-1',
    screenTrackId: 'screen-track-b',
    cameraTrackId: 'camera-track-b',
  });
  const snapShare = svc.getConferenceSnapshot(roomId);
  const bothSharing =
    snapShare?.peers.every((p) => p.screen.enabled && p.screen.trackRef && p.camera.trackRef) ?? false;
  assert(bothSharing, 'dual screen share state invalid');
  metrics.push({
    scenario: 'simultaneous-screen-share',
    convergedMs: now() - t1,
    version: snapShare?.version ?? 0,
    ok: true,
  });

  const t2 = now();
  svc.leavePeerFromConference(roomId, 'b', false);
  svc.joinPeerToConference(roomId, 'b');
  svc.setPeerUser('b', { id: 2, username: 'b' });
  const snapReconnect = svc.getConferenceSnapshot(roomId);
  assert((snapReconnect?.peers.length ?? 0) === 2, 'reconnect recovery failed');
  metrics.push({
    scenario: 'reconnect-mid-call',
    convergedMs: now() - t2,
    version: snapReconnect?.version ?? 0,
    ok: true,
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, metrics }, null, 2));
}

void run().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});

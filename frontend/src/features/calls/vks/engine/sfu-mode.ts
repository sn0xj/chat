// Thin wrapper around mediasoup-client used by CallEngine once the room grows
// to 3+ participants. Keeps all mediasoup specifics (Device, Transports,
// Producers, Consumers) isolated from the legacy P2P-mesh code so the engine
// only needs to know about MediaStreamTracks in remoteStreams.
//
// Design notes:
// - We piggy-back on the existing SignalingClient (socket.io) to send
//   `createWebRtcTransport`, `connectTransport`, `produce`, `consume`, etc.
// - `appData.source` travels through the backend (see video-call.gateway.ts
//   produce handler), so consumers can tag incoming tracks as camera/screen/
//   mic without any additional mapping.
// - Callers are responsible for keeping `remoteStreams` in sync via the
//   `onRemoteTrackAdded` / `onRemoteTrackRemoved` hooks — the SFU wrapper
//   doesn't own that map to keep the legacy path and the SFU path symmetric.
import { Device } from 'mediasoup-client';
import type {
  Consumer,
  Producer,
  RtpCapabilities,
  Transport,
  TransportOptions,
} from 'mediasoup-client/types';

import type { SignalingClient } from './signaling';
import { RT_EVENTS } from './realtime-events';

export type TrackSource = 'mic' | 'camera' | 'screen';

export type SfuProducerInfo = {
  producerId: string;
  peerId: string;
  kind: 'audio' | 'video';
  appData?: { source?: TrackSource } & Record<string, unknown>;
};

export type SfuModeHandlers = {
  onRemoteTrackAdded: (
    peerId: string,
    track: MediaStreamTrack,
    info: { source: TrackSource; producerId: string; consumerId: string },
  ) => void;
  onRemoteTrackRemoved: (
    peerId: string,
    trackId: string,
    info: { source: TrackSource; producerId: string; consumerId: string },
  ) => void;
  onError?: (err: Error) => void;
};

type ActiveConsumer = {
  consumer: Consumer;
  peerId: string;
  producerId: string;
  source: TrackSource;
};

export type SfuMode = {
  init: (rtpCapabilities: RtpCapabilities) => Promise<void>;
  createTransports: () => Promise<void>;
  publishTrack: (track: MediaStreamTrack, source: TrackSource) => Promise<string>;
  getProducer: (source: TrackSource) => Producer | null;
  pauseProducer: (source: TrackSource) => Promise<void>;
  resumeProducer: (source: TrackSource) => Promise<void>;
  closeProducer: (source: TrackSource) => void;
  consumeRemote: (info: SfuProducerInfo) => Promise<void>;
  removePeer: (peerId: string) => void;
  isConsuming: (producerId: string) => boolean;
  isReady: () => boolean;
  stop: () => void;
};

// Default when the server doesn't tag a producer with an explicit source.
const sourceFromInfo = (info: SfuProducerInfo): TrackSource => {
  const tagged = info.appData?.source;
  if (tagged === 'mic' || tagged === 'camera' || tagged === 'screen') {
    return tagged;
  }
  return info.kind === 'audio' ? 'mic' : 'camera';
};

export function createSfuMode(
  signaling: SignalingClient,
  handlers: SfuModeHandlers,
): SfuMode {
  const device = new Device();
  let sendTransport: Transport | null = null;
  let recvTransport: Transport | null = null;
  const producers = new Map<TrackSource, Producer>();
  const consumers = new Map<string, ActiveConsumer>();
  // Producer ids we've already consumed (or are in-flight consuming). Guards
  // against duplicate `newProducer` events (can happen if the engine fetches
  // `getProducers` and a `newProducer` push arrives concurrently).
  const consumedProducerIds = new Set<string>();
  let stopped = false;

  const emitError = (err: unknown) => {
    if (handlers.onError) {
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const init = async (rtpCapabilities: RtpCapabilities) => {
    if (device.loaded) return;
    await device.load({ routerRtpCapabilities: rtpCapabilities });
  };

  const createWebRtcTransport = async (
    direction: 'send' | 'recv',
  ): Promise<Transport> => {
    const response = await signaling.emitWithAck<{ transportOptions: TransportOptions }>(
      RT_EVENTS.SFU_CREATE_TRANSPORT,
      {},
    );
    const options = response.transportOptions;
    if (!options) {
      throw new Error('createWebRtcTransport returned no transportOptions');
    }
    const transport =
      direction === 'send' ? device.createSendTransport(options) : device.createRecvTransport(options);

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      signaling
        .emitWithAck(RT_EVENTS.SFU_CONNECT_TRANSPORT, { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch((err) => errback(err as Error));
    });

    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        signaling
          .emitWithAck<{ id: string }>(RT_EVENTS.SFU_PRODUCE, {
            transportId: transport.id,
            kind,
            rtpParameters,
            appData,
          })
          .then(({ id }) => callback({ id }))
          .catch((err) => errback(err as Error));
      });
    }

    transport.on('connectionstatechange', (state) => {
      if (state === 'failed' || state === 'disconnected') {
        // eslint-disable-next-line no-console
        console.warn('[vks/call] SFU transport state', direction, state);
      }
    });

    return transport;
  };

  const createTransports = async () => {
    if (sendTransport && recvTransport) return;
    sendTransport = await createWebRtcTransport('send');
    recvTransport = await createWebRtcTransport('recv');
  };

  const publishTrack = async (track: MediaStreamTrack, source: TrackSource): Promise<string> => {
    if (stopped) throw new Error('SFU mode stopped');
    if (!sendTransport) throw new Error('Send transport is not ready');
    // Prevent duplicate camera/screen/mic producers.
    const existing = producers.get(source);
    if (existing) {
      if (existing.track?.id !== track.id) {
        try {
          await existing.replaceTrack({ track });
        } catch (err) {
          emitError(err);
        }
      }
      return existing.id;
    }
    const producer = await sendTransport.produce({
      track,
      appData: { source },
    });
    producers.set(source, producer);
    producer.on('trackended', () => {
      closeProducer(source);
    });
    producer.on('transportclose', () => {
      closeProducer(source);
    });
    return producer.id;
  };

  const pauseProducer = async (source: TrackSource) => {
    const producer = producers.get(source);
    if (!producer || producer.paused) return;
    producer.pause();
  };

  const resumeProducer = async (source: TrackSource) => {
    const producer = producers.get(source);
    if (!producer || !producer.paused) return;
    producer.resume();
  };

  const closeProducer = (source: TrackSource) => {
    const producer = producers.get(source);
    if (!producer) return;
    producers.delete(source);
    try {
      producer.close();
    } catch {
      /* ignore */
    }
  };

  const getProducer = (source: TrackSource) => producers.get(source) ?? null;

  const consumeRemote = async (info: SfuProducerInfo) => {
    if (stopped) return;
    if (!recvTransport) throw new Error('Recv transport is not ready');
    if (!device.loaded) throw new Error('Device is not loaded');
    if (consumedProducerIds.has(info.producerId)) return;
    consumedProducerIds.add(info.producerId);

    try {
      const response = await signaling.emitWithAck<{
        id: string;
        producerId: string;
        kind: 'audio' | 'video';
        rtpParameters: unknown;
        peerId: string | null;
        appData?: { source?: TrackSource } & Record<string, unknown>;
      }>(RT_EVENTS.SFU_CONSUME, {
        producerId: info.producerId,
        transportId: recvTransport.id,
        rtpCapabilities: device.rtpCapabilities,
      });

      const consumer = await recvTransport.consume({
        id: response.id,
        producerId: response.producerId,
        kind: response.kind,
        rtpParameters: response.rtpParameters as never,
        appData: response.appData ?? info.appData,
      });

      const peerId = info.peerId || response.peerId || '';
      const source = sourceFromInfo({
        producerId: info.producerId,
        peerId,
        kind: response.kind,
        appData: response.appData ?? info.appData,
      });

      const active: ActiveConsumer = {
        consumer,
        peerId,
        producerId: info.producerId,
        source,
      };
      consumers.set(consumer.id, active);

      consumer.on('trackended', () => {
        handlers.onRemoteTrackRemoved(peerId, consumer.track.id, {
          source,
          producerId: info.producerId,
          consumerId: consumer.id,
        });
      });
      consumer.on('transportclose', () => {
        consumers.delete(consumer.id);
        consumedProducerIds.delete(info.producerId);
      });

      handlers.onRemoteTrackAdded(peerId, consumer.track, {
        source,
        producerId: info.producerId,
        consumerId: consumer.id,
      });

      await signaling.emitWithAck(RT_EVENTS.SFU_CONSUMER_RESUME, { consumerId: consumer.id });
    } catch (err) {
      consumedProducerIds.delete(info.producerId);
      emitError(err);
    }
  };

  const removePeer = (peerId: string) => {
    for (const [consumerId, active] of [...consumers.entries()]) {
      if (active.peerId !== peerId) continue;
      consumers.delete(consumerId);
      consumedProducerIds.delete(active.producerId);
      try {
        active.consumer.close();
      } catch {
        /* ignore */
      }
      handlers.onRemoteTrackRemoved(peerId, active.consumer.track.id, {
        source: active.source,
        producerId: active.producerId,
        consumerId,
      });
    }
  };

  const isConsuming = (producerId: string) => consumedProducerIds.has(producerId);

  const isReady = () => device.loaded && Boolean(sendTransport && recvTransport);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const producer of producers.values()) {
      try {
        producer.close();
      } catch {
        /* ignore */
      }
    }
    producers.clear();
    for (const active of consumers.values()) {
      try {
        active.consumer.close();
      } catch {
        /* ignore */
      }
    }
    consumers.clear();
    consumedProducerIds.clear();
    try {
      sendTransport?.close();
    } catch {
      /* ignore */
    }
    try {
      recvTransport?.close();
    } catch {
      /* ignore */
    }
    sendTransport = null;
    recvTransport = null;
  };

  return {
    init,
    createTransports,
    publishTrack,
    getProducer,
    pauseProducer,
    resumeProducer,
    closeProducer,
    consumeRemote,
    removePeer,
    isConsuming,
    isReady,
    stop,
  };
}

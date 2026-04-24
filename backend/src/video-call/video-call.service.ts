import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import * as mediasoup from 'mediasoup';
import { MeetingStateService } from './meeting-state.service';

type MediasoupWorker = {
  createRouter: (opts: { mediaCodecs: unknown[] }) => Promise<MediasoupRouter>;
  on: (event: string, handler: () => void) => void;
  close?: () => void;
};

type MediasoupRouter = {
  rtpCapabilities: unknown;
  createWebRtcTransport: (opts: Record<string, unknown>) => Promise<MediasoupTransport>;
  canConsume: (opts: { producerId: string; rtpCapabilities: unknown }) => boolean;
  close?: () => void;
};

type MediasoupTransport = {
  id: string;
  iceParameters: unknown;
  iceCandidates: unknown[];
  dtlsParameters: unknown;
  connect: (opts: { dtlsParameters: unknown }) => Promise<void>;
  produce: (opts: { kind: string; rtpParameters: unknown; appData?: Record<string, unknown> }) => Promise<MediasoupProducer>;
  consume: (opts: { producerId: string; rtpCapabilities: unknown; paused: boolean }) => Promise<MediasoupConsumer>;
  close: () => void;
};

type MediasoupProducer = {
  id: string;
  kind: string;
  appData?: Record<string, unknown>;
  close: () => void;
  on: (event: string, handler: () => void) => void;
};

type MediasoupConsumer = {
  id: string;
  kind: string;
  rtpParameters: unknown;
  appData?: Record<string, unknown>;
  resume: () => Promise<void>;
  close: () => void;
  on: (event: string, handler: () => void) => void;
};

type MediasoupModuleShape = {
  createWorker?: (opts: {
    rtcMinPort: number;
    rtcMaxPort: number;
    logLevel: 'debug' | 'warn' | 'error' | 'none';
  }) => Promise<unknown>;
  default?: {
    createWorker?: (opts: {
      rtcMinPort: number;
      rtcMaxPort: number;
      logLevel: 'debug' | 'warn' | 'error' | 'none';
    }) => Promise<unknown>;
  };
};

type PeerState = {
  transports: Map<string, MediasoupTransport>;
  producers: Map<string, MediasoupProducer>;
  consumers: Map<string, MediasoupConsumer>;
};
type PeerMediaHint = {
  audioEnabled: boolean;
  videoEnabled: boolean;
  cameraEnabled?: boolean;
  screenSharing?: boolean;
  primaryVideoSource?: 'none' | 'camera' | 'screen';
  streamRef?: string | null;
  screenTrackId?: string | null;
  cameraTrackId?: string | null;
};

@Injectable()
export class VideoCallService implements OnModuleDestroy {
  private readonly logger = new Logger(VideoCallService.name);
  private worker: MediasoupWorker | null = null;
  private router: MediasoupRouter | null = null;
  private readonly peers = new Map<string, PeerState>();
  private readonly rooms = new Map<number, Set<string>>();
  private readonly peerToRoom = new Map<string, number>();
  constructor(private readonly meetingState: MeetingStateService) {}

  private ensurePeer(peerId: string) {
    const existing = this.peers.get(peerId);
    if (existing) {
      return existing;
    }
    const created: PeerState = {
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    this.peers.set(peerId, created);
    return created;
  }

  private async ensureRuntime() {
    if (this.router) {
      return;
    }
    const mediasoupModule = mediasoup as unknown as MediasoupModuleShape;
    const createWorker = mediasoupModule.createWorker ?? mediasoupModule.default?.createWorker;
    if (!createWorker) {
      this.logger.error('mediasoup createWorker is unavailable (import interop mismatch)');
      throw new WsException('SFU runtime init failed: mediasoup import mismatch');
    }
    const worker = (await createWorker({
      rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT ?? 40000),
      rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT ?? 49999),
      logLevel: (process.env.MEDIASOUP_LOG_LEVEL ?? 'warn') as 'debug' | 'warn' | 'error' | 'none',
    })) as unknown as MediasoupWorker;
    this.worker = worker;
    worker.on('died', () => {
      this.logger.error('mediasoup worker died');
      process.exit(1);
    });

    this.router = await worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {},
        },
      ],
    });
  }

  private getListenIps() {
    const announcedIp = process.env.ANNOUNCED_IP;
    if (announcedIp) {
      return [{ ip: '0.0.0.0', announcedIp }];
    }
    return [{ ip: '127.0.0.1', announcedIp: undefined }];
  }

  getRoomPeerIds(chatId: number, excludePeerId?: string) {
    const room = this.rooms.get(chatId);
    if (!room) {
      return [];
    }
    return [...room].filter((peerId) => peerId !== excludePeerId);
  }

  getRoomParticipantCount(chatId: number) {
    return this.rooms.get(chatId)?.size ?? 0;
  }

  hasActiveCall(chatId: number) {
    return this.getRoomParticipantCount(chatId) > 0;
  }

  getActiveCallsSnapshot(): Array<{ chatId: number; participants: number }> {
    const snapshot: Array<{ chatId: number; participants: number }> = [];
    for (const [chatId, peers] of this.rooms.entries()) {
      if (peers.size > 0) {
        snapshot.push({ chatId, participants: peers.size });
      }
    }
    return snapshot;
  }

  getProducerInfos(chatId: number, excludePeerId?: string) {
    const infos: Array<{
      producerId: string;
      peerId: string;
      kind: string;
      appData?: Record<string, unknown>;
    }> = [];
    for (const peerId of this.getRoomPeerIds(chatId, excludePeerId)) {
      const peer = this.peers.get(peerId);
      if (!peer) {
        continue;
      }
      for (const producer of peer.producers.values()) {
        infos.push({
          producerId: producer.id,
          peerId,
          kind: producer.kind,
          appData: producer.appData ? { ...producer.appData } : undefined,
        });
      }
    }
    return infos;
  }

  setPeerUser(peerId: string, user: { id: number | null; username: string }) {
    this.meetingState.setPeerUser(peerId, user);
  }

  getPeerUser(peerId: string) {
    return this.meetingState.getPeerUser(peerId);
  }

  getPeerDirectoryForRoom(chatId: number) {
    return this.meetingState.getPeerDirectory(this.getRoomPeerIds(chatId));
  }

  getPeerMediaHintsForRoom(chatId: number, excludePeerId?: string) {
    return this.meetingState.getPeerMediaHints(this.getRoomPeerIds(chatId, excludePeerId));
  }

  getPeerQualityStatesForRoom(chatId: number, excludePeerId?: string) {
    return this.meetingState.getPeerQualityStates(this.getRoomPeerIds(chatId, excludePeerId));
  }

  getScalabilityModeForRoom(chatId: number): 'full' | 'speaker-focus' {
    return this.getRoomParticipantCount(chatId) > 12 ? 'speaker-focus' : 'full';
  }

  getConferenceSnapshot(chatId: number) {
    return this.meetingState.getConferenceSnapshot(chatId);
  }

  setPeerQualityState(peerId: string, qualityState: Record<string, unknown>) {
    this.meetingState.setPeerQualityState(peerId, qualityState);
  }

  applyPeerMediaState(peerId: string, patch: PeerMediaHint) {
    const chatId = this.peerToRoom.get(peerId);
    return this.meetingState.applyPeerMediaState(peerId, chatId ?? 0, patch);
  }

  getPeerStatus(chatId: number) {
    return this.meetingState.getPeerStatus(this.getRoomPeerIds(chatId));
  }

  joinRoom(peerId: string, chatId: number) {
    this.leaveRoom(peerId);
    const room = this.rooms.get(chatId) ?? new Set<string>();
    const existingPeerIds = [...room];
    room.add(peerId);
    this.rooms.set(chatId, room);
    this.peerToRoom.set(peerId, chatId);
    this.ensurePeer(peerId);
    this.meetingState.joinPeerToConference(chatId, peerId);
    return { existingPeerIds };
  }

  leaveRoom(peerId: string) {
    const chatId = this.peerToRoom.get(peerId);
    if (!chatId) {
      return null;
    }
    const room = this.rooms.get(chatId);
    if (room) {
      room.delete(peerId);
      const roomWillBeEmpty = room.size === 0;
      this.meetingState.leavePeerFromConference(chatId, peerId, roomWillBeEmpty);
      if (room.size === 0) {
        this.rooms.delete(chatId);
      }
    }
    this.peerToRoom.delete(peerId);
    this.removePeer(peerId);
    return chatId;
  }

  async getRouterRtpCapabilities() {
    await this.ensureRuntime();
    return { rtpCapabilities: this.router?.rtpCapabilities ?? null };
  }

  async createWebRtcTransport(peerId: string) {
    await this.ensureRuntime();
    if (!this.router) {
      throw new WsException('Router is not initialized');
    }
    const peer = this.ensurePeer(peerId);
    const transport = await this.router.createWebRtcTransport({
      listenIps: this.getListenIps(),
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
    peer.transports.set(transport.id, transport);
    return {
      transportOptions: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  }

  async connectTransport(peerId: string, transportId: string, dtlsParameters: unknown) {
    const transport = this.ensurePeer(peerId).transports.get(transportId);
    if (!transport) {
      throw new WsException('Transport not found');
    }
    await transport.connect({ dtlsParameters });
    return { ok: true };
  }

  async produce(
    peerId: string,
    transportId: string,
    kind: string,
    rtpParameters: unknown,
    appData?: Record<string, unknown>,
  ) {
    const chatId = this.peerToRoom.get(peerId);
    if (!chatId) {
      throw new WsException('Join room before producing');
    }
    const peer = this.ensurePeer(peerId);
    const transport = peer.transports.get(transportId);
    if (!transport) {
      throw new WsException('Transport not found');
    }
    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: { ...(appData ?? {}), peerId, chatId },
    });
    peer.producers.set(producer.id, producer);
    producer.on('transportclose', () => {
      peer.producers.delete(producer.id);
    });
    return {
      id: producer.id,
      chatId,
      appData: producer.appData ? { ...producer.appData } : undefined,
    };
  }

  async consume(peerId: string, producerId: string, transportId: string, rtpCapabilities: unknown) {
    await this.ensureRuntime();
    if (!this.router) {
      throw new WsException('Router is not initialized');
    }
    if (!this.router.canConsume({ producerId, rtpCapabilities })) {
      throw new WsException('Cannot consume this producer');
    }
    const peer = this.ensurePeer(peerId);
    const transport = peer.transports.get(transportId);
    if (!transport) {
      throw new WsException('Transport not found');
    }
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    peer.consumers.set(consumer.id, consumer);
    consumer.on('transportclose', () => {
      peer.consumers.delete(consumer.id);
    });
    const producerPeerId = this.getProducerOwnerPeerId(producerId);
    const producer = producerPeerId ? this.peers.get(producerPeerId)?.producers.get(producerId) : null;
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      peerId: producerPeerId,
      appData: producer?.appData ? { ...producer.appData } : undefined,
    };
  }

  async resumeConsumer(peerId: string, consumerId: string) {
    const consumer = this.ensurePeer(peerId).consumers.get(consumerId);
    if (!consumer) {
      throw new WsException('Consumer not found');
    }
    await consumer.resume();
    return { ok: true };
  }

  getPeerRoom(peerId: string) {
    return this.peerToRoom.get(peerId) ?? null;
  }

  private getProducerOwnerPeerId(producerId: string) {
    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.producers.has(producerId)) {
        return peerId;
      }
    }
    return null;
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return;
    }
    for (const transport of peer.transports.values()) {
      transport.close();
    }
    for (const producer of peer.producers.values()) {
      producer.close();
    }
    for (const consumer of peer.consumers.values()) {
      consumer.close();
    }
    this.peers.delete(peerId);
  }

  onModuleDestroy() {
    for (const peerId of [...this.peers.keys()]) {
      this.removePeer(peerId);
    }
    this.router?.close?.();
    this.worker?.close?.();
  }
}

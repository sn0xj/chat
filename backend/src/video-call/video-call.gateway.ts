import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { MessageService } from '../message/message.service';
import { CallSessionsService } from '../call-sessions/call-sessions.service';
import { ChatService } from '../chat/chat.service';
import { RealtimeBusService } from './realtime-bus.service';
import { RT_EVENTS } from './realtime-events';
import { JoinRoomAck, SocketUser } from './video-call.types';
import { VideoCallService } from './video-call.service';

const BUS_TOPIC_CHAT_UPDATED = 'chat.updated';

@WebSocketGateway({
  namespace: '/call',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class VideoCallGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server!: Server;
  private readonly logger = new Logger(VideoCallGateway.name);
  private readonly seenBusMessageIds: string[] = [];
  private readonly callChatAliases = new Map<number, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly messageService: MessageService,
    private readonly callService: VideoCallService,
    private readonly callSessions: CallSessionsService,
    private readonly chatService: ChatService,
    private readonly realtimeBus: RealtimeBusService,
  ) {}

  afterInit() {
    this.realtimeBus.onMessage((msg) => {
      if (msg.originInstanceId === this.realtimeBus.getInstanceId()) return;
      if (this.seenBusMessageIds.includes(msg.messageId)) return;
      this.seenBusMessageIds.push(msg.messageId);
      if (this.seenBusMessageIds.length > 500) this.seenBusMessageIds.shift();
      if (msg.topic === BUS_TOPIC_CHAT_UPDATED) {
        const chatId = Number(msg.roomId);
        if (!Number.isFinite(chatId) || chatId <= 0) return;
        const payload = msg.payload as {
          chatId?: number;
          sourceChatId?: number;
          createdMeeting?: boolean;
          addedMemberIds?: number[];
          chat?: (Awaited<ReturnType<ChatService['getChatSnapshot']>> & {
            members?: Array<{ id?: number | string }>;
          }) | null;
        };
        const event = {
          chatId,
          sourceChatId: Number(payload.sourceChatId ?? chatId),
          createdMeeting: Boolean(payload.createdMeeting),
          addedMemberIds: Array.isArray(payload.addedMemberIds) ? payload.addedMemberIds : [],
          chat: payload.chat ?? null,
        };
        if (
          event.createdMeeting &&
          Number.isFinite(event.sourceChatId) &&
          event.sourceChatId > 0 &&
          event.sourceChatId !== event.chatId
        ) {
          // Keep call chat routing consistent across multi-instance deployments:
          // if promotion happened on another instance, mirror source->meeting alias
          // locally so in-call chat messages are stored in the meeting chat.
          this.callChatAliases.set(event.sourceChatId, event.chatId);
        }
        if (!event.chat) return;
        const rootNamespace = (this.server as unknown as { server: Server }).server.of('/');
        rootNamespace.to(`chat:${chatId}`).emit('chat_updated', event);
        const memberIds = new Set<number>();
        for (const member of payload.chat?.members ?? []) {
          const id = Number(member?.id);
          if (Number.isFinite(id) && id > 0) memberIds.add(id);
        }
        for (const memberId of event.addedMemberIds) {
          const id = Number(memberId);
          if (Number.isFinite(id) && id > 0) memberIds.add(id);
        }
        for (const memberId of memberIds) {
          rootNamespace.to(`user:${memberId}`).emit('chat_updated', event);
        }
        return;
      }
      const peerIds = this.callService.getRoomPeerIds(Number(msg.roomId));
      for (const peerId of peerIds) {
        this.server.to(peerId).emit(msg.topic, msg.payload);
      }
    });
  }

  async handleConnection(client: Socket) {
    const requireTls = process.env.REQUIRE_TLS !== 'false';
    if (requireTls && !this.isSecureSocket(client)) {
      client.disconnect();
      return;
    }

    const rawToken = client.handshake.auth?.token || this.extractBearer(client);
    if (!rawToken) {
      client.data.user = null;
      return;
    }
    try {
      const payload = await this.jwtService.verifyAsync<SocketUser>(rawToken, {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
      });
      client.data.user = payload;
    } catch {
      client.data.user = null;
    }
  }

  handleDisconnect(client: Socket) {
    const chatId = this.callService.leaveRoom(client.id);
    if (!chatId) {
      return;
    }
    const peerIds = this.callService.getRoomPeerIds(chatId);
    for (const peerId of peerIds) {
      this.server.to(peerId).emit(RT_EVENTS.ROOM_PEER_LEFT, { peerId: client.id });
    }
    void this.realtimeBus.publish(RT_EVENTS.ROOM_PEER_LEFT, String(chatId), { peerId: client.id });
    void this.callSessions.endSessionIfEmpty(chatId, peerIds.length);
    this.emitConferenceSnapshot(chatId);
    this.emitCallPresence(chatId);
  }

  @SubscribeMessage(RT_EVENTS.ROOM_JOIN)
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number; roomId?: string },
  ): Promise<JoinRoomAck> {
    const userId = client.data.user?.sub as number | undefined;
    const rawRoomId = typeof body?.roomId === 'string' ? body.roomId : '';
    const chatId = Number(body?.chatId ?? rawRoomId);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      throw new WsException('chatId is required');
    }
    const guestName = typeof (body as { guestName?: unknown })?.guestName === 'string'
      ? String((body as { guestName?: string }).guestName).trim()
      : '';
    let targetChatId = chatId;
    const isGuestJoin = Boolean(guestName) || !userId;
    if (isGuestJoin && !this.callService.hasActiveCall(chatId)) {
      throw new WsException('Звонок завершён');
    }
    let promotionPayload: {
      sourceChatId: number;
      createdMeeting: boolean;
      addedMemberIds: number[];
      targetChatId: number;
      snapshot: Awaited<ReturnType<ChatService['getChatSnapshot']>>;
    } | null = null;
    if (userId) {
      // Guest flow is kept as-is: if a logged-in user joins a chat they're not
      // a member of, but they've opted to appear as a guest (via guest link),
      // we respect that without touching the chat membership.
      if (guestName) {
        this.callService.setPeerUser(client.id, {
          id: null,
          username: guestName,
        });
      } else {
        let isMember = true;
        try {
          await this.messageService.ensureMember(userId, chatId);
        } catch {
          isMember = false;
        }
        if (!isMember) {
          // Not a member yet — create a dedicated meeting chat from this
          // conversation (private/group) and include the newly joined user.
          // The source chat remains untouched.
          const result = await this.chatService.ensureMeetingChatCreated(chatId, userId, [userId]);
          if (!result.chat) {
            throw new WsException('Chat not found');
          }
          // Keep active media room stable for all existing peers. Only map
          // call-chat persistence to the dedicated meeting chat.
          if (result.createdMeeting) {
            this.remapCallChatAlias(chatId, result.chat.id);
            targetChatId = chatId;
          } else {
            targetChatId = result.chat.id;
          }
          promotionPayload = {
            sourceChatId: chatId,
            createdMeeting: result.createdMeeting,
            addedMemberIds: result.addedMemberIds,
            targetChatId: result.chat.id,
            snapshot: await this.chatService.getChatSnapshot(
              result.chat.id,
              Number(
                (result.chat as { created_by?: number } | null)?.created_by,
              ) || userId,
            ),
          };
        }
        this.callService.setPeerUser(client.id, {
          id: userId,
          username: client.data.user?.username || `user-${userId}`,
        });
      }
    } else {
      if (!guestName) {
        throw new WsException('guestName is required');
      }
      // Guests should never join a private/group room directly. If they open a
      // guest link to a non-meeting chat, promote that conversation to a
      // dedicated meeting room first and join the guest there.
      const promotion = await this.chatService.ensureMeetingChatCreated(chatId, 0, []);
      if (promotion.chat) {
        // Same approach for guest joins: preserve active room id to avoid
        // splitting participants between source and newly created meeting room.
        if (promotion.createdMeeting) {
          this.remapCallChatAlias(chatId, promotion.chat.id);
          targetChatId = chatId;
        } else {
          targetChatId = promotion.chat.id;
        }
        promotionPayload = {
          sourceChatId: chatId,
          createdMeeting: promotion.createdMeeting,
          addedMemberIds: promotion.addedMemberIds,
          targetChatId: promotion.chat.id,
          snapshot: await this.chatService.getChatSnapshot(
            promotion.chat.id,
            Number(
              (promotion.chat as { created_by?: number } | null)?.created_by,
            ) || 1,
          ),
        };
      }
      this.callService.setPeerUser(client.id, {
        id: null,
        username: guestName,
      });
    }

    const requestedRoomId = targetChatId;
    targetChatId = this.resolveJoinRoomId(targetChatId);
    this.logger.log(
      `[room.join] peer=${client.id} user=${userId ?? 'guest'} requested=${requestedRoomId} resolved=${targetChatId} source=${chatId} alias=${this.callChatAliases.get(chatId) ?? '-'} activeRequested=${this.callService.hasActiveCall(requestedRoomId)} activeResolved=${this.callService.hasActiveCall(targetChatId)}`,
    );
    const { existingPeerIds } = this.callService.joinRoom(client.id, targetChatId);
    this.logger.log(
      `[room.joined] peer=${client.id} room=${targetChatId} existingPeers=${existingPeerIds.length} totalPeers=${this.callService.getRoomParticipantCount(targetChatId)}`,
    );
    const joiningPeerUser = this.callService.getPeerUser(client.id);
    for (const peerId of existingPeerIds) {
      this.server.to(peerId).emit(RT_EVENTS.ROOM_PEER_JOINED, {
        peerId: client.id,
        chatId: targetChatId,
        user: joiningPeerUser,
      });
    }
    void this.realtimeBus.publish(RT_EVENTS.ROOM_PEER_JOINED, String(targetChatId), {
      peerId: client.id,
      chatId: targetChatId,
      user: joiningPeerUser,
    });
    const username = joiningPeerUser?.username || undefined;
    if (existingPeerIds.length === 0) {
      await this.callSessions.startSessionIfAbsent(targetChatId, username);
    } else {
      this.callSessions.addParticipant(targetChatId, username);
    }
    this.emitConferenceSnapshot(targetChatId);
    this.emitCallPresence(targetChatId);
    if (promotionPayload) {
      this.broadcastChatUpdated(promotionPayload.targetChatId, promotionPayload);
    }

    return {
      peerId: client.id,
      chatId: targetChatId,
      roomId: String(targetChatId),
      peerIds: existingPeerIds,
      peerDirectory: this.callService.getPeerDirectoryForRoom(targetChatId),
      producerInfos: this.callService.getProducerInfos(targetChatId, client.id),
      peerMediaHints: this.callService.getPeerMediaHintsForRoom(targetChatId, client.id),
      peerQualityStates: this.callService.getPeerQualityStatesForRoom(targetChatId, client.id),
      snapshot: this.callService.getConferenceSnapshot(targetChatId),
      scalabilityMode: this.callService.getScalabilityModeForRoom(targetChatId),
    };
  }

  @SubscribeMessage(RT_EVENTS.ROOM_LEAVE)
  leaveRoom(@ConnectedSocket() client: Socket) {
    const chatId = this.callService.leaveRoom(client.id);
    if (!chatId) {
      return { ok: true };
    }
    const peerIds = this.callService.getRoomPeerIds(chatId);
    for (const peerId of peerIds) {
      this.server.to(peerId).emit(RT_EVENTS.ROOM_PEER_LEFT, { peerId: client.id });
    }
    void this.realtimeBus.publish(RT_EVENTS.ROOM_PEER_LEFT, String(chatId), { peerId: client.id });
    void this.callSessions.endSessionIfEmpty(chatId, peerIds.length);
    this.emitConferenceSnapshot(chatId);
    this.emitCallPresence(chatId);
    return { ok: true };
  }

  @SubscribeMessage(RT_EVENTS.SFU_GET_ROUTER_CAPS)
  async getRouterRtpCapabilities() {
    return this.callService.getRouterRtpCapabilities();
  }

  @SubscribeMessage(RT_EVENTS.SFU_CREATE_TRANSPORT)
  async createWebRtcTransport(@ConnectedSocket() client: Socket) {
    this.assertInRoom(client.id);
    return this.callService.createWebRtcTransport(client.id);
  }

  @SubscribeMessage(RT_EVENTS.SFU_CONNECT_TRANSPORT)
  async connectTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { transportId: string; dtlsParameters: unknown },
  ) {
    this.assertInRoom(client.id);
    return this.callService.connectTransport(client.id, body.transportId, body.dtlsParameters);
  }

  @SubscribeMessage(RT_EVENTS.SFU_PRODUCE)
  async produce(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      transportId: string;
      kind: string;
      rtpParameters: unknown;
      appData?: Record<string, unknown>;
    },
  ) {
    this.assertInRoom(client.id);
    const produced = await this.callService.produce(
      client.id,
      body.transportId,
      body.kind,
      body.rtpParameters,
      body.appData,
    );
    const peerIds = this.callService.getRoomPeerIds(produced.chatId, client.id);
    for (const peerId of peerIds) {
      this.server.to(peerId).emit(RT_EVENTS.SFU_NEW_PRODUCER, {
        producerId: produced.id,
        peerId: client.id,
        kind: body.kind,
        appData: produced.appData,
        user: this.callService.getPeerUser(client.id),
      });
    }
    void this.realtimeBus.publish(RT_EVENTS.SFU_NEW_PRODUCER, String(produced.chatId), {
      producerId: produced.id,
      peerId: client.id,
      kind: body.kind,
      appData: produced.appData,
      user: this.callService.getPeerUser(client.id),
    });
    return { id: produced.id };
  }

  @SubscribeMessage(RT_EVENTS.SFU_CONSUME)
  async consume(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { producerId: string; transportId: string; rtpCapabilities: unknown },
  ) {
    this.assertInRoom(client.id);
    return this.callService.consume(
      client.id,
      body.producerId,
      body.transportId,
      body.rtpCapabilities,
    );
  }

  @SubscribeMessage(RT_EVENTS.SFU_CONSUMER_RESUME)
  async resumeConsumer(@ConnectedSocket() client: Socket, @MessageBody() body: { consumerId: string }) {
    this.assertInRoom(client.id);
    return this.callService.resumeConsumer(client.id, body.consumerId);
  }

  @SubscribeMessage(RT_EVENTS.SFU_GET_PRODUCERS)
  getProducers(@ConnectedSocket() client: Socket) {
    const chatId = this.callService.getPeerRoom(client.id);
    if (!chatId) {
      return { producerInfos: [] };
    }
    return { producerInfos: this.callService.getProducerInfos(chatId, client.id) };
  }

  @SubscribeMessage(RT_EVENTS.STATE_PATCH)
  peerMediaState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: Record<string, unknown>,
  ) {
    const chatId = this.callService.getPeerRoom(client.id);
    if (!chatId) {
      throw new WsException('Join room before sending media state');
    }
    this.assertMediaPatchInvariant(body);
    const peerIds = this.callService.getRoomPeerIds(chatId, client.id);
    for (const peerId of peerIds) {
      this.server.to(peerId).emit(RT_EVENTS.STATE_PATCH, {
        fromPeerId: client.id,
        ...body,
      });
    }
    const { version } = this.callService.applyPeerMediaState(client.id, body as never);
    const messageId = `${Date.now()}-${client.id}-${Math.random().toString(36).slice(2, 8)}`;
    const deltaPayload = {
      roomId: String(chatId),
      peerId: client.id,
      version,
      patch: body,
      ts: new Date().toISOString(),
      messageId,
      actorPeerId: client.id,
    };
    for (const peerId of peerIds) {
      this.server.to(peerId).emit(RT_EVENTS.STATE_DELTA, deltaPayload);
    }
    void this.realtimeBus.publish(RT_EVENTS.STATE_DELTA, String(chatId), deltaPayload);
    return { ok: true, version };
  }

  @SubscribeMessage(RT_EVENTS.STATE_SNAPSHOT_GET)
  getConferenceSnapshot(@ConnectedSocket() client: Socket) {
    const chatId = this.callService.getPeerRoom(client.id);
    if (!chatId) {
      throw new WsException('Join room before requesting snapshot');
    }
    return {
      roomId: String(chatId),
      snapshot: this.callService.getConferenceSnapshot(chatId),
    };
  }

  @SubscribeMessage(RT_EVENTS.STATE_RESYNC_REQUEST)
  requestConferenceResync(@ConnectedSocket() client: Socket) {
    const chatId = this.callService.getPeerRoom(client.id);
    if (!chatId) {
      throw new WsException('Join room before requesting snapshot');
    }
    this.server.to(client.id).emit(RT_EVENTS.STATE_SNAPSHOT, {
      roomId: String(chatId),
      snapshot: this.callService.getConferenceSnapshot(chatId),
    });
    return { ok: true };
  }

  @SubscribeMessage('peerQualityState')
  peerQualityState(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: Record<string, unknown>,
  ) {
    const chatId = this.callService.getPeerRoom(client.id);
    if (!chatId) {
      throw new WsException('Join room before sending quality state');
    }
    const peerIds = this.callService.getRoomPeerIds(chatId, client.id);
    this.callService.setPeerQualityState(client.id, body);
    for (const peerId of peerIds) {
      this.server.to(peerId).emit('peerQualityState', {
        fromPeerId: client.id,
        ...body,
      });
    }
    return { ok: true };
  }

  @SubscribeMessage(RT_EVENTS.RTC_OFFER)
  rtcOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { targetPeerId: string; sdp: unknown },
  ) {
    this.assertPeersInSameRoom(client.id, body.targetPeerId);
    this.server.to(body.targetPeerId).emit(RT_EVENTS.RTC_OFFER, { fromPeerId: client.id, sdp: body.sdp });
    return { ok: true };
  }

  @SubscribeMessage(RT_EVENTS.RTC_ANSWER)
  rtcAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { targetPeerId: string; sdp: unknown },
  ) {
    this.assertPeersInSameRoom(client.id, body.targetPeerId);
    this.server.to(body.targetPeerId).emit(RT_EVENTS.RTC_ANSWER, { fromPeerId: client.id, sdp: body.sdp });
    return { ok: true };
  }

  @SubscribeMessage(RT_EVENTS.RTC_ICE)
  rtcIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { targetPeerId: string; candidate: unknown },
  ) {
    this.assertPeersInSameRoom(client.id, body.targetPeerId);
    this.server
      .to(body.targetPeerId)
      .emit(RT_EVENTS.RTC_ICE, { fromPeerId: client.id, candidate: body.candidate });
    return { ok: true };
  }

  @SubscribeMessage('kickPeer')
  async kickPeer(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { targetPeerId: string },
  ) {
    const sourceChatId = this.callService.getPeerRoom(client.id);
    const targetChatId = this.callService.getPeerRoom(body.targetPeerId);
    if (!sourceChatId || sourceChatId !== targetChatId) {
      throw new WsException('Target peer is not in this room');
    }
    const sourcePeerUser = this.callService.getPeerUser(client.id);
    const targetPeerUser = this.callService.getPeerUser(body.targetPeerId);
    const sourceUserId = Number(sourcePeerUser?.id);
    const targetUserId = Number(targetPeerUser?.id);
    // Guests never moderate rooms.
    if (!Number.isFinite(sourceUserId) || sourceUserId <= 0) {
      throw new WsException('Insufficient permissions');
    }
    const context = await this.chatService.getModerationContext(sourceUserId, sourceChatId);
    const chatType = context.chat.type;
    const isGroup = chatType === 'group';
    const isPrivate = chatType === 'private';
    const isMeetingLike = !isGroup && !isPrivate;
    if (isPrivate) {
      throw new WsException('Insufficient permissions');
    }
    if (isGroup && context.membership.role !== 'owner') {
      throw new WsException('Insufficient permissions');
    }
    if (isMeetingLike && context.chat.created_by !== sourceUserId) {
      throw new WsException('Insufficient permissions');
    }
    // Prevent kicking the original creator/owner account in managed rooms.
    if (Number.isFinite(targetUserId) && targetUserId > 0) {
      if (isGroup) {
        const targetContext = await this.chatService.getModerationContext(targetUserId, sourceChatId);
        if (targetContext.membership.role === 'owner') {
          throw new WsException('Cannot kick room owner');
        }
      }
      if (isMeetingLike && targetUserId === context.chat.created_by) {
        throw new WsException('Cannot kick meeting initiator');
      }
    }
    const removedChatId = this.callService.leaveRoom(body.targetPeerId);
    if (!removedChatId) {
      return { ok: true };
    }
      this.server.to(body.targetPeerId).emit(RT_EVENTS.ROOM_KICKED, {
      roomId: String(removedChatId),
      byPeerId: client.id,
    });
    const peerIds = this.callService.getRoomPeerIds(removedChatId);
    for (const peerId of peerIds) {
      this.server.to(peerId).emit(RT_EVENTS.ROOM_PEER_LEFT, { peerId: body.targetPeerId });
    }
    void this.callSessions.endSessionIfEmpty(removedChatId, peerIds.length);
    this.emitConferenceSnapshot(removedChatId);
    this.emitCallPresence(removedChatId);
    return { ok: true };
  }

  @SubscribeMessage(RT_EVENTS.CALL_CHAT_HISTORY_GET)
  async getCallChatHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number; limit?: number },
  ) {
    const chatId = Number(body?.chatId);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      throw new WsException('chatId is required');
    }
    const roomId = this.callService.getPeerRoom(client.id);
    if (!roomId || roomId !== chatId) {
      throw new WsException('Peer is not in this room');
    }
    const userId = client.data.user?.sub as number | undefined;
    const resolvedChatId = this.resolveCallChatId(chatId);
    const limit = Number.isFinite(Number(body?.limit)) ? Number(body?.limit) : 30;
    const peerUser = this.callService.getPeerUser(client.id);
    const effectiveUserId =
      Number.isFinite(Number(peerUser?.id)) && Number(peerUser?.id) > 0
        ? Number(peerUser?.id)
        : undefined;
    if (effectiveUserId) {
      const messages = await this.messageService.getMessages(effectiveUserId, resolvedChatId);
      const callMessages = await this.messageService.listCallChatMessages(
        resolvedChatId,
        Math.max(1, Math.min(limit, 200)),
      );
      const merged = [...messages, ...callMessages].sort((a, b) => {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (aTs !== bTs) return aTs - bTs;
        return a.id - b.id;
      });
      const uniq = merged.filter((item, idx, arr) => arr.findIndex((m) => m.id === item.id) === idx);
      return uniq.slice(-Math.max(1, Math.min(limit, 200)));
    }
    return this.messageService.listCallChatMessages(resolvedChatId, limit);
  }

  @SubscribeMessage(RT_EVENTS.CALL_CHAT_MESSAGE_SEND)
  async sendCallChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId?: number; text?: string },
  ) {
    const chatId = Number(body?.chatId);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      throw new WsException('chatId is required');
    }
    const roomId = this.callService.getPeerRoom(client.id);
    if (!roomId || roomId !== chatId) {
      throw new WsException('Peer is not in this room');
    }

    const userId = client.data.user?.sub as number | undefined;
    const resolvedChatId = this.resolveCallChatId(chatId);
    const peerUser = this.callService.getPeerUser(client.id);
    const effectiveUserId =
      Number.isFinite(Number(peerUser?.id)) && Number(peerUser?.id) > 0
        ? Number(peerUser?.id)
        : undefined;
    const message = effectiveUserId
      ? await this.messageService.createMessage(effectiveUserId, resolvedChatId, String(body?.text ?? ''))
      : await this.messageService.createGuestMessage(
          resolvedChatId,
          String(peerUser?.username || 'Гость'),
          String(body?.text ?? ''),
        );

    for (const peerId of this.callService.getRoomPeerIds(chatId)) {
      this.server.to(peerId).emit(RT_EVENTS.CALL_CHAT_MESSAGE, message);
    }
    const rootNamespace = (this.server as unknown as { server: Server }).server.of('/');
    rootNamespace.to(`chat:${resolvedChatId}`).emit('new_message', message);
    return message;
  }

  private emitCallPresence(chatId: number) {
    const participants = this.callService.getRoomParticipantCount(chatId);
    const rootNamespace = (this.server as unknown as { server: Server }).server.of('/');
    rootNamespace.to(`chat:${chatId}`).emit('call_presence', {
      chatId,
      active: participants > 0,
      participants,
    });
  }

  // Fanned-out `chat_updated` notification. Used when the backend creates a
  // dedicated meeting chat from an existing conversation. Goes through the
  // root namespace (where ChatGateway listens) so both the freshly-added user
  // (via `user:{id}`) and everyone currently viewing the target chat (`chat:{id}`)
  // can reconcile their client-side caches.
  private broadcastChatUpdated(
    chatId: number,
    payload: {
      sourceChatId: number;
      createdMeeting: boolean;
      addedMemberIds: number[];
      snapshot: Awaited<ReturnType<ChatService['getChatSnapshot']>>;
    },
  ) {
    if (!payload.snapshot) return;
    const rootNamespace = (this.server as unknown as { server: Server }).server.of('/');
    const event = {
      chatId,
      sourceChatId: payload.sourceChatId,
      createdMeeting: payload.createdMeeting,
      addedMemberIds: payload.addedMemberIds,
      chat: payload.snapshot,
    };
    if (payload.createdMeeting && payload.sourceChatId && payload.sourceChatId !== chatId) {
      this.callChatAliases.set(payload.sourceChatId, chatId);
    }
    rootNamespace.to(`chat:${chatId}`).emit('chat_updated', event);
    if (payload.sourceChatId && payload.sourceChatId !== chatId) {
      rootNamespace.to(`chat:${payload.sourceChatId}`).emit('chat_updated', event);
    }
    const memberIds = new Set<number>();
    for (const member of payload.snapshot.members ?? []) {
      const id = Number(member?.id);
      if (Number.isFinite(id) && id > 0) memberIds.add(id);
    }
    for (const memberId of payload.addedMemberIds) {
      const id = Number(memberId);
      if (Number.isFinite(id) && id > 0) memberIds.add(id);
    }
    for (const memberId of memberIds) {
      rootNamespace.to(`user:${memberId}`).emit('chat_updated', event);
    }
    void this.realtimeBus.publish(BUS_TOPIC_CHAT_UPDATED, String(chatId), event as Record<string, unknown>);
  }

  private resolveCallChatId(chatId: number) {
    return this.callChatAliases.get(chatId) ?? chatId;
  }

  private remapCallChatAlias(sourceChatId: number, targetChatId: number) {
    if (sourceChatId === targetChatId) return;
    this.callChatAliases.set(sourceChatId, targetChatId);
    this.emitCallPresence(sourceChatId);
    this.emitCallPresence(targetChatId);
  }

  // When a private/group chat is promoted to a meeting chat, active media
  // participants may still be in the original source room id. If someone tries
  // to join by the new meeting chat id, route them into the already-active
  // source room to avoid splitting one call into two separate rooms.
  private resolveJoinRoomId(requestedChatId: number) {
    if (this.callService.hasActiveCall(requestedChatId)) {
      return requestedChatId;
    }
    for (const [sourceChatId, mappedChatId] of this.callChatAliases.entries()) {
      if (mappedChatId !== requestedChatId) continue;
      if (this.callService.hasActiveCall(sourceChatId)) {
        return sourceChatId;
      }
    }
    return requestedChatId;
  }

  private emitConferenceSnapshot(chatId: number) {
    const snapshot = this.callService.getConferenceSnapshot(chatId);
    if (!snapshot) {
      return;
    }
    const peerIds = this.callService.getRoomPeerIds(chatId);
    for (const peerId of peerIds) {
      this.server.to(peerId).emit(RT_EVENTS.STATE_SNAPSHOT, {
        roomId: String(chatId),
        snapshot,
      });
    }
  }

  private assertInRoom(peerId: string) {
    const chatId = this.callService.getPeerRoom(peerId);
    if (!chatId) {
      throw new WsException('Join room before this action');
    }
  }

  private assertMediaPatchInvariant(body: Record<string, unknown>) {
    const primary = body.primaryVideoSource;
    const screenSharing = Boolean(body.screenSharing);
    const cameraEnabled = Boolean(body.cameraEnabled ?? body.videoEnabled);
    const screenTrackId = typeof body.screenTrackId === 'string' ? body.screenTrackId : null;
    const cameraTrackId = typeof body.cameraTrackId === 'string' ? body.cameraTrackId : null;
    if (screenSharing && primary !== 'screen') {
      throw new WsException('Invalid media patch: screenSharing requires primaryVideoSource=screen');
    }
    if (primary === 'screen' && !screenTrackId) {
      throw new WsException('Invalid media patch: primaryVideoSource=screen requires screenTrackId');
    }
    if (primary === 'camera' && cameraEnabled && !cameraTrackId) {
      throw new WsException('Invalid media patch: primaryVideoSource=camera requires cameraTrackId');
    }
  }

  private assertPeersInSameRoom(sourcePeerId: string, targetPeerId: string) {
    const sourceChatId = this.callService.getPeerRoom(sourcePeerId);
    const targetChatId = this.callService.getPeerRoom(targetPeerId);
    if (!sourceChatId || sourceChatId !== targetChatId) {
      throw new WsException('Target peer is not in this room');
    }
    return sourceChatId;
  }

  private extractBearer(client: Socket) {
    const authHeader = client.handshake.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.replace('Bearer ', '');
  }

  private isSecureSocket(client: Socket) {
    const handshake = client.handshake as Socket['handshake'] & {
      secure?: boolean;
      headers: Record<string, string | string[] | undefined>;
    };
    if (handshake.secure) {
      return true;
    }
    const protoHeader = handshake.headers?.['x-forwarded-proto'];
    const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
    return proto === 'https' || proto === 'wss';
  }
}

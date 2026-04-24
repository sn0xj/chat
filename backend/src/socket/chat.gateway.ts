import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { MessageService } from '../message/message.service';
import { ChatService } from '../chat/chat.service';
import { VideoCallService } from '../video-call/video-call.service';

type SocketUser = {
  sub: number;
  username: string;
};

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly messageService: MessageService,
    private readonly jwtService: JwtService,
    private readonly chatService: ChatService,
    private readonly videoCallService: VideoCallService,
  ) {}

  async handleConnection(client: Socket) {
    const requireTls = process.env.REQUIRE_TLS !== 'false';
    if (requireTls && !this.isSecureSocket(client)) {
      client.disconnect();
      return;
    }
    const rawToken = client.handshake.auth?.token || this.extractBearer(client);
    if (!rawToken) {
      client.disconnect();
      return;
    }
    try {
      const payload = await this.jwtService.verifyAsync<SocketUser>(rawToken, {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
      });
      client.data.user = payload;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect() {
    return;
  }

  @SubscribeMessage('join_chat')
  async joinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId: number },
  ) {
    const userId = client.data.user?.sub;
    if (!userId) {
      return;
    }
    try {
      await this.messageService.ensureMember(userId, body.chatId);
    } catch {
      // Client-side joined chat ids can briefly contain stale rooms (for example
      // after membership changes across instances). Ignore unauthorized joins
      // instead of surfacing noisy ws errors.
      return;
    }
    await client.join(`chat:${body.chatId}`);
    client.emit('call_presence', {
      chatId: body.chatId,
      active: this.videoCallService.hasActiveCall(body.chatId),
      participants: this.videoCallService.getRoomParticipantCount(body.chatId),
    });
  }

  @SubscribeMessage('leave_chat')
  async leaveChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId: number },
  ) {
    await client.leave(`chat:${body.chatId}`);
  }

  @SubscribeMessage('send_message')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId: number; text: string },
  ) {
    const userId = client.data.user?.sub;
    if (!userId) {
      return;
    }
    const message = await this.messageService.createMessage(userId, body.chatId, body.text);
    this.server.to(`chat:${body.chatId}`).emit('new_message', message);
    return message;
  }

  @SubscribeMessage('edit_message')
  async editMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId: number; messageId: number; text: string },
  ) {
    const userId = client.data.user?.sub;
    if (!userId) {
      return;
    }
    const message = await this.messageService.updateMessage(userId, body.chatId, body.messageId, body.text);
    this.server.to(`chat:${body.chatId}`).emit('message_updated', message);
    return message;
  }

  @SubscribeMessage('delete_message')
  async deleteMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId: number; messageId: number },
  ) {
    const userId = client.data.user?.sub;
    if (!userId) {
      return;
    }
    await this.messageService.deleteMessage(userId, body.chatId, body.messageId);
    const payload = { chatId: body.chatId, messageId: body.messageId };
    this.server.to(`chat:${body.chatId}`).emit('message_deleted', payload);
    return payload;
  }

  @SubscribeMessage('clear_history_for_all')
  async clearHistoryForAll(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId: number },
  ) {
    const userId = client.data.user?.sub;
    if (!userId) {
      return;
    }
    const result = await this.chatService.clearHistoryForAll(userId, body.chatId);
    this.server.to(`chat:${body.chatId}`).emit('chat_history_cleared', result);
    return result;
  }

  @SubscribeMessage('start_call')
  async startCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId: number },
  ) {
    const userId = client.data.user?.sub;
    if (!userId) {
      return;
    }
    await this.messageService.ensureMember(userId, body.chatId);
    const callerName = client.data.user?.username || `user-${userId}`;
    this.server.to(`chat:${body.chatId}`).emit('incoming_call', {
      chatId: body.chatId,
      callerId: userId,
      callerName,
      startedAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  @SubscribeMessage('invite_users_to_call')
  async inviteUsersToCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId: number; userIds: number[] },
  ) {
    const userId = client.data.user?.sub;
    if (!userId) {
      return;
    }
    await this.messageService.ensureMember(userId, body.chatId);
    const callerName = client.data.user?.username || `user-${userId}`;
    const uniqueIds = Array.from(new Set((body.userIds || []).filter((id) => Number.isFinite(id) && id > 0)));
    for (const targetUserId of uniqueIds) {
      this.server.to(`user:${targetUserId}`).emit('incoming_call', {
        chatId: body.chatId,
        callerId: userId,
        callerName,
        startedAt: new Date().toISOString(),
      });
    }
    return { ok: true };
  }

  @SubscribeMessage('decline_call')
  async declineCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatId: number; callerId: number },
  ) {
    const userId = client.data.user?.sub;
    if (!userId) {
      return;
    }
    await this.messageService.ensureMember(userId, body.chatId);
    const declinedByName = client.data.user?.username || `user-${userId}`;
    this.server.to(`user:${body.callerId}`).emit('call_declined', {
      chatId: body.chatId,
      callerId: body.callerId,
      declinedById: userId,
      declinedByName,
      declinedAt: new Date().toISOString(),
    });
    return { ok: true };
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

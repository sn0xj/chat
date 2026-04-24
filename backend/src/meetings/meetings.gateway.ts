import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class MeetingsGateway {
  @WebSocketServer()
  server!: Server;

  emitToUser<T>(userId: number, event: string, payload: T) {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit(event, payload as unknown as object);
  }

  emitToUsers<T>(userIds: number[], event: string, payload: T) {
    if (!this.server) return;
    const unique = Array.from(new Set(userIds.filter((id) => Number.isFinite(id) && id > 0)));
    for (const id of unique) {
      this.server.to(`user:${id}`).emit(event, payload as unknown as object);
    }
  }
}

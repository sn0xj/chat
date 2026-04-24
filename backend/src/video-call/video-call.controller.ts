import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '../auth/auth.guard';
import { MessageService } from '../message/message.service';
import { VideoCallService } from './video-call.service';

@Controller('/api/rooms')
export class VideoCallController {
  constructor(
    private readonly videoCallService: VideoCallService,
    private readonly messageService: MessageService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('active')
  listActive() {
    return {
      rooms: this.videoCallService.getActiveCallsSnapshot(),
    };
  }

  @Get(':roomId/peer-status')
  getPeerStatus(@Param('roomId') roomId: string) {
    const chatId = Number(roomId);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      throw new NotFoundException('room not found');
    }
    if (!this.videoCallService.hasActiveCall(chatId)) {
      throw new NotFoundException('room not found');
    }
    return {
      roomId: String(chatId),
      peers: this.videoCallService.getPeerStatus(chatId),
    };
  }

  @Post(':roomId/kick')
  kickPeer(@Param('roomId') roomId: string, @Body() body: { targetPeerId?: string }) {
    const chatId = Number(roomId);
    const targetPeerId = typeof body?.targetPeerId === 'string' ? body.targetPeerId : '';
    if (!Number.isFinite(chatId) || chatId <= 0 || !targetPeerId) {
      throw new NotFoundException('room not found');
    }
    const peerRoom = this.videoCallService.getPeerRoom(targetPeerId);
    if (!peerRoom || peerRoom !== chatId) {
      throw new NotFoundException('room not found');
    }
    this.videoCallService.leaveRoom(targetPeerId);
    return { ok: true };
  }

  @UseGuards(AuthGuard)
  @Post(':roomId/guest-link')
  async createGuestLink(
    @Param('roomId') roomId: string,
    @Req() req: { user?: { id?: number } },
  ) {
    const chatId = Number(roomId);
    if (!Number.isFinite(chatId) || chatId <= 0) {
      throw new NotFoundException('room not found');
    }
    const userId = Number(req.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new UnauthorizedException('unauthorized');
    }
    await this.messageService.ensureMember(userId, chatId);
    const expiresInSeconds = 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const token = await this.jwtService.signAsync(
      { type: 'guest_call', roomId: chatId },
      {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
        expiresIn: `${expiresInSeconds}s`,
      },
    );
    return { token, expiresAt: expiresAt.toISOString() };
  }

  @Get('guest/:token')
  async resolveGuestLink(@Param('token') token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<{ type?: string; roomId?: number }>(token, {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
      });
      if (payload?.type !== 'guest_call') {
        throw new NotFoundException('guest link is invalid');
      }
      const chatId = Number(payload.roomId);
      if (!Number.isFinite(chatId) || chatId <= 0) {
        throw new NotFoundException('guest link is invalid');
      }
      return { chatId };
    } catch {
      throw new NotFoundException('guest link is invalid');
    }
  }
}

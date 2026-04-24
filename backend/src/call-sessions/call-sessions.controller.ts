import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CallSessionsService } from './call-sessions.service';

@UseGuards(AuthGuard)
@Controller('call-sessions')
export class CallSessionsController {
  constructor(private readonly callSessions: CallSessionsService) {}

  @Get()
  list(
    @Req() req: { user: { id: number } },
    @Query('chatId') chatId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.callSessions.listForUser(req.user.id, {
      chatId: chatId ? Number(chatId) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}

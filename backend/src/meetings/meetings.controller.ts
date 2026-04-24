import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @UseGuards(AuthGuard)
  @Post()
  create(@Req() req: { user: { id: number } }, @Body() dto: CreateMeetingDto) {
    return this.meetingsService.createMeeting(req.user.id, dto);
  }

  @UseGuards(AuthGuard)
  @Get('upcoming')
  listUpcoming(
    @Req() req: { user: { id: number } },
    @Query('chatId') chatId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.meetingsService.listUpcoming(req.user.id, {
      chatId: chatId ? Number(chatId) : undefined,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('guest/:token')
  getGuest(@Param('token') token: string) {
    return this.meetingsService.getGuestMeeting(token);
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  getOne(
    @Req() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.meetingsService.getMeeting(req.user.id, id);
  }

  @UseGuards(AuthGuard)
  @Patch(':id')
  update(
    @Req() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMeetingDto,
  ) {
    const { scope, occurrenceDate, ...rest } = dto;
    return this.meetingsService.updateMeeting(req.user.id, id, rest, scope ?? 'master', occurrenceDate);
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  cancel(
    @Req() req: { user: { id: number } },
    @Param('id', ParseIntPipe) id: number,
    @Query('scope') scope?: 'master' | 'single',
    @Query('occurrenceDate') occurrenceDate?: string,
  ) {
    return this.meetingsService.cancelMeeting(req.user.id, id, scope ?? 'master', occurrenceDate);
  }
}

import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { MeetingSchedulerService } from './meeting-scheduler.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsGateway } from './meetings.gateway';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [ChatModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingsGateway, MeetingSchedulerService],
  exports: [MeetingsService],
})
export class MeetingsModule {}

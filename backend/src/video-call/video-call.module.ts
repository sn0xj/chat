import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CallSessionsModule } from '../call-sessions/call-sessions.module';
import { ChatModule } from '../chat/chat.module';
import { MessageModule } from '../message/message.module';
import { MeetingStateService } from './meeting-state.service';
import { RealtimeBusService } from './realtime-bus.service';
import { VideoCallController } from './video-call.controller';
import { VideoCallGateway } from './video-call.gateway';
import { VideoCallService } from './video-call.service';

@Module({
  imports: [MessageModule, CallSessionsModule, ChatModule, JwtModule.register({})],
  controllers: [VideoCallController],
  providers: [VideoCallGateway, VideoCallService, MeetingStateService, RealtimeBusService],
  exports: [VideoCallService, MeetingStateService, RealtimeBusService],
})
export class VideoCallModule {}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MeetingsGateway } from './meetings.gateway';
import { MeetingsService } from './meetings.service';

const REMINDER_LEAD_MINUTES = Number(process.env.MEETING_REMINDER_LEAD_MIN || 10);
const START_TOLERANCE_MINUTES = 1;

@Injectable()
export class MeetingSchedulerService {
  private readonly logger = new Logger(MeetingSchedulerService.name);

  constructor(
    private readonly meetings: MeetingsService,
    private readonly gateway: MeetingsGateway,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    const now = new Date();
    try {
      await this.fireReminders(now);
      await this.fireStarting(now);
    } catch (err) {
      this.logger.error(`Scheduler tick failed: ${(err as Error).message}`);
    }
  }

  private computeRecipients(meeting: {
    hostId: number;
    participants: { userId: number }[];
  }): number[] {
    const ids = new Set<number>();
    ids.add(meeting.hostId);
    for (const p of meeting.participants) ids.add(p.userId);
    return Array.from(ids);
  }

  private async fireReminders(now: Date) {
    const leadEndExclusive = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60 * 1000);
    const leadStartExclusive = new Date(leadEndExclusive.getTime() - 60 * 1000);
    const dueList = await this.meetings.findDueReminders(now, REMINDER_LEAD_MINUTES);
    for (const { meeting, occurrence } of dueList) {
      const startsAtDate = new Date(occurrence.startsAt);
      if (startsAtDate < leadStartExclusive || startsAtDate >= leadEndExclusive) {
        continue;
      }
      if (
        meeting.lastReminderFiredAt &&
        Math.abs(meeting.lastReminderFiredAt.getTime() - startsAtDate.getTime()) <
          REMINDER_LEAD_MINUTES * 60 * 1000
      ) {
        continue;
      }
      const recipients = this.computeRecipients(meeting);
      const hostName = occurrence.hostName;
      this.gateway.emitToUsers(recipients, 'meeting_reminder', {
        meetingId: occurrence.meetingId,
        occurrenceDate: occurrence.occurrenceDate,
        startsAt: occurrence.startsAt,
        title: occurrence.title,
        chatId: occurrence.chatId,
        minutesBefore: REMINDER_LEAD_MINUTES,
        hostName,
      });
      await this.meetings.markReminderFired(meeting.id, now);
    }
  }

  private async fireStarting(now: Date) {
    const windowStart = new Date(now.getTime() - START_TOLERANCE_MINUTES * 60 * 1000);
    const windowEnd = new Date(now.getTime() + START_TOLERANCE_MINUTES * 60 * 1000);
    const dueList = await this.meetings.findDueReminders(
      windowStart,
      START_TOLERANCE_MINUTES * 2,
    );
    for (const { meeting, occurrence } of dueList) {
      const startsAtDate = new Date(occurrence.startsAt);
      if (startsAtDate < windowStart || startsAtDate > windowEnd) {
        continue;
      }
      if (
        meeting.lastStartFiredAt &&
        Math.abs(meeting.lastStartFiredAt.getTime() - startsAtDate.getTime()) < 90 * 1000
      ) {
        continue;
      }
      const recipients = this.computeRecipients(meeting);
      this.gateway.emitToUsers(recipients, 'meeting_starting', {
        meetingId: occurrence.meetingId,
        occurrenceDate: occurrence.occurrenceDate,
        startsAt: occurrence.startsAt,
        title: occurrence.title,
        chatId: occurrence.chatId,
        hostName: occurrence.hostName,
      });
      await this.meetings.markStartFired(meeting.id, now);
    }
  }
}

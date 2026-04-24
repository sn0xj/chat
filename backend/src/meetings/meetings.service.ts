import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { RRule, RRuleSet, rrulestr } from 'rrule';
import { ChatService } from '../chat/chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { MeetingsGateway } from './meetings.gateway';

const INVITE_TOKEN_LENGTH = 21;
const UPCOMING_DEFAULT_LIMIT = 50;
const UPCOMING_MAX_LIMIT = 200;
const UPCOMING_DEFAULT_WINDOW_DAYS = 30;

type MeetingWithRelations = Prisma.MeetingGetPayload<{
  include: {
    host: { select: { id: true; username: true; firstname: true; lastname: true } };
    participants: {
      include: {
        user: { select: { id: true; username: true; firstname: true; lastname: true } };
      };
    };
    overrides: true;
  };
}>;

export type MeetingOccurrenceDto = {
  meetingId: number;
  occurrenceDate: string;
  startsAt: string;
  endsAt: string;
  title: string;
  description?: string | null;
  chatId?: number | null;
  hostName: string;
  inviteToken: string;
  durationMin: number;
  participantUserIds: number[];
};

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: MeetingsGateway,
    private readonly chatService: ChatService,
  ) {}

  private notifyAudience(
    meeting: MeetingWithRelations,
    event: 'meeting_created' | 'meeting_updated' | 'meeting_cancelled',
  ) {
    const ids = new Set<number>();
    ids.add(meeting.hostId);
    for (const p of meeting.participants) ids.add(p.userId);
    this.gateway.emitToUsers(Array.from(ids), event, { meetingId: meeting.id });
  }

  private readonly meetingInclude = {
    host: { select: { id: true, username: true, firstname: true, lastname: true } },
    participants: {
      include: {
        user: { select: { id: true, username: true, firstname: true, lastname: true } },
      },
    },
    overrides: true,
  } as const;

  private serializeMeeting(meeting: MeetingWithRelations) {
    return {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      chatId: meeting.chatId,
      hostId: meeting.hostId,
      host: {
        id: meeting.host.id,
        username: meeting.host.username,
        firstname: meeting.host.firstname,
        lastname: meeting.host.lastname,
      },
      startsAt: meeting.startsAt.toISOString(),
      durationMin: meeting.durationMin,
      rrule: meeting.rrule,
      recurrenceEndsAt: meeting.recurrenceEndsAt ? meeting.recurrenceEndsAt.toISOString() : null,
      inviteToken: meeting.inviteToken,
      cancelledAt: meeting.cancelledAt ? meeting.cancelledAt.toISOString() : null,
      createdAt: meeting.createdAt.toISOString(),
      participants: meeting.participants.map((p) => ({
        userId: p.userId,
        username: p.user.username,
        firstname: p.user.firstname,
        lastname: p.user.lastname,
        invitedAt: p.invitedAt.toISOString(),
      })),
    };
  }

  private async ensureChatAccess(userId: number, chatId: number) {
    const member = await this.prisma.chatMember.findFirst({
      where: { chat_id: chatId, user_id: userId },
    });
    if (!member) {
      throw new ForbiddenException('No access to chat');
    }
  }

  private validateRRule(rrule: string, dtstart: Date): Date | null {
    let parsed: RRule | RRuleSet;
    try {
      parsed = rrulestr(rrule, { dtstart }) as RRule | RRuleSet;
    } catch (err) {
      this.logger.debug(`Invalid RRULE: ${(err as Error).message}`);
      throw new BadRequestException('Invalid RRULE');
    }
    const options =
      parsed instanceof RRule
        ? parsed.options
        : (parsed as RRuleSet).rrules()[0]?.options;
    if (!options) {
      return null;
    }
    if (options.until) {
      return options.until as Date;
    }
    if (options.count) {
      const all = parsed.all((_, i) => i < Math.min(options.count as number, 500));
      return all.length ? all[all.length - 1] : null;
    }
    return null;
  }

  private hostName(meeting: MeetingWithRelations): string {
    const { firstname, lastname, username } = meeting.host;
    const fullname = [firstname, lastname].filter(Boolean).join(' ').trim();
    return fullname || username;
  }

  private expandOccurrences(
    meeting: MeetingWithRelations,
    fromDate: Date,
    toDate: Date,
  ): MeetingOccurrenceDto[] {
    if (meeting.cancelledAt) {
      return [];
    }
    const durationMs = meeting.durationMin * 60 * 1000;
    const hostName = this.hostName(meeting);
    const participantUserIds = meeting.participants.map((p) => p.userId);
    const overridesByDate = new Map<string, (typeof meeting.overrides)[number]>();
    for (const override of meeting.overrides) {
      overridesByDate.set(override.occurrenceDate.toISOString(), override);
    }

    const buildOccurrence = (occurrenceDate: Date, startsAt: Date, title: string): MeetingOccurrenceDto => ({
      meetingId: meeting.id,
      occurrenceDate: occurrenceDate.toISOString(),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + durationMs).toISOString(),
      title,
      description: meeting.description,
      chatId: meeting.chatId,
      hostName,
      inviteToken: meeting.inviteToken,
      durationMin: meeting.durationMin,
      participantUserIds,
    });

    if (!meeting.rrule) {
      const start = meeting.startsAt;
      const end = new Date(start.getTime() + durationMs);
      if (end < fromDate || start > toDate) {
        return [];
      }
      const override = overridesByDate.get(start.toISOString());
      if (override?.cancelled) {
        return [];
      }
      const effectiveStart = override?.newStartsAt ?? start;
      const title = override?.newTitle ?? meeting.title;
      return [buildOccurrence(start, effectiveStart, title)];
    }

    let ruleSet: RRuleSet | RRule;
    try {
      ruleSet = rrulestr(meeting.rrule, { dtstart: meeting.startsAt });
    } catch (err) {
      this.logger.warn(`Meeting ${meeting.id} has invalid RRULE: ${(err as Error).message}`);
      return [];
    }
    const expandFrom = new Date(fromDate.getTime() - durationMs);
    const dates = ruleSet.between(expandFrom, toDate, true);
    const occurrences: MeetingOccurrenceDto[] = [];
    for (const date of dates) {
      const iso = date.toISOString();
      const override = overridesByDate.get(iso);
      if (override?.cancelled) {
        continue;
      }
      const effectiveStart = override?.newStartsAt ?? date;
      const effectiveEnd = new Date(effectiveStart.getTime() + durationMs);
      if (effectiveEnd < fromDate || effectiveStart > toDate) {
        continue;
      }
      const title = override?.newTitle ?? meeting.title;
      occurrences.push(buildOccurrence(date, effectiveStart, title));
    }
    return occurrences;
  }

  async createMeeting(userId: number, dto: CreateMeetingDto) {
    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Invalid startsAt');
    }
    if (dto.chatId) {
      await this.ensureChatAccess(userId, dto.chatId);
    }
    const participantIds = Array.from(
      new Set((dto.participantUserIds ?? []).filter((id) => Number.isFinite(id) && id > 0 && id !== userId)),
    );
    if (participantIds.length > 0) {
      const existing = await this.prisma.auth.findMany({
        where: { id: { in: participantIds } },
        select: { id: true },
      });
      if (existing.length !== participantIds.length) {
        throw new BadRequestException('One or more participants do not exist');
      }
    }
    let recurrenceEndsAt: Date | null = null;
    if (dto.rrule) {
      recurrenceEndsAt = this.validateRRule(dto.rrule, startsAt);
    }
    const inviteToken = nanoid(INVITE_TOKEN_LENGTH);

    // Auto-assign or auto-create a chat based on participant count, unless caller
    // explicitly passed one. 1:1 meetings reuse/create a private chat; meetings
    // with 2+ participants get a dedicated meeting chat; meetings with no other
    // participants stay chat-less (guest-only).
    let resolvedChatId = dto.chatId ?? null;
    if (resolvedChatId === null) {
      if (participantIds.length === 1) {
        const dm = await this.chatService.createOrGetPrivateChat(userId, participantIds[0]);
        resolvedChatId = dm.id;
      } else if (participantIds.length >= 2) {
        const meetingChat = await this.chatService.createMeetingChat(userId, {
          title: dto.title.trim() || 'Встреча',
          memberIds: participantIds,
        });
        resolvedChatId = meetingChat.id;
      }
    }

    const meeting = await this.prisma.meeting.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        chatId: resolvedChatId,
        hostId: userId,
        startsAt,
        durationMin: dto.durationMin,
        rrule: dto.rrule || null,
        recurrenceEndsAt,
        inviteToken,
        participants: {
          create: participantIds.map((id) => ({ userId: id })),
        },
      },
      include: this.meetingInclude,
    });
    this.notifyAudience(meeting, 'meeting_created');
    return this.serializeMeeting(meeting);
  }

  async getMeeting(userId: number, meetingId: number) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: this.meetingInclude,
    });
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }
    this.assertViewAccess(userId, meeting);
    return this.serializeMeeting(meeting);
  }

  private assertViewAccess(userId: number, meeting: MeetingWithRelations) {
    if (meeting.hostId === userId) {
      return;
    }
    if (meeting.participants.some((p) => p.userId === userId)) {
      return;
    }
    throw new ForbiddenException('No access to meeting');
  }

  async updateMeeting(
    userId: number,
    meetingId: number,
    dto: UpdateMeetingDto,
    scope: 'master' | 'single' = 'master',
    occurrenceDate?: string,
  ) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: this.meetingInclude,
    });
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }
    if (meeting.hostId !== userId) {
      throw new ForbiddenException('Only host can edit meeting');
    }
    if (meeting.cancelledAt) {
      throw new BadRequestException('Meeting is cancelled');
    }

    if (scope === 'single') {
      if (!occurrenceDate) {
        throw new BadRequestException('occurrenceDate is required for single-scope update');
      }
      const occurrence = new Date(occurrenceDate);
      if (Number.isNaN(occurrence.getTime())) {
        throw new BadRequestException('Invalid occurrenceDate');
      }
      const newStartsAt = dto.startsAt ? new Date(dto.startsAt) : null;
      if (newStartsAt && Number.isNaN(newStartsAt.getTime())) {
        throw new BadRequestException('Invalid startsAt');
      }
      await this.prisma.meetingOccurrenceOverride.upsert({
        where: { meetingId_occurrenceDate: { meetingId, occurrenceDate: occurrence } },
        update: {
          newStartsAt,
          newTitle: dto.title ?? undefined,
          cancelled: false,
        },
        create: {
          meetingId,
          occurrenceDate: occurrence,
          newStartsAt,
          newTitle: dto.title ?? null,
          cancelled: false,
        },
      });
      const updated = await this.prisma.meeting.findUniqueOrThrow({
        where: { id: meetingId },
        include: this.meetingInclude,
      });
      this.notifyAudience(updated, 'meeting_updated');
      return this.serializeMeeting(updated);
    }

    const data: Prisma.MeetingUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.startsAt !== undefined) {
      const next = new Date(dto.startsAt);
      if (Number.isNaN(next.getTime())) throw new BadRequestException('Invalid startsAt');
      data.startsAt = next;
    }
    if (dto.durationMin !== undefined) data.durationMin = dto.durationMin;
    if (dto.rrule !== undefined) {
      data.rrule = dto.rrule || null;
      const startsAt = data.startsAt instanceof Date ? data.startsAt : meeting.startsAt;
      data.recurrenceEndsAt = dto.rrule ? this.validateRRule(dto.rrule, startsAt) : null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.meeting.update({ where: { id: meetingId }, data });
      if (dto.participantUserIds !== undefined) {
        const nextIds = Array.from(
          new Set(
            dto.participantUserIds.filter((id) => Number.isFinite(id) && id > 0 && id !== userId),
          ),
        );
        const existingIds = new Set(meeting.participants.map((p) => p.userId));
        const toAdd = nextIds.filter((id) => !existingIds.has(id));
        const toRemove = [...existingIds].filter((id) => !nextIds.includes(id));
        if (toRemove.length > 0) {
          await tx.meetingParticipant.deleteMany({
            where: { meetingId, userId: { in: toRemove } },
          });
        }
        if (toAdd.length > 0) {
          await tx.meetingParticipant.createMany({
            data: toAdd.map((id) => ({ meetingId, userId: id })),
            skipDuplicates: true,
          });
        }
      }
    });

    const updated = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: this.meetingInclude,
    });
    this.notifyAudience(updated, 'meeting_updated');
    return this.serializeMeeting(updated);
  }

  async cancelMeeting(
    userId: number,
    meetingId: number,
    scope: 'master' | 'single' = 'master',
    occurrenceDate?: string,
  ) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: this.meetingInclude,
    });
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }
    if (meeting.hostId !== userId) {
      throw new ForbiddenException('Only host can cancel meeting');
    }
    if (scope === 'single') {
      if (!occurrenceDate) {
        throw new BadRequestException('occurrenceDate is required for single-scope cancel');
      }
      const occurrence = new Date(occurrenceDate);
      if (Number.isNaN(occurrence.getTime())) {
        throw new BadRequestException('Invalid occurrenceDate');
      }
      await this.prisma.meetingOccurrenceOverride.upsert({
        where: { meetingId_occurrenceDate: { meetingId, occurrenceDate: occurrence } },
        update: { cancelled: true },
        create: { meetingId, occurrenceDate: occurrence, cancelled: true },
      });
      this.notifyAudience(meeting, 'meeting_updated');
      return { ok: true as const };
    }
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { cancelledAt: new Date() },
    });
    this.notifyAudience(meeting, 'meeting_cancelled');
    return { ok: true as const };
  }

  async listUpcoming(
    userId: number,
    options: { chatId?: number; from?: string; to?: string; limit?: number } = {},
  ) {
    const now = new Date();
    const from = options.from ? new Date(options.from) : now;
    if (Number.isNaN(from.getTime())) throw new BadRequestException('Invalid from');
    const defaultTo = new Date(from.getTime() + UPCOMING_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const to = options.to ? new Date(options.to) : defaultTo;
    if (Number.isNaN(to.getTime())) throw new BadRequestException('Invalid to');
    const limit = Math.max(1, Math.min(options.limit ?? UPCOMING_DEFAULT_LIMIT, UPCOMING_MAX_LIMIT));

    if (options.chatId) {
      await this.ensureChatAccess(userId, options.chatId);
    }

    const where: Prisma.MeetingWhereInput = {
      cancelledAt: null,
      OR: [
        { hostId: userId },
        { participants: { some: { userId } } },
      ],
      AND: [
        {
          OR: [
            { rrule: null, startsAt: { lte: to } },
            { rrule: { not: null } },
          ],
        },
        {
          OR: [
            { recurrenceEndsAt: null },
            { recurrenceEndsAt: { gte: from } },
          ],
        },
      ],
      ...(options.chatId ? { chatId: options.chatId } : {}),
    };

    const meetings = await this.prisma.meeting.findMany({
      where,
      include: this.meetingInclude,
      orderBy: { startsAt: 'asc' },
    });

    const occurrences: MeetingOccurrenceDto[] = [];
    for (const meeting of meetings) {
      occurrences.push(...this.expandOccurrences(meeting, from, to));
    }
    occurrences.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return occurrences.slice(0, limit);
  }

  async getGuestMeeting(token: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { inviteToken: token },
      include: this.meetingInclude,
    });
    if (!meeting || meeting.cancelledAt) {
      throw new NotFoundException('Meeting not found');
    }
    return {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      startsAt: meeting.startsAt.toISOString(),
      durationMin: meeting.durationMin,
      hostName: this.hostName(meeting),
      chatId: meeting.chatId,
      rrule: meeting.rrule,
    };
  }

  async findDueReminders(now: Date, leadMinutes: number) {
    const windowStart = new Date(now.getTime());
    const windowEnd = new Date(now.getTime() + leadMinutes * 60 * 1000);
    const meetings = await this.prisma.meeting.findMany({
      where: {
        cancelledAt: null,
        OR: [
          { recurrenceEndsAt: null },
          { recurrenceEndsAt: { gte: now } },
        ],
      },
      include: this.meetingInclude,
    });
    const results: Array<{ meeting: MeetingWithRelations; occurrence: MeetingOccurrenceDto }> = [];
    for (const meeting of meetings) {
      const occurrences = this.expandOccurrences(meeting, windowStart, windowEnd);
      for (const occurrence of occurrences) {
        const startsAtDate = new Date(occurrence.startsAt);
        if (startsAtDate < windowStart || startsAtDate > windowEnd) {
          continue;
        }
        results.push({ meeting, occurrence });
      }
    }
    return results;
  }

  async markReminderFired(meetingId: number, firedAt: Date) {
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { lastReminderFiredAt: firedAt },
    });
  }

  async markStartFired(meetingId: number, firedAt: Date) {
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { lastStartFiredAt: firedAt },
    });
  }
}

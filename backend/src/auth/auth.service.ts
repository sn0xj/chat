import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Auth } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

type Tokens = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.auth.findUnique({
      where: { username: dto.username },
    });
    if (exists) {
      throw new BadRequestException('Username already exists');
    }

    const now = new Date();
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.auth.create({
      data: {
        username: dto.username,
        password: hashedPassword,
        firstname: dto.firstname,
        lastname: dto.lastname,
        wrong_attempts: 0,
        created_at: now,
        updated_at: now,
        last_seen: now,
        last_activity: now,
        last_password_change_date: now,
      },
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
      },
    });
    return user;
  }

  async login(dto: LoginDto): Promise<Tokens> {
    const user = await this.prisma.auth.findUnique({
      where: { username: dto.username },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(dto.password, user.password);
    if (!isValid) {
      await this.prisma.auth.update({
        where: { id: user.id },
        data: { wrong_attempts: { increment: 1 }, updated_at: new Date() },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const now = new Date();
    await this.prisma.auth.update({
      where: { id: user.id },
      data: { wrong_attempts: 0, last_seen: now, last_activity: now, updated_at: now },
    });

    return this.issueTokens(user);
  }

  async refresh(dto: RefreshDto): Promise<Tokens> {
    const users = await this.prisma.auth.findMany({
      where: { refreshToken: { not: null } },
    });
    let matched: Auth | null = null;
    for (const user of users) {
      if (!user.refreshToken) {
        continue;
      }
      const ok = await bcrypt.compare(dto.refreshToken, user.refreshToken);
      if (ok) {
        matched = user;
        break;
      }
    }
    if (!matched) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.prisma.auth.update({
      where: { id: matched.id },
      data: { last_activity: new Date(), updated_at: new Date() },
    });
    return this.issueTokens(matched);
  }

  async me(userId: number) {
    const user = await this.prisma.auth.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        last_activity: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    await this.prisma.auth.update({
      where: { id: user.id },
      data: { last_activity: new Date(), updated_at: new Date() },
    });
    return user;
  }

  async listUsers(currentUserId: number) {
    return this.prisma.auth.findMany({
      where: { id: { not: currentUserId } },
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        last_activity: true,
      },
      orderBy: [{ firstname: 'asc' }, { username: 'asc' }],
    });
  }

  private async issueTokens(user: Auth): Promise<Tokens> {
    const payload = { sub: user.id, username: user.username };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
      expiresIn: '15m',
    });
    const refreshTokenRaw = `${randomUUID()}-${user.id}`;
    const refreshToken = await this.jwtService.signAsync(
      { ...payload, rid: refreshTokenRaw },
      {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
        expiresIn: '7d',
      },
    );
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.prisma.auth.update({
      where: { id: user.id },
      data: {
        refreshToken: refreshTokenHash,
        refreshTokenId: randomUUID(),
        updated_at: new Date(),
      },
    });
    return { accessToken, refreshToken };
  }
}

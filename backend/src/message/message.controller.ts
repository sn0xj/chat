import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  ParseIntPipe,
  Post,
  Query,
  Res,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { MessageCryptoService } from '../crypto/message-crypto.service';
import { GetChatFilesDto } from './dto/get-chat-files.dto';
import { GetMessagesDto } from './dto/get-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { MessageService } from './message.service';

@UseGuards(AuthGuard)
@Controller('messages')
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    private readonly messageCryptoService: MessageCryptoService,
  ) {}

  @Post(':chatId/upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, _file, callback) => {
          const destination = join(process.cwd(), 'uploads');
          if (!existsSync(destination)) {
            mkdirSync(destination, { recursive: true });
          }
          callback(null, destination);
        },
        filename: (_, file, callback) => {
          const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
          const extension = extname(file.originalname || '');
          callback(null, `${suffix}${extension}`);
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async uploadAttachment(
    @Req() req: { user: { id: number }; params: { chatId: string } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    await this.messageService.ensureMember(req.user.id, chatId);
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const encrypted = this.messageCryptoService.encryptAttachment(readFileSync(file.path), {
      actorUserId: req.user.id,
      chatId,
    });
    writeFileSync(file.path, encrypted);
    return {
      name: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      url: `/messages/${chatId}/attachments/${file.filename}`,
      kind: file.mimetype?.startsWith('image/') ? 'image' : 'file',
    };
  }

  @Get(':chatId/attachments/:fileName')
  async getAttachment(
    @Req() req: { user: { id: number } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    await this.messageService.ensureMember(req.user.id, chatId);
    if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
      throw new NotFoundException('File not found');
    }
    const filePath = join(process.cwd(), 'uploads', fileName);
    if (!existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }
    const decrypted = this.messageCryptoService.decryptAttachment(readFileSync(filePath), {
      actorUserId: req.user.id,
      chatId,
      fileName,
    });
    return res
      .setHeader('Content-Disposition', `inline; filename="${fileName}"`)
      .setHeader('Content-Type', this.resolveMimeType(fileName))
      .send(decrypted);
  }

  @Get(':chatId/files')
  getChatFiles(
    @Req() req: { user: { id: number } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @Query() query: GetChatFilesDto,
  ) {
    return this.messageService.getChatFiles(req.user.id, chatId, {
      beforeMessageId: query.beforeMessageId,
      limit: query.limit,
    });
  }

  @Get(':chatId')
  getMessages(
    @Req() req: { user: { id: number } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @Query() query: GetMessagesDto,
  ) {
    return this.messageService.getMessages(req.user.id, chatId, query.beforeId);
  }

  @Post(':chatId')
  send(
    @Req() req: { user: { id: number } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body() dto: SendMessageDto,
  ) {
    return this.messageService.createMessage(req.user.id, chatId, dto.text);
  }

  @Patch(':chatId/:messageId')
  update(
    @Req() req: { user: { id: number } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messageService.updateMessage(req.user.id, chatId, messageId, dto.text);
  }

  @Delete(':chatId/:messageId')
  remove(
    @Req() req: { user: { id: number } },
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('messageId', ParseIntPipe) messageId: number,
  ) {
    return this.messageService.deleteMessage(req.user.id, chatId, messageId);
  }

  private resolveMimeType(fileName: string) {
    const ext = extname(fileName).toLowerCase();
    switch (ext) {
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      case '.pdf':
        return 'application/pdf';
      case '.geojson':
        return 'application/geo+json';
      case '.json':
        return 'application/json';
      case '.txt':
        return 'text/plain; charset=utf-8';
      default:
        return 'application/octet-stream';
    }
  }
}

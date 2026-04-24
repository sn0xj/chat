import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  DecryptedMessageResult,
  EncryptedMessageEnvelope,
  MessageEncryptionMetadata,
} from './message-crypto.types';
import { CryptoAuditService } from './crypto-audit.service';

const ENCRYPTED_PREFIX = 'SC_ENC_V1:';
const FILE_ENCRYPTED_PREFIX = 'SC_FILE_ENC_V1:';
const ENCRYPTION_VERSION = 1;
const DEV_ALGORITHM = 'aes-256-gcm';
const DEV_ALGORITHM_ID = 'DEV_AES_256_GCM';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_BYTES = 16;

type KeyConfig = {
  id: string;
  key: Buffer;
};

@Injectable()
export class MessageCryptoService {
  private readonly keys: Map<string, Buffer>;
  private readonly primaryKey: KeyConfig;

  constructor(private readonly audit: CryptoAuditService) {
    const keyring = this.buildKeyring();
    this.keys = keyring.keys;
    this.primaryKey = keyring.primary;
  }

  encryptText(plaintext: string, context?: { actorUserId?: number; chatId?: number }) {
    try {
      const iv = randomBytes(IV_LENGTH_BYTES);
      const cipher = createCipheriv(DEV_ALGORITHM, this.primaryKey.key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const metadata: MessageEncryptionMetadata = {
        version: ENCRYPTION_VERSION,
        algorithmId: DEV_ALGORITHM_ID,
        keyId: this.primaryKey.id,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
      };
      const payload: EncryptedMessageEnvelope = {
        metadata,
        ciphertext: ciphertext.toString('base64'),
      };
      this.audit.log({
        action: 'encrypt_message',
        actorUserId: context?.actorUserId,
        chatId: context?.chatId,
        keyId: metadata.keyId,
        algorithmId: metadata.algorithmId,
        success: true,
      });
      return `${ENCRYPTED_PREFIX}${JSON.stringify(payload)}`;
    } catch {
      this.audit.log({
        action: 'encrypt_message',
        actorUserId: context?.actorUserId,
        chatId: context?.chatId,
        success: false,
        reason: 'encrypt_failed',
      });
      throw new InternalServerErrorException('Message encryption failed');
    }
  }

  decryptText(raw: string | null, context?: { actorUserId?: number; chatId?: number; messageId?: number }) {
    if (!raw) {
      return { text: '', metadata: null as MessageEncryptionMetadata | null };
    }
    if (!raw.startsWith(ENCRYPTED_PREFIX)) {
      return { text: raw, metadata: null as MessageEncryptionMetadata | null };
    }
    try {
      const envelope = JSON.parse(raw.slice(ENCRYPTED_PREFIX.length)) as EncryptedMessageEnvelope;
      const key = this.keys.get(envelope.metadata.keyId);
      if (!key) {
        throw new Error('missing_key');
      }
      const decipher = createDecipheriv(
        DEV_ALGORITHM,
        key,
        Buffer.from(envelope.metadata.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(envelope.metadata.authTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');

      this.audit.log({
        action: 'decrypt_message',
        actorUserId: context?.actorUserId,
        chatId: context?.chatId,
        messageId: context?.messageId,
        keyId: envelope.metadata.keyId,
        algorithmId: envelope.metadata.algorithmId,
        success: true,
      });
      return { text: plaintext, metadata: envelope.metadata } as DecryptedMessageResult & {
        metadata: MessageEncryptionMetadata;
      };
    } catch {
      this.audit.log({
        action: 'decrypt_message',
        actorUserId: context?.actorUserId,
        chatId: context?.chatId,
        messageId: context?.messageId,
        success: false,
        reason: 'decrypt_failed',
      });
      throw new InternalServerErrorException('Message decryption failed');
    }
  }

  getDefaultEncryptionMetadata() {
    return {
      version: ENCRYPTION_VERSION,
      algorithmId: DEV_ALGORITHM_ID,
      keyId: this.primaryKey.id,
    };
  }

  encryptAttachment(buffer: Buffer, context?: { actorUserId?: number; chatId?: number }) {
    try {
      const iv = randomBytes(IV_LENGTH_BYTES);
      const cipher = createCipheriv(DEV_ALGORITHM, this.primaryKey.key, iv);
      const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const metadata: MessageEncryptionMetadata = {
        version: ENCRYPTION_VERSION,
        algorithmId: DEV_ALGORITHM_ID,
        keyId: this.primaryKey.id,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
      };
      const payload: EncryptedMessageEnvelope = {
        metadata,
        ciphertext: ciphertext.toString('base64'),
      };
      this.audit.log({
        action: 'encrypt_attachment',
        actorUserId: context?.actorUserId,
        chatId: context?.chatId,
        keyId: metadata.keyId,
        algorithmId: metadata.algorithmId,
        success: true,
      });
      return Buffer.from(`${FILE_ENCRYPTED_PREFIX}${JSON.stringify(payload)}`, 'utf8');
    } catch {
      this.audit.log({
        action: 'encrypt_attachment',
        actorUserId: context?.actorUserId,
        chatId: context?.chatId,
        success: false,
        reason: 'encrypt_failed',
      });
      throw new InternalServerErrorException('Attachment encryption failed');
    }
  }

  decryptAttachment(
    raw: Buffer,
    context?: { actorUserId?: number; chatId?: number; fileName?: string },
  ) {
    const source = raw.toString('utf8');
    if (!source.startsWith(FILE_ENCRYPTED_PREFIX)) {
      return raw;
    }
    try {
      const envelope = JSON.parse(source.slice(FILE_ENCRYPTED_PREFIX.length)) as EncryptedMessageEnvelope;
      const key = this.keys.get(envelope.metadata.keyId);
      if (!key) {
        throw new Error('missing_key');
      }
      const decipher = createDecipheriv(
        DEV_ALGORITHM,
        key,
        Buffer.from(envelope.metadata.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(envelope.metadata.authTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]);
      this.audit.log({
        action: 'decrypt_attachment',
        actorUserId: context?.actorUserId,
        chatId: context?.chatId,
        keyId: envelope.metadata.keyId,
        algorithmId: envelope.metadata.algorithmId,
        success: true,
      });
      return plaintext;
    } catch {
      this.audit.log({
        action: 'decrypt_attachment',
        actorUserId: context?.actorUserId,
        chatId: context?.chatId,
        success: false,
        reason: 'decrypt_failed',
      });
      throw new InternalServerErrorException('Attachment decryption failed');
    }
  }

  listActiveKeyIds() {
    return Array.from(this.keys.keys());
  }

  getPrimaryKeyId() {
    return this.primaryKey.id;
  }

  private buildKeyring() {
    const keys = new Map<string, Buffer>();
    const rawPrimaryKey = process.env.SC_MESSAGE_ENC_KEY_B64;
    const primaryKeyId = process.env.SC_MESSAGE_ENC_KEY_ID || 'dev-primary';
    const rawHistoric = process.env.SC_MESSAGE_ENC_PREVIOUS_KEYS || '';

    const primary = this.readKey(primaryKeyId, rawPrimaryKey);
    keys.set(primary.id, primary.key);

    const historicPairs = rawHistoric
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    for (const pair of historicPairs) {
      const [id, keyB64] = pair.split(':');
      if (!id || !keyB64 || keys.has(id)) {
        continue;
      }
      const resolved = this.readKey(id, keyB64);
      keys.set(resolved.id, resolved.key);
    }

    return { keys, primary };
  }

  private readKey(id: string, keyB64?: string): KeyConfig {
    if (!keyB64) {
      throw new Error('SC_MESSAGE_ENC_KEY_B64 is required');
    }
    const key = Buffer.from(keyB64, 'base64');
    if (key.length !== 32) {
      throw new Error(`Invalid key length for key ${id}, expected 32 bytes`);
    }
    return { id, key };
  }
}

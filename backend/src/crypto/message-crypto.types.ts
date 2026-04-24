export type MessageEncryptionMetadata = {
  version: number;
  algorithmId: string;
  keyId: string;
  iv: string;
  authTag: string;
};

export type EncryptedMessageEnvelope = {
  metadata: MessageEncryptionMetadata;
  ciphertext: string;
};

export type DecryptedMessageResult = {
  text: string;
  metadata: MessageEncryptionMetadata;
};

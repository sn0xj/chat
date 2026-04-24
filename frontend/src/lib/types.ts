export type AuthUser = {
  id: number;
  username: string;
  firstname?: string | null;
  lastname?: string | null;
};

export type ChatMember = {
  id: number;
  username: string;
  firstname?: string | null;
  lastname?: string | null;
  last_activity?: string | null;
  role: 'owner' | 'admin' | 'member';
};

export type Message = {
  id: number;
  chat_id: number;
  sender_id: number;
  text: string | null;
  type?: 'text' | 'call_event' | 'meeting_event';
  created_at: string | null;
  edited_at?: string | null;
  crypto_metadata?: MessageCryptoMetadata | null;
  sender: AuthUser;
};

export type MessageCryptoMetadata = {
  version: number;
  algorithmId: string;
  keyId: string;
  iv: string;
  authTag: string;
};

export type Chat = {
  id: number;
  type: 'private' | 'group' | 'meeting';
  title: string | null;
  updated_at: string | null;
  lastMessage: Message | null;
  members: ChatMember[];
};

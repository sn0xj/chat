export type SocketUser = {
  sub: number;
  username: string;
};

export type JoinRoomAck = {
  peerId: string;
  chatId: number;
  roomId: string;
  peerIds: string[];
  peerDirectory: Array<{ peerId: string; user: { id: number | null; username: string } | null }>;
  producerInfos: Array<{ producerId: string; peerId: string; kind: string }>;
  peerMediaHints: unknown[];
  peerQualityStates: unknown[];
  snapshot: unknown;
  scalabilityMode: 'full' | 'speaker-focus';
};

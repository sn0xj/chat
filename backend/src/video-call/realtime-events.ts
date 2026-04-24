export const RT_EVENTS = {
  ROOM_JOIN: 'room.join',
  ROOM_JOINED: 'room.joined',
  ROOM_LEAVE: 'room.leave',
  ROOM_PEER_JOINED: 'room.peer.joined',
  ROOM_PEER_LEFT: 'room.peer.left',
  ROOM_KICKED: 'room.kicked',
  STATE_PATCH: 'state.patch',
  STATE_DELTA: 'state.delta',
  STATE_SNAPSHOT_GET: 'state.snapshot.get',
  STATE_SNAPSHOT: 'state.snapshot',
  STATE_RESYNC_REQUEST: 'state.resync.request',
  RTC_OFFER: 'rtc.offer',
  RTC_ANSWER: 'rtc.answer',
  RTC_ICE: 'rtc.ice',
  SFU_GET_ROUTER_CAPS: 'sfu.routerCaps.get',
  SFU_CREATE_TRANSPORT: 'sfu.transport.create',
  SFU_CONNECT_TRANSPORT: 'sfu.transport.connect',
  SFU_PRODUCE: 'sfu.produce',
  SFU_CONSUME: 'sfu.consume',
  SFU_CONSUMER_RESUME: 'sfu.consumer.resume',
  SFU_GET_PRODUCERS: 'sfu.producers.get',
  SFU_NEW_PRODUCER: 'sfu.producer.new',
  CALL_CHAT_HISTORY_GET: 'call.chat.history.get',
  CALL_CHAT_MESSAGE_SEND: 'call.chat.message.send',
  CALL_CHAT_MESSAGE: 'call.chat.message',
} as const;

export type RealtimeEventName = (typeof RT_EVENTS)[keyof typeof RT_EVENTS];

export type StateDeltaEvent = {
  roomId: string;
  peerId: string;
  version: number;
  patch: Record<string, unknown>;
  ts: string;
  messageId: string;
  actorPeerId: string;
};

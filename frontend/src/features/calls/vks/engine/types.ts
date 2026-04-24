export type PrimaryVideoSource = 'none' | 'camera' | 'screen';

export type RemoteMediaHint = {
  audioEnabled: boolean;
  videoEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  primaryVideoSource: PrimaryVideoSource;
  screenTrackId: string | null;
  cameraTrackId: string | null;
  streamRef: string | null;
};

export type PeerMediaStatePayload = {
  audioEnabled: boolean;
  videoEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  primaryVideoSource: PrimaryVideoSource;
  streamRef: string | null;
  screenTrackId: string | null;
  cameraTrackId: string | null;
};

export type ConferencePeerSnapshot = {
  peerId: string;
  mic: { enabled: boolean; updatedAt: string | null };
  camera: {
    enabled: boolean;
    streamRef: string | null;
    trackRef: string | null;
    updatedAt: string | null;
  };
  screen: {
    enabled: boolean;
    streamRef: string | null;
    trackRef: string | null;
    updatedAt: string | null;
  };
  publishedStreams: Record<string, unknown>;
  connectionState: string;
  updatedAt: string | null;
};

export type ConferenceSnapshotDto = {
  roomId?: string | null;
  version?: number;
  peers?: Array<Partial<ConferencePeerSnapshot> & { peerId?: string }>;
};

export type PeerDirectoryRow = {
  peerId: string;
  user?: { id?: number | string; username?: string | null; guestName?: string | null } | null;
  guestName?: string | null;
};

export type SfuTrackSource = 'mic' | 'camera' | 'screen';

export type ProducerInfo = {
  producerId: string;
  peerId: string;
  kind: 'audio' | 'video';
  appData?: { source?: SfuTrackSource } & Record<string, unknown>;
};

export type NewProducerEvent = ProducerInfo & {
  user?: { id?: number | null; username?: string | null } | null;
};

export type JoinRoomAck = {
  peerId: string;
  roomId: string;
  peerIds?: string[];
  peerMediaHints?: Array<{ peerId: string } & Partial<PeerMediaStatePayload>>;
  peerQualityStates?: Array<{ peerId: string; [k: string]: unknown }>;
  snapshot?: ConferenceSnapshotDto | null;
  scalabilityMode?: 'full' | 'speaker-focus';
  peerDirectory?: PeerDirectoryRow[];
  producerInfos?: ProducerInfo[];
};

export type StateDeltaPayload = {
  roomId?: string;
  peerId?: string;
  version?: number;
  patch?: Partial<PeerMediaStatePayload>;
  ts?: string;
  actorPeerId?: string;
  messageId?: string;
};

export type PeerLabel = {
  peerId: string;
  displayName: string;
  isLocal: boolean;
  userId?: number | string | null;
};

export type RemoteParticipant = {
  peerId: string;
  displayName: string;
  stream: MediaStream | null;
  media: RemoteMediaHint;
  /** Ordered list of ids of live video tracks currently in this participant's stream (newest last). */
  videoTrackOrder: string[];
  connectionState: RTCPeerConnectionState;
};

export type LocalMediaSnapshot = {
  stream: MediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  /** The screen share stream (if active); independent from the camera stream. */
  screenStream: MediaStream | null;
};

export type CallEngineEvents = {
  /** Fired whenever a participant is added, removed, renamed, or its media changes. */
  participants: (participants: RemoteParticipant[]) => void;
  localMedia: (snapshot: LocalMediaSnapshot) => void;
  activeSpeaker: (peerId: string | null) => void;
  activeSpeakers: (peerIds: string[]) => void;
  connectionState: (state: 'idle' | 'connecting' | 'joined' | 'leaving' | 'left' | 'error') => void;
  error: (message: string) => void;
  /** Map of peerId -> displayName changes (including local). */
  peerLabels: (labels: Map<string, PeerLabel>) => void;
  /** Fired when the local peer was kicked. */
  kicked: (payload: { byPeerId?: string | null }) => void;
};

export type CallEngineListener<K extends keyof CallEngineEvents> = CallEngineEvents[K];

export type CallEngineOptions = {
  roomId: string;
  baseUrl: string;
  authToken: string | null;
  guestName?: string | null;
  /** Initial preferences applied right after joining. */
  initialMic?: boolean;
  initialCamera?: boolean;
  /** Optional STUN servers override. */
  iceServers?: RTCIceServer[];
};

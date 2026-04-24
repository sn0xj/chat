import { create } from 'zustand';
import type {
  CallEngineOptions,
  LocalMediaSnapshot,
  PeerLabel,
  RemoteParticipant,
} from '../engine/types';
import { createCallEngine, type CallEngine } from '../engine/call-engine';

export type ConnectionState = 'idle' | 'connecting' | 'joined' | 'leaving' | 'left' | 'error';

type CallStoreState = {
  engine: CallEngine | null;
  engineKey: string | null;
  roomId: string | null;
  connectionState: ConnectionState;
  participants: RemoteParticipant[];
  peerLabels: Map<string, PeerLabel>;
  localMedia: LocalMediaSnapshot;
  activeSpeaker: string | null;
  activeSpeakers: string[];
  lastError: string | null;
  kickedByPeer: string | null;
};

type CallStoreActions = {
  /** Create the underlying engine (idempotent on engineKey). */
  initEngine: (options: CallEngineOptions) => CallEngine;
  start: () => Promise<void>;
  leave: () => Promise<void>;
  disposeEngine: () => Promise<void>;
  toggleMic: () => void;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  kickPeer: (peerId: string) => Promise<void>;
  clearError: () => void;
};

const EMPTY_LOCAL_MEDIA: LocalMediaSnapshot = {
  stream: null,
  micEnabled: false,
  cameraEnabled: false,
  screenSharing: false,
  screenStream: null,
};

type CallStore = CallStoreState & CallStoreActions;

export const useCallStore = create<CallStore>((set, get) => ({
  engine: null,
  engineKey: null,
  roomId: null,
  connectionState: 'idle',
  participants: [],
  peerLabels: new Map(),
  localMedia: EMPTY_LOCAL_MEDIA,
  activeSpeaker: null,
  activeSpeakers: [],
  lastError: null,
  kickedByPeer: null,

  initEngine: (options) => {
    const key = buildEngineKey(options);
    const { engine, engineKey } = get();
    if (engine && engineKey === key) return engine;
    if (engine) {
      void engine.shutdown();
    }
    const nextEngine = createCallEngine(options);
    set({
      engine: nextEngine,
      engineKey: key,
      roomId: options.roomId,
      connectionState: 'idle',
      participants: [],
      peerLabels: new Map(),
      localMedia: EMPTY_LOCAL_MEDIA,
      activeSpeaker: null,
      activeSpeakers: [],
      lastError: null,
      kickedByPeer: null,
    });
    nextEngine.on('participants', (list) => set({ participants: list }));
    nextEngine.on('localMedia', (snap) => set({ localMedia: snap }));
    nextEngine.on('activeSpeaker', (peerId) => set({ activeSpeaker: peerId }));
    nextEngine.on('activeSpeakers', (peerIds) => set({ activeSpeakers: peerIds }));
    nextEngine.on('connectionState', (state) => set({ connectionState: state }));
    nextEngine.on('peerLabels', (labels) => set({ peerLabels: labels }));
    nextEngine.on('error', (message) => set({ lastError: message }));
    nextEngine.on('kicked', (payload) => set({ kickedByPeer: payload.byPeerId ?? null }));
    return nextEngine;
  },

  start: async () => {
    const engine = get().engine;
    if (!engine) return;
    await engine.start();
  },

  leave: async () => {
    const engine = get().engine;
    if (!engine) return;
    await engine.leave();
  },

  disposeEngine: async () => {
    const engine = get().engine;
    if (!engine) return;
    await engine.shutdown();
    set({
      engine: null,
      engineKey: null,
      roomId: null,
      connectionState: 'idle',
      participants: [],
      peerLabels: new Map(),
      localMedia: EMPTY_LOCAL_MEDIA,
      activeSpeaker: null,
      activeSpeakers: [],
    });
  },

  toggleMic: () => {
    get().engine?.toggleMic();
  },

  toggleCamera: async () => {
    await get().engine?.toggleCamera();
  },

  toggleScreenShare: async () => {
    await get().engine?.toggleScreenShare();
  },

  kickPeer: async (peerId) => {
    await get().engine?.kickPeer(peerId);
  },

  clearError: () => set({ lastError: null }),
}));

function buildEngineKey(options: CallEngineOptions): string {
  return [
    options.roomId,
    options.baseUrl,
    options.authToken ?? '',
    options.guestName ?? '',
    options.initialMic === false ? '0' : '1',
    options.initialCamera === false ? '0' : '1',
  ].join('|');
}

import { io, type Socket } from 'socket.io-client';

export type SignalingClient = {
  socket: Socket;
  on: <T = unknown>(event: string, handler: (payload: T) => void) => void;
  off: <T = unknown>(event: string, handler: (payload: T) => void) => void;
  emit: (event: string, payload?: unknown) => void;
  emitWithAck: <T = unknown>(
    event: string,
    payload?: unknown,
    timeoutMs?: number,
  ) => Promise<T>;
  onSocketReady: (handler: () => void) => void;
  onConnectionError: (handler: (err: Error) => void) => () => void;
  disconnect: () => void;
};

const DEFAULT_ACK_TIMEOUT_MS = 15000;

export function createSignalingClient(options: {
  baseUrl: string;
  authToken: string | null;
}): SignalingClient {
  const { baseUrl, authToken } = options;
  const origin =
    baseUrl && baseUrl.length > 0
      ? baseUrl
      : typeof window !== 'undefined'
        ? window.location.origin
        : '';
  const socketUrl = `${origin}/call`;
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.debug('[vks/call] creating signaling socket for', socketUrl);
  }
  const socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    forceNew: true,
    ...(authToken ? { auth: { token: authToken } } : {}),
  });

  if (typeof window !== 'undefined') {
    socket.on('connect', () => {
      // eslint-disable-next-line no-console
      console.debug('[vks/call] socket connected', socket.id);
    });
    socket.on('disconnect', (reason) => {
      // eslint-disable-next-line no-console
      console.debug('[vks/call] socket disconnected', reason);
    });
    socket.on('connect_error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[vks/call] socket connect_error', err?.message || err, err);
    });
    socket.io.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[vks/call] manager error', err?.message || err, err);
    });
    socket.io.on('reconnect_attempt', (n) => {
      // eslint-disable-next-line no-console
      console.debug('[vks/call] reconnect_attempt', n);
    });
  }

  const on = <T = unknown>(event: string, handler: (payload: T) => void) => {
    socket.on(event, handler as (payload: unknown) => void);
  };

  const off = <T = unknown>(event: string, handler: (payload: T) => void) => {
    socket.off(event, handler as (payload: unknown) => void);
  };

  const emit = (event: string, payload: unknown = {}) => {
    socket.emit(event, payload);
  };

  const emitWithAck = <T = unknown>(
    event: string,
    payload: unknown = {},
    timeoutMs: number = DEFAULT_ACK_TIMEOUT_MS,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const timer =
        timeoutMs > 0
          ? window.setTimeout(() => {
              if (settled) return;
              settled = true;
              reject(
                new Error(
                  socket.connected
                    ? `Сервер не ответил на "${event}" за ${Math.round(timeoutMs / 1000)} с`
                    : 'Нет соединения с сервером звонков',
                ),
              );
            }, timeoutMs)
          : null;
      socket.emit(event, payload, (response: unknown) => {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        if (response && typeof response === 'object' && 'error' in response) {
          const errMsg = (response as { error?: string }).error || 'Signaling error';
          reject(new Error(errMsg));
          return;
        }
        resolve(response as T);
      });
    });

  const onSocketReady = (handler: () => void) => {
    socket.on('connect', handler);
    if (socket.connected) {
      queueMicrotask(handler);
    }
  };

  const onConnectionError = (handler: (err: Error) => void): (() => void) => {
    const wrapped = (err: Error) => handler(err);
    socket.on('connect_error', wrapped);
    return () => {
      socket.off('connect_error', wrapped);
    };
  };

  const disconnect = () => {
    try {
      socket.removeAllListeners();
    } catch {
      // best-effort
    }
    try {
      socket.disconnect();
    } catch {
      // best-effort
    }
  };

  return {
    socket,
    on,
    off,
    emit,
    emitWithAck,
    onSocketReady,
    onConnectionError,
    disconnect,
  };
}

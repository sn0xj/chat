export function createSignalingClient() {
  const socket = io();

  function on(event, handler) {
    socket.on(event, handler);
  }

  function off(event, handler) {
    socket.off(event, handler);
  }

  /**
   * Не отбрасывать при кратковременном !connected — Socket.IO ставит в очередь после handshake.
   * Иначе peerMediaState терялся, если вызвали в тот же тик, что и joinRoom.
   */
  function emit(event, payload = {}) {
    socket.emit(event, payload);
  }

  function emitWithAck(event, payload = {}) {
    return new Promise((resolve, reject) => {
      socket.emit(event, payload, (response) => {
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  /** connect срабатывает и при первом подключении, и при reconnect — один обработчик. */
  function onSocketReady(handler) {
    socket.on("connect", handler);
    if (socket.connected) {
      queueMicrotask(handler);
    }
  }

  function disconnect() {
    try {
      socket.removeAllListeners();
    } catch (_) {
      // best-effort
    }
    try {
      socket.disconnect();
    } catch (_) {
      // best-effort
    }
  }

  return {
    on,
    off,
    emit,
    emitWithAck,
    onSocketReady,
    disconnect,
  };
}

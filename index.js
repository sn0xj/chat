const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const fs = require("fs");
const express = require("express");
const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

const PORT = Number(process.env.PORT || 3000);
const ANNOUNCED_IP = process.env.ANNOUNCED_IP || null;
const USE_HTTPS = process.env.USE_HTTPS === "true";
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(__dirname, "..", "certs", "key.pem");
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, "..", "certs", "cert.pem");

const app = express();

function createWebServer() {
  if (!USE_HTTPS) {
    return {
      server: http.createServer(app),
      protocol: "http",
    };
  }

  if (!fs.existsSync(SSL_KEY_PATH) || !fs.existsSync(SSL_CERT_PATH)) {
    throw new Error(
      `HTTPS enabled but cert files not found. Expected:\n- ${SSL_KEY_PATH}\n- ${SSL_CERT_PATH}\nRun: npm run cert:generate`
    );
  }

  return {
    server: https.createServer(
      {
        key: fs.readFileSync(SSL_KEY_PATH, "utf8"),
        cert: fs.readFileSync(SSL_CERT_PATH, "utf8"),
      },
      app
    ),
    protocol: "https",
  };
}

const { server: webServer, protocol } = createWebServer();
const io = new Server(webServer);

app.use(express.static(path.join(__dirname, "..", "client")));
app.use(express.json());

app.get("/api/rooms/:roomId/peer-status", (req, res) => {
  const roomId = normalizeClientRoomId(req.params.roomId);
  if (!roomId) {
    res.status(400).json({ error: "roomId is required" });
    return;
  }
  if (!rooms.has(roomId)) {
    res.status(404).json({ error: "room not found" });
    return;
  }

  const peers = getRoomPeerIds(roomId).map((peerId) => ({
    peerId,
    media: peerMediaHints.get(peerId) ?? { audioEnabled: true, videoEnabled: true },
    quality: peerQualityStates.get(peerId) ?? null,
  }));
  res.json({ roomId, peers });
});

const state = {
  worker: null,
  router: null,
  peers: new Map(),
};
const rooms = new Map();
const peerToRoom = new Map();
/** @type {Map<string, { audioEnabled: boolean, videoEnabled: boolean }>} */
const peerMediaHints = new Map();
/** @type {Map<string, PeerQualityState>} */
const peerQualityStates = new Map();

/**
 * @typedef {{
 *  microphone?: {
 *    enabled?: boolean,
 *    muted?: boolean,
 *    readyState?: "live" | "ended" | "unknown",
 *    level?: number,
 *    noiseDetected?: boolean,
 *    noiseSuppressionEnabled?: boolean,
 *    echoCancellationEnabled?: boolean,
 *    autoGainControlEnabled?: boolean,
 *  },
 *  camera?: {
 *    enabled?: boolean,
 *    muted?: boolean,
 *    readyState?: "live" | "ended" | "unknown",
 *    width?: number,
 *    height?: number,
 *    frameRate?: number,
 *  },
 *  connection?: {
 *    iceConnectionState?: string,
 *    connectionState?: string,
 *    rttMs?: number,
 *    jitterMs?: number,
 *    packetLossPct?: number,
 *    audioBitrateKbps?: number,
 *    videoBitrateKbps?: number,
 *    availableOutgoingBitrateKbps?: number,
 *    availableIncomingBitrateKbps?: number,
 *  },
 *  system?: {
 *    networkType?: string,
 *    downlinkMbps?: number,
 *    networkRttMs?: number,
 *  },
 *  updatedAt?: string,
 * }} PeerQualityState
 */

function createPeer() {
  return {
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };
}

async function createMediasoupWorker() {
  const worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: "warn",
  });

  worker.on("died", () => {
    process.exit(1);
  });

  const mediaCodecs = [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: "video",
      mimeType: "video/VP8",
      clockRate: 90000,
      parameters: {},
    },
  ];

  const router = await worker.createRouter({ mediaCodecs });
  return { worker, router };
}

function getListenIps() {
  if (ANNOUNCED_IP) {
    return [{ ip: "0.0.0.0", announcedIp: ANNOUNCED_IP }];
  }

  return [{ ip: "127.0.0.1", announcedIp: null }];
}

function getPeer(socketId) {
  if (!state.peers.has(socketId)) {
    state.peers.set(socketId, createPeer());
  }
  return state.peers.get(socketId);
}

function removePeer(socketId) {
  const peer = state.peers.get(socketId);
  if (!peer) return;

  for (const transport of peer.transports.values()) {
    transport.close();
  }
  for (const producer of peer.producers.values()) {
    producer.close();
  }
  for (const consumer of peer.consumers.values()) {
    consumer.close();
  }

  state.peers.delete(socketId);
}

function normalizeClientRoomId(roomId) {
  let s = String(roomId).trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep trimmed */
  }
  return s.trim();
}

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { peers: new Set() });
  }
  return rooms.get(roomId);
}

function removePeerFromRoom(socketId) {
  const roomId = peerToRoom.get(socketId);
  if (!roomId) return null;

  const room = rooms.get(roomId);
  if (room) {
    room.peers.delete(socketId);
    if (room.peers.size === 0) {
      rooms.delete(roomId);
    }
  }

  peerToRoom.delete(socketId);
  return roomId;
}

function getRoomPeerIds(roomId, excludeSocketId = null) {
  const room = rooms.get(roomId);
  if (!room) return [];

  return [...room.peers].filter((peerId) => peerId !== excludeSocketId);
}

function getPeerMediaHintsForRoom(roomId, excludeSocketId) {
  return getRoomPeerIds(roomId, excludeSocketId).map((peerId) => ({
    peerId,
    ...(peerMediaHints.get(peerId) ?? { audioEnabled: true, videoEnabled: true }),
  }));
}

function clampNumber(input, min, max) {
  if (typeof input !== "number" || Number.isNaN(input)) {
    return undefined;
  }
  return Math.max(min, Math.min(max, input));
}

function sanitizeReadyState(input) {
  if (input === "live" || input === "ended") {
    return input;
  }
  return "unknown";
}

function sanitizeQualityStatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("quality state payload is required");
  }

  const microphone = payload.microphone && typeof payload.microphone === "object"
    ? {
      enabled:
          typeof payload.microphone.enabled === "boolean" ? payload.microphone.enabled : undefined,
      muted: typeof payload.microphone.muted === "boolean" ? payload.microphone.muted : undefined,
      readyState: sanitizeReadyState(payload.microphone.readyState),
      level: clampNumber(payload.microphone.level, 0, 1),
      noiseDetected:
          typeof payload.microphone.noiseDetected === "boolean"
            ? payload.microphone.noiseDetected
            : undefined,
      noiseSuppressionEnabled:
          typeof payload.microphone.noiseSuppressionEnabled === "boolean"
            ? payload.microphone.noiseSuppressionEnabled
            : undefined,
      echoCancellationEnabled:
          typeof payload.microphone.echoCancellationEnabled === "boolean"
            ? payload.microphone.echoCancellationEnabled
            : undefined,
      autoGainControlEnabled:
          typeof payload.microphone.autoGainControlEnabled === "boolean"
            ? payload.microphone.autoGainControlEnabled
            : undefined,
    }
    : undefined;

  const camera = payload.camera && typeof payload.camera === "object"
    ? {
      enabled: typeof payload.camera.enabled === "boolean" ? payload.camera.enabled : undefined,
      muted: typeof payload.camera.muted === "boolean" ? payload.camera.muted : undefined,
      readyState: sanitizeReadyState(payload.camera.readyState),
      width: clampNumber(payload.camera.width, 0, 7680),
      height: clampNumber(payload.camera.height, 0, 4320),
      frameRate: clampNumber(payload.camera.frameRate, 0, 240),
    }
    : undefined;

  const connection = payload.connection && typeof payload.connection === "object"
    ? {
      iceConnectionState:
          typeof payload.connection.iceConnectionState === "string"
            ? payload.connection.iceConnectionState
            : undefined,
      connectionState:
          typeof payload.connection.connectionState === "string"
            ? payload.connection.connectionState
            : undefined,
      rttMs: clampNumber(payload.connection.rttMs, 0, 60000),
      jitterMs: clampNumber(payload.connection.jitterMs, 0, 60000),
      packetLossPct: clampNumber(payload.connection.packetLossPct, 0, 100),
      audioBitrateKbps: clampNumber(payload.connection.audioBitrateKbps, 0, 20000),
      videoBitrateKbps: clampNumber(payload.connection.videoBitrateKbps, 0, 200000),
      availableOutgoingBitrateKbps: clampNumber(
        payload.connection.availableOutgoingBitrateKbps,
        0,
        200000
      ),
      availableIncomingBitrateKbps: clampNumber(
        payload.connection.availableIncomingBitrateKbps,
        0,
        200000
      ),
    }
    : undefined;

  const system = payload.system && typeof payload.system === "object"
    ? {
      networkType:
          typeof payload.system.networkType === "string" ? payload.system.networkType : undefined,
      downlinkMbps: clampNumber(payload.system.downlinkMbps, 0, 10000),
      networkRttMs: clampNumber(payload.system.networkRttMs, 0, 60000),
    }
    : undefined;

  return {
    microphone,
    camera,
    connection,
    system,
    updatedAt: new Date().toISOString(),
  };
}

function getPeerQualityStatesForRoom(roomId, excludeSocketId) {
  return getRoomPeerIds(roomId, excludeSocketId).map((peerId) => ({
    peerId,
    ...(peerQualityStates.get(peerId) ?? {}),
  }));
}

function getPeerProducerIds(roomId, excludeSocketId) {
  const producerInfos = [];
  const peerIds = getRoomPeerIds(roomId, excludeSocketId);

  for (const peerId of peerIds) {
    const peer = state.peers.get(peerId);
    if (!peer) continue;
    for (const producer of peer.producers.values()) {
      producerInfos.push({
        producerId: producer.id,
        peerId,
        kind: producer.kind,
      });
    }
  }

  return producerInfos;
}

function getProducerOwnerPeerId(producerId) {
  for (const [peerId, peer] of state.peers.entries()) {
    if (peer.producers.has(producerId)) {
      return peerId;
    }
  }
  return null;
}

function emitToPeerSocket(io, targetSocketId, event, payload) {
  const target = io.sockets.sockets.get(targetSocketId);
  if (!target) {
    return false;
  }
  target.emit(event, payload);
  return true;
}

function emitToPeerSockets(io, peerIds, event, payload) {
  for (const peerId of peerIds) {
    if (!emitToPeerSocket(io, peerId, event, payload)) {
      // eslint-disable-next-line no-console
      console.warn(`[${event}] socket not found:`, peerId);
    }
  }
}

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId }, callback) => {
    try {
      if (!roomId || typeof roomId !== "string") {
        callback({ error: "roomId is required" });
        return;
      }

      const normalizedRoomId = normalizeClientRoomId(roomId);
      if (!normalizedRoomId) {
        callback({ error: "roomId is required" });
        return;
      }

      removePeerFromRoom(socket.id);

      const room = ensureRoom(normalizedRoomId);
      const existingPeerIds = [...room.peers];
      room.peers.add(socket.id);
      peerToRoom.set(socket.id, normalizedRoomId);

      emitToPeerSockets(io, existingPeerIds, "peerJoined", { peerId: socket.id });

      callback({
        roomId: normalizedRoomId,
        peerIds: existingPeerIds,
        producerInfos: getPeerProducerIds(normalizedRoomId, socket.id),
        peerMediaHints: getPeerMediaHintsForRoom(normalizedRoomId, socket.id),
        peerQualityStates: getPeerQualityStatesForRoom(normalizedRoomId, socket.id),
      });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on("leaveRoom", (_, callback) => {
    const roomId = removePeerFromRoom(socket.id);
    peerMediaHints.delete(socket.id);
    peerQualityStates.delete(socket.id);
    if (roomId) {
      const peerIds = getRoomPeerIds(roomId);
      emitToPeerSockets(io, peerIds, "peerLeft", { peerId: socket.id });
    }
    removePeer(socket.id);
    callback({ ok: true });
  });

  socket.on("peerMediaState", (payload, callback) => {
    const ack = typeof callback === "function" ? callback : () => {};
    try {
      const { audioEnabled, videoEnabled } = payload || {};
      if (typeof audioEnabled !== "boolean" || typeof videoEnabled !== "boolean") {
        ack({ error: "audioEnabled and videoEnabled booleans are required" });
        return;
      }
      const roomId = peerToRoom.get(socket.id);
      if (!roomId) {
        ack({ error: "Join room before sending media state" });
        return;
      }

      peerMediaHints.set(socket.id, { audioEnabled, videoEnabled });
      const peerIds = getRoomPeerIds(roomId, socket.id);
      const out = {
        fromPeerId: socket.id,
        audioEnabled,
        videoEnabled,
      };
      emitToPeerSockets(io, peerIds, "peerMediaState", out);
      ack({ ok: true });
    } catch (error) {
      ack({ error: error.message });
    }
  });

  socket.on("peerQualityState", (payload, callback) => {
    const ack = typeof callback === "function" ? callback : () => {};
    try {
      const roomId = peerToRoom.get(socket.id);
      if (!roomId) {
        ack({ error: "Join room before sending quality state" });
        return;
      }
      const qualityState = sanitizeQualityStatePayload(payload);
      peerQualityStates.set(socket.id, qualityState);
      const peerIds = getRoomPeerIds(roomId, socket.id);
      emitToPeerSockets(io, peerIds, "peerQualityState", {
        fromPeerId: socket.id,
        ...qualityState,
      });
      ack({ ok: true });
    } catch (error) {
      ack({ error: error.message });
    }
  });

  socket.on("rtcOffer", ({ targetPeerId, sdp }, callback) => {
    if (!targetPeerId || !sdp) {
      callback({ error: "targetPeerId and sdp are required" });
      return;
    }
    if (!emitToPeerSocket(io, targetPeerId, "rtcOffer", { fromPeerId: socket.id, sdp })) {
      // eslint-disable-next-line no-console
      console.warn("[rtcOffer] target socket not found:", targetPeerId);
    }
    callback({ ok: true });
  });

  socket.on("rtcAnswer", ({ targetPeerId, sdp }, callback) => {
    if (!targetPeerId || !sdp) {
      callback({ error: "targetPeerId and sdp are required" });
      return;
    }
    if (!emitToPeerSocket(io, targetPeerId, "rtcAnswer", { fromPeerId: socket.id, sdp })) {
      // eslint-disable-next-line no-console
      console.warn("[rtcAnswer] target socket not found:", targetPeerId);
    }
    callback({ ok: true });
  });

  socket.on("rtcIceCandidate", ({ targetPeerId, candidate }, callback) => {
    if (!targetPeerId || !candidate) {
      callback({ error: "targetPeerId and candidate are required" });
      return;
    }
    if (!emitToPeerSocket(io, targetPeerId, "rtcIceCandidate", { fromPeerId: socket.id, candidate })) {
      // eslint-disable-next-line no-console
      console.warn("[rtcIceCandidate] target socket not found:", targetPeerId);
    }
    callback({ ok: true });
  });

  socket.on("getRouterRtpCapabilities", (_, callback) => {
    callback({ rtpCapabilities: state.router.rtpCapabilities });
  });

  socket.on("createWebRtcTransport", async (_, callback) => {
    try {
      const transport = await state.router.createWebRtcTransport({
        listenIps: getListenIps(),
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      const peer = getPeer(socket.id);
      peer.transports.set(transport.id, transport);

      transport.appData = {
        peerId: socket.id,
      };

      callback({
        transportOptions: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on("connectTransport", async ({ transportId, dtlsParameters }, callback) => {
    try {
      const peer = getPeer(socket.id);
      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback({ error: "Transport not found" });
        return;
      }

      await transport.connect({ dtlsParameters });
      callback({ ok: true });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on("produce", async ({ transportId, kind, rtpParameters }, callback) => {
    try {
      const roomId = peerToRoom.get(socket.id);
      if (!roomId) {
        callback({ error: "Join room before producing" });
        return;
      }

      const peer = getPeer(socket.id);
      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback({ error: "Transport not found" });
        return;
      }

      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: {
          peerId: socket.id,
          roomId,
        },
      });
      peer.producers.set(producer.id, producer);

      producer.on("transportclose", () => {
        peer.producers.delete(producer.id);
      });

      const peerIds = getRoomPeerIds(roomId, socket.id);
      for (const peerId of peerIds) {
        io.to(peerId).emit("newProducer", {
          producerId: producer.id,
          peerId: socket.id,
          kind: producer.kind,
        });
      }
      callback({ id: producer.id });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on("consume", async ({ producerId, transportId, rtpCapabilities }, callback) => {
    try {
      if (!state.router.canConsume({ producerId, rtpCapabilities })) {
        callback({ error: "Cannot consume this producer" });
        return;
      }

      const peer = getPeer(socket.id);
      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback({ error: "Transport not found" });
        return;
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });

      peer.consumers.set(consumer.id, consumer);

      consumer.on("transportclose", () => {
        peer.consumers.delete(consumer.id);
      });

      callback({
        id: consumer.id,
        producerId,
        peerId: getProducerOwnerPeerId(producerId),
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on("resumeConsumer", async ({ consumerId }, callback) => {
    try {
      const peer = getPeer(socket.id);
      const consumer = peer.consumers.get(consumerId);
      if (!consumer) {
        callback({ error: "Consumer not found" });
        return;
      }

      await consumer.resume();
      callback({ ok: true });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on("getProducers", (_, callback) => {
    const roomId = peerToRoom.get(socket.id);
    if (!roomId) {
      callback({ producerInfos: [] });
      return;
    }
    callback({ producerInfos: getPeerProducerIds(roomId, socket.id) });
  });

  socket.on("disconnect", () => {
    const roomId = removePeerFromRoom(socket.id);
    peerMediaHints.delete(socket.id);
    peerQualityStates.delete(socket.id);
    if (roomId) {
      const peerIds = getRoomPeerIds(roomId);
      emitToPeerSockets(io, peerIds, "peerLeft", { peerId: socket.id });
    }

    removePeer(socket.id);
  });
});

async function start() {
  const { worker, router } = await createMediasoupWorker();
  state.worker = worker;
  state.router = router;

  webServer.listen(PORT, () => {
    const localIp = Object.values(os.networkInterfaces())
      .flat()
      .find((item) => item && item.family === "IPv4" && !item.internal)?.address;

    const displayIp = ANNOUNCED_IP || localIp || "127.0.0.1";
    // eslint-disable-next-line no-console
    console.log(`Server started on ${protocol}://${displayIp}:${PORT}`);
    // eslint-disable-next-line no-console
    console.log("Open from your device browser and click Start preview.");
    if (USE_HTTPS) {
      // eslint-disable-next-line no-console
      console.log("For first launch you may need to accept the self-signed certificate warning.");
    }
    if (!ANNOUNCED_IP) {
      // eslint-disable-next-line no-console
      console.log("Set ANNOUNCED_IP=<your-lan-ip> if remote device cannot connect media.");
    }
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

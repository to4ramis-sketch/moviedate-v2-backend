
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((url) => url.trim())
  : true;

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();

// Health check
app.get("/", (req, res) => {
  res.json({
    app: "MovieDate V2 Backend",
    status: "online",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// Create a room
app.post("/api/rooms", (req, res) => {
  let roomId;

  do {
    roomId = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(roomId));

  rooms.set(roomId, {
    participants: new Set(),
    createdAt: Date.now(),
  });

  res.status(201).json({ roomId });
});

// Socket.IO connection
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Join a room
  socket.on("room:join", (data = {}, callback) => {
    const roomId = String(data.roomId || "").trim().toUpperCase();
    const room = rooms.get(roomId);

    if (typeof callback !== "function") return;

    if (!room) {
      return callback({ success: false, error: "Room not found" });
    }

    if (room.participants.has(socket.id)) {
      return callback({
        success: true,
        roomId,
        participants: room.participants.size,
      });
    }

    if (room.participants.size >= 2) {
      return callback({ success: false, error: "Room is full" });
    }

    room.participants.add(socket.id);
    socket.data.roomId = roomId;
    socket.join(roomId);

    callback({
      success: true,
      roomId,
      participants: room.participants.size,
    });

    socket.to(roomId).emit("participant:joined", {
      socketId: socket.id,
    });
  });

  // Synchronized playback events
  socket.on("playback:event", (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    socket.to(roomId).emit("playback:event", data);
  });

  // Reactions
  socket.on("reaction:send", (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    socket.to(roomId).emit("reaction:received", data);
  });

  // WebRTC signaling
  socket.on("webrtc:signal", (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    socket.to(roomId).emit("webrtc:signal", {
      from: socket.id,
      signal: data,
    });
  });

  // Disconnect and clean up
  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);

    if (room) {
      room.participants.delete(socket.id);

      socket.to(roomId).emit("participant:left", {
        socketId: socket.id,
      });

      if (room.participants.size === 0) {
        rooms.delete(roomId);
      }
    }

    console.log("Disconnected:", socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MovieDate backend running on port ${PORT}`);
});

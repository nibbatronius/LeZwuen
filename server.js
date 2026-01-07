const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { v2: cloudinary } = require("cloudinary");
const { Pool } = require("pg");
const nearby = require("./lib/nearby");

const app = express();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL environment variable.");
  process.exit(1);
}

const useSsl = process.env.DATABASE_SSL === "true" || process.env.NODE_ENV === "production";
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location_bucket TEXT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location_bucket_1k TEXT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS location_bucket_5k TEXT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_adult BOOLEAN DEFAULT FALSE;`);
    await pool.query(`
      UPDATE users
      SET display_name = split_part(email, '@', 1)
      WHERE display_name IS NULL
    `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      room_key TEXT NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, room_key)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nearby_messages (
      id SERIAL PRIMARY KEY,
      room_key TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_reports (
      id SERIAL PRIMARY KEY,
      message_id INTEGER REFERENCES nearby_messages(id) ON DELETE SET NULL,
      room_key TEXT,
      reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reported_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      message_body TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const locationSalt = process.env.LOCATION_SALT || "local-dev-salt";
const presenceWindowMinutes = 5;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

const cloudinaryUrl = process.env.CLOUDINARY_URL;
const cloudinaryConfigured = Boolean(
  cloudinaryUrl ||
    (process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET)
);

if (cloudinaryConfigured) {
  if (cloudinaryUrl) {
    cloudinary.config({ cloudinary_url: cloudinaryUrl });
  } else {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
  }
}

const allowedOrigins = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin) {
    let allowOrigin = "";
    if (allowedOrigins.includes("*")) {
      allowOrigin = "*";
    } else if (allowedOrigins.includes(origin)) {
      allowOrigin = origin;
    }

    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Vary", "Origin");
    }
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

function getTokenFromRequest(req) {
  const authHeader = req.get("authorization") || "";
  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer" || !token) {
    return null;
  }
  return token;
}

function ensureAdult(user, res) {
  if (!user.is_adult) {
    res.status(403).json({ error: "Age verification required." });
    return false;
  }
  return true;
}

async function getBlockedIds(blockerId) {
  const result = await pool.query("SELECT blocked_id FROM user_blocks WHERE blocker_id = $1", [
    blockerId
  ]);
  return new Set(result.rows.map((row) => row.blocked_id));
}

const roomSubscribers = new Map();

function addSubscriber(roomKey, subscriber) {
  if (!roomSubscribers.has(roomKey)) {
    roomSubscribers.set(roomKey, new Set());
  }
  roomSubscribers.get(roomKey).add(subscriber);
}

function removeSubscriber(roomKey, subscriber) {
  const roomSet = roomSubscribers.get(roomKey);
  if (!roomSet) {
    return;
  }
  roomSet.delete(subscriber);
  if (roomSet.size === 0) {
    roomSubscribers.delete(roomKey);
  }
}

function broadcastToRoom(roomKey, payload) {
  const roomSet = roomSubscribers.get(roomKey);
  if (!roomSet) {
    return;
  }
  roomSet.forEach((subscriber) => {
    if (subscriber.blockedIds && subscriber.blockedIds.has(payload.user_id)) {
      return;
    }
    subscriber.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });
}

async function refreshBlockedIdsForUser(userId) {
  const blockedIds = await getBlockedIds(userId);
  roomSubscribers.forEach((subscribers) => {
    subscribers.forEach((subscriber) => {
      if (subscriber.userId === userId) {
        subscriber.blockedIds = blockedIds;
      }
    });
  });
}

async function touchPresence(userId, roomKey) {
  await pool.query(
    `
      INSERT INTO user_presence (user_id, room_key, last_seen_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id, room_key)
      DO UPDATE SET last_seen_at = NOW()
    `,
    [userId, roomKey]
  );
}

async function createSession(userId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = crypto.randomBytes(24).toString("hex");
    try {
      await pool.query("INSERT INTO sessions (user_id, token) VALUES ($1, $2)", [
        userId,
        token
      ]);
      return token;
    } catch (error) {
      if (error.code !== "23505") {
        throw error;
      }
    }
  }

  throw new Error("Unable to create session.");
}

async function getUserFromToken(token) {
  const result = await pool.query(
    `
      SELECT users.id,
             users.email,
             users.display_name,
             users.profile_image_url,
             users.location_bucket,
             users.location_bucket_1k,
             users.location_bucket_5k,
             users.is_adult
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = $1
    `,
    [token]
  );
  return result.rows[0];
}

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.get("/nearby", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "nearby.html"));
});

app.get("/code-of-conduct", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "code-of-conduct.html"));
});

app.post("/api/signup", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  const displayName = (req.body.displayName || "").trim();

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Please enter a valid email." });
  }

  if (displayName.length < 2 || displayName.length > 32) {
    return res.status(400).json({ error: "Display name must be 2-32 characters." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `
        INSERT INTO users (email, password_hash, display_name)
        VALUES ($1, $2, $3)
        RETURNING id, email, display_name
      `,
      [email, passwordHash, displayName]
    );

    const token = await createSession(result.rows[0].id);

    return res.status(201).json({
      ok: true,
      user: result.rows[0],
      token,
      redirect: "/skeleton.html"
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email is already registered." });
    }

    console.error("Signup failed:", error);
    return res.status(500).json({ error: "Unable to create account." });
  }
});

app.post("/api/login", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT id, email, display_name, password_hash FROM users WHERE email = $1",
      [email]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = await createSession(user.id);

    return res.json({
      ok: true,
      user: { id: user.id, email: user.email, display_name: user.display_name },
      token,
      redirect: "/skeleton.html"
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ error: "Unable to sign in." });
  }
});

app.get("/api/users/:id", async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  try {
    const result = await pool.query(
      "SELECT id, email, display_name, profile_image_url FROM users WHERE id = $1",
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json({ ok: true, user: result.rows[0] });
  } catch (error) {
    console.error("User lookup failed:", error);
    return res.status(500).json({ error: "Unable to load profile." });
  }
});

app.get("/api/me", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    return res.json({ ok: true, user });
  } catch (error) {
    console.error("Profile lookup failed:", error);
    return res.status(500).json({ error: "Unable to load profile." });
  }
});

app.patch("/api/profile", async (req, res) => {
  const token = getTokenFromRequest(req);
  const displayNameInput = req.body.displayName;
  const emailInput = req.body.email;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (displayNameInput === undefined && emailInput === undefined) {
    return res.status(400).json({ error: "No profile updates provided." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const updates = [];
    const values = [];
    let index = 1;

    if (displayNameInput !== undefined) {
      const displayName = String(displayNameInput).trim();
      if (displayName.length < 2 || displayName.length > 32) {
        return res.status(400).json({ error: "Display name must be 2-32 characters." });
      }
      updates.push(`display_name = $${index}`);
      values.push(displayName);
      index += 1;
    }

    if (emailInput !== undefined) {
      const email = String(emailInput).trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "Please enter a valid email." });
      }
      updates.push(`email = $${index}`);
      values.push(email);
      index += 1;
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No profile updates provided." });
    }

    values.push(user.id);
    const result = await pool.query(
      `
        UPDATE users
        SET ${updates.join(", ")}
        WHERE id = $${index}
        RETURNING id, email, display_name, profile_image_url
      `,
      values
    );

    return res.json({ ok: true, user: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email is already registered." });
    }
    console.error("Profile update failed:", error);
    return res.status(500).json({ error: "Unable to update profile." });
  }
});

app.post("/api/age-gate", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    await pool.query("UPDATE users SET is_adult = TRUE WHERE id = $1", [user.id]);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Age gate failed:", error);
    return res.status(500).json({ error: "Unable to update age gate." });
  }
});

app.post("/api/location", async (req, res) => {
  const token = getTokenFromRequest(req);
  const lat = Number.parseFloat(req.body.lat);
  const lng = Number.parseFloat(req.body.lng);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "Location required." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (!ensureAdult(user, res)) {
      return;
    }

    const buckets = nearby.computeBuckets(lat, lng, locationSalt);
    const bucketValues = buckets.reduce((acc, bucket) => {
      acc[bucket.column] = bucket.bucketId;
      return acc;
    }, {});

    await pool.query(
      `
        UPDATE users
        SET location_bucket = $1,
            location_bucket_1k = $2,
            location_bucket_5k = $3
        WHERE id = $4
      `,
      [
        bucketValues.location_bucket,
        bucketValues.location_bucket_1k,
        bucketValues.location_bucket_5k,
        user.id
      ]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error("Location update failed:", error);
    return res.status(500).json({ error: "Unable to update location." });
  }
});

app.get("/api/nearby/rooms", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (!ensureAdult(user, res)) {
      return;
    }

    if (!user.location_bucket) {
      return res.status(400).json({ error: "Location required." });
    }

    const rooms = nearby.roomsFromUser(user);
    const roomKeys = rooms.map((room) => room.roomKey);

    const presenceResult = await pool.query(
      `
        SELECT room_key, COUNT(DISTINCT user_id)::int AS count
        FROM user_presence
        WHERE room_key = ANY($1)
          AND last_seen_at > NOW() - INTERVAL '${presenceWindowMinutes} minutes'
        GROUP BY room_key
      `,
      [roomKeys]
    );

    const counts = new Map(presenceResult.rows.map((row) => [row.room_key, row.count]));

    const withCounts = rooms.map((room) => ({
      ...room,
      activeCount: counts.get(room.roomKey) || 0
    }));

    return res.json({ ok: true, rooms: withCounts });
  } catch (error) {
    console.error("Nearby rooms lookup failed:", error);
    return res.status(500).json({ error: "Unable to load rooms." });
  }
});

app.post("/api/nearby/rooms/:roomKey/join", async (req, res) => {
  const token = getTokenFromRequest(req);
  const roomKey = req.params.roomKey;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (!ensureAdult(user, res)) {
      return;
    }

    if (!nearby.isRoomAllowed(roomKey, user)) {
      return res.status(403).json({ error: "Access denied." });
    }

    await touchPresence(user.id, roomKey);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Presence join failed:", error);
    return res.status(500).json({ error: "Unable to join room." });
  }
});

app.post("/api/nearby/presence", async (req, res) => {
  const token = getTokenFromRequest(req);
  const roomKey = req.body.roomKey || "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (!ensureAdult(user, res)) {
      return;
    }

    if (!nearby.isRoomAllowed(roomKey, user)) {
      return res.status(403).json({ error: "Access denied." });
    }

    await touchPresence(user.id, roomKey);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Presence update failed:", error);
    return res.status(500).json({ error: "Unable to update presence." });
  }
});

app.get("/api/nearby/rooms/:roomKey/messages", async (req, res) => {
  const token = getTokenFromRequest(req);
  const roomKey = req.params.roomKey;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (!ensureAdult(user, res)) {
      return;
    }

    if (!nearby.isRoomAllowed(roomKey, user)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const blockedIds = await getBlockedIds(user.id);
    await touchPresence(user.id, roomKey);

    const result = await pool.query(
      `
        SELECT m.id,
               m.room_key,
               m.user_id,
               m.body,
               m.created_at,
               u.email,
               u.display_name
        FROM nearby_messages m
        JOIN users u ON u.id = m.user_id
        WHERE m.room_key = $1
        ORDER BY m.created_at DESC
        LIMIT 50
      `,
      [roomKey]
    );

    const messages = nearby.filterBlockedMessages(result.rows, blockedIds).map((row) => ({
      id: row.id,
      room_key: row.room_key,
      user_id: row.user_id,
      body: row.body,
      created_at: row.created_at,
      display_name: row.display_name || row.email.split("@")[0]
    }));

    return res.json({ ok: true, messages: messages.reverse() });
  } catch (error) {
    console.error("Message list failed:", error);
    return res.status(500).json({ error: "Unable to load messages." });
  }
});

app.post("/api/nearby/rooms/:roomKey/messages", async (req, res) => {
  const token = getTokenFromRequest(req);
  const roomKey = req.params.roomKey;
  const body = (req.body.body || "").trim();

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!body) {
    return res.status(400).json({ error: "Message required." });
  }

  if (body.length > 500) {
    return res.status(400).json({ error: "Message too long." });
  }

  if (nearby.containsTradeKeywords(body)) {
    return res.status(400).json({ error: "Buy/sell/trade content is not allowed." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (!ensureAdult(user, res)) {
      return;
    }

    if (!nearby.isRoomAllowed(roomKey, user)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const result = await pool.query(
      `
        INSERT INTO nearby_messages (room_key, user_id, body)
        VALUES ($1, $2, $3)
        RETURNING id, created_at
      `,
      [roomKey, user.id, body]
    );

    await touchPresence(user.id, roomKey);

    const payload = {
      id: result.rows[0].id,
      room_key: roomKey,
      user_id: user.id,
      body,
      created_at: result.rows[0].created_at,
      display_name: user.display_name || user.email.split("@")[0]
    };

    broadcastToRoom(roomKey, payload);

    return res.json({ ok: true, message: payload });
  } catch (error) {
    console.error("Message send failed:", error);
    return res.status(500).json({ error: "Unable to send message." });
  }
});

app.get("/api/nearby/rooms/:roomKey/stream", async (req, res) => {
  const token = getTokenFromRequest(req);
  const roomKey = req.params.roomKey;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (!ensureAdult(user, res)) {
      return;
    }

    if (!nearby.isRoomAllowed(roomKey, user)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const blockedIds = await getBlockedIds(user.id);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    const subscriber = { res, userId: user.id, blockedIds };
    addSubscriber(roomKey, subscriber);

    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 20000);

    req.on("close", () => {
      clearInterval(heartbeat);
      removeSubscriber(roomKey, subscriber);
    });
  } catch (error) {
    console.error("Stream failed:", error);
    return res.status(500).json({ error: "Unable to open stream." });
  }
});

app.post("/api/nearby/messages/:id/report", async (req, res) => {
  const token = getTokenFromRequest(req);
  const messageId = Number.parseInt(req.params.id, 10);
  const reason = (req.body.reason || "").trim();

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(messageId)) {
    return res.status(400).json({ error: "Invalid message." });
  }

  if (!reason) {
    return res.status(400).json({ error: "Reason required." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const messageResult = await pool.query(
      `
        SELECT id, room_key, user_id, body
        FROM nearby_messages
        WHERE id = $1
      `,
      [messageId]
    );

    if (!messageResult.rows.length) {
      return res.status(404).json({ error: "Message not found." });
    }

    const message = messageResult.rows[0];

    await pool.query(
      `
        INSERT INTO message_reports (message_id, room_key, reporter_id, reported_user_id, reason, message_body)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [message.id, message.room_key, user.id, message.user_id, reason, message.body]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error("Report failed:", error);
    return res.status(500).json({ error: "Unable to report message." });
  }
});

app.post("/api/block", async (req, res) => {
  const token = getTokenFromRequest(req);
  const blockedId = Number.parseInt(req.body.blockedUserId, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(blockedId)) {
    return res.status(400).json({ error: "Invalid user." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (user.id === blockedId) {
      return res.status(400).json({ error: "Cannot block yourself." });
    }

    await pool.query(
      `
        INSERT INTO user_blocks (blocker_id, blocked_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [user.id, blockedId]
    );

    await refreshBlockedIdsForUser(user.id);

    return res.json({ ok: true });
  } catch (error) {
    console.error("Block failed:", error);
    return res.status(500).json({ error: "Unable to block user." });
  }
});

app.delete("/api/block/:id", async (req, res) => {
  const token = getTokenFromRequest(req);
  const blockedId = Number.parseInt(req.params.id, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(blockedId)) {
    return res.status(400).json({ error: "Invalid user." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    await pool.query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [
      user.id,
      blockedId
    ]);

    await refreshBlockedIdsForUser(user.id);

    return res.json({ ok: true });
  } catch (error) {
    console.error("Unblock failed:", error);
    return res.status(500).json({ error: "Unable to unblock user." });
  }
});

app.get("/api/blocklist", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const blockedIds = await getBlockedIds(user.id);
    return res.json({ ok: true, blockedIds: Array.from(blockedIds) });
  } catch (error) {
    console.error("Blocklist failed:", error);
    return res.status(500).json({ error: "Unable to load blocklist." });
  }
});

app.post("/api/profile-image", async (req, res) => {
  const token = getTokenFromRequest(req);
  const imageData = req.body.imageData || "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!cloudinaryConfigured) {
    return res.status(500).json({ error: "Cloudinary is not configured." });
  }

  const match = imageData.match(
    /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match) {
    return res.status(400).json({ error: "Unsupported image format." });
  }

  const buffer = Buffer.from(match[3], "base64");

  if (buffer.length > 1500000) {
    return res.status(400).json({ error: "Image must be 1.5MB or smaller." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const uploadResult = await cloudinary.uploader.upload(imageData, {
      folder: "lezwuen/avatars",
      public_id: `user-${user.id}`,
      overwrite: true,
      invalidate: true
    });

    const imageUrl = uploadResult.secure_url || uploadResult.url;
    const result = await pool.query(
      "UPDATE users SET profile_image_url = $1 WHERE id = $2 RETURNING id",
      [imageUrl, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json({ ok: true, url: imageUrl });
  } catch (error) {
    console.error("Profile image upload failed:", error);
    return res.status(500).json({ error: "Unable to save image." });
  }
});

initDb()
  .then(() => {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });

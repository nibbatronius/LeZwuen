const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { v2: cloudinary } = require("cloudinary");
const { Pool } = require("pg");

const app = express();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL environment variable.");
  process.exit(1);
}

const dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY;
if (!dataEncryptionKey) {
  console.error("Missing DATA_ENCRYPTION_KEY environment variable.");
  process.exit(1);
}

const dataKey = Buffer.from(dataEncryptionKey, "base64");
if (dataKey.length !== 32) {
  console.error("DATA_ENCRYPTION_KEY must be 32 bytes (base64).");
  process.exit(1);
}

const ENCRYPTION_PREFIX = "enc:v1:";

function isEncryptedValue(value) {
  return typeof value === "string" && value.startsWith(ENCRYPTION_PREFIX);
}

function encryptAtRest(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const stringValue = String(value);
  if (isEncryptedValue(stringValue)) {
    return stringValue;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(stringValue, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString(
    "base64"
  )}`;
}

function decryptAtRest(value) {
  if (!value || typeof value !== "string") {
    return value;
  }
  if (!isEncryptedValue(value)) {
    return value;
  }
  const payload = value.slice(ENCRYPTION_PREFIX.length);
  const [ivBase64, tagBase64, ciphertextBase64] = payload.split(":");
  if (!ivBase64 || !tagBase64 || !ciphertextBase64) {
    return value;
  }
  try {
    const iv = Buffer.from(ivBase64, "base64");
    const tag = Buffer.from(tagBase64, "base64");
    const ciphertext = Buffer.from(ciphertextBase64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", dataKey, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (error) {
    return value;
  }
}

function hashLookup(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  return crypto.createHmac("sha256", dataKey).update(normalized).digest("hex");
}

function decryptRow(row, fields) {
  if (!row) {
    return row;
  }
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      row[field] = decryptAtRest(row[field]);
    }
  });
  return row;
}

function decryptRows(rows, fields) {
  return rows.map((row) => decryptRow(row, fields));
}

const useSsl = process.env.DATABASE_SSL === "true" || process.env.NODE_ENV === "production";
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined
});
const DEFAULT_OWNER_DISPLAY_NAME = "NibbaTronius";
const DEFAULT_FOLDER_NAME = "General";
const DEFAULT_POST_ITS = [
  {
    body:
      "Mushroom cloning process\n\nMake agar\n\nLet it fully solidify\n\nCut a small mycelium wedge (rice-grain size)\n\nPlace it on top of the agar\n\nClose and incubate\n\nThis allows:\n\nRadial outward growth\n\nVisual identification of contamination\n\nClean edge selection for future transfers\n\nThis is the standard method worldwide."
  },
  {
    body:
      "Preparing substrate:\nSteps\n\nAdd 1 part dry coco coir to bucket\n\nAdd 4 parts boiling water\n\nCover 1-2 hours\n\nBreak up and mix\n\nSqueeze test (field capacity):\n\nFew drops = ready\n\nStreams = too wet\n\nNo drops, crumbly = too dry\n\nLet cool + use\n\nFixes\n\nToo wet:\n\nSqueeze harder by hand\n\nSpread thin for 10-20 min, then re-mix\n\nToo dry:\n\nAdd small splashes of clean water\n\nMix and re-test\n\nNotes\n\nMoist, not dripping\n\nCool before inoculating\n\nNo nutrients needed\n\nDone."
  },
  {
    body:
      "Price: 60eu\n\nLinks:\n[Dutch Headshop - Azurescens growkit (280cc)](https://www.dutch-headshop.nl/outdoor-paddos-psilocybe-azurescens-growkit-280cc)\n[Dutch Headshop - Agar agar powder (40g)](https://www.dutch-headshop.nl/agar-agar-poeder-jacob-hooy-40-gram)\n[Temu item (goods_id 601099631089002)](https://www.temu.com/goods.html?_bg_fs=1&goods_id=601099631089002&sku_id=17592640907281&_oak_page_source=501)\n[Temu item (goods_id 601103384146748)](https://www.temu.com/goods.html?_bg_fs=1&goods_id=601103384146748&sku_id=17609529472874&_oak_page_source=501)\n[Amazon - Trixie coconut fiber substrate](https://www.amazon.nl/-/en/Trixie-76153-Kokosfaserhumus-Substrat-pressed/dp/B002YK1SLY/ref=sr_1_1?adgrpid=104937912365&dib=eyJ2IjoiMSJ9.P2JAGbgb7sJxi9k4iU7rl2aWYY3dVsEXG9FV3jyi1XWg999coR-CNTurl2zqiSL-SkGFmu7I6Bp4Z27hz9mR_V7YxBWMKEg80O1r89FtefLT06JODXWVdWN0wRhtfu85gMjy6t-3Dkj2aD7tnGaK3SkBxjd--KgexA6lSwQ_BKRK5HXCFlNjPih69DWu1K8uCyiG3QOF3HIXNkbaUynPdArtb0uQkJyDavefz1SuogUYKLDwFtmSYHaD5ZCw2a2uR0nAlnUkAIUlR5Wqsi6tSesH6hgP9C-HGnI97kl9Kco.u_fG6vKQVWwO9JH9KJ7JnpqvF9sLAVzmRPLIKPpjiaI&dib_tag=se&hvadid=678178427700&hvdev=c&hvlocphy=9103130&hvnetw=g&hvqmt=e&hvrand=4551244774710727631&hvtargid=kwd-302253634031&hydadcr=29078_2483947&keywords=coconut%2Bfiber%2Bsubstrate&mcid=cfe8d8c9fbb73296901b37b9be21279f&qid=1767822165&sr=8-1&th=1)"
  }
];

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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_adult BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT;`);
  await pool.query(`ALTER TABLE users ALTER COLUMN account_type DROP DEFAULT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS key_salt TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS key_iv TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS key_iterations INTEGER;`);
  await pool.query("UPDATE users SET account_type = $1 WHERE account_type IS NULL;", [
    encryptAtRest("guest")
  ]);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_hash TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_its (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    "ALTER TABLE post_its ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE;"
  );
  await pool.query("ALTER TABLE post_its ADD COLUMN IF NOT EXISTS body_ciphertext TEXT;");
  await pool.query("ALTER TABLE post_its ADD COLUMN IF NOT EXISTS body_iv TEXT;");
  await pool.query("ALTER TABLE post_its ADD COLUMN IF NOT EXISTS body_version INTEGER DEFAULT 1;");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id SERIAL PRIMARY KEY,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE friend_requests ADD COLUMN IF NOT EXISTS status_hash TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      share_folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_ciphertext TEXT;");
  await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_iv TEXT;");
  await pool.query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_version INTEGER DEFAULT 1;");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS folder_shares (
      id SERIAL PRIMARY KEY,
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shared_with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (folder_id, shared_with_user_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folder_keys (
      id SERIAL PRIMARY KEY,
      folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      enc_key TEXT NOT NULL,
      enc_iv TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (folder_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      amount TEXT NOT NULL,
      currency TEXT,
      category TEXT,
      expense_date TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      units TEXT NOT NULL,
      unit_price TEXT NOT NULL,
      total TEXT NOT NULL,
      currency TEXT,
      sale_date TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profit_snapshots (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      currency TEXT,
      invested TEXT,
      profit TEXT,
      revenue TEXT,
      margin TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id)
    );
  `);

  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_email_hash_unique ON users(email_hash);"
  );
  await pool.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_unique ON sessions(token_hash);"
  );

  await pool.query(
    `
      INSERT INTO folders (user_id, name)
      SELECT users.id, $1
      FROM users
      WHERE NOT EXISTS (
        SELECT 1 FROM folders WHERE folders.user_id = users.id
      )
    `,
    [encryptAtRest(DEFAULT_FOLDER_NAME)]
  );

  await pool.query(`
    WITH first_folder AS (
      SELECT user_id, MIN(id) AS id
      FROM folders
      GROUP BY user_id
    )
    UPDATE post_its
    SET folder_id = first_folder.id
    FROM first_folder
    WHERE post_its.user_id = first_folder.user_id
      AND post_its.folder_id IS NULL
  `);

  await migrateEncryptedData();
  await syncOwnerAccount();
  await ensureOwnerPostIts();
}

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

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
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
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

async function createSession(userId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = crypto.randomBytes(24).toString("hex");
    try {
      const tokenHash = hashLookup(token);
      await pool.query("INSERT INTO sessions (user_id, token, token_hash) VALUES ($1, $2, $3)", [
        userId,
        encryptAtRest(token),
        tokenHash
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
  const tokenHash = hashLookup(token);
  const result = await pool.query(
    `
      SELECT users.id,
             users.email,
             users.display_name,
             users.profile_image_url,
             users.is_adult,
             users.account_type,
             users.public_key,
             users.encrypted_private_key,
             users.key_salt,
             users.key_iv,
             users.key_iterations
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1
    `,
    [tokenHash]
  );
  const user = result.rows[0];
  if (!user) {
    return null;
  }
  decryptRow(user, [
    "email",
    "display_name",
    "profile_image_url",
    "account_type",
    "public_key",
    "encrypted_private_key",
    "key_salt",
    "key_iv"
  ]);
  return user;
}

function getOwnerDisplayName() {
  return (process.env.OWNER_DISPLAY_NAME || DEFAULT_OWNER_DISPLAY_NAME || "").trim();
}

async function getOwnerId(ownerDisplayName) {
  if (!ownerDisplayName) {
    return null;
  }

  const displayNameHash = hashLookup(ownerDisplayName);
  const result = await pool.query(
    "SELECT id FROM users WHERE display_name_hash = $1 ORDER BY id ASC LIMIT 1",
    [displayNameHash]
  );

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0].id;
}

async function ensureDefaultFolderForUser(userId) {
  const existing = await pool.query(
    "SELECT id FROM folders WHERE user_id = $1 ORDER BY id ASC LIMIT 1",
    [userId]
  );
  if (existing.rows.length) {
    return existing.rows[0].id;
  }

  const created = await pool.query(
    "INSERT INTO folders (user_id, name) VALUES ($1, $2) RETURNING id",
    [userId, encryptAtRest(DEFAULT_FOLDER_NAME)]
  );
  return created.rows[0].id;
}

async function getFolderAccess(userId, folderId) {
  const folderResult = await pool.query(
    `
      SELECT folders.id, folders.name, folders.user_id, users.display_name AS owner_display_name
      FROM folders
      JOIN users ON users.id = folders.user_id
      WHERE folders.id = $1
    `,
    [folderId]
  );

  if (!folderResult.rows.length) {
    return null;
  }

  const folder = folderResult.rows[0];
  decryptRow(folder, ["name", "owner_display_name"]);
  if (folder.user_id === userId) {
    return { folder, canEdit: true };
  }

  const shareResult = await pool.query(
    "SELECT id FROM folder_shares WHERE folder_id = $1 AND shared_with_user_id = $2",
    [folderId, userId]
  );

  if (shareResult.rows.length) {
    return { folder, canEdit: false };
  }

  return null;
}

async function areFriends(userId, otherUserId) {
  const acceptedHash = hashLookup("accepted");
  const result = await pool.query(
    `
      SELECT id
      FROM friend_requests
      WHERE status_hash = $3
        AND (
          (requester_id = $1 AND recipient_id = $2)
          OR
          (requester_id = $2 AND recipient_id = $1)
        )
      LIMIT 1
    `,
    [userId, otherUserId, acceptedHash]
  );
  return result.rows.length > 0;
}

async function syncOwnerAccount() {
  const ownerDisplayName = getOwnerDisplayName();
  if (!ownerDisplayName) {
    return;
  }

  const ownerId = await getOwnerId(ownerDisplayName);
  if (!ownerId) {
    console.warn(`Owner display name not found: ${ownerDisplayName}`);
    return;
  }

  const guestValue = encryptAtRest("guest");
  const ownerValue = encryptAtRest("owner");
  await pool.query("UPDATE users SET account_type = $1 WHERE id <> $2", [
    guestValue,
    ownerId
  ]);
  await pool.query("UPDATE users SET account_type = $1 WHERE id = $2", [ownerValue, ownerId]);
}

async function ensureOwnerPostIts() {
  if (!DEFAULT_POST_ITS.length) {
    return;
  }

  const ownerDisplayName = getOwnerDisplayName();
  if (!ownerDisplayName) {
    return;
  }

  const ownerId = await getOwnerId(ownerDisplayName);
  if (!ownerId) {
    return;
  }

  const folderId = await ensureDefaultFolderForUser(ownerId);
  const existing = await pool.query("SELECT id FROM post_its WHERE user_id = $1 LIMIT 1", [
    ownerId
  ]);
  if (existing.rows.length) {
    return;
  }

  const encryptedBodies = DEFAULT_POST_ITS.map((note) => encryptAtRest(note.body));
  const values = [ownerId, folderId, ...encryptedBodies];
  const placeholders = DEFAULT_POST_ITS.map(
    (_, index) => `($1, $2, $${index + 3})`
  ).join(", ");
  await pool.query(
    `INSERT INTO post_its (user_id, folder_id, body) VALUES ${placeholders}`,
    values
  );
}

async function migrateEncryptedData() {
  await migrateUsers();
  await migrateSessions();
  await migrateFriendRequests();
  await migrateFolders();
  await migratePostIts();
  await migrateMessages();
  await migrateFolderKeys();
  await migrateExpenses();
  await migrateSales();
  await migrateProfitSnapshots();
}

async function migrateUsers() {
  const result = await pool.query(
    `
      SELECT id,
             email,
             email_hash,
             display_name,
             display_name_hash,
             password_hash,
             profile_image_url,
             account_type,
             public_key,
             encrypted_private_key,
             key_salt,
             key_iv
      FROM users
    `
  );

  for (const row of result.rows) {
    const updates = [];
    const values = [];
    let index = 1;

    const emailPlain = row.email ? decryptAtRest(row.email) : null;
    let displayNamePlain = row.display_name ? decryptAtRest(row.display_name) : null;
    if (!displayNamePlain && emailPlain && emailPlain.includes("@")) {
      displayNamePlain = emailPlain.split("@")[0];
    }

    if (row.email !== null && row.email !== undefined && !isEncryptedValue(row.email)) {
      updates.push(`email = $${index}`);
      values.push(encryptAtRest(emailPlain || row.email));
      index += 1;
    }

    if (emailPlain) {
      const emailHash = hashLookup(emailPlain);
      if (row.email_hash !== emailHash) {
        updates.push(`email_hash = $${index}`);
        values.push(emailHash);
        index += 1;
      }
    }

    if (displayNamePlain) {
      if (!row.display_name || !isEncryptedValue(row.display_name)) {
        updates.push(`display_name = $${index}`);
        values.push(encryptAtRest(displayNamePlain));
        index += 1;
      }
      const displayHash = hashLookup(displayNamePlain);
      if (row.display_name_hash !== displayHash) {
        updates.push(`display_name_hash = $${index}`);
        values.push(displayHash);
        index += 1;
      }
    }

    if (row.password_hash && !isEncryptedValue(row.password_hash)) {
      updates.push(`password_hash = $${index}`);
      values.push(encryptAtRest(row.password_hash));
      index += 1;
    }

    if (row.profile_image_url && !isEncryptedValue(row.profile_image_url)) {
      updates.push(`profile_image_url = $${index}`);
      values.push(encryptAtRest(row.profile_image_url));
      index += 1;
    }

    const accountTypePlain = row.account_type
      ? decryptAtRest(row.account_type)
      : "guest";
    if (!row.account_type || !isEncryptedValue(row.account_type)) {
      updates.push(`account_type = $${index}`);
      values.push(encryptAtRest(accountTypePlain));
      index += 1;
    }

    if (row.public_key && !isEncryptedValue(row.public_key)) {
      updates.push(`public_key = $${index}`);
      values.push(encryptAtRest(row.public_key));
      index += 1;
    }

    if (row.encrypted_private_key && !isEncryptedValue(row.encrypted_private_key)) {
      updates.push(`encrypted_private_key = $${index}`);
      values.push(encryptAtRest(row.encrypted_private_key));
      index += 1;
    }

    if (row.key_salt && !isEncryptedValue(row.key_salt)) {
      updates.push(`key_salt = $${index}`);
      values.push(encryptAtRest(row.key_salt));
      index += 1;
    }

    if (row.key_iv && !isEncryptedValue(row.key_iv)) {
      updates.push(`key_iv = $${index}`);
      values.push(encryptAtRest(row.key_iv));
      index += 1;
    }

    if (updates.length) {
      values.push(row.id);
      await pool.query(
        `UPDATE users SET ${updates.join(", ")} WHERE id = $${index}`,
        values
      );
    }
  }
}

async function migrateSessions() {
  const result = await pool.query("SELECT id, token, token_hash FROM sessions");

  for (const row of result.rows) {
    const updates = [];
    const values = [];
    let index = 1;

    const tokenPlain = row.token ? decryptAtRest(row.token) : null;
    if (row.token && !isEncryptedValue(row.token)) {
      updates.push(`token = $${index}`);
      values.push(encryptAtRest(tokenPlain || row.token));
      index += 1;
    }

    if (tokenPlain) {
      const tokenHash = hashLookup(tokenPlain);
      if (row.token_hash !== tokenHash) {
        updates.push(`token_hash = $${index}`);
        values.push(tokenHash);
        index += 1;
      }
    }

    if (updates.length) {
      values.push(row.id);
      await pool.query(`UPDATE sessions SET ${updates.join(", ")} WHERE id = $${index}`, values);
    }
  }
}

async function migrateFriendRequests() {
  const result = await pool.query("SELECT id, status, status_hash FROM friend_requests");

  for (const row of result.rows) {
    const updates = [];
    const values = [];
    let index = 1;

    const statusPlain = row.status ? decryptAtRest(row.status) : "pending";
    if (!row.status || !isEncryptedValue(row.status)) {
      updates.push(`status = $${index}`);
      values.push(encryptAtRest(statusPlain));
      index += 1;
    }

    const statusHash = hashLookup(statusPlain);
    if (row.status_hash !== statusHash) {
      updates.push(`status_hash = $${index}`);
      values.push(statusHash);
      index += 1;
    }

    if (updates.length) {
      values.push(row.id);
      await pool.query(
        `UPDATE friend_requests SET ${updates.join(", ")} WHERE id = $${index}`,
        values
      );
    }
  }
}

async function migrateFolders() {
  const result = await pool.query("SELECT id, name FROM folders");

  for (const row of result.rows) {
    if (!isEncryptedValue(row.name)) {
      await pool.query("UPDATE folders SET name = $1 WHERE id = $2", [
        encryptAtRest(row.name),
        row.id
      ]);
    }
  }
}

async function migratePostIts() {
  const result = await pool.query("SELECT id, body, body_ciphertext, body_iv FROM post_its");

  for (const row of result.rows) {
    const updates = [];
    const values = [];
    let index = 1;

    if (row.body !== null && !isEncryptedValue(row.body)) {
      updates.push(`body = $${index}`);
      values.push(encryptAtRest(row.body));
      index += 1;
    }

    if (row.body_ciphertext && !isEncryptedValue(row.body_ciphertext)) {
      updates.push(`body_ciphertext = $${index}`);
      values.push(encryptAtRest(row.body_ciphertext));
      index += 1;
    }

    if (row.body_iv && !isEncryptedValue(row.body_iv)) {
      updates.push(`body_iv = $${index}`);
      values.push(encryptAtRest(row.body_iv));
      index += 1;
    }

    if (updates.length) {
      values.push(row.id);
      await pool.query(
        `UPDATE post_its SET ${updates.join(", ")} WHERE id = $${index}`,
        values
      );
    }
  }
}

async function migrateMessages() {
  const result = await pool.query("SELECT id, body, body_ciphertext, body_iv FROM messages");

  for (const row of result.rows) {
    const updates = [];
    const values = [];
    let index = 1;

    if (row.body !== null && !isEncryptedValue(row.body)) {
      updates.push(`body = $${index}`);
      values.push(encryptAtRest(row.body));
      index += 1;
    }

    if (row.body_ciphertext && !isEncryptedValue(row.body_ciphertext)) {
      updates.push(`body_ciphertext = $${index}`);
      values.push(encryptAtRest(row.body_ciphertext));
      index += 1;
    }

    if (row.body_iv && !isEncryptedValue(row.body_iv)) {
      updates.push(`body_iv = $${index}`);
      values.push(encryptAtRest(row.body_iv));
      index += 1;
    }

    if (updates.length) {
      values.push(row.id);
      await pool.query(
        `UPDATE messages SET ${updates.join(", ")} WHERE id = $${index}`,
        values
      );
    }
  }
}

async function migrateFolderKeys() {
  const result = await pool.query("SELECT id, enc_key, enc_iv FROM folder_keys");

  for (const row of result.rows) {
    const updates = [];
    const values = [];
    let index = 1;

    if (row.enc_key && !isEncryptedValue(row.enc_key)) {
      updates.push(`enc_key = $${index}`);
      values.push(encryptAtRest(row.enc_key));
      index += 1;
    }

    if (row.enc_iv && !isEncryptedValue(row.enc_iv)) {
      updates.push(`enc_iv = $${index}`);
      values.push(encryptAtRest(row.enc_iv));
      index += 1;
    }

    if (updates.length) {
      values.push(row.id);
      await pool.query(
        `UPDATE folder_keys SET ${updates.join(", ")} WHERE id = $${index}`,
        values
      );
    }
  }
}

async function migrateExpenses() {
  const result = await pool.query(
    "SELECT id, name, amount, currency, category, expense_date FROM expenses"
  );

  for (const row of result.rows) {
    const updates = [];
    const values = [];
    let index = 1;

    if (row.name && !isEncryptedValue(row.name)) {
      updates.push(`name = $${index}`);
      values.push(encryptAtRest(row.name));
      index += 1;
    }

    if (row.amount && !isEncryptedValue(row.amount)) {
      updates.push(`amount = $${index}`);
      values.push(encryptAtRest(row.amount));
      index += 1;
    }

    if (row.currency && !isEncryptedValue(row.currency)) {
      updates.push(`currency = $${index}`);
      values.push(encryptAtRest(row.currency));
      index += 1;
    }

    if (row.category && !isEncryptedValue(row.category)) {
      updates.push(`category = $${index}`);
      values.push(encryptAtRest(row.category));
      index += 1;
    }

    if (row.expense_date && !isEncryptedValue(row.expense_date)) {
      updates.push(`expense_date = $${index}`);
      values.push(encryptAtRest(row.expense_date));
      index += 1;
    }

    if (updates.length) {
      values.push(row.id);
      await pool.query(
        `UPDATE expenses SET ${updates.join(", ")} WHERE id = $${index}`,
        values
      );
    }
  }
}

async function migrateSales() {
  const result = await pool.query(
    "SELECT id, name, units, unit_price, total, currency, sale_date FROM sales"
  );

  for (const row of result.rows) {
    const updates = [];
    const values = [];
    let index = 1;

    if (row.name && !isEncryptedValue(row.name)) {
      updates.push(`name = $${index}`);
      values.push(encryptAtRest(row.name));
      index += 1;
    }

    if (row.units && !isEncryptedValue(row.units)) {
      updates.push(`units = $${index}`);
      values.push(encryptAtRest(row.units));
      index += 1;
    }

    if (row.unit_price && !isEncryptedValue(row.unit_price)) {
      updates.push(`unit_price = $${index}`);
      values.push(encryptAtRest(row.unit_price));
      index += 1;
    }

    if (row.total && !isEncryptedValue(row.total)) {
      updates.push(`total = $${index}`);
      values.push(encryptAtRest(row.total));
      index += 1;
    }

    if (row.currency && !isEncryptedValue(row.currency)) {
      updates.push(`currency = $${index}`);
      values.push(encryptAtRest(row.currency));
      index += 1;
    }

    if (row.sale_date && !isEncryptedValue(row.sale_date)) {
      updates.push(`sale_date = $${index}`);
      values.push(encryptAtRest(row.sale_date));
      index += 1;
    }

    if (updates.length) {
      values.push(row.id);
      await pool.query(
        `UPDATE sales SET ${updates.join(", ")} WHERE id = $${index}`,
        values
      );
    }
  }
}

async function migrateProfitSnapshots() {
  const result = await pool.query(
    "SELECT id, currency, invested, profit, revenue, margin FROM profit_snapshots"
  );

  for (const row of result.rows) {
    const updates = [];
    const values = [];
    let index = 1;

    if (row.currency && !isEncryptedValue(row.currency)) {
      updates.push(`currency = $${index}`);
      values.push(encryptAtRest(row.currency));
      index += 1;
    }

    if (row.invested && !isEncryptedValue(row.invested)) {
      updates.push(`invested = $${index}`);
      values.push(encryptAtRest(row.invested));
      index += 1;
    }

    if (row.profit && !isEncryptedValue(row.profit)) {
      updates.push(`profit = $${index}`);
      values.push(encryptAtRest(row.profit));
      index += 1;
    }

    if (row.revenue && !isEncryptedValue(row.revenue)) {
      updates.push(`revenue = $${index}`);
      values.push(encryptAtRest(row.revenue));
      index += 1;
    }

    if (row.margin && !isEncryptedValue(row.margin)) {
      updates.push(`margin = $${index}`);
      values.push(encryptAtRest(row.margin));
      index += 1;
    }

    if (updates.length) {
      values.push(row.id);
      await pool.query(
        `UPDATE profit_snapshots SET ${updates.join(", ")} WHERE id = $${index}`,
        values
      );
    }
  }
}

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/signup", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  const displayName = (req.body.displayName || "").trim();
  const publicKey = typeof req.body.publicKey === "string" ? req.body.publicKey.trim() : null;
  const encryptedPrivateKey =
    typeof req.body.encryptedPrivateKey === "string" ? req.body.encryptedPrivateKey.trim() : null;
  const keySalt = typeof req.body.keySalt === "string" ? req.body.keySalt.trim() : null;
  const keyIv = typeof req.body.keyIv === "string" ? req.body.keyIv.trim() : null;
  const keyIterationsInput = Number.parseInt(req.body.keyIterations, 10);
  const keyIterations = Number.isInteger(keyIterationsInput) ? keyIterationsInput : null;

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
    const emailHash = hashLookup(email);
    const displayNameHash = hashLookup(displayName);
    const encryptedPasswordHash = encryptAtRest(passwordHash);
    const result = await pool.query(
      `
        INSERT INTO users (
          email,
          password_hash,
          display_name,
          email_hash,
          display_name_hash,
          public_key,
          encrypted_private_key,
          key_salt,
          key_iv,
          key_iterations,
          account_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id,
                  email,
                  display_name,
                  account_type,
                  public_key,
                  encrypted_private_key,
                  key_salt,
                  key_iv,
                  key_iterations
      `,
      [
        encryptAtRest(email),
        encryptedPasswordHash,
        encryptAtRest(displayName),
        emailHash,
        displayNameHash,
        publicKey ? encryptAtRest(publicKey) : null,
        encryptedPrivateKey ? encryptAtRest(encryptedPrivateKey) : null,
        keySalt ? encryptAtRest(keySalt) : null,
        keyIv ? encryptAtRest(keyIv) : null,
        keyIterations,
        encryptAtRest("guest")
      ]
    );

    decryptRow(result.rows[0], [
      "email",
      "display_name",
      "account_type",
      "public_key",
      "encrypted_private_key",
      "key_salt",
      "key_iv"
    ]);
    await ensureDefaultFolderForUser(result.rows[0].id);
    const token = await createSession(result.rows[0].id);

    return res.status(201).json({
      ok: true,
      user: result.rows[0],
      token,
      redirect: "/home.html"
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
    const emailHash = hashLookup(email);
    const result = await pool.query(
      `SELECT id,
              email,
              display_name,
              password_hash,
              account_type,
              public_key,
              encrypted_private_key,
              key_salt,
              key_iv,
              key_iterations
       FROM users
       WHERE email_hash = $1`,
      [emailHash]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = result.rows[0];
    decryptRow(user, [
      "email",
      "display_name",
      "password_hash",
      "account_type",
      "public_key",
      "encrypted_private_key",
      "key_salt",
      "key_iv"
    ]);
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = await createSession(user.id);

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        account_type: user.account_type,
        public_key: user.public_key,
        encrypted_private_key: user.encrypted_private_key,
        key_salt: user.key_salt,
        key_iv: user.key_iv,
        key_iterations: user.key_iterations
      },
      token,
      redirect: "/home.html"
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
      "SELECT id, email, display_name, profile_image_url, account_type FROM users WHERE id = $1",
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found." });
    }

    const updatedUser = result.rows[0];
    decryptRow(updatedUser, ["email", "display_name", "profile_image_url", "account_type"]);
    return res.json({ ok: true, user: updatedUser });
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

app.post("/api/e2ee/bootstrap", async (req, res) => {
  const token = getTokenFromRequest(req);
  const publicKey = typeof req.body.publicKey === "string" ? req.body.publicKey.trim() : "";
  const encryptedPrivateKey =
    typeof req.body.encryptedPrivateKey === "string" ? req.body.encryptedPrivateKey.trim() : "";
  const keySalt = typeof req.body.keySalt === "string" ? req.body.keySalt.trim() : "";
  const keyIv = typeof req.body.keyIv === "string" ? req.body.keyIv.trim() : "";
  const keyIterationsInput = Number.parseInt(req.body.keyIterations, 10);
  const keyIterations = Number.isInteger(keyIterationsInput) ? keyIterationsInput : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!publicKey || !encryptedPrivateKey || !keySalt || !keyIv || !keyIterations) {
    return res.status(400).json({ error: "Missing encryption keys." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        UPDATE users
        SET public_key = $1,
            encrypted_private_key = $2,
            key_salt = $3,
            key_iv = $4,
            key_iterations = $5
        WHERE id = $6
        RETURNING id,
                  public_key,
                  encrypted_private_key,
                  key_salt,
                  key_iv,
                  key_iterations
      `,
      [
        encryptAtRest(publicKey),
        encryptAtRest(encryptedPrivateKey),
        encryptAtRest(keySalt),
        encryptAtRest(keyIv),
        keyIterations,
        user.id
      ]
    );

    const keys = result.rows[0];
    decryptRow(keys, ["public_key", "encrypted_private_key", "key_salt", "key_iv"]);
    return res.json({ ok: true, keys });
  } catch (error) {
    console.error("E2EE bootstrap failed:", error);
    return res.status(500).json({ error: "Unable to save encryption keys." });
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
      values.push(encryptAtRest(displayName));
      index += 1;
      updates.push(`display_name_hash = $${index}`);
      values.push(hashLookup(displayName));
      index += 1;
    }

    if (emailInput !== undefined) {
      const email = String(emailInput).trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "Please enter a valid email." });
      }
      updates.push(`email = $${index}`);
      values.push(encryptAtRest(email));
      index += 1;
      updates.push(`email_hash = $${index}`);
      values.push(hashLookup(email));
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
        RETURNING id, email, display_name, profile_image_url, account_type
      `,
      values
    );

    const updatedUser = result.rows[0];
    decryptRow(updatedUser, ["email", "display_name", "profile_image_url", "account_type"]);
    return res.json({ ok: true, user: updatedUser });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email is already registered." });
    }
    console.error("Profile update failed:", error);
    return res.status(500).json({ error: "Unable to update profile." });
  }
});

app.get("/api/folders", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const ownFolders = await pool.query(
      `
        SELECT folders.id,
               folders.name,
               folders.created_at,
               folders.updated_at,
               folder_keys.enc_key AS encrypted_key,
               folder_keys.enc_iv AS key_iv,
               folder_keys.key_version
        FROM folders
        LEFT JOIN folder_keys
          ON folder_keys.folder_id = folders.id
         AND folder_keys.user_id = $1
        WHERE folders.user_id = $1
        ORDER BY folders.created_at ASC, folders.id ASC
      `,
      [user.id]
    );

    const sharedFolders = await pool.query(
      `
        SELECT folders.id,
               folders.name,
               folders.user_id AS owner_id,
               users.display_name AS owner_display_name,
               users.public_key AS owner_public_key,
               folder_keys.enc_key AS encrypted_key,
               folder_keys.enc_iv AS key_iv,
               folder_keys.key_version
        FROM folder_shares
        JOIN folders ON folders.id = folder_shares.folder_id
        JOIN users ON users.id = folders.user_id
        LEFT JOIN folder_keys
          ON folder_keys.folder_id = folders.id
         AND folder_keys.user_id = $1
        WHERE folder_shares.shared_with_user_id = $1
        ORDER BY folder_shares.created_at ASC, folders.id ASC
      `,
      [user.id]
    );

    const own = decryptRows(ownFolders.rows, ["name", "encrypted_key", "key_iv"]);
    const shared = decryptRows(sharedFolders.rows, [
      "name",
      "owner_display_name",
      "owner_public_key",
      "encrypted_key",
      "key_iv"
    ]);
    return res.json({
      ok: true,
      folders: own,
      sharedFolders: shared
    });
  } catch (error) {
    console.error("Folder lookup failed:", error);
    return res.status(500).json({ error: "Unable to load folders." });
  }
});

app.post("/api/folders", async (req, res) => {
  const token = getTokenFromRequest(req);
  const nameInput = typeof req.body.name === "string" ? req.body.name.trim() : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!nameInput) {
    return res.status(400).json({ error: "Folder name is required." });
  }

  if (nameInput.length > 32) {
    return res.status(400).json({ error: "Folder name is too long." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        INSERT INTO folders (user_id, name)
        VALUES ($1, $2)
        RETURNING id, name, created_at, updated_at
      `,
      [user.id, encryptAtRest(nameInput)]
    );

    const folder = result.rows[0];
    decryptRow(folder, ["name"]);
    return res.status(201).json({ ok: true, folder });
  } catch (error) {
    console.error("Folder create failed:", error);
    return res.status(500).json({ error: "Unable to create folder." });
  }
});

app.patch("/api/folders/:id", async (req, res) => {
  const token = getTokenFromRequest(req);
  const folderId = Number.parseInt(req.params.id, 10);
  const nameInput = typeof req.body.name === "string" ? req.body.name.trim() : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(folderId)) {
    return res.status(400).json({ error: "Invalid folder id." });
  }

  if (!nameInput) {
    return res.status(400).json({ error: "Folder name is required." });
  }

  if (nameInput.length > 32) {
    return res.status(400).json({ error: "Folder name is too long." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        UPDATE folders
        SET name = $1, updated_at = NOW()
        WHERE id = $2 AND user_id = $3
        RETURNING id, name, created_at, updated_at
      `,
      [encryptAtRest(nameInput), folderId, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Folder not found." });
    }

    const folder = result.rows[0];
    decryptRow(folder, ["name"]);
    return res.json({ ok: true, folder });
  } catch (error) {
    console.error("Folder update failed:", error);
    return res.status(500).json({ error: "Unable to update folder." });
  }
});

app.post("/api/folders/:id/key", async (req, res) => {
  const token = getTokenFromRequest(req);
  const folderId = Number.parseInt(req.params.id, 10);
  const encryptedKey = typeof req.body.encryptedKey === "string" ? req.body.encryptedKey.trim() : "";
  const keyIv = typeof req.body.keyIv === "string" ? req.body.keyIv.trim() : "";
  const keyVersionInput = Number.parseInt(req.body.keyVersion, 10);
  const keyVersion = Number.isInteger(keyVersionInput) ? keyVersionInput : 1;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(folderId)) {
    return res.status(400).json({ error: "Invalid folder id." });
  }

  if (!encryptedKey || !keyIv) {
    return res.status(400).json({ error: "Encrypted key is required." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const access = await getFolderAccess(user.id, folderId);
    if (!access || !access.canEdit) {
      return res.status(404).json({ error: "Folder not found." });
    }

    const result = await pool.query(
      `
        INSERT INTO folder_keys (folder_id, user_id, enc_key, enc_iv, key_version)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (folder_id, user_id)
        DO UPDATE SET enc_key = EXCLUDED.enc_key,
                      enc_iv = EXCLUDED.enc_iv,
                      key_version = EXCLUDED.key_version
        RETURNING folder_id, user_id, enc_key, enc_iv, key_version
      `,
      [folderId, user.id, encryptAtRest(encryptedKey), encryptAtRest(keyIv), keyVersion]
    );

    const keyRow = result.rows[0];
    decryptRow(keyRow, ["enc_key", "enc_iv"]);
    return res.json({ ok: true, key: keyRow });
  } catch (error) {
    console.error("Folder key save failed:", error);
    return res.status(500).json({ error: "Unable to save folder key." });
  }
});

app.delete("/api/folders/:id", async (req, res) => {
  const token = getTokenFromRequest(req);
  const folderId = Number.parseInt(req.params.id, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(folderId)) {
    return res.status(400).json({ error: "Invalid folder id." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      "DELETE FROM folders WHERE id = $1 AND user_id = $2 RETURNING id",
      [folderId, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Folder not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("Folder delete failed:", error);
    return res.status(500).json({ error: "Unable to delete folder." });
  }
});

app.get("/api/folders/:id/post-its", async (req, res) => {
  const token = getTokenFromRequest(req);
  const folderId = Number.parseInt(req.params.id, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(folderId)) {
    return res.status(400).json({ error: "Invalid folder id." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const access = await getFolderAccess(user.id, folderId);
    if (!access) {
      return res.status(404).json({ error: "Folder not found." });
    }

    const result = await pool.query(
      `
        SELECT id,
               body,
               body_ciphertext,
               body_iv,
               body_version,
               created_at,
               updated_at
        FROM post_its
        WHERE folder_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [folderId]
    );

    const postIts = decryptRows(result.rows, ["body", "body_ciphertext", "body_iv"]);
    return res.json({
      ok: true,
      postIts,
      canEdit: access.canEdit,
      folder: access.folder
    });
  } catch (error) {
    console.error("Post-it lookup failed:", error);
    return res.status(500).json({ error: "Unable to load notes." });
  }
});

app.get("/api/post-its", async (req, res) => {
  const token = getTokenFromRequest(req);
  const folderId = Number.parseInt(req.query.folderId, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(folderId)) {
    return res.status(400).json({ error: "Folder id is required." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const access = await getFolderAccess(user.id, folderId);
    if (!access) {
      return res.status(404).json({ error: "Folder not found." });
    }

    const result = await pool.query(
      `
        SELECT id,
               body,
               body_ciphertext,
               body_iv,
               body_version,
               created_at,
               updated_at
        FROM post_its
        WHERE folder_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [folderId]
    );

    const postIts = decryptRows(result.rows, ["body", "body_ciphertext", "body_iv"]);
    return res.json({
      ok: true,
      postIts,
      canEdit: access.canEdit,
      folder: access.folder
    });
  } catch (error) {
    console.error("Post-it lookup failed:", error);
    return res.status(500).json({ error: "Unable to load notes." });
  }
});

app.post("/api/post-its", async (req, res) => {
  const token = getTokenFromRequest(req);
  const bodyCiphertext =
    typeof req.body.bodyCiphertext === "string" ? req.body.bodyCiphertext.trim() : "";
  const bodyIv = typeof req.body.bodyIv === "string" ? req.body.bodyIv.trim() : "";
  const bodyVersionInput = Number.parseInt(req.body.bodyVersion, 10);
  const bodyVersion = Number.isInteger(bodyVersionInput) ? bodyVersionInput : 1;
  const isEncrypted = Boolean(bodyCiphertext && bodyIv);
  const bodyInput = !isEncrypted && typeof req.body.body === "string" ? req.body.body.trim() : "";
  const bodyValue = isEncrypted ? "" : bodyInput;
  const folderId = Number.parseInt(req.body.folderId, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(folderId)) {
    return res.status(400).json({ error: "Folder id is required." });
  }

  if (!isEncrypted) {
    return res.status(400).json({ error: "Note must be encrypted." });
  }

  if (!isEncrypted && bodyInput.length > 4000) {
    return res.status(400).json({ error: "Note is too long." });
  }
  if (isEncrypted && bodyCiphertext.length > 16000) {
    return res.status(400).json({ error: "Note is too long." });
  }
  if (isEncrypted && bodyIv.length > 128) {
    return res.status(400).json({ error: "Note is too long." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const access = await getFolderAccess(user.id, folderId);
    if (!access || !access.canEdit) {
      return res.status(404).json({ error: "Folder not found." });
    }

    const storedBody = encryptAtRest(bodyValue);
    const storedCiphertext = bodyCiphertext ? encryptAtRest(bodyCiphertext) : null;
    const storedIv = bodyIv ? encryptAtRest(bodyIv) : null;
    const result = await pool.query(
      `
        INSERT INTO post_its (user_id, folder_id, body, body_ciphertext, body_iv, body_version)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id,
                  body,
                  body_ciphertext,
                  body_iv,
                  body_version,
                  created_at,
                  updated_at
      `,
      [user.id, folderId, storedBody, storedCiphertext, storedIv, bodyVersion]
    );

    const postIt = result.rows[0];
    decryptRow(postIt, ["body", "body_ciphertext", "body_iv"]);
    return res.status(201).json({ ok: true, postIt });
  } catch (error) {
    console.error("Post-it create failed:", error);
    return res.status(500).json({ error: "Unable to save note." });
  }
});

app.patch("/api/post-its/:id", async (req, res) => {
  const token = getTokenFromRequest(req);
  const postItId = Number.parseInt(req.params.id, 10);
  const bodyCiphertext =
    typeof req.body.bodyCiphertext === "string" ? req.body.bodyCiphertext.trim() : "";
  const bodyIv = typeof req.body.bodyIv === "string" ? req.body.bodyIv.trim() : "";
  const bodyVersionInput = Number.parseInt(req.body.bodyVersion, 10);
  const bodyVersion = Number.isInteger(bodyVersionInput) ? bodyVersionInput : 1;
  const isEncrypted = Boolean(bodyCiphertext && bodyIv);
  const bodyInput = !isEncrypted && typeof req.body.body === "string" ? req.body.body.trim() : "";
  const bodyValue = isEncrypted ? "" : bodyInput;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(postItId)) {
    return res.status(400).json({ error: "Invalid note id." });
  }

  if (!isEncrypted) {
    return res.status(400).json({ error: "Note must be encrypted." });
  }

  if (!isEncrypted && bodyInput.length > 4000) {
    return res.status(400).json({ error: "Note is too long." });
  }
  if (isEncrypted && bodyCiphertext.length > 16000) {
    return res.status(400).json({ error: "Note is too long." });
  }
  if (isEncrypted && bodyIv.length > 128) {
    return res.status(400).json({ error: "Note is too long." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const storedBody = encryptAtRest(bodyValue);
    const storedCiphertext = bodyCiphertext ? encryptAtRest(bodyCiphertext) : null;
    const storedIv = bodyIv ? encryptAtRest(bodyIv) : null;
    const result = await pool.query(
      `
        UPDATE post_its
        SET body = $1,
            body_ciphertext = $2,
            body_iv = $3,
            body_version = $4,
            updated_at = NOW()
        WHERE id = $5 AND user_id = $6
        RETURNING id,
                  body,
                  body_ciphertext,
                  body_iv,
                  body_version,
                  created_at,
                  updated_at
      `,
      [storedBody, storedCiphertext, storedIv, bodyVersion, postItId, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Note not found." });
    }

    const postIt = result.rows[0];
    decryptRow(postIt, ["body", "body_ciphertext", "body_iv"]);
    return res.json({ ok: true, postIt });
  } catch (error) {
    console.error("Post-it update failed:", error);
    return res.status(500).json({ error: "Unable to save note." });
  }
});

app.delete("/api/post-its/:id", async (req, res) => {
  const token = getTokenFromRequest(req);
  const postItId = Number.parseInt(req.params.id, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(postItId)) {
    return res.status(400).json({ error: "Invalid note id." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      "DELETE FROM post_its WHERE id = $1 AND user_id = $2 RETURNING id",
      [postItId, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Note not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("Post-it delete failed:", error);
    return res.status(500).json({ error: "Unable to delete note." });
  }
});

app.get("/api/expenses", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        SELECT id,
               name,
               amount,
               currency,
               category,
               expense_date,
               created_at
        FROM expenses
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [user.id]
    );

    const expenses = decryptRows(result.rows, [
      "name",
      "amount",
      "currency",
      "category",
      "expense_date"
    ]);
    expenses.forEach((expense) => {
      const parsedAmount = Number.parseFloat(expense.amount);
      expense.amount = Number.isFinite(parsedAmount) ? parsedAmount : null;
    });
    return res.json({ ok: true, expenses });
  } catch (error) {
    console.error("Expense lookup failed:", error);
    return res.status(500).json({ error: "Unable to load expenses." });
  }
});

app.get("/api/expenses/summary", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      "SELECT amount FROM expenses WHERE user_id = $1",
      [user.id]
    );

    let total = 0;
    result.rows.forEach((row) => {
      const amount = Number.parseFloat(decryptAtRest(row.amount));
      if (Number.isFinite(amount)) {
        total += amount;
      }
    });

    return res.json({
      ok: true,
      summary: { total, count: result.rows.length }
    });
  } catch (error) {
    console.error("Expense summary failed:", error);
    return res.status(500).json({ error: "Unable to load expense summary." });
  }
});

app.post("/api/expenses", async (req, res) => {
  const token = getTokenFromRequest(req);
  const nameInput = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const amountInput = Number.parseFloat(req.body.amount);
  const categoryInput = typeof req.body.category === "string" ? req.body.category.trim() : "";
  const dateInput = typeof req.body.date === "string" ? req.body.date.trim() : "";
  const currencyInput =
    typeof req.body.currency === "string" ? req.body.currency.trim().toUpperCase() : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    return res.status(400).json({ error: "Amount must be greater than 0." });
  }

  const nameValue = nameInput || "Untitled";
  if (nameValue.length > 80) {
    return res.status(400).json({ error: "Expense name is too long." });
  }

  if (categoryInput.length > 40) {
    return res.status(400).json({ error: "Category is too long." });
  }

  if (dateInput.length > 32) {
    return res.status(400).json({ error: "Date is too long." });
  }

  if (currencyInput.length > 6) {
    return res.status(400).json({ error: "Currency is too long." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        INSERT INTO expenses (user_id, name, amount, currency, category, expense_date)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id,
                  name,
                  amount,
                  currency,
                  category,
                  expense_date,
                  created_at
      `,
      [
        user.id,
        encryptAtRest(nameValue),
        encryptAtRest(String(amountInput)),
        currencyInput ? encryptAtRest(currencyInput) : null,
        categoryInput ? encryptAtRest(categoryInput) : null,
        dateInput ? encryptAtRest(dateInput) : null
      ]
    );

    const expense = result.rows[0];
    decryptRow(expense, ["name", "amount", "currency", "category", "expense_date"]);
    expense.amount = amountInput;
    return res.status(201).json({ ok: true, expense });
  } catch (error) {
    console.error("Expense create failed:", error);
    return res.status(500).json({ error: "Unable to save expense." });
  }
});

app.delete("/api/expenses/:id", async (req, res) => {
  const token = getTokenFromRequest(req);
  const expenseId = Number.parseInt(req.params.id, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(expenseId)) {
    return res.status(400).json({ error: "Invalid expense id." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      "DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id",
      [expenseId, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Expense not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("Expense delete failed:", error);
    return res.status(500).json({ error: "Unable to delete expense." });
  }
});

app.delete("/api/expenses", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    await pool.query("DELETE FROM expenses WHERE user_id = $1", [user.id]);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Expense clear failed:", error);
    return res.status(500).json({ error: "Unable to clear expenses." });
  }
});

app.get("/api/sales", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        SELECT id,
               name,
               units,
               unit_price,
               total,
               currency,
               sale_date,
               created_at
        FROM sales
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [user.id]
    );

    const sales = decryptRows(result.rows, [
      "name",
      "units",
      "unit_price",
      "total",
      "currency",
      "sale_date"
    ]);
    sales.forEach((sale) => {
      const units = Number.parseFloat(sale.units);
      const unitPrice = Number.parseFloat(sale.unit_price);
      const total = Number.parseFloat(sale.total);
      sale.units = Number.isFinite(units) ? units : null;
      sale.unit_price = Number.isFinite(unitPrice) ? unitPrice : null;
      sale.total = Number.isFinite(total) ? total : null;
    });

    return res.json({ ok: true, sales });
  } catch (error) {
    console.error("Sales lookup failed:", error);
    return res.status(500).json({ error: "Unable to load sales." });
  }
});

app.get("/api/sales/summary", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      "SELECT total FROM sales WHERE user_id = $1",
      [user.id]
    );

    let total = 0;
    result.rows.forEach((row) => {
      const value = Number.parseFloat(decryptAtRest(row.total));
      if (Number.isFinite(value)) {
        total += value;
      }
    });

    return res.json({
      ok: true,
      summary: { total, count: result.rows.length }
    });
  } catch (error) {
    console.error("Sales summary failed:", error);
    return res.status(500).json({ error: "Unable to load sales summary." });
  }
});

app.post("/api/sales", async (req, res) => {
  const token = getTokenFromRequest(req);
  const nameInput = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const unitsInput = Number.parseFloat(req.body.units);
  const unitPriceInput = Number.parseFloat(req.body.unitPrice);
  const dateInput = typeof req.body.date === "string" ? req.body.date.trim() : "";
  const currencyInput =
    typeof req.body.currency === "string" ? req.body.currency.trim().toUpperCase() : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isFinite(unitsInput) || unitsInput <= 0) {
    return res.status(400).json({ error: "Units must be greater than 0." });
  }

  if (!Number.isFinite(unitPriceInput) || unitPriceInput <= 0) {
    return res.status(400).json({ error: "Unit price must be greater than 0." });
  }

  const nameValue = nameInput || "Untitled";
  if (nameValue.length > 80) {
    return res.status(400).json({ error: "Sale name is too long." });
  }

  if (dateInput.length > 32) {
    return res.status(400).json({ error: "Date is too long." });
  }

  if (currencyInput.length > 6) {
    return res.status(400).json({ error: "Currency is too long." });
  }

  const totalValue = unitsInput * unitPriceInput;

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        INSERT INTO sales (user_id, name, units, unit_price, total, currency, sale_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id,
                  name,
                  units,
                  unit_price,
                  total,
                  currency,
                  sale_date,
                  created_at
      `,
      [
        user.id,
        encryptAtRest(nameValue),
        encryptAtRest(String(unitsInput)),
        encryptAtRest(String(unitPriceInput)),
        encryptAtRest(String(totalValue)),
        currencyInput ? encryptAtRest(currencyInput) : null,
        dateInput ? encryptAtRest(dateInput) : null
      ]
    );

    const sale = result.rows[0];
    decryptRow(sale, ["name", "units", "unit_price", "total", "currency", "sale_date"]);
    sale.units = unitsInput;
    sale.unit_price = unitPriceInput;
    sale.total = totalValue;
    return res.status(201).json({ ok: true, sale });
  } catch (error) {
    console.error("Sale create failed:", error);
    return res.status(500).json({ error: "Unable to save sale." });
  }
});

app.delete("/api/sales/:id", async (req, res) => {
  const token = getTokenFromRequest(req);
  const saleId = Number.parseInt(req.params.id, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(saleId)) {
    return res.status(400).json({ error: "Invalid sale id." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      "DELETE FROM sales WHERE id = $1 AND user_id = $2 RETURNING id",
      [saleId, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Sale not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("Sale delete failed:", error);
    return res.status(500).json({ error: "Unable to delete sale." });
  }
});

app.delete("/api/sales", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    await pool.query("DELETE FROM sales WHERE user_id = $1", [user.id]);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Sales clear failed:", error);
    return res.status(500).json({ error: "Unable to clear sales." });
  }
});

app.get("/api/profit-snapshot", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        SELECT currency,
               invested,
               profit,
               revenue,
               margin,
               updated_at
        FROM profit_snapshots
        WHERE user_id = $1
        LIMIT 1
      `,
      [user.id]
    );

    if (!result.rows.length) {
      return res.json({ ok: true, snapshot: null });
    }

    const snapshot = result.rows[0];
    decryptRow(snapshot, ["currency", "invested", "profit", "revenue", "margin"]);
    const investedValue = Number.parseFloat(snapshot.invested);
    const profitValue = Number.parseFloat(snapshot.profit);
    const revenueValue = Number.parseFloat(snapshot.revenue);
    const marginValue = Number.parseFloat(snapshot.margin);
    snapshot.invested = Number.isFinite(investedValue) ? investedValue : null;
    snapshot.profit = Number.isFinite(profitValue) ? profitValue : null;
    snapshot.revenue = Number.isFinite(revenueValue) ? revenueValue : null;
    snapshot.margin =
      snapshot.margin === null || snapshot.margin === undefined || snapshot.margin === ""
        ? null
        : Number.isFinite(marginValue)
          ? marginValue
          : null;
    return res.json({ ok: true, snapshot });
  } catch (error) {
    console.error("Profit snapshot lookup failed:", error);
    return res.status(500).json({ error: "Unable to load profit snapshot." });
  }
});

app.post("/api/profit-snapshot", async (req, res) => {
  const token = getTokenFromRequest(req);
  const currencyInput =
    typeof req.body.currency === "string" ? req.body.currency.trim().toUpperCase() : "";
  const investedInput = Number.parseFloat(req.body.invested);
  const profitInput = Number.parseFloat(req.body.profit);
  const revenueInput = Number.parseFloat(req.body.revenue);
  const marginInput = Number.parseFloat(req.body.margin);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isFinite(investedInput) || !Number.isFinite(profitInput) || !Number.isFinite(revenueInput)) {
    return res.status(400).json({ error: "Invalid profit snapshot values." });
  }

  const marginValue = Number.isFinite(marginInput) ? String(marginInput) : null;
  const currencyValue = currencyInput || "USD";

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        INSERT INTO profit_snapshots (user_id, currency, invested, profit, revenue, margin)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id)
        DO UPDATE SET currency = EXCLUDED.currency,
                      invested = EXCLUDED.invested,
                      profit = EXCLUDED.profit,
                      revenue = EXCLUDED.revenue,
                      margin = EXCLUDED.margin,
                      updated_at = NOW()
        RETURNING currency,
                  invested,
                  profit,
                  revenue,
                  margin,
                  updated_at
      `,
      [
        user.id,
        encryptAtRest(currencyValue),
        encryptAtRest(String(investedInput)),
        encryptAtRest(String(profitInput)),
        encryptAtRest(String(revenueInput)),
        marginValue ? encryptAtRest(marginValue) : null
      ]
    );

    const snapshot = result.rows[0];
    decryptRow(snapshot, ["currency", "invested", "profit", "revenue", "margin"]);
    snapshot.invested = investedInput;
    snapshot.profit = profitInput;
    snapshot.revenue = revenueInput;
    snapshot.margin = marginValue ? Number.parseFloat(marginValue) : null;
    return res.json({ ok: true, snapshot });
  } catch (error) {
    console.error("Profit snapshot save failed:", error);
    return res.status(500).json({ error: "Unable to save profit snapshot." });
  }
});

app.delete("/api/profit-snapshot", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    await pool.query("DELETE FROM profit_snapshots WHERE user_id = $1", [user.id]);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Profit snapshot delete failed:", error);
    return res.status(500).json({ error: "Unable to delete profit snapshot." });
  }
});

app.get("/api/friend-requests", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const pendingHash = hashLookup("pending");
    const incoming = await pool.query(
      `
        SELECT friend_requests.id,
               friend_requests.requester_id,
               users.display_name,
               users.email
        FROM friend_requests
        JOIN users ON users.id = friend_requests.requester_id
        WHERE friend_requests.recipient_id = $1
          AND friend_requests.status_hash = $2
        ORDER BY friend_requests.created_at ASC
      `,
      [user.id, pendingHash]
    );

    const outgoing = await pool.query(
      `
        SELECT friend_requests.id,
               friend_requests.recipient_id,
               users.display_name,
               users.email
        FROM friend_requests
        JOIN users ON users.id = friend_requests.recipient_id
        WHERE friend_requests.requester_id = $1
          AND friend_requests.status_hash = $2
        ORDER BY friend_requests.created_at ASC
      `,
      [user.id, pendingHash]
    );

    const incomingRows = decryptRows(incoming.rows, ["display_name", "email"]);
    const outgoingRows = decryptRows(outgoing.rows, ["display_name", "email"]);
    return res.json({ ok: true, incoming: incomingRows, outgoing: outgoingRows });
  } catch (error) {
    console.error("Friend request lookup failed:", error);
    return res.status(500).json({ error: "Unable to load friend requests." });
  }
});

app.post("/api/friend-requests", async (req, res) => {
  const token = getTokenFromRequest(req);
  const emailInput = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!emailInput || !emailInput.includes("@")) {
    return res.status(400).json({ error: "Please enter a valid email." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const targetResult = await pool.query(
      "SELECT id, display_name, email FROM users WHERE email_hash = $1",
      [hashLookup(emailInput)]
    );

    if (!targetResult.rows.length) {
      return res.status(404).json({ error: "User not found." });
    }

    const targetUser = targetResult.rows[0];
    if (targetUser.id === user.id) {
      return res.status(400).json({ error: "You cannot add yourself." });
    }

    const existing = await pool.query(
      `
        SELECT id, requester_id, recipient_id, status, status_hash
        FROM friend_requests
        WHERE (requester_id = $1 AND recipient_id = $2)
           OR (requester_id = $2 AND recipient_id = $1)
        LIMIT 1
      `,
      [user.id, targetUser.id]
    );

    if (existing.rows.length) {
      const request = existing.rows[0];
      const acceptedHash = hashLookup("accepted");
      const pendingHash = hashLookup("pending");
      const statusHash =
        request.status_hash || hashLookup(decryptAtRest(request.status || ""));
      if (statusHash === acceptedHash) {
        return res.status(409).json({ error: "You are already friends." });
      }
      if (statusHash === pendingHash) {
        if (request.requester_id === user.id) {
          return res.status(409).json({ error: "Friend request already sent." });
        }
        return res
          .status(409)
          .json({ error: "Friend request already received. Accept it first." });
      }
      await pool.query(
        `
          UPDATE friend_requests
          SET requester_id = $1,
              recipient_id = $2,
              status = $3,
              status_hash = $4,
              updated_at = NOW()
          WHERE id = $5
        `,
        [
          user.id,
          targetUser.id,
          encryptAtRest("pending"),
          hashLookup("pending"),
          request.id
        ]
      );

      return res.status(201).json({
        ok: true,
        request: {
          id: request.id,
          recipient_id: targetUser.id,
          display_name: decryptAtRest(targetUser.display_name),
          email: decryptAtRest(targetUser.email)
        }
      });
    }

    const result = await pool.query(
      `
        INSERT INTO friend_requests (requester_id, recipient_id, status, status_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [user.id, targetUser.id, encryptAtRest("pending"), hashLookup("pending")]
    );

    return res.status(201).json({
      ok: true,
      request: {
        id: result.rows[0].id,
        recipient_id: targetUser.id,
        display_name: decryptAtRest(targetUser.display_name),
        email: decryptAtRest(targetUser.email)
      }
    });
  } catch (error) {
    console.error("Friend request create failed:", error);
    return res.status(500).json({ error: "Unable to send friend request." });
  }
});

app.post("/api/friend-requests/:id/accept", async (req, res) => {
  const token = getTokenFromRequest(req);
  const requestId = Number.parseInt(req.params.id, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(requestId)) {
    return res.status(400).json({ error: "Invalid request id." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const pendingHash = hashLookup("pending");
    const result = await pool.query(
      `
        UPDATE friend_requests
        SET status = $3,
            status_hash = $4,
            updated_at = NOW()
        WHERE id = $1 AND recipient_id = $2 AND status_hash = $5
        RETURNING id, requester_id
      `,
      [
        requestId,
        user.id,
        encryptAtRest("accepted"),
        hashLookup("accepted"),
        pendingHash
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Friend request not found." });
    }

    return res.json({ ok: true, request: result.rows[0] });
  } catch (error) {
    console.error("Friend request accept failed:", error);
    return res.status(500).json({ error: "Unable to accept friend request." });
  }
});

app.post("/api/friend-requests/:id/decline", async (req, res) => {
  const token = getTokenFromRequest(req);
  const requestId = Number.parseInt(req.params.id, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(requestId)) {
    return res.status(400).json({ error: "Invalid request id." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const pendingHash = hashLookup("pending");
    const result = await pool.query(
      `
        UPDATE friend_requests
        SET status = $3,
            status_hash = $4,
            updated_at = NOW()
        WHERE id = $1 AND recipient_id = $2 AND status_hash = $5
        RETURNING id
      `,
      [
        requestId,
        user.id,
        encryptAtRest("declined"),
        hashLookup("declined"),
        pendingHash
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Friend request not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("Friend request decline failed:", error);
    return res.status(500).json({ error: "Unable to decline friend request." });
  }
});

app.get("/api/friends", async (req, res) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const acceptedHash = hashLookup("accepted");
    const result = await pool.query(
      `
        SELECT
          users.id,
          users.display_name,
          users.email,
          users.profile_image_url,
          users.public_key
        FROM friend_requests
        JOIN users ON users.id =
          CASE
            WHEN friend_requests.requester_id = $1 THEN friend_requests.recipient_id
            ELSE friend_requests.requester_id
          END
        WHERE friend_requests.status_hash = $2
          AND (friend_requests.requester_id = $1 OR friend_requests.recipient_id = $1)
        ORDER BY users.id ASC
      `,
      [user.id, acceptedHash]
    );

    const friends = decryptRows(result.rows, [
      "display_name",
      "email",
      "profile_image_url",
      "public_key"
    ]).sort((a, b) => {
      const nameA = (a.display_name || a.email || "").toLowerCase();
      const nameB = (b.display_name || b.email || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
    return res.json({ ok: true, friends });
  } catch (error) {
    console.error("Friend list lookup failed:", error);
    return res.status(500).json({ error: "Unable to load friends." });
  }
});

app.get("/api/messages/:userId", async (req, res) => {
  const token = getTokenFromRequest(req);
  const otherUserId = Number.parseInt(req.params.userId, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(otherUserId)) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const friends = await areFriends(user.id, otherUserId);
    if (!friends) {
      return res.status(403).json({ error: "You can only message friends." });
    }

    const result = await pool.query(
      `
        SELECT messages.id,
               messages.body,
               messages.body_ciphertext,
               messages.body_iv,
               messages.body_version,
               messages.sender_id,
               messages.recipient_id,
               messages.share_folder_id,
               messages.created_at,
               folders.name AS share_folder_name
        FROM messages
        LEFT JOIN folders ON folders.id = messages.share_folder_id
        WHERE (messages.sender_id = $1 AND messages.recipient_id = $2)
           OR (messages.sender_id = $2 AND messages.recipient_id = $1)
        ORDER BY messages.created_at ASC, messages.id ASC
        LIMIT 200
      `,
      [user.id, otherUserId]
    );

    const messages = decryptRows(result.rows, [
      "body",
      "body_ciphertext",
      "body_iv",
      "share_folder_name"
    ]);
    return res.json({ ok: true, messages });
  } catch (error) {
    console.error("Message lookup failed:", error);
    return res.status(500).json({ error: "Unable to load messages." });
  }
});

app.post("/api/messages/:id/encrypt", async (req, res) => {
  const token = getTokenFromRequest(req);
  const messageId = Number.parseInt(req.params.id, 10);
  const bodyCiphertext =
    typeof req.body.bodyCiphertext === "string" ? req.body.bodyCiphertext.trim() : "";
  const bodyIv = typeof req.body.bodyIv === "string" ? req.body.bodyIv.trim() : "";
  const bodyVersionInput = Number.parseInt(req.body.bodyVersion, 10);
  const bodyVersion = Number.isInteger(bodyVersionInput) ? bodyVersionInput : 1;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(messageId)) {
    return res.status(400).json({ error: "Invalid message id." });
  }

  if (!bodyCiphertext || !bodyIv) {
    return res.status(400).json({ error: "Encrypted message is required." });
  }

  if (bodyCiphertext.length > 16000 || bodyIv.length > 128) {
    return res.status(400).json({ error: "Message is too long." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const storedCiphertext = encryptAtRest(bodyCiphertext);
    const storedIv = encryptAtRest(bodyIv);
    const result = await pool.query(
      `
        UPDATE messages
        SET body = '',
            body_ciphertext = $1,
            body_iv = $2,
            body_version = $3
        WHERE id = $4
          AND body_ciphertext IS NULL
          AND (sender_id = $5 OR recipient_id = $5)
        RETURNING id, body_ciphertext, body_iv, body_version
      `,
      [storedCiphertext, storedIv, bodyVersion, messageId, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Message not found or already encrypted." });
    }

    const message = result.rows[0];
    decryptRow(message, ["body_ciphertext", "body_iv"]);
    return res.json({ ok: true, message });
  } catch (error) {
    console.error("Message encrypt failed:", error);
    return res.status(500).json({ error: "Unable to encrypt message." });
  }
});

app.post("/api/messages", async (req, res) => {
  const token = getTokenFromRequest(req);
  const bodyCiphertext =
    typeof req.body.bodyCiphertext === "string" ? req.body.bodyCiphertext.trim() : "";
  const bodyIv = typeof req.body.bodyIv === "string" ? req.body.bodyIv.trim() : "";
  const bodyVersionInput = Number.parseInt(req.body.bodyVersion, 10);
  const bodyVersion = Number.isInteger(bodyVersionInput) ? bodyVersionInput : 1;
  const isEncrypted = Boolean(bodyCiphertext && bodyIv);
  const bodyInput = !isEncrypted && typeof req.body.body === "string" ? req.body.body.trim() : "";
  const bodyValue = isEncrypted ? "" : bodyInput;
  const recipientId = Number.parseInt(req.body.recipientId, 10);
  const shareFolderId = Number.parseInt(req.body.shareFolderId, 10);
  const shareFolderKey =
    typeof req.body.shareFolderKey === "string" ? req.body.shareFolderKey.trim() : "";
  const shareFolderKeyIv =
    typeof req.body.shareFolderKeyIv === "string" ? req.body.shareFolderKeyIv.trim() : "";
  const shareFolderKeyVersionInput = Number.parseInt(req.body.shareFolderKeyVersion, 10);
  const shareFolderKeyVersion = Number.isInteger(shareFolderKeyVersionInput)
    ? shareFolderKeyVersionInput
    : 1;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(recipientId)) {
    return res.status(400).json({ error: "Recipient is required." });
  }

  if (!bodyValue && !isEncrypted && !Number.isInteger(shareFolderId)) {
    return res.status(400).json({ error: "Message cannot be empty." });
  }

  if (!isEncrypted && bodyInput) {
    return res.status(400).json({ error: "Message must be encrypted." });
  }

  if (!isEncrypted && bodyInput.length > 4000) {
    return res.status(400).json({ error: "Message is too long." });
  }

  if (isEncrypted && bodyCiphertext.length > 16000) {
    return res.status(400).json({ error: "Message is too long." });
  }

  if (isEncrypted && bodyIv.length > 128) {
    return res.status(400).json({ error: "Message is too long." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const friends = await areFriends(user.id, recipientId);
    if (!friends) {
      return res.status(403).json({ error: "You can only message friends." });
    }

    let shareFolderName = null;
    let shareFolderValue = null;
    if (Number.isInteger(shareFolderId)) {
      const folderResult = await pool.query(
        "SELECT id, name FROM folders WHERE id = $1 AND user_id = $2",
        [shareFolderId, user.id]
      );

      if (!folderResult.rows.length) {
        return res.status(404).json({ error: "Folder not found." });
      }

      shareFolderValue = folderResult.rows[0].id;
      shareFolderName = decryptAtRest(folderResult.rows[0].name);

      await pool.query(
        `
          INSERT INTO folder_shares (folder_id, owner_id, shared_with_user_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (folder_id, shared_with_user_id) DO NOTHING
        `,
        [shareFolderId, user.id, recipientId]
      );

      if (shareFolderKey && shareFolderKeyIv) {
        await pool.query(
          `
            INSERT INTO folder_keys (folder_id, user_id, enc_key, enc_iv, key_version)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (folder_id, user_id)
            DO UPDATE SET enc_key = EXCLUDED.enc_key,
                          enc_iv = EXCLUDED.enc_iv,
                          key_version = EXCLUDED.key_version
          `,
          [
            shareFolderId,
            recipientId,
            encryptAtRest(shareFolderKey),
            encryptAtRest(shareFolderKeyIv),
            shareFolderKeyVersion
          ]
        );
      }
    }

    const storedBody = encryptAtRest(bodyValue);
    const storedCiphertext = bodyCiphertext ? encryptAtRest(bodyCiphertext) : null;
    const storedIv = bodyIv ? encryptAtRest(bodyIv) : null;
    const result = await pool.query(
      `
        INSERT INTO messages (
          sender_id,
          recipient_id,
          body,
          body_ciphertext,
          body_iv,
          body_version,
          share_folder_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id,
                  body,
                  body_ciphertext,
                  body_iv,
                  body_version,
                  sender_id,
                  recipient_id,
                  share_folder_id,
                  created_at
      `,
      [
        user.id,
        recipientId,
        storedBody,
        storedCiphertext,
        storedIv,
        bodyVersion,
        shareFolderValue
      ]
    );

    const message = result.rows[0];
    decryptRow(message, ["body", "body_ciphertext", "body_iv"]);

    return res.status(201).json({
      ok: true,
      message: {
        ...message,
        share_folder_name: shareFolderName
      }
    });
  } catch (error) {
    console.error("Message send failed:", error);
    return res.status(500).json({ error: "Unable to send message." });
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
      [encryptAtRest(imageUrl), user.id]
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

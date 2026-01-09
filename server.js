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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_adult BOOLEAN DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'guest';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS key_salt TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS key_iv TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS key_iterations INTEGER;`);
  await pool.query(`UPDATE users SET account_type = 'guest' WHERE account_type IS NULL;`);
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

  await pool.query(
    `
      INSERT INTO folders (user_id, name)
      SELECT users.id, $1
      FROM users
      WHERE NOT EXISTS (
        SELECT 1 FROM folders WHERE folders.user_id = users.id
      )
    `,
    [DEFAULT_FOLDER_NAME]
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
             users.is_adult,
             users.account_type,
             users.public_key,
             users.encrypted_private_key,
             users.key_salt,
             users.key_iv,
             users.key_iterations
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = $1
    `,
    [token]
  );
  return result.rows[0];
}

function getOwnerDisplayName() {
  return (process.env.OWNER_DISPLAY_NAME || DEFAULT_OWNER_DISPLAY_NAME || "").trim();
}

async function getOwnerId(ownerDisplayName) {
  if (!ownerDisplayName) {
    return null;
  }

  const result = await pool.query(
    "SELECT id FROM users WHERE LOWER(display_name) = LOWER($1) ORDER BY id ASC LIMIT 1",
    [ownerDisplayName]
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
    [userId, DEFAULT_FOLDER_NAME]
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
  const result = await pool.query(
    `
      SELECT id
      FROM friend_requests
      WHERE status = 'accepted'
        AND (
          (requester_id = $1 AND recipient_id = $2)
          OR
          (requester_id = $2 AND recipient_id = $1)
        )
      LIMIT 1
    `,
    [userId, otherUserId]
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

  await pool.query("UPDATE users SET account_type = 'guest' WHERE account_type = 'owner' AND id <> $1", [
    ownerId
  ]);
  await pool.query("UPDATE users SET account_type = 'owner' WHERE id = $1", [ownerId]);
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

  const values = [ownerId, folderId, ...DEFAULT_POST_ITS.map((note) => note.body)];
  const placeholders = DEFAULT_POST_ITS.map(
    (_, index) => `($1, $2, $${index + 3})`
  ).join(", ");
  await pool.query(
    `INSERT INTO post_its (user_id, folder_id, body) VALUES ${placeholders}`,
    values
  );
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
    const result = await pool.query(
      `
        INSERT INTO users (
          email,
          password_hash,
          display_name,
          public_key,
          encrypted_private_key,
          key_salt,
          key_iv,
          key_iterations
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
        email,
        passwordHash,
        displayName,
        publicKey,
        encryptedPrivateKey,
        keySalt,
        keyIv,
        keyIterations
      ]
    );

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
       WHERE email = $1`,
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
      [publicKey, encryptedPrivateKey, keySalt, keyIv, keyIterations, user.id]
    );

    return res.json({ ok: true, keys: result.rows[0] });
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
        RETURNING id, email, display_name, profile_image_url, account_type
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

    return res.json({
      ok: true,
      folders: ownFolders.rows,
      sharedFolders: sharedFolders.rows
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
      [user.id, nameInput]
    );

    return res.status(201).json({ ok: true, folder: result.rows[0] });
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
      [nameInput, folderId, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Folder not found." });
    }

    return res.json({ ok: true, folder: result.rows[0] });
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
      [folderId, user.id, encryptedKey, keyIv, keyVersion]
    );

    return res.json({ ok: true, key: result.rows[0] });
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

    return res.json({
      ok: true,
      postIts: result.rows,
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

    return res.json({
      ok: true,
      postIts: result.rows,
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
  const folderId = Number.parseInt(req.body.folderId, 10);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(folderId)) {
    return res.status(400).json({ error: "Folder id is required." });
  }

  if (!isEncrypted && !bodyInput) {
    return res.status(400).json({ error: "Note cannot be empty." });
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
      [user.id, folderId, bodyInput || "", bodyCiphertext || null, bodyIv || null, bodyVersion]
    );

    return res.status(201).json({ ok: true, postIt: result.rows[0] });
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

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(postItId)) {
    return res.status(400).json({ error: "Invalid note id." });
  }

  if (!isEncrypted && !bodyInput) {
    return res.status(400).json({ error: "Note cannot be empty." });
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
      [bodyInput || "", bodyCiphertext || null, bodyIv || null, bodyVersion, postItId, user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Note not found." });
    }

    return res.json({ ok: true, postIt: result.rows[0] });
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

    const incoming = await pool.query(
      `
        SELECT friend_requests.id,
               friend_requests.requester_id,
               users.display_name,
               users.email
        FROM friend_requests
        JOIN users ON users.id = friend_requests.requester_id
        WHERE friend_requests.recipient_id = $1
          AND friend_requests.status = 'pending'
        ORDER BY friend_requests.created_at ASC
      `,
      [user.id]
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
          AND friend_requests.status = 'pending'
        ORDER BY friend_requests.created_at ASC
      `,
      [user.id]
    );

    return res.json({ ok: true, incoming: incoming.rows, outgoing: outgoing.rows });
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
      "SELECT id, display_name, email FROM users WHERE LOWER(email) = LOWER($1)",
      [emailInput]
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
        SELECT id, requester_id, recipient_id, status
        FROM friend_requests
        WHERE (requester_id = $1 AND recipient_id = $2)
           OR (requester_id = $2 AND recipient_id = $1)
        LIMIT 1
      `,
      [user.id, targetUser.id]
    );

    if (existing.rows.length) {
      const request = existing.rows[0];
      if (request.status === "accepted") {
        return res.status(409).json({ error: "You are already friends." });
      }
      if (request.status === "pending") {
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
          SET requester_id = $1, recipient_id = $2, status = 'pending', updated_at = NOW()
          WHERE id = $3
        `,
        [user.id, targetUser.id, request.id]
      );

      return res.status(201).json({
        ok: true,
        request: {
          id: request.id,
          recipient_id: targetUser.id,
          display_name: targetUser.display_name,
          email: targetUser.email
        }
      });
    }

    const result = await pool.query(
      `
        INSERT INTO friend_requests (requester_id, recipient_id)
        VALUES ($1, $2)
        RETURNING id
      `,
      [user.id, targetUser.id]
    );

    return res.status(201).json({
      ok: true,
      request: {
        id: result.rows[0].id,
        recipient_id: targetUser.id,
        display_name: targetUser.display_name,
        email: targetUser.email
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

    const result = await pool.query(
      `
        UPDATE friend_requests
        SET status = 'accepted', updated_at = NOW()
        WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
        RETURNING id, requester_id
      `,
      [requestId, user.id]
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

    const result = await pool.query(
      `
        UPDATE friend_requests
        SET status = 'declined', updated_at = NOW()
        WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
        RETURNING id
      `,
      [requestId, user.id]
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
        WHERE friend_requests.status = 'accepted'
          AND (friend_requests.requester_id = $1 OR friend_requests.recipient_id = $1)
        ORDER BY users.display_name ASC
      `,
      [user.id]
    );

    return res.json({ ok: true, friends: result.rows });
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

    return res.json({ ok: true, messages: result.rows });
  } catch (error) {
    console.error("Message lookup failed:", error);
    return res.status(500).json({ error: "Unable to load messages." });
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

  if (!bodyInput && !isEncrypted && !Number.isInteger(shareFolderId)) {
    return res.status(400).json({ error: "Message cannot be empty." });
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
      shareFolderName = folderResult.rows[0].name;

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
          [shareFolderId, recipientId, shareFolderKey, shareFolderKeyIv, shareFolderKeyVersion]
        );
      }
    }

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
        bodyInput || "",
        bodyCiphertext || null,
        bodyIv || null,
        bodyVersion,
        shareFolderValue
      ]
    );

    return res.status(201).json({
      ok: true,
      message: {
        ...result.rows[0],
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

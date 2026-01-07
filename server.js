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
    CREATE TABLE IF NOT EXISTS post_its (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
             users.account_type
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

  const existing = await pool.query("SELECT id FROM post_its WHERE user_id = $1 LIMIT 1", [
    ownerId
  ]);
  if (existing.rows.length) {
    return;
  }

  const values = [ownerId, ...DEFAULT_POST_ITS.map((note) => note.body)];
  const placeholders = DEFAULT_POST_ITS.map((_, index) => `($1, $${index + 2})`).join(", ");
  await pool.query(`INSERT INTO post_its (user_id, body) VALUES ${placeholders}`, values);
}

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
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
        RETURNING id, email, display_name, account_type
      `,
      [email, passwordHash, displayName]
    );

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
      "SELECT id, email, display_name, password_hash, account_type FROM users WHERE email = $1",
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
        account_type: user.account_type
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

app.get("/api/post-its", async (req, res) => {
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
      "SELECT id, body, created_at, updated_at FROM post_its WHERE user_id = $1 ORDER BY created_at ASC, id ASC",
      [user.id]
    );

    return res.json({ ok: true, postIts: result.rows });
  } catch (error) {
    console.error("Post-it lookup failed:", error);
    return res.status(500).json({ error: "Unable to load notes." });
  }
});

app.post("/api/post-its", async (req, res) => {
  const token = getTokenFromRequest(req);
  const bodyInput = typeof req.body.body === "string" ? req.body.body.trim() : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!bodyInput) {
    return res.status(400).json({ error: "Note cannot be empty." });
  }

  if (bodyInput.length > 4000) {
    return res.status(400).json({ error: "Note is too long." });
  }

  try {
    const user = await getUserFromToken(token);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    const result = await pool.query(
      `
        INSERT INTO post_its (user_id, body)
        VALUES ($1, $2)
        RETURNING id, body, created_at, updated_at
      `,
      [user.id, bodyInput]
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
  const bodyInput = typeof req.body.body === "string" ? req.body.body.trim() : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  if (!Number.isInteger(postItId)) {
    return res.status(400).json({ error: "Invalid note id." });
  }

  if (!bodyInput) {
    return res.status(400).json({ error: "Note cannot be empty." });
  }

  if (bodyInput.length > 4000) {
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
        SET body = $1, updated_at = NOW()
        WHERE id = $2 AND user_id = $3
        RETURNING id, body, created_at, updated_at
      `,
      [bodyInput, postItId, user.id]
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

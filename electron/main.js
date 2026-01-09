const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

if (process.env.ELECTRON_RUN_AS_NODE === "1") {
  delete process.env.ELECTRON_RUN_AS_NODE;
}
const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;
let getPort;
let startServer;

let serverInstance = null;

function ensureDataKey(targetPath) {
  if (fs.existsSync(targetPath)) {
    return fs.readFileSync(targetPath, "utf8").trim();
  }
  const key = crypto.randomBytes(32).toString("base64");
  fs.writeFileSync(targetPath, key);
  return key;
}

async function createWindow() {
  const userDataDir = app.getPath("userData");
  const dataDir = path.join(userDataDir, "data");
  const uploadDir = path.join(userDataDir, "uploads");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const dataKeyPath = path.join(dataDir, "data.key");
  const dbPath = path.join(dataDir, "lezwuen.sqlite");
  const dataKey = ensureDataKey(dataKeyPath);
  if (!getPort) {
    const next = await import("get-port");
    getPort = next.default || next;
  }
  const port = await getPort({ port: 3210 });

  process.env.LEZWUEN_USE_SQLITE = "true";
  process.env.LEZWUEN_DB_PATH = dbPath;
  process.env.DATA_ENCRYPTION_KEY = dataKey;
  process.env.PORT = String(port);
  process.env.UPLOAD_DIR = uploadDir;

  if (!startServer) {
    startServer = require(path.join(__dirname, "..", "server.js")).startServer;
  }
  serverInstance = await startServer();

  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 700,
    title: "LeZwuen",
    frame: false,
    transparent: true,
    hasShadow: true,
    titleBarStyle: "hidden",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
      sandbox: false
    }
  });

  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  if (serverInstance && typeof serverInstance.close === "function") {
    serverInstance.close();
  }
});

ipcMain.handle("window:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.minimize();
  }
});

ipcMain.handle("window:maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.handle("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.close();
  }
});

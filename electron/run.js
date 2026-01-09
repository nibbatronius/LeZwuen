const { spawn } = require("child_process");
const path = require("path");

const electronPath = require("electron");
const spawnEnv = { ...process.env };
if (spawnEnv.ELECTRON_RUN_AS_NODE) {
  delete spawnEnv.ELECTRON_RUN_AS_NODE;
}

const child = spawn(electronPath, [path.join(process.cwd())], {
  env: spawnEnv,
  stdio: "inherit",
  windowsHide: false
});

child.on("close", (code, signal) => {
  if (code === null) {
    console.error("Electron exited with signal", signal);
    process.exit(1);
  }
  process.exit(code);
});

const handleSignal = (signal) => {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
};

handleSignal("SIGINT");
handleSignal("SIGTERM");

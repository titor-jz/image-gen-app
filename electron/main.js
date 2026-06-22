const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let nextServer = null;
let windowCreated = false;

const PORT = process.env.NEXT_PORT || 3000;

function getAppRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return path.join(__dirname, "..");
}

function startNextServer() {
  const appRoot = getAppRoot();
  const serverPath = path.join(appRoot, ".next", "standalone", "server.js");
  const serverDir = path.dirname(serverPath);

  console.log(`[Electron] App root: ${appRoot}`);
  console.log(`[Electron] Server path: ${serverPath}`);

  nextServer = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    cwd: serverDir,
    stdio: "pipe",
  });

  nextServer.stdout.on("data", (data) => {
    console.log(`[Next.js] ${data.toString().trim()}`);
  });

  nextServer.stderr.on("data", (data) => {
    console.error(`[Next.js] ${data.toString().trim()}`);
  });

  nextServer.on("close", (code) => {
    console.log(`[Next.js] Server exited with code ${code}`);
  });

  nextServer.on("error", (err) => {
    console.error(`[Next.js] Server error: ${err.message}`);
  });
}

function createWindow() {
  if (windowCreated) return;
  windowCreated = true;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "AI Image Gen",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  Menu.setApplicationMenu(null);

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
    windowCreated = false;
  });
}

app.whenReady().then(() => {
  startNextServer();

  const maxAttempts = 120;
  let attempts = 0;

  const checkReady = () => {
    attempts++;
    if (attempts > maxAttempts) {
      console.error("[Electron] Server failed to start after 60s");
      return;
    }

    const http = require("http");
    const req = http.get(`http://127.0.0.1:${PORT}`, (res) => {
      if (res.statusCode === 200 && !windowCreated) {
        createWindow();
      }
    });
    req.on("error", () => {
      if (!windowCreated) {
        setTimeout(checkReady, 500);
      }
    });
    req.setTimeout(3000, () => {
      req.destroy();
      if (!windowCreated) {
        setTimeout(checkReady, 500);
      }
    });
  };

  setTimeout(checkReady, 1000);
});

app.on("window-all-closed", () => {
  if (nextServer) {
    nextServer.kill();
    nextServer = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (nextServer) {
    nextServer.kill();
    nextServer = null;
  }
});

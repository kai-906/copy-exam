const { app, BrowserWindow, globalShortcut, ipcMain, powerSaveBlocker, screen } = require('electron');
const path = require('path');

let mainWindow;
let pendingExamKey    = null;
let examActive        = false;          // true while exam is running
let powerSaveBlockId  = null;          // keeps screen awake (DND equivalent)
let blurRefocusTimer  = null;

// ─── Deep-link protocol registration ──────────────────────────────────────────
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('smartexam', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('smartexam');
}

// ─── Single-instance lock ──────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    const url = commandLine.find(arg => arg.startsWith('smartexam://'));
    if (url) handleDeepLink(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    const url = process.argv.find(arg => arg.startsWith('smartexam://'));
    if (url) handleDeepLink(url);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// ─── Window creation ───────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: false,
    frame: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Block OS-level screen capture / recording for the whole session
  mainWindow.setContentProtection(true);

  const indexPath = path.join(__dirname, 'index.html');
  mainWindow.loadFile(indexPath).catch(() => {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  });

  // During active exam: prevent minimize and force refocus after any blur
  mainWindow.on('minimize', (e) => {
    if (examActive) {
      e.preventDefault();
      mainWindow.restore();
    }
  });

  mainWindow.on('blur', () => {
    if (!examActive) return;
    // Clear any existing timer first to avoid stacking
    if (blurRefocusTimer) clearTimeout(blurRefocusTimer);
    blurRefocusTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && examActive) {
        mainWindow.focus();
        mainWindow.moveTop();
        // Notify renderer so it can log the violation
        mainWindow.webContents.send('proctor:window-blur');
      }
    }, 200);
  });

  // Block window close during exam
  mainWindow.on('close', (e) => {
    if (examActive) {
      e.preventDefault();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingExamKey) {
      mainWindow.webContents.send('auto-fill-key', pendingExamKey);
      pendingExamKey = null;
    }
  });
}

// ─── Kiosk Lockdown ───────────────────────────────────────────────────────────
function enableKioskLockdown() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  examActive = true;

  try {
    mainWindow.setKiosk(true);
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true);
    mainWindow.focus();

    // Keep display awake — acts as Do Not Disturb for the screen
    if (powerSaveBlockId === null) {
      powerSaveBlockId = powerSaveBlocker.start('prevent-display-sleep');
    }

    // Register ALL system shortcuts that should be blocked
    const shortcutsToBlock = [
      // Window / app switching
      'Alt+Tab', 'Alt+Shift+Tab',
      'Meta+Tab', 'Meta+Shift+Tab',
      'CommandOrControl+Tab', 'CommandOrControl+Shift+Tab',
      // App close / reload
      'Alt+F4',
      'CommandOrControl+W',
      'CommandOrControl+Q',
      'CommandOrControl+R',
      'CommandOrControl+Shift+R',
      'F5', 'F11',
      // Developer tools
      'CommandOrControl+Shift+I',
      'CommandOrControl+Shift+J',
      'CommandOrControl+Shift+C',
      'F12',
      // Clipboard
      'CommandOrControl+C',
      'CommandOrControl+V',
      'CommandOrControl+X',
      'CommandOrControl+A',
      // Screenshot / screen recording
      'PrintScreen',
      'Meta+PrintScreen',
      'Alt+PrintScreen',
      'Meta+Shift+3',        // macOS full screenshot
      'Meta+Shift+4',        // macOS selection screenshot
      'Meta+Shift+5',        // macOS screen recording
      // Misc
      'CommandOrControl+P',  // Print
      'CommandOrControl+S',  // Save
      'CommandOrControl+U',  // View source
      'Escape',              // Prevent ESC from exiting fullscreen
    ];

    shortcutsToBlock.forEach(shortcut => {
      try {
        globalShortcut.register(shortcut, () => {
          // Silently absorb — return false blocks the default action
          return false;
        });
      } catch (err) {
        // Some shortcuts may not be registerable on all platforms; skip gracefully
      }
    });

    console.log('[Lockdown] Kiosk mode ENABLED');
  } catch (err) {
    console.error('[Lockdown] Failed to enable kiosk:', err.message);
  }
}

function disableKioskLockdown() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  examActive = false;

  try {
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);

    if (blurRefocusTimer) {
      clearTimeout(blurRefocusTimer);
      blurRefocusTimer = null;
    }

    // Release screen-awake lock
    if (powerSaveBlockId !== null) {
      powerSaveBlocker.stop(powerSaveBlockId);
      powerSaveBlockId = null;
    }

    globalShortcut.unregisterAll();
    console.log('[Lockdown] Kiosk mode DISABLED');
  } catch (err) {
    console.error('[Lockdown] Failed to disable kiosk:', err.message);
  }
}

// ─── IPC Events from renderer ─────────────────────────────────────────────────
ipcMain.on('enter-kiosk-mode', () => {
  enableKioskLockdown();
});

ipcMain.on('exit-kiosk-mode', () => {
  disableKioskLockdown();
});

// Renderer can query whether lockdown is active
ipcMain.handle('is-exam-active', () => examActive);

// ─── Deep-link handler ────────────────────────────────────────────────────────
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(url) {
  const match = url.match(/key=([^&]+)/);
  if (match) {
    const examKey = match[1];
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
      mainWindow.webContents.send('auto-fill-key', examKey);
    } else {
      pendingExamKey = examKey;
    }
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (powerSaveBlockId !== null) {
    try { powerSaveBlocker.stop(powerSaveBlockId); } catch(e) {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

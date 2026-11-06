// Electron shell for Ledger POS.
//
// This does NOT reimplement the app — it starts the exact same Express
// server used by `npm start`, just pointed at a proper per-user data folder,
// and opens a window onto it. There is no separate "desktop" codebase to
// keep in sync with the web version.

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const PORT = 3300;

// Store the database under the OS's standard per-user app-data folder
// (e.g. C:\Users\<you>\AppData\Roaming\Ledger POS\data on Windows) instead
// of next to the installed program files, which is usually read-only and
// gets wiped out on reinstall/update.
process.env.POS_DATA_DIR = path.join(app.getPath('userData'), 'data');
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1'; // desktop app — no need to expose on the LAN by default
process.env.SESSION_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');

let mainWindow;

function waitForServer(url, attempts = 40) {
  return new Promise((resolve, reject) => {
    const tryOnce = (n) => {
      require('http').get(url, () => resolve())
        .on('error', () => {
          if (n <= 0) return reject(new Error('Server did not start in time'));
          setTimeout(() => tryOnce(n - 1), 150);
        });
    };
    tryOnce(attempts);
  });
}

async function createWindow() {
  // Starts listening as a side effect (see server/index.js).
  require('../server/index.js');

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/api/auth/status`);
  } catch (e) {
    console.error('Backend did not come up:', e);
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'Ledger POS',
    backgroundColor: '#EFEAE1',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Open any target="_blank" links (there aren't any today, but future-proof)
  // in the OS browser instead of a bare Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// alert.js
const path = require('path');
const { app, BrowserWindow } = require('electron');

// Hier KEINE Socket-Verbindung, nur das Fenster
function createAlertWindow(message) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 800,
      height: 400,
      frame: false,
      resizable: true,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    win.loadFile(path.join(__dirname, 'alert.html'));

    win.once('ready-to-show', () => {
      win.show();
      win.webContents.send('init-message', message);
     // win.flashFrame(true);
      win.focus();
    });

    // Nach 10 Sekunden Close-Button freischalten
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.webContents.send('enable-close');
      }
    }, 10_000);

    win.on('closed', () => {
      resolve(); // <-- erst jetzt weiter
    });
  });
}

function initAlert() {
  // Dummy, noch leer
}

module.exports = { initAlert, createAlertWindow };

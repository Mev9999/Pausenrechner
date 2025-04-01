<<<<<<< HEAD
<<<<<<< HEAD
const { app, BrowserWindow } = require('electron');  // Importiert nur die benötigten Module
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');  // Importiert den 'autoUpdater' von 'electron-updater'
=======
const { app, BrowserWindow } = require('electron');  // Entfernt 'autoUpdater' aus electron
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');  // Nur hier den 'autoUpdater' importieren
>>>>>>> fc27ef0 (Initial commit)
=======
const { app, BrowserWindow } = require('electron');  // Importiert nur die benötigten Module
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');  // Importiert den 'autoUpdater' von 'electron-updater'
>>>>>>> cd4ce46 (Initial commit: Quellcode ohne dist und node_modules)

// Loggen von Update-Fehlern
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

// Funktion zur Überprüfung von Updates
function checkForUpdates() {
<<<<<<< HEAD
<<<<<<< HEAD
  autoUpdater.checkForUpdatesAndNotify();  // Überprüft und benachrichtigt bei Updates
=======
  autoUpdater.checkForUpdatesAndNotify();  // Überprüft auf Updates
>>>>>>> fc27ef0 (Initial commit)
=======
  autoUpdater.checkForUpdatesAndNotify();  // Überprüft und benachrichtigt bei Updates
>>>>>>> cd4ce46 (Initial commit: Quellcode ohne dist und node_modules)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'pause.png'),
    title: 'Pausenrechner'
  });

<<<<<<< HEAD
<<<<<<< HEAD
  win.loadFile('index.html');  // Lädt die HTML-Datei für das Fenster
=======
  win.loadFile('index.html');
>>>>>>> fc27ef0 (Initial commit)
=======
  win.loadFile('index.html');  // Lädt die HTML-Datei für das Fenster
>>>>>>> cd4ce46 (Initial commit: Quellcode ohne dist und node_modules)

  // Auto-Update prüfen, wenn das Fenster geladen ist
  checkForUpdates();
}

app.whenReady().then(() => {
  createWindow();  // Fenster erstellen, wenn die App bereit ist
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();  // Öffnet ein neues Fenster, falls es geschlossen wurde
  });

  // Wenn ein Update verfügbar ist
  autoUpdater.on('update-available', () => {
    log.info('Update verfügbar!');
    // Hier kannst du eine Benachrichtigung anzeigen, dass ein Update verfügbar ist
<<<<<<< HEAD
<<<<<<< HEAD
    // Beispiel: win.webContents.send('update-available'); // Senden an das Renderer-Prozess, um es in der UI zu zeigen
=======
    // Beispiel: Hier könntest du eine Dialogbox anzeigen oder eine andere UI-Aktion triggern
    // win.webContents.send('update-available'); // Senden an das Renderer-Prozess, wenn du es an die UI weitergeben möchtest
>>>>>>> fc27ef0 (Initial commit)
=======
    // Beispiel: win.webContents.send('update-available'); // Senden an das Renderer-Prozess, um es in der UI zu zeigen
>>>>>>> cd4ce46 (Initial commit: Quellcode ohne dist und node_modules)
  });

  // Wenn das Update erfolgreich heruntergeladen wurde
  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update heruntergeladen:', info);
    // Hier kannst du auch eine Benachrichtigung anzeigen, dass das Update heruntergeladen wurde
    // Beispiel: win.webContents.send('update-downloaded'); // Senden an das Renderer-Prozess, um es in der UI zu zeigen
    // Neustart der App nach dem Update
<<<<<<< HEAD
<<<<<<< HEAD
    autoUpdater.quitAndInstall();  // App wird geschlossen und neu gestartet
=======
    autoUpdater.quitAndInstall(); // App wird geschlossen und neu gestartet
>>>>>>> fc27ef0 (Initial commit)
=======
    autoUpdater.quitAndInstall();  // App wird geschlossen und neu gestartet
>>>>>>> cd4ce46 (Initial commit: Quellcode ohne dist und node_modules)
  });

  // Fehlerprotokollierung, wenn Updates fehlschlagen
  autoUpdater.on('error', (error) => {
    log.error('Fehler beim Aktualisieren:', error);
    // Hier kannst du eine Benachrichtigung über das Update-Fehler anzeigen
    // Beispiel: win.webContents.send('update-error', error.message);
  });

  // Überprüft Updates, wenn das Fenster geöffnet ist
  checkForUpdates();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();  // Beendet die App, wenn alle Fenster geschlossen sind (außer auf macOS)
});

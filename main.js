// main.js

// ===========================
// 🧠 Abhängigkeiten & Module
// ===========================
const os               = require('os');
const fs               = require('fs');
const path             = require('path');
const dayjs            = require('dayjs');
const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');

// → electron-log konfigurieren, bevor wir es verwenden
const log = require('electron-log');
// Speichere main.log in %APPDATA%\Pausenrechner\logs\main.log
log.transports.file.resolvePath = () =>
  path.join(app.getPath('userData'), 'logs', 'main.log');
// Nur ab Level “info” schreiben
log.transports.file.level = 'info';

const chokidar         = require('chokidar');
const { initAlert, createAlertWindow } = require('./alert');
const { autoUpdater }  = require('electron-updater');

// Erste Log-Ausgabe
log.info('App starting…');

// → Chat-Modul laden (dort nutzt du ebenfalls `log.info()` statt console.log)
require(path.join(__dirname, 'chat.js'));


// ===========================
// 📂 Pfade & State
// ===========================
const folderPath        = '\\\\svrstorage\\Telefondatenbanken\\ServicelineReports\\Pausenzeiten';
const messagesFile      = path.join(folderPath, 'nachrichten.json');
const scheduledMessagesFile = path.join(folderPath, 'nachrichten_geplant.json');
const messagesLockFile  = path.join(folderPath, 'nachrichten.json.lock');
const getPauseDateiPfad = () => path.join(folderPath, `${os.hostname()}.json`);
const getSonderPauseDateiPfad = () => path.join(folderPath, 'sonderpausen.json');
const MESSAGE_LOCK_TIMEOUT_MS = 15000;
const MESSAGE_LOCK_RETRY_MS = 150;
const MESSAGE_LOCK_STALE_MS = 60000;
const MESSAGE_POLL_INTERVAL_MS = 30000;
const shownMessages = new Set();
let messagePollTimer = null;
let isProcessingScheduledMessages = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function uniqueStrings(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  ));
}

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeScheduledFor(value) {
  if (!value) {
    return null;
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.toISOString() : null;
}

function getMessageKey(message) {
  if (!message) {
    return null;
  }

  return message.id ? String(message.id) : String(message.timestamp || '');
}

function getMessageDueAt(message) {
  return normalizeScheduledFor(message?.scheduledFor || message?.deliverAt) || message?.timestamp || null;
}

function isMessageDue(message, now = dayjs()) {
  const dueAt = getMessageDueAt(message);
  if (!dueAt) {
    return true;
  }

  const parsed = dayjs(dueAt);
  return !parsed.isValid() || parsed.valueOf() <= now.valueOf();
}

function normalizeMessageRecord(message = {}) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const text = String(message.text || '').trim();
  if (!text) {
    return null;
  }

  const timestamp = message.timestamp || dayjs().format();
  return {
    id: message.id ? String(message.id) : null,
    text,
    timestamp,
    createdAt: message.createdAt || timestamp,
    scheduledFor: normalizeScheduledFor(message.scheduledFor || message.deliverAt),
    onlyFor: uniqueStrings(message.onlyFor),
    seenBy: uniqueStrings(message.seenBy)
  };
}

function createImmediateMessage(payload = {}) {
  const now = dayjs().format();
  return {
    id: createMessageId(),
    text: String(payload.text || '').trim(),
    timestamp: now,
    createdAt: now,
    scheduledFor: null,
    onlyFor: uniqueStrings(payload.onlyFor),
    seenBy: []
  };
}

function createScheduledMessage(payload = {}) {
  const text = String(payload.text || '').trim();
  const scheduledFor = normalizeScheduledFor(payload.scheduledFor || payload.deliverAt);
  if (!text) {
    throw new Error('Nachricht enthaelt keinen Text.');
  }
  if (!scheduledFor) {
    throw new Error('Geplante Nachricht hat keine gueltige Versandzeit.');
  }

  const now = dayjs().format();
  return {
    id: createMessageId(),
    text,
    timestamp: now,
    createdAt: now,
    scheduledFor,
    onlyFor: uniqueStrings(payload.onlyFor),
    seenBy: []
  };
}

async function acquireMessagesLock() {
  const deadline = Date.now() + MESSAGE_LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const handle = await fs.promises.open(messagesLockFile, 'wx');
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          host: os.hostname(),
          createdAt: new Date().toISOString()
        }),
        'utf8'
      );
      return handle;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }

      try {
        const stat = await fs.promises.stat(messagesLockFile);
        if (Date.now() - stat.mtimeMs > MESSAGE_LOCK_STALE_MS) {
          await fs.promises.unlink(messagesLockFile).catch(() => {});
          continue;
        }
      } catch (statErr) {
        if (statErr.code === 'ENOENT') {
          continue;
        }
      }

      await sleep(MESSAGE_LOCK_RETRY_MS);
    }
  }

  throw new Error(`Konnte die Nachrichten-Sperre nicht innerhalb von ${MESSAGE_LOCK_TIMEOUT_MS} ms erhalten.`);
}

async function withMessagesFileLock(task) {
  const lockHandle = await acquireMessagesLock();

  try {
    return await task();
  } finally {
    try {
      await lockHandle.close();
    } catch (_) {}

    await fs.promises.unlink(messagesLockFile).catch(() => {});
  }
}

async function backupUnreadableFile(filePath) {
  const backupPath = `${filePath}.${Date.now()}.bak`;

  try {
    await fs.promises.copyFile(filePath, backupPath);
    return backupPath;
  } catch (_) {
    return null;
  }
}

async function backupUnreadableMessagesFile() {
  return backupUnreadableFile(messagesFile);
}

async function writeJsonArrayAtomic(targetFile, all) {
  if (!Array.isArray(all)) {
    throw new Error('JSON-Datei muss als Array gespeichert werden.');
  }

  const tempPath = path.join(folderPath, `${path.basename(targetFile)}.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(all, null, 2)}\n`;

  try {
    await fs.promises.writeFile(tempPath, payload, 'utf8');
    await fs.promises.rename(tempPath, targetFile);
  } finally {
    await fs.promises.unlink(tempPath).catch(() => {});
  }
}

async function writeMessagesAtomic(all) {
  return writeJsonArrayAtomic(messagesFile, all);
}

async function writeScheduledMessagesAtomic(all) {
  return writeJsonArrayAtomic(scheduledMessagesFile, all);
}

async function readJsonArrayFromDisk(targetFile, { createIfMissing = false } = {}) {
  try {
    await fs.promises.access(targetFile, fs.constants.R_OK);
  } catch (err) {
    if (err.code === 'ENOENT' && createIfMissing) {
      await writeJsonArrayAtomic(targetFile, []);
      return [];
    }

    throw err;
  }

  const raw = await fs.promises.readFile(targetFile, 'utf8');
  if (!raw.trim()) {
    const error = new Error(`'${targetFile}' ist leer.`);
    error.code = 'EMPTY_MESSAGES_FILE';
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    err.code = err.code || 'INVALID_MESSAGES_JSON';
    throw err;
  }

  if (!Array.isArray(parsed)) {
    const error = new Error(`'${targetFile}' muss ein JSON-Array enthalten.`);
    error.code = 'INVALID_MESSAGES_SHAPE';
    throw error;
  }

  return parsed;
}

async function readMessagesFromDisk(options = {}) {
  return readJsonArrayFromDisk(messagesFile, options);
}

async function readScheduledMessagesFromDisk(options = {}) {
  return readJsonArrayFromDisk(scheduledMessagesFile, options);
}

async function updateMessages(mutator) {
  return withMessagesFileLock(async () => {
    const currentMessages = await readMessagesFromDisk({ createIfMissing: true });
    const workingCopy = JSON.parse(JSON.stringify(currentMessages));
    const nextMessages = await mutator(workingCopy);
    const finalMessages = Array.isArray(nextMessages) ? nextMessages : workingCopy;

    if (!Array.isArray(finalMessages)) {
      throw new Error('Die Nachrichten-Aktualisierung muss ein Array zurueckgeben.');
    }

    await writeMessagesAtomic(finalMessages);
    return finalMessages;
  });
}

async function readScheduledMessages() {
  try {
    return await readScheduledMessagesFromDisk();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return withMessagesFileLock(() => readScheduledMessagesFromDisk({ createIfMissing: true }));
    }

    console.error(`Fehler beim Lesen/Parsen von '${scheduledMessagesFile}':`, error.message);
    const backupPath = await backupUnreadableFile(scheduledMessagesFile);

    throw new Error(
      backupPath
        ? `Korrupte oder leere JSON in ${scheduledMessagesFile}. Backup unter ${backupPath}. Bitte Datei pruefen.`
        : `Korrupte oder leere JSON in ${scheduledMessagesFile}. Bitte Datei pruefen.`
    );
  }
}

async function queueScheduledMessage(message) {
  return withMessagesFileLock(async () => {
    const scheduledMessages = await readScheduledMessagesFromDisk({ createIfMissing: true });
    scheduledMessages.push(message);
    await writeScheduledMessagesAtomic(scheduledMessages);
    return message;
  });
}

async function promoteDueScheduledMessages() {
  if (isProcessingScheduledMessages) {
    return 0;
  }

  isProcessingScheduledMessages = true;

  try {
    return await withMessagesFileLock(async () => {
      const scheduledMessages = await readScheduledMessagesFromDisk({ createIfMissing: true });
      if (!scheduledMessages.length) {
        return 0;
      }

      const now = dayjs();
      const dueMessages = [];
      const remainingMessages = [];

      scheduledMessages.forEach(rawMessage => {
        const message = normalizeMessageRecord(rawMessage);
        if (!message) {
          return;
        }

        if (isMessageDue(message, now)) {
          dueMessages.push(message);
        } else {
          remainingMessages.push(message);
        }
      });

      if (!dueMessages.length) {
        return 0;
      }

      const liveMessages = await readMessagesFromDisk({ createIfMissing: true });
      dueMessages
        .sort((a, b) => dayjs(getMessageDueAt(a)).valueOf() - dayjs(getMessageDueAt(b)).valueOf())
        .forEach(message => {
          liveMessages.push({
            id: message.id || createMessageId(),
            text: message.text,
            timestamp: message.scheduledFor || dayjs().format(),
            createdAt: message.createdAt || message.timestamp,
            scheduledFor: message.scheduledFor,
            onlyFor: uniqueStrings(message.onlyFor),
            seenBy: []
          });
        });

      await writeMessagesAtomic(liveMessages);
      await writeScheduledMessagesAtomic(remainingMessages);
      return dueMessages.length;
    });
  } finally {
    isProcessingScheduledMessages = false;
  }
}

function startMessagePolling() {
  if (messagePollTimer) {
    return;
  }

  messagePollTimer = setInterval(() => {
    promoteDueScheduledMessages()
      .then(promotedCount => {
        if (promotedCount > 0) {
          return showMissedMessages();
        }
        return null;
      })
      .catch(error => {
        console.error('Fehler beim Verarbeiten geplanter Nachrichten:', error);
      });
  }, MESSAGE_POLL_INTERVAL_MS);
}


// Fenster-Referenzen hier ganz oben deklarieren
let mainWindow, updateWindow, tray;
let isShowingAlerts    = false;
let suppressWatcher    = false;

// ===========================
// 🔒 Single Instance Lock
// ===========================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    startApp();
    initAlert();
    await promoteDueScheduledMessages();
    await showMissedMessages();
    setupWatcher();
    startMessagePolling();
  });
}


// ===========================
// ⚙️ Auto-Updater
// ===========================
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.setFeedURL({ provider:'github', owner:'Mev9999', repo:'Pausenrechner' });

async function checkForUpdates() {
  if (!updateWindow) return;

  // ❇️ Alte Listener weg, bevor wir neue registrieren
  autoUpdater.removeAllListeners();

  // Initiale Meldung ins Update-Fenster
  updateWindow.webContents.send('update-message', '🔍 Update wird gesucht…');

  autoUpdater
    .on('checking-for-update', () => {
      updateWindow.webContents.send('update-message', '🔍 Update wird gesucht…');
    })
    .on('update-available', () => {
      updateWindow.webContents.send('update-message', '🚀 Update verfügbar! Lade herunter…');
    })
    .on('download-progress', progress => {
      const p = Math.round(progress.percent);
      updateWindow.webContents.send('update-progress', p);
    })
    .on('update-not-available', () => {
      updateWindow.webContents.send('update-message', '✅ Keine Updates verfügbar. Starte App…');
      setTimeout(() => {
        if (updateWindow) {
          updateWindow.close();
          updateWindow = null;
        }
        if (!mainWindow) createMainWindow();
        mainWindow.show();
      }, 1000);
    })
    .on('error', err => {
      // ❌ Hier die neue Meldung vor dem Schließen
      updateWindow.webContents.send('update-message', '❌ Fehler beim Update… Starte App…');
      setTimeout(() => {
        if (updateWindow) {
          updateWindow.close();
          updateWindow = null;
        }
        if (!mainWindow) createMainWindow();
        mainWindow.show();
      }, 1000);
    })
    .on('update-downloaded', () => {
      updateWindow.webContents.send('update-message', '✅ Download abgeschlossen. Installiere…');
      setTimeout(() => autoUpdater.quitAndInstall(), 1500);
    });

  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    console.error('❌ Update-Check fehlgeschlagen:', e);
    // ❌ Auch hier die Meldung, bevor wir weiterstarten
    if (updateWindow) {
      updateWindow.webContents.send('update-message', '❌ Fehler beim Update… Starte App…');
      updateWindow.close();
      updateWindow = null;
    }
    if (!mainWindow) createMainWindow();
    mainWindow.show();
  }
}




// ===========================
// 🪟 Fenster-Funktionen
// ===========================
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 700,
    icon: path.join(__dirname,'pause.png'),
    title:'Pausenrechner',
    webPreferences:{ nodeIntegration:true, contextIsolation:false }
  });
  mainWindow.loadFile('index.html');
  if (!app.isPackaged) mainWindow.webContents.openDevTools();
  mainWindow.on('close', e => { e.preventDefault(); mainWindow.hide(); });
}

function createUpdateWindow() {
  updateWindow = new BrowserWindow({
    width:400, height:300, frame:false, alwaysOnTop:true,
    webPreferences:{ nodeIntegration:true, contextIsolation:false }
  });
  updateWindow.loadFile('update.html');
}

function createTray() {
  tray = new Tray(path.join(__dirname,'pause.png'));
  const menu = Menu.buildFromTemplate([
    { label: 'Öffnen', click: () => mainWindow.show() },
    { label: 'Beenden', click: () => app.quit() }
  ]);
  tray.setToolTip('Pausenrechner läuft im Hintergrund');
  tray.setContextMenu(menu);

  // Linksklick: Hauptfenster einblenden
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });

  // Rechtsklick: Kontextmenü aufpoppen lassen
  tray.on('right-click', () => {
    tray.popUpContextMenu(menu);
  });
}


function startApp() {
  // Erzeuge immer das Hauptfenster und Tray
  createMainWindow();
  createTray();

  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    // nur wenn wir **nicht** gerade durch Auto‐Start hier gelandet sind
    if (!app.getLoginItemSettings().wasOpenedAtLogin) {
      // drüberlegen das Update‐Fenster
      createUpdateWindow();
      checkForUpdates();
    }
  }
}



// ===========================
// 📖 JSON-Lese-/Schreib-Helper
// ===========================
async function readMessages() {
  console.log('📂 Lese Nachrichten aus:', messagesFile);

  // 1) Existenz- und Zugriffscheck
  try {
    await fs.promises.access(messagesFile, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`⚠️ Datei nicht gefunden – lege neue leere Datei an.`);
      await fs.promises.writeFile(messagesFile, '[]', 'utf8');
      return [];
    }
    // andere Fehler (z.B. EACCES) nicht überstürzt überschreiben
    console.error(`❌ Kann '${messagesFile}' nicht lesen:`, err.message);
    throw err;
  }

  // 2) Inhalt lesen, trimmen und parsen mit Backup im Fehlerfall
  try {
    const raw = await fs.promises.readFile(messagesFile, 'utf8');
    if (!raw.trim()) {
      console.warn(`⚠️ '${messagesFile}' ist leer – initialisiere als [].`);
      await fs.promises.writeFile(messagesFile, '[]', 'utf8');
      return [];
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error(`❌ Fehler beim Lesen/Parsen von '${messagesFile}':`, e.message);

    // Backup der fehlerhaften Datei anlegen
    const backupPath = `${messagesFile}.${Date.now()}.bak`;
    try {
      await fs.promises.copyFile(messagesFile, backupPath);
      console.warn(`📦 Fehlerhafte JSON gesichert unter '${backupPath}'.`);
    } catch (copyErr) {
      console.error(`❌ Backup fehlgeschlagen:`, copyErr.message);
    }

    // Abbrechen, damit nichts überschrieben wird
    throw new Error(
      `Korrupte JSON in ${messagesFile}. Backup unter ${backupPath}. ` +
      `Bitte prüfe und korrigiere die Datei manuell.`
    );
  }
}


async function writeMessages(all) {
  try {
    await fs.promises.writeFile(messagesFile, JSON.stringify(all,null,2),'utf8');
  } catch(e) {
    console.error('Fehler beim Schreiben in nachrichten.json:', e.message);
  }
}


// ===========================
// 🔔 Ungesehene Nachrichten anzeigen
// ===========================
async function showMissedMessages() {
  if (isShowingAlerts) return;
  isShowingAlerts = true;
  suppressWatcher = true;

  try {
    const hostname = os.hostname();
    const all = await readMessages();

    // 1) Filter: noch nicht gesehen *und* noch nicht in dieser Session shown
    const queue = all
      .filter(m => {
        const seen        = Array.isArray(m.seenBy) && m.seenBy.includes(hostname);
        const onlyFor     = Array.isArray(m.onlyFor) ? m.onlyFor : [];
        const wrongTarget = onlyFor.length > 0 && !onlyFor.includes(hostname);
        return !seen && !wrongTarget && !shownMessages.has(m.timestamp);
      })
      .sort((a,b) => dayjs(a.timestamp).valueOf() - dayjs(b.timestamp).valueOf());

    console.log('🔔 showMissedMessages: to-show:', queue.map(m=>m.timestamp));

    // 2) nacheinander anzeigen …
    for (const msg of queue) {
      await createAlertWindow(msg.text);

      // a) sofort merken, dass wir’s gezeigt haben
      shownMessages.add(msg.timestamp);

      // b) in der Datei als seenBy abspeichern
      const fresh = await readMessages();
      const idx = fresh.findIndex(x => x.timestamp === msg.timestamp);
      if (idx > -1) {
        fresh[idx].seenBy = Array.isArray(fresh[idx].seenBy) ? fresh[idx].seenBy : [];
        if (!fresh[idx].seenBy.includes(hostname)) {
          fresh[idx].seenBy.push(hostname);
          console.log('✍️  schreibe seenBy für', msg.timestamp, fresh[idx].seenBy);
          await writeMessages(fresh);
        }
      }
    }
  } catch (err) {
    console.error('❌ Fehler in showMissedMessages:', err);
  } finally {
    // Watcher nach kurzer Pause wieder aktivieren
    setTimeout(() => { suppressWatcher = false; }, 500);
    isShowingAlerts = false;
  }
}





// ===========================
// 🔄 File-Watcher
// ===========================
function setupWatcher() {
  const watcher = chokidar.watch([messagesFile, scheduledMessagesFile], {
    ignoreInitial:true,
    awaitWriteFinish:{ stabilityThreshold:200, pollInterval:100 }
  });
  let timer;
  watcher.on('change', () => {
    if (suppressWatcher) {
      console.log('🔕 Ignoriere eigenes Write-Event');
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(async() => {
      console.log('📩 Nachrichtendatei geaendert, pruefe neue und geplante Nachrichten...');
      await promoteDueScheduledMessages();
      await showMissedMessages();
    }, 300);
  });
}


// ===========================
// 📩 IPC: Neue Nachricht
// ===========================
// 📝 IPC: Neue Nachricht – nur in die JSON schreiben
ipcMain.handle('send-alert', async (_, message) => {
  suppressWatcher = true;                  // Watcher aus
  const all = await readMessages();
  all.push({ text: message, timestamp: dayjs().format(), onlyFor: [], seenBy: [] });
  await writeMessages(all);
  setTimeout(() => { suppressWatcher = false; }, 500);
});

// 🔔 IPC: Fenster auf Befehl öffnen – erst nach Admin‐OK
ipcMain.on('trigger-alert-window', (_, message) => {
  createAlertWindow(message).catch(err => console.error('Alert-Error:', err));
});


ipcMain.handle('load-archive', async () => {
  const all = await readMessages();
  return all.map(m => ({
    text:      String(m.text||'').trim(),
    timestamp: m.timestamp,
    seenBy:    Array.isArray(m.seenBy)?m.seenBy:[]
  }));
});

// 📩 IPC: Nachricht löschen
ipcMain.handle('delete-message', async (_, timestamp) => {
  const all = await readMessages();
  // lösche alle Einträge mit exakt diesem Timestamp
  const filtered = all.filter(m => m.timestamp !== timestamp);
  await writeMessages(filtered);
  return true;
});


// ===========================
// 💾 IPC: Pausen-Daten
// ===========================
ipcMain.on('pause-daten-speichern', (_, pauseDaten) => {
  const file = getPauseDateiPfad();
  const daten = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];

  if (pauseDaten.ende === null) {
    daten.push(pauseDaten);
  } else {
    const offen = daten.reverse().find(p => p.ende === null);
    if (offen) offen.ende = pauseDaten.ende;
    else daten.push(pauseDaten);
  }
  fs.writeFileSync(file, JSON.stringify(daten, null, 2), 'utf8');
});

ipcMain.handle('pause-daten-laden', () => {
  const file = getPauseDateiPfad();
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
});

ipcMain.handle('admin-pause-loeschen', (_, { fileName, index }) => {
  const filePath = path.join(folderPath, `${fileName}.json`);
  if (!fs.existsSync(filePath)) return false;
  const daten = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  daten.splice(index, 1);
  fs.writeFileSync(filePath, JSON.stringify(daten, null, 2), 'utf8');
  return true;
});

// ===========================
// 📁 IPC: Ordnerauswahl
// ===========================
ipcMain.handle('ordner-auswaehlen', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return canceled || filePaths.length === 0 ? null : filePaths[0];
});

// ===========================
// 🕵️ IPC: Sonderpausen-Handling
// ===========================
ipcMain.on('pause-freigabe-anfrage', (_, sonderpause) => {
  const dateipfad = getSonderPauseDateiPfad();
  const daten = fs.existsSync(dateipfad) ? JSON.parse(fs.readFileSync(dateipfad, 'utf-8')) : [];

  const neuerEintrag = {
    agent: sonderpause.agent.trim(),
    datum: sonderpause.datum.trim(),
    von: sonderpause.von.trim(),
    bis: sonderpause.bis.trim(),
    bemerkung: sonderpause.bemerkung.trim(),
    start: `${sonderpause.datum.trim()} ${sonderpause.von.trim()}`,
    ende: `${sonderpause.datum.trim()} ${sonderpause.bis.trim()}`,
    status: 'offen'
  };

  const gefiltert = daten.filter(p =>
    !(p.agent === neuerEintrag.agent &&
      p.datum === neuerEintrag.datum &&
      p.von === neuerEintrag.von &&
      p.bis === neuerEintrag.bis)
  );

  gefiltert.push(neuerEintrag);
  fs.writeFileSync(dateipfad, JSON.stringify(gefiltert, null, 2), 'utf-8');

  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('sonderpausen-aktualisieren'));
});

ipcMain.handle('sonderpausen-laden', () => {
  const filePath = getSonderPauseDateiPfad();
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
});

ipcMain.handle('sonderpause-aktualisieren', (_, { agent, datum, von, bis, status }) => {
  const pfad = getSonderPauseDateiPfad();
  const daten = fs.existsSync(pfad) ? JSON.parse(fs.readFileSync(pfad, 'utf8')) : [];

  const eintrag = daten.find(p =>
    p.agent.trim() === agent.trim() &&
    p.start.trim() === `${datum.trim()} ${von.trim()}` &&
    p.ende.trim() === `${datum.trim()} ${bis.trim()}`
  );

  if (!eintrag) return false;
  eintrag.status = status;
  fs.writeFileSync(pfad, JSON.stringify(daten, null, 2), 'utf8');

  BrowserWindow.getAllWindows().forEach(win => win.webContents.send('sonderpausen-aktualisieren', status));
  return true;
});

ipcMain.handle('sonderpause-loeschen', (_, index) => {
  const file = getSonderPauseDateiPfad();
  if (!fs.existsSync(file)) return false;
  const daten = JSON.parse(fs.readFileSync(file, 'utf8'));
  daten.splice(index, 1);
  fs.writeFileSync(file, JSON.stringify(daten, null, 2), 'utf8');
  return true;
});

// — Admin-Fenster öffnen —
ipcMain.on('open-admin', () => {
  const adminWin = new BrowserWindow({
    width: 1000, height: 800,
    icon: path.join(__dirname,'pause.png'),
    title: 'Admin-Bereich',
    webPreferences: { nodeIntegration:true, contextIsolation:false }
  });
  adminWin.loadFile('admin.html');
  if (!app.isPackaged) adminWin.webContents.openDevTools();
});

// — Archiv-Fenster öffnen —
ipcMain.on('open-archive-window', () => {
  const archiveWin = new BrowserWindow({
    width: 600, height: 500,
    icon: path.join(__dirname,'pause.png'),
    title: 'Nachrichten-Archiv',
    webPreferences: { nodeIntegration:true, contextIsolation:false }
  });
  archiveWin.loadFile('archive.html');
  if (!app.isPackaged) archiveWin.webContents.openDevTools();
});

ipcMain.handle('sonderpause-aktualisieren-indexbasiert', async (event, { index, status }) => {
  const pfad = getSonderPauseDateiPfad();
  if (!fs.existsSync(pfad)) return false;
  const daten = JSON.parse(fs.readFileSync(pfad,'utf8'));

  if (index < 0 || index >= daten.length) return false;
  daten[index].status = status;
  fs.writeFileSync(pfad, JSON.stringify(daten,null,2),'utf8');

  // Broadcast an alle Renderer
  BrowserWindow.getAllWindows().forEach(win =>
    win.webContents.send('sonderpausen-aktualisieren', { index, status })
  );
  return true;
});

// ===========================
// 🧼 Cleanup bei App-Schließen
// ===========================
// Sichere Nachrichten-Implementierung
async function readMessages() {
  console.log('Lese Nachrichten aus:', messagesFile);

  try {
    return await readMessagesFromDisk();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return withMessagesFileLock(() => readMessagesFromDisk({ createIfMissing: true }));
    }

    console.error(`Fehler beim Lesen/Parsen von '${messagesFile}':`, error.message);
    const backupPath = await backupUnreadableMessagesFile();

    throw new Error(
      backupPath
        ? `Korrupte oder leere JSON in ${messagesFile}. Backup unter ${backupPath}. Bitte Datei pruefen.`
        : `Korrupte oder leere JSON in ${messagesFile}. Bitte Datei pruefen.`
    );
  }
}

async function writeMessages(all) {
  return updateMessages(() => all);
}

async function showMissedMessages() {
  if (isShowingAlerts) return;
  isShowingAlerts = true;
  suppressWatcher = true;

  try {
    const hostname = os.hostname();
    const all = await readMessages();

    const queue = all
      .map(message => normalizeMessageRecord(message))
      .filter(message => {
        if (!message) {
          return false;
        }

        const seen = message.seenBy.includes(hostname);
        const onlyFor = message.onlyFor;
        const wrongTarget = onlyFor.length > 0 && !onlyFor.includes(hostname);
        const messageKey = getMessageKey(message);
        return Boolean(messageKey) && isMessageDue(message) && !seen && !wrongTarget && !shownMessages.has(messageKey);
      })
      .sort((a, b) => dayjs(getMessageDueAt(a)).valueOf() - dayjs(getMessageDueAt(b)).valueOf());

    console.log('showMissedMessages to-show:', queue.map(message => getMessageKey(message)));

    for (const message of queue) {
      const messageKey = getMessageKey(message);
      await createAlertWindow(message.text);
      shownMessages.add(messageKey);

      await updateMessages(allMessages => {
        const idx = allMessages.findIndex(entry => getMessageKey(normalizeMessageRecord(entry)) === messageKey);
        if (idx === -1) {
          return allMessages;
        }

        const seenBy = uniqueStrings(allMessages[idx].seenBy);
        if (!seenBy.includes(hostname)) {
          seenBy.push(hostname);
          allMessages[idx].seenBy = seenBy;
        }

        return allMessages;
      });
    }
  } catch (error) {
    console.error('Fehler in showMissedMessages:', error);
  } finally {
    setTimeout(() => { suppressWatcher = false; }, 500);
    isShowingAlerts = false;
  }
}

ipcMain.removeHandler('send-alert');
ipcMain.handle('send-alert', async (_, payload) => {
  const request = typeof payload === 'string' ? { text: payload } : (payload || {});
  const text = String(request.text || '').trim();
  if (!text) {
    throw new Error('Bitte zuerst eine Nachricht eingeben.');
  }

  const onlyFor = uniqueStrings(request.onlyFor);
  const scheduledFor = normalizeScheduledFor(request.scheduledFor || request.deliverAt);
  const shouldSchedule = scheduledFor && dayjs(scheduledFor).valueOf() > Date.now();
  suppressWatcher = true;

  try {
    if (shouldSchedule) {
      const scheduledMessage = createScheduledMessage({ text, onlyFor, scheduledFor });
      await queueScheduledMessage(scheduledMessage);
      return {
        scheduled: true,
        scheduledFor,
        id: scheduledMessage.id
      };
    }

    const immediateMessage = createImmediateMessage({ text, onlyFor });
    await updateMessages(allMessages => {
      allMessages.push(immediateMessage);
      return allMessages;
    });

    return {
      scheduled: false,
      id: immediateMessage.id
    };
  } finally {
    setTimeout(() => { suppressWatcher = false; }, 500);
  }
});

ipcMain.removeHandler('load-scheduled-alerts');
ipcMain.handle('load-scheduled-alerts', async () => {
  const all = await readScheduledMessages();
  return all
    .map(message => normalizeMessageRecord(message))
    .filter(Boolean)
    .sort((a, b) => dayjs(getMessageDueAt(a)).valueOf() - dayjs(getMessageDueAt(b)).valueOf())
    .map(message => ({
      id: getMessageKey(message),
      text: message.text,
      timestamp: message.timestamp,
      createdAt: message.createdAt,
      scheduledFor: message.scheduledFor,
      onlyFor: message.onlyFor
    }));
});

ipcMain.removeHandler('delete-scheduled-alert');
ipcMain.handle('delete-scheduled-alert', async (_, messageId) => {
  const targetId = String(messageId || '').trim();
  if (!targetId) {
    return false;
  }

  await withMessagesFileLock(async () => {
    const all = await readScheduledMessagesFromDisk({ createIfMissing: true });
    const remaining = all.filter(message => getMessageKey(normalizeMessageRecord(message)) !== targetId);
    await writeScheduledMessagesAtomic(remaining);
  });

  return true;
});

ipcMain.removeHandler('load-archive');
ipcMain.handle('load-archive', async () => {
  const all = await readMessages();
  return all
    .map(message => normalizeMessageRecord(message))
    .filter(Boolean)
    .map(message => ({
      id: getMessageKey(message),
      text: message.text,
      timestamp: message.timestamp,
      createdAt: message.createdAt,
      scheduledFor: message.scheduledFor,
      onlyFor: message.onlyFor,
      seenBy: message.seenBy
    }))
    .sort((a, b) => dayjs(getMessageDueAt(b) || b.timestamp).valueOf() - dayjs(getMessageDueAt(a) || a.timestamp).valueOf());
});

ipcMain.removeHandler('delete-message');
ipcMain.handle('delete-message', async (_, messageId) => {
  const targetId = String(messageId || '').trim();
  await updateMessages(allMessages =>
    allMessages.filter(message => getMessageKey(normalizeMessageRecord(message)) !== targetId)
  );
  return true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

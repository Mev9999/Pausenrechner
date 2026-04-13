// chat.js
const os               = require('os');
const http             = require('http');
const path             = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const log              = require('electron-log');
const ioClient         = require('socket.io-client');
const socketIo         = require('socket.io');

// === Admin-Hostname hier anpassen ===
const ADMIN_HOST = 'Teamleitung3';

const myId    = os.hostname();
const isAdmin = (myId === ADMIN_HOST);
log.info(`🔖 [CHAT] Meine ID=${myId}, isAdmin=${isAdmin}`);

// ===== Socket.IO-Server starten (nur auf Admin) =====
const server = http.createServer();
const io     = socketIo(server, { cors:{ origin:'*' } });

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    log.warn('⚠️ Port 3000 belegt – verwende existierenden Chat-Server.');
    return;
  }
  throw err;
});

if (isAdmin) {
  server.listen(3000, '0.0.0.0', () => {
    log.info('🔌 Chat-Server läuft auf 0.0.0.0:3000');
  });
} else {
  log.info(`🔌 Kein Server-Start auf ${myId}, da isAdmin=false`);
}

// ===== Socket-Rooms & Status-Tracking =====
const onlineClients    = new Set();
const socketIdToClient = {};

io.on('connection', socket => {
  socket.on('register', clientId => {
    socket.join(clientId);
    socketIdToClient[socket.id] = clientId;
    if (!onlineClients.has(clientId)) {
      onlineClients.add(clientId);
      log.info(`🔗 [SERVER] ${clientId} angemeldet (socket ${socket.id})`);
      BrowserWindow.getAllWindows().forEach(win =>
        win.webContents.send('client-status', { clientId, status: 'online' })
      );
    }
  });

  socket.on('chat-message', ({ from, to, text }) => {
    log.info(`✉️  [SERVER] ${from} → ${to}: ${text}`);
    io.to(to).emit('chat-message', { from, text });
  });

  socket.on('disconnect', () => {
    const clientId = socketIdToClient[socket.id];
    if (clientId) {
      delete socketIdToClient[socket.id];
      const still = Object.values(socketIdToClient).includes(clientId);
      if (!still) {
        onlineClients.delete(clientId);
        log.info(`🔌 [SERVER] ${clientId} abgemeldet`);
        BrowserWindow.getAllWindows().forEach(win =>
          win.webContents.send('client-status', { clientId, status: 'offline' })
        );
      }
    }
  });
});

// ===== IPC: aktuelle Online-Liste =====
ipcMain.handle('get-online-clients', () => Array.from(onlineClients));

// ===== Chat-Fenster öffnen/fokusieren =====
const chatWindows = new Map();
function openChatWindow(myId, peerId) {
  const key = `${myId}#${peerId}`;
  if (!chatWindows.has(key)) {
    const win = new BrowserWindow({
      width: 400, height: 600,
      title: `Chat ${myId} ↔ ${peerId}`,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    win.loadFile(path.join(__dirname, 'chat.html'), { query: { myId, peerId } });
    if (!app.isPackaged) win.webContents.openDevTools({ mode:'right' });
    win.on('closed', () => chatWindows.delete(key));
    chatWindows.set(key, win);
  }
  chatWindows.get(key).show();
}

ipcMain.handle('chat-open', (_, peerId) => openChatWindow('Admin', peerId));

// ===== Client‐Seite verbindet sich automatisch =====
const serverUrl = isAdmin
  ? 'http://localhost:3000'
  : `http://${ADMIN_HOST}:3000`;

const clientSocket = ioClient(serverUrl);

clientSocket.on('connect', () => {
  log.info(`🔗 [CLIENT] ${myId} verbunden mit ${serverUrl} (socket ${clientSocket.id})`);
  clientSocket.emit('register', myId);
});

clientSocket.on('chat-message', ({ from, text }) => {
  log.info(`🌐 [CLIENT] Nachricht für ${myId} von ${from}: ${text}`);
  openChatWindow(myId, 'Admin');
  const key = `${myId}#Admin`;
  const win = chatWindows.get(key);
  if (win) win.webContents.send('chat-message', { from, text });
});

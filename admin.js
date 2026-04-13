const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const ExcelJS = require('exceljs');
const { ipcRenderer } = require('electron');

const SONDERPAUSEN_DATEINAME = 'sonderpausen.json';
const folderPath = '\\\\svrstorage\\Telefondatenbanken\\ServicelineReports\\Pausenzeiten';
const correctPassword = 'Vitachef1!';


document.addEventListener('DOMContentLoaded', () => {
const loginDiv = document.getElementById('login');
const appDiv = document.getElementById('app');
const outputDiv = document.getElementById('output');
const agentFilter = document.getElementById('agent-filter');
const passwordInput = document.getElementById('admin-password');
const togglePassword = document.getElementById('toggle-password');
const loginButton = document.getElementById('login-button');

  // ✅ Standarddatum setzen
  document.getElementById('start').value = dayjs().format('YYYY-MM-DD');
  document.getElementById('end').value = dayjs().format('YYYY-MM-DD');

setTimeout(() => {
  const el = document.getElementById('admin-password');
  if (el && el.offsetParent !== null) {
    el.focus();
    console.log('🔍 Passwortfeld sofort fokussiert!');
  }
}, 0); // sofort nach Rendering


  // ✅ Passwort-Sichtbarkeit Toggle
if (togglePassword) {
  togglePassword.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePassword.textContent = isPassword ? '🙈' : '👁️';
  });
}

// ⚡️ EINMALIG den "Nachricht senden"-Button hooken
const alertSendBtn = document.getElementById('alert-send');
const alertText   = document.getElementById('alert-text');
alertSendBtn.addEventListener('click', async () => {
  const msg = alertText.value.trim();
  if (!msg) {
    return alert('Bitte zuerst eine Nachricht eingeben!');
  }

  // 1) Nachricht in die JSON schreiben
  await ipcRenderer.invoke('send-alert', msg);

  // 2) Admin-Bestätigung abwarten
  alert('Nachricht gesendet!');

  // 3) Erst jetzt das globale Alert-Fenster auslösen
  ipcRenderer.send('trigger-alert-window', msg);

  // 4) Eingabefeld leeren
  alertText.value = '';
});

  // ✅ Login-Handler
function handleLogin() {
  const enteredPassword = passwordInput.value.trim();

  if (enteredPassword === correctPassword) {
    loginDiv.style.display = 'none';
appDiv.style.display = 'flex';  // das display: flex; aus dem CSS-Layout wieder aktivieren
    passwordInput.blur(); // optional, falls du das magst

    console.log('✅ Login erfolgreich – Adminbereich wird geladen!');

    // ✅ Jetzt erst Daten laden, wenn UI sichtbar ist
    setTimeout(() => {
      loadAgents();
      loadData();
      ladeSonderpausen();
    }, 100); // 100ms reichen in der Regel aus

  } else {
    showToastAdmin('❌ Falsches Passwort! Bitte erneut versuchen.', false);
    passwordInput.value = '';
    setTimeout(() => {
      passwordInput.focus();
    }, 0);
  }
}

// ✅ Button & Enter-Taste aktivieren
loginButton.addEventListener('click', handleLogin);
passwordInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleLogin();
});
});

// 🔁 Sonderpausen-Aktualisierung
ipcRenderer.on('sonderpause-aktualisiert', () => {
  console.log('ℹ️ Sonderpause aktualisiert, Daten neu berechnen.');
  document.getElementById('berechnen')?.click();
});


// ✅ Agenten laden
async function markOnlineStatus() {
  const online = await ipcRenderer.invoke('get-online-clients');
  online.forEach(id => {
    const li = document.querySelector(`#chat-clients li[data-client-id="${id}"]`);
    if (li) li.style.backgroundColor = 'lightgreen';
  });
}

// 2) Live‐Updates: färbe neu angemeldete/abgemeldete Clients um
ipcRenderer.on('client-status', (_, { clientId, status }) => {
  const li = document.querySelector(`#chat-clients li[data-client-id="${clientId}"]`);
  if (!li) return;
  li.style.backgroundColor = status === 'online' ? 'lightgreen' : 'lightcoral';
});

// 3) loadAgents: füllt Dropdown und Sidebar, dann ruft markOnlineStatus auf
function loadAgents() {
  const agentFilter = document.getElementById('agent-filter');
  const chatList    = document.getElementById('chat-clients');

  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error('Fehler beim Laden der Dateien:', err);
      return;
    }

    // Nur echte Agent‐JSONs
    const agents = files
      .filter(f => f.endsWith('.json'))
      .filter(f => f !== SONDERPAUSEN_DATEINAME && f !== 'nachrichten.json')
      .map(f => path.basename(f, '.json'));

    // Dropdown
    agentFilter.innerHTML = '<option value="">Alle Agenten</option>';
    agents.forEach(agent => {
      const opt = document.createElement('option');
      opt.value = opt.text = agent;
      agentFilter.appendChild(opt);
    });

    // Sidebar‐Liste (rot = offline)
    chatList.innerHTML = '';
    agents.forEach(agent => {
      const li = document.createElement('li');
      li.textContent       = agent;
      li.dataset.clientId  = agent;
      li.style.padding     = '6px';
      li.style.marginBottom= '4px';
      li.style.cursor      = 'pointer';
      li.style.backgroundColor = 'lightcoral';
      li.addEventListener('click', () => {
        ipcRenderer.invoke('chat-open', agent);
      });
      chatList.appendChild(li);
    });

    // Status nachladen
    markOnlineStatus();
  });
}

// ✅ Daten laden
function loadData() {
  const agentFilter   = document.getElementById('agent-filter');
  const outputDiv     = document.getElementById('output');
  const start         = dayjs(document.getElementById('start').value).startOf('day');
  const end           = dayjs(document.getElementById('end').value).endOf('day');
  const selectedAgent = agentFilter.value;

  let ausgabe     = '';
  let gesamtPause = 0;

  fs.readdir(folderPath, (err, files) => {
    if (err) {
      outputDiv.innerText = 'Fehler beim Laden der Dateien.';
      console.error(err);
      return;
    }

    // Manuelle (gestempelte) Pausen pro Agent
    files
      .filter(file =>
        file.endsWith('.json') &&
        file !== SONDERPAUSEN_DATEINAME &&        // Sonderpausen separat
        file !== 'nachrichten.json'               // <-- hier die Nachrichten ausklammern
      )
      .forEach(file => {
        const filePath  = path.join(folderPath, file);
        const daten     = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const agentName = path.basename(file, '.json');

        if (selectedAgent && selectedAgent !== agentName) return;

        const gefiltert = daten.filter(pause => {
          const ts = dayjs(pause.start);
          return ts.isAfter(start.subtract(1, 'second')) && ts.isBefore(end.add(1, 'second'));
        });
        if (gefiltert.length === 0) return;

        ausgabe += `<h3>${agentName}</h3>`;
        gefiltert.forEach(pause => {
          const startZeit = dayjs(pause.start).format('YYYY-MM-DD HH:mm:ss');
          const endZeit   = dayjs(pause.ende).format('YYYY-MM-DD HH:mm:ss');
          const dauer     = dayjs(pause.ende).diff(dayjs(pause.start), 'minute', true).toFixed(2);
          gesamtPause   += parseFloat(dauer);

          // Original-Index in daten[]
          const originalIndex = daten.findIndex(d =>
            d.start === pause.start &&
            d.ende  === pause.ende
          );

          // … innerhalb von gefiltert.forEach(pause => { … })
ausgabe += `
#${originalIndex + 1}: ${startZeit} – ${endZeit} | ${dauer} Min <button class="delete-button" onclick="deletePause('${agentName}', ${originalIndex})">Löschen</button><br>`;

        });
        ausgabe += '<br>';
      });

    // Sonderpausen (unverändert)
    const sonderpausenPath = path.join(folderPath, SONDERPAUSEN_DATEINAME);
    if (fs.existsSync(sonderpausenPath)) {
      const sonderpausen = JSON.parse(fs.readFileSync(sonderpausenPath, 'utf-8'));
      const genehmigte   = sonderpausen.filter(p =>
        p.status === 'genehmigt' &&
        (!selectedAgent || p.agent === selectedAgent)
      );

      if (genehmigte.length > 0) {
        ausgabe += `<h3>Sonderpausen (Genehmigt)</h3>`;
        genehmigte.forEach(pause => {
          const idx       = sonderpausen.indexOf(pause);
          const startZeit = dayjs(`${pause.datum} ${pause.von}`).format('YYYY-MM-DD HH:mm:ss');
          const endZeit   = dayjs(`${pause.datum} ${pause.bis}`).format('YYYY-MM-DD HH:mm:ss');
          const dauer     = dayjs(`${pause.datum} ${pause.bis}`)
                              .diff(dayjs(`${pause.datum} ${pause.von}`), 'minute', true).toFixed(2);
          gesamtPause    += parseFloat(dauer);

          ausgabe += `
  #${idx + 1}: ${startZeit} – ${endZeit} | ${dauer} Min (Sonderpause von ${pause.agent}) <button class="delete-button" onclick="deleteSonderpause(${idx})">Löschen</button><br>`;

        });
        ausgabe += '<br>';
      }
    }

    ausgabe += `<strong>🧮 Gesamt manuelle Pausenzeit: ${gesamtPause.toFixed(2)} Min</strong>`;
    outputDiv.innerHTML = ausgabe;
  });
}


// ✅ Pause löschen
function deletePause(fileName, index) {
  if (confirm('❗ Möchtest du diese Pause wirklich löschen?')) {
    ipcRenderer.invoke('admin-pause-loeschen', { fileName, index }).then(() => {
      alert('✅ Pause gelöscht!');
      loadData();
    }).catch(err => {
      console.error('Fehler beim Löschen der Pause:', err);
      alert('Fehler beim Löschen.');
    });
  }
}


// ✅ Export Excel
function exportToExcel() {
  const start = dayjs(document.getElementById('start').value).startOf('day');
  const end = dayjs(document.getElementById('end').value).endOf('day');
  const agentFilter = document.getElementById('agent-filter');
  const selectedAgent = agentFilter.value;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Manuelle Pausen');

  sheet.columns = [
    { header: 'Agent', key: 'agent', width: 20 },
    { header: 'Startzeit', key: 'start', width: 25 },
    { header: 'Endzeit', key: 'end', width: 25 },
    { header: 'Dauer (Minuten)', key: 'dauer', width: 20 }
  ];

  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error('Fehler beim Export:', err);
      alert('Fehler beim Export!');
      return;
    }

    files
  .filter(file => file.endsWith('.json') && file !== SONDERPAUSEN_DATEINAME)
  .forEach(file => {
    const filePath = path.join(folderPath, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const agentName = path.parse(file).name;

    if (selectedAgent && selectedAgent !== agentName) return;

    const gefiltert = data.filter(pause => {
      const pauseStart = dayjs(pause.start);
      return pauseStart.isAfter(start.subtract(1, 'second')) && pauseStart.isBefore(end.add(1, 'second'));
    });

    gefiltert.forEach(pause => {
      sheet.addRow({
        agent: agentName,
        start: dayjs(pause.start).format('YYYY-MM-DD HH:mm:ss'),
        end: dayjs(pause.ende).format('YYYY-MM-DD HH:mm:ss'),
        dauer: dayjs(pause.ende).diff(dayjs(pause.start), 'minute', true).toFixed(2)
      });
    });
  });


    ipcRenderer.invoke('ordner-auswaehlen').then(exportFolder => {
      if (!exportFolder) {
        alert('❌ Kein Ordner ausgewählt. Export abgebrochen.');
        return;
      }
    
      const exportPath = path.join(exportFolder, `AdminExport_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.xlsx`);
      workbook.xlsx.writeFile(exportPath).then(() => {
        alert(`✅ Exportiert nach: ${exportPath}`);
      }).catch(err => {
        console.error('Fehler beim Speichern der Excel-Datei:', err);
        alert('❌ Fehler beim Speichern der Datei!');
      });
    });
    
  });
}

// ✅ Sauber: deletePause als globale Funktion verfügbar machen
window.deletePause = deletePause;

// Sonderpausen laden
function ladeSonderpausen() {
  console.log('🗂️ Lade Sonderpausen von:', path.join(folderPath, 'sonderpausen.json'));


  ipcRenderer.invoke('sonderpausen-laden').then(sonderpausen => {
    const offenePausen = sonderpausen.filter(pause => pause.status === 'offen');

    if (!offenePausen.length) {
      document.getElementById('sonderpausen-output').innerHTML = '<p>Keine Sonderpausen vorhanden.</p>';
      return;
    }

    let html = '<h3>Sonderpausen (Warte auf Freigabe):</h3>';

    offenePausen.forEach((pause, index) => {
      pause.index = index;
      html += `
      <div id="sonderpause-${index}" style="margin-bottom: 10px; padding: 5px; border: 1px solid #ccc;">
        <strong>${pause.agent}</strong> | ${pause.datum} | ${pause.von} – ${pause.bis}<br>
        Begründung: ${pause.bemerkung}<br>
        Status: <strong>${pause.status.toUpperCase()}</strong><br>
        <button onclick="sonderpauseEntscheiden(${index}, '${pause.agent}', '${pause.datum}', '${pause.von}', '${pause.bis}', 'genehmigt')">✅ Genehmigen</button>
<button onclick="sonderpauseEntscheiden(${index}, '${pause.agent}', '${pause.datum}', '${pause.von}', '${pause.bis}', 'abgelehnt')">❌ Ablehnen</button>

      </div>
    `;
    
    });

    document.getElementById('sonderpausen-output').innerHTML = html;
  });
}



  // 🆕 Sonderpause genehmigen oder ablehnen
  function sonderpauseEntscheiden(index, agent, datum, von, bis, status) {
    console.log('📦 Aktualisiere Pause für:', agent, datum, von, bis, '→', status);
    const genehmigenButton = document.querySelector(`button[onclick*="sonderpauseEntscheiden(${index},"]`);
    const ablehnenButton = document.querySelector(`button[onclick*="sonderpauseEntscheiden(${index},"]`);
  
    if (genehmigenButton) genehmigenButton.disabled = true;
    if (ablehnenButton) ablehnenButton.disabled = true;
  
    const eintrag = document.getElementById(`sonderpause-${index}`);
    if (eintrag) eintrag.remove();
  
    showToastAdmin(`✅ Sonderpause wird ${status === 'genehmigt' ? 'genehmigt' : 'abgelehnt'}...`);
  
    ipcRenderer.invoke('sonderpause-aktualisieren', {
      agent, datum, von, bis, status
    }).then(erfolg => {
      console.log('⏬ Ergebnis vom Speichern:', erfolg);
      if (erfolg) {
        ipcRenderer.send('sonderpausen-aktualisieren', status);
        ladeSonderpausen(); // neu laden
      } else {
        showToastAdmin('❌ Fehler beim Aktualisieren der Sonderpause.', false);
        ladeSonderpausen();
      }
    });
  }
  
  
  






// Optional schöne Meldung als Toast statt Alert
console.log(`✅ Sonderpause wurde ${status === 'genehmigt' ? 'genehmigt' : 'abgelehnt'}!`);




// 🆕 Automatischer Refresh alle 20 Sekunden
setInterval(() => {
  console.log('⏳ Refresh Sonderpausen…');
  ladeSonderpausen();
}, 5000); // alle 5 Sekunden




ipcRenderer.on('sonderpausen-aktualisieren', (event, status) => {
  console.log('🔄 Sonderpausen-Status hat sich geändert! Aktualisiere automatisch...');
  const berechnenBtn = document.getElementById('berechnen');
if (berechnenBtn) {
  berechnenBtn.click(); // nur im Hauptfenster vorhanden
} else {
  loadData(); // Adminbereich → einfach direkt neu laden
}


  const infoBox = document.createElement('div');
  infoBox.style.position = 'fixed';
  infoBox.style.top = '20px';
  infoBox.style.right = '20px';
  infoBox.style.backgroundColor = status === 'genehmigt' ? '#4CAF50' : '#e74c3c'; // ✅ grün, ❌ rot
  infoBox.style.color = 'white';
  infoBox.style.padding = '12px 20px';
  infoBox.style.borderRadius = '8px';
  infoBox.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
  infoBox.style.zIndex = '9999';
  infoBox.style.fontSize = '14px';
  infoBox.style.opacity = '0.95';
  infoBox.textContent = status === 'genehmigt' ? '✅ Sonderpause genehmigt!' : '❌ Sonderpause abgelehnt!';

  document.body.appendChild(infoBox);

  setTimeout(() => {
    infoBox.remove();
  }, 3000);
});

function showToastAdmin(message, success = true) {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.right = '20px';
  toast.style.backgroundColor = success ? '#4CAF50' : '#e74c3c';
  toast.style.color = 'white';
  toast.style.padding = '12px 20px';
  toast.style.borderRadius = '8px';
  toast.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
  toast.style.zIndex = '9999';
  toast.style.fontSize = '14px';
  toast.style.opacity = '0.95';
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Sonderpause löschen
function deleteSonderpause(index) {
  if (confirm('❗ Diese genehmigte Sonderpause wirklich löschen?')) {
    ipcRenderer.invoke('sonderpause-loeschen', index).then(erfolg => {
      if (erfolg) {
        alert('✅ Sonderpause gelöscht!');
        loadData();
      } else {
        alert('❌ Fehler beim Löschen.');
      }
    });
  }
}

// global verfügbar machen
window.deleteSonderpause = deleteSonderpause;

document.getElementById('filter-button')?.addEventListener('click', loadData);
document.getElementById('export-button')?.addEventListener('click', exportToExcel);


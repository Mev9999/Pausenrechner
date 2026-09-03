const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const ExcelJS = require('exceljs');
const { ipcRenderer } = require('electron');

const SONDERPAUSEN_DATEINAME = 'sonderpausen.json';
const NACHRICHTEN_DATEINAME = 'nachrichten.json';
const GEPLANTE_NACHRICHTEN_DATEINAME = 'nachrichten_geplant.json';
const HANDYFREIGABEN_DATEINAME = 'handyfreigaben.json';
const SPECIAL_JSON_DATEIEN = new Set([
  SONDERPAUSEN_DATEINAME,
  NACHRICHTEN_DATEINAME,
  GEPLANTE_NACHRICHTEN_DATEINAME,
  HANDYFREIGABEN_DATEINAME
]);
const folderPath = '\\\\192.168.210.42\\Serviceline-Team\\Pausenrechner';
const correctPassword = 'Vitachef1!';

let knownAgents = [];
let adminVisible = false;
let refreshTimer = null;
let knownPhoneUsageRequestIds = new Set();
let phoneUsageInitialLoadComplete = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAgentNames(files) {
  return files
    .filter(file => file.endsWith('.json'))
    .filter(file => !SPECIAL_JSON_DATEIEN.has(file))
    .map(file => path.basename(file, '.json'))
    .sort((a, b) => a.localeCompare(b, 'de'));
}

function formatDateTime(value) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('DD.MM.YYYY HH:mm') : '-';
}

function formatRecipients(onlyFor) {
  return Array.isArray(onlyFor) && onlyFor.length ? onlyFor.join(', ') : 'Alle PCs';
}

function formatPhoneUsageRemaining(expiresAt) {
  const remainingMs = Math.max(0, dayjs(expiresAt).valueOf() - Date.now());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

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
  setTimeout(() => toast.remove(), 3000);
}

async function loadPhoneUsageRequests({ notifyOnNew = false } = {}) {
  const summary = document.getElementById('phone-usage-summary');
  const activeContainer = document.getElementById('phone-usage-active-list');
  const historyContainer = document.getElementById('phone-usage-history-list');
  if (!summary || !activeContainer || !historyContainer) {
    return;
  }

  try {
    const requests = await ipcRenderer.invoke('load-phone-usage-requests');
    const currentIds = new Set(requests.map(request => request.id));

    if (notifyOnNew && phoneUsageInitialLoadComplete) {
      const newRequests = requests.filter(request => !knownPhoneUsageRequestIds.has(request.id));
      if (newRequests.length === 1) {
        const request = newRequests[0];
        showToastAdmin(`Handyfreigabe von ${request.agent} (${request.clientId}) eingegangen.`);
      } else if (newRequests.length > 1) {
        showToastAdmin(`${newRequests.length} neue Handyfreigaben eingegangen.`);
      }
    }

    knownPhoneUsageRequestIds = currentIds;
    phoneUsageInitialLoadComplete = true;

    if (!requests.length) {
      summary.innerHTML = '<span class="muted-message">Noch keine Eintraege.</span>';
      activeContainer.innerHTML = '<p class="muted-message">Aktuell ist keine Handyfreigabe aktiv.</p>';
      historyContainer.innerHTML = '<p class="muted-message">Noch keine Eintraege.</p>';
      return;
    }

    const activeRequests = requests.filter(request => request.active);
    const todayCount = requests.filter(request => dayjs(request.requestedAt).isSame(dayjs(), 'day')).length;
    const countsByAgent = requests.reduce((acc, request) => {
      acc[request.agent] = (acc[request.agent] || 0) + 1;
      return acc;
    }, {});
    const topAgentEntry = Object.entries(countsByAgent)
      .sort((a, b) => b[1] - a[1])[0];

    summary.innerHTML = [
      `Gesamt: <strong>${requests.length}</strong>`,
      `Heute: <strong>${todayCount}</strong>`,
      topAgentEntry ? `Am haeufigsten: <strong>${escapeHtml(topAgentEntry[0])}</strong> (${topAgentEntry[1]})` : null
    ].filter(Boolean).join(' | ');

    activeContainer.innerHTML = activeRequests.length
      ? activeRequests.map(request => `
          <div class="phone-request-item is-active">
            <div class="phone-request-title">
              <strong>${escapeHtml(request.agent)}</strong>
              <span class="phone-request-badge is-active">aktiv</span>
            </div>
            <div class="phone-request-meta">
              PC: ${escapeHtml(request.clientId)}<br>
              Beantragt: ${escapeHtml(formatDateTime(request.requestedAt))}<br>
              Aktiv bis: ${escapeHtml(formatDateTime(request.expiresAt))}<br>
              Restzeit: ${escapeHtml(formatPhoneUsageRemaining(request.expiresAt))}
            </div>
          </div>
        `).join('')
      : '<p class="muted-message">Aktuell ist keine Handyfreigabe aktiv.</p>';

    historyContainer.innerHTML = requests.slice(0, 20).map(request => `
      <div class="phone-request-item ${request.active ? 'is-active' : ''}">
        <div class="phone-request-title">
          <strong>${escapeHtml(request.agent)}</strong>
          <span class="phone-request-badge ${request.active ? 'is-active' : 'is-expired'}">
            ${request.active ? 'aktiv' : 'abgelaufen'}
          </span>
        </div>
        <div class="phone-request-meta">
          PC: ${escapeHtml(request.clientId)}<br>
          Beantragt: ${escapeHtml(formatDateTime(request.requestedAt))}<br>
          Aktiv bis: ${escapeHtml(formatDateTime(request.expiresAt))}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Fehler beim Laden der Handyfreigaben:', error);
    summary.innerHTML = '<span class="muted-message">Handyfreigaben konnten nicht geladen werden.</span>';
    activeContainer.innerHTML = '<p class="muted-message">Handyfreigaben konnten nicht geladen werden.</p>';
    historyContainer.innerHTML = '<p class="muted-message">Handyfreigaben konnten nicht geladen werden.</p>';
  }
}

async function markOnlineStatus() {
  const online = await ipcRenderer.invoke('get-online-clients');
  online.forEach(clientId => {
    const li = document.querySelector(`#chat-clients li[data-client-id="${clientId}"]`);
    if (li) {
      li.style.backgroundColor = 'lightgreen';
    }
  });
}

function syncAlertRecipientState() {
  const sendToAll = document.getElementById('alert-all-clients');
  const recipientWrap = document.getElementById('alert-recipient-wrap');
  const checkboxes = document.querySelectorAll('#alert-recipients input[type="checkbox"]');
  if (!sendToAll || !recipientWrap) {
    return;
  }

  recipientWrap.classList.toggle('is-disabled', sendToAll.checked);
  checkboxes.forEach(checkbox => {
    checkbox.disabled = sendToAll.checked;
  });
}

function syncScheduleState() {
  const enabled = document.getElementById('alert-schedule-enabled');
  const scheduleWrap = document.getElementById('alert-schedule-wrap');
  const scheduleAt = document.getElementById('alert-schedule-at');
  if (!enabled || !scheduleWrap || !scheduleAt) {
    return;
  }

  scheduleWrap.classList.toggle('is-disabled', !enabled.checked);
  scheduleAt.disabled = !enabled.checked;
  if (!enabled.checked) {
    scheduleAt.value = '';
  }
}

function renderAlertRecipients() {
  const container = document.getElementById('alert-recipients');
  if (!container) {
    return;
  }

  const selectedBeforeRender = new Set(
    Array.from(document.querySelectorAll('#alert-recipients input[type="checkbox"]:checked'))
      .map(checkbox => checkbox.value)
  );

  if (!knownAgents.length) {
    container.innerHTML = '<p class="muted-message">Noch keine PCs gefunden.</p>';
    syncAlertRecipientState();
    return;
  }

  container.innerHTML = knownAgents.map(agent => `
    <label class="recipient-item">
      <input type="checkbox" value="${escapeHtml(agent)}" ${selectedBeforeRender.has(agent) ? 'checked' : ''} />
      <span>${escapeHtml(agent)}</span>
    </label>
  `).join('');

  syncAlertRecipientState();
}

function getSelectedAlertRecipients() {
  return Array.from(document.querySelectorAll('#alert-recipients input[type="checkbox"]:checked'))
    .map(checkbox => checkbox.value)
    .filter(Boolean);
}

function resetAlertComposer() {
  const alertText = document.getElementById('alert-text');
  const sendToAll = document.getElementById('alert-all-clients');
  const scheduleEnabled = document.getElementById('alert-schedule-enabled');
  const recipientCheckboxes = document.querySelectorAll('#alert-recipients input[type="checkbox"]');

  if (alertText) {
    alertText.value = '';
  }

  recipientCheckboxes.forEach(checkbox => {
    checkbox.checked = false;
  });

  if (sendToAll) {
    sendToAll.checked = true;
  }

  if (scheduleEnabled) {
    scheduleEnabled.checked = false;
  }

  syncAlertRecipientState();
  syncScheduleState();
}

async function loadScheduledAlerts() {
  const container = document.getElementById('scheduled-alerts-list');
  if (!container) {
    return;
  }

  try {
    const scheduledAlerts = await ipcRenderer.invoke('load-scheduled-alerts');

    if (!scheduledAlerts.length) {
      container.innerHTML = '<p class="muted-message">Keine geplanten Nachrichten.</p>';
      return;
    }

    container.innerHTML = scheduledAlerts.map(alert => `
      <div class="scheduled-alert-item">
        <div class="scheduled-alert-head">
          <strong>${escapeHtml(formatDateTime(alert.scheduledFor || alert.timestamp))}</strong>
          <button type="button" class="delete-scheduled-alert" data-id="${escapeHtml(alert.id)}">Loeschen</button>
        </div>
        <div class="scheduled-alert-meta">Empfaenger: ${escapeHtml(formatRecipients(alert.onlyFor))}</div>
        <div class="scheduled-alert-text">${escapeHtml(alert.text).replace(/\n/g, '<br>')}</div>
      </div>
    `).join('');

    container.querySelectorAll('.delete-scheduled-alert').forEach(button => {
      button.addEventListener('click', async () => {
        if (!confirm('Diese geplante Nachricht wirklich loeschen?')) {
          return;
        }

        const success = await ipcRenderer.invoke('delete-scheduled-alert', button.dataset.id);
        if (success) {
          showToastAdmin('Geplante Nachricht geloescht.');
          loadScheduledAlerts();
        } else {
          showToastAdmin('Geplante Nachricht konnte nicht geloescht werden.', false);
        }
      });
    });
  } catch (error) {
    console.error('Fehler beim Laden geplanter Nachrichten:', error);
    container.innerHTML = '<p class="muted-message">Geplante Nachrichten konnten nicht geladen werden.</p>';
  }
}

function loadAgents() {
  const agentFilter = document.getElementById('agent-filter');
  const chatList = document.getElementById('chat-clients');

  fs.readdir(folderPath, (err, files) => {
    if (err) {
      console.error('Fehler beim Laden der Dateien:', err);
      return;
    }

    const agents = getAgentNames(files);
    knownAgents = agents;

    agentFilter.innerHTML = '<option value="">Alle Agenten</option>';
    agents.forEach(agent => {
      const option = document.createElement('option');
      option.value = agent;
      option.text = agent;
      agentFilter.appendChild(option);
    });

    chatList.innerHTML = '';
    agents.forEach(agent => {
      const li = document.createElement('li');
      li.textContent = agent;
      li.dataset.clientId = agent;
      li.style.padding = '6px';
      li.style.marginBottom = '4px';
      li.style.cursor = 'pointer';
      li.style.backgroundColor = 'lightcoral';
      li.addEventListener('click', () => {
        ipcRenderer.invoke('chat-open', agent);
      });
      chatList.appendChild(li);
    });

    renderAlertRecipients();
    markOnlineStatus();
  });
}

function loadData() {
  const agentFilter = document.getElementById('agent-filter');
  const outputDiv = document.getElementById('output');
  const start = dayjs(document.getElementById('start').value).startOf('day');
  const end = dayjs(document.getElementById('end').value).endOf('day');
  const selectedAgent = agentFilter.value;

  let ausgabe = '';
  let gesamtPause = 0;

  fs.readdir(folderPath, (err, files) => {
    if (err) {
      outputDiv.innerText = 'Fehler beim Laden der Dateien.';
      console.error(err);
      return;
    }

    files
      .filter(file => file.endsWith('.json'))
      .filter(file => !SPECIAL_JSON_DATEIEN.has(file))
      .forEach(file => {
        const filePath = path.join(folderPath, file);
        const daten = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const agentName = path.basename(file, '.json');

        if (selectedAgent && selectedAgent !== agentName) {
          return;
        }

        const gefiltert = daten.filter(pause => {
          const ts = dayjs(pause.start);
          return ts.isAfter(start.subtract(1, 'second')) && ts.isBefore(end.add(1, 'second'));
        });

        if (!gefiltert.length) {
          return;
        }

        ausgabe += `<h3>${escapeHtml(agentName)}</h3>`;
        gefiltert.forEach(pause => {
          const startZeit = dayjs(pause.start).format('YYYY-MM-DD HH:mm:ss');
          const endZeit = dayjs(pause.ende).format('YYYY-MM-DD HH:mm:ss');
          const dauer = dayjs(pause.ende).diff(dayjs(pause.start), 'minute', true).toFixed(2);
          gesamtPause += parseFloat(dauer);

          const originalIndex = daten.findIndex(eintrag =>
            eintrag.start === pause.start &&
            eintrag.ende === pause.ende
          );

          ausgabe += `
            #${originalIndex + 1}: ${startZeit} - ${endZeit} | ${dauer} Min
            <button class="delete-button" onclick='deletePause(${JSON.stringify(agentName)}, ${originalIndex})'>Loeschen</button><br>
          `;
        });

        ausgabe += '<br>';
      });

    const sonderpausenPath = path.join(folderPath, SONDERPAUSEN_DATEINAME);
    if (fs.existsSync(sonderpausenPath)) {
      const sonderpausen = JSON.parse(fs.readFileSync(sonderpausenPath, 'utf-8'));
      const genehmigte = sonderpausen.filter(pause =>
        pause.status === 'genehmigt' &&
        (!selectedAgent || pause.agent === selectedAgent)
      );

      if (genehmigte.length) {
        ausgabe += '<h3>Sonderpausen (Genehmigt)</h3>';
        genehmigte.forEach(pause => {
          const index = sonderpausen.indexOf(pause);
          const startZeit = dayjs(`${pause.datum} ${pause.von}`).format('YYYY-MM-DD HH:mm:ss');
          const endZeit = dayjs(`${pause.datum} ${pause.bis}`).format('YYYY-MM-DD HH:mm:ss');
          const dauer = dayjs(`${pause.datum} ${pause.bis}`)
            .diff(dayjs(`${pause.datum} ${pause.von}`), 'minute', true)
            .toFixed(2);
          gesamtPause += parseFloat(dauer);

          ausgabe += `
            #${index + 1}: ${startZeit} - ${endZeit} | ${dauer} Min (Sonderpause von ${escapeHtml(pause.agent)})
            <button class="delete-button" onclick="deleteSonderpause(${index})">Loeschen</button><br>
          `;
        });

        ausgabe += '<br>';
      }
    }

    ausgabe += `<strong>Gesamt manuelle Pausenzeit: ${gesamtPause.toFixed(2)} Min</strong>`;
    outputDiv.innerHTML = ausgabe;
  });
}

function deletePause(fileName, index) {
  if (!confirm('Möchtest du diese Pause wirklich loeschen?')) {
    return;
  }

  ipcRenderer.invoke('admin-pause-loeschen', { fileName, index }).then(() => {
    alert('Pause geloescht!');
    loadData();
  }).catch(error => {
    console.error('Fehler beim Loeschen der Pause:', error);
    alert('Fehler beim Loeschen.');
  });
}

function exportToExcel() {
  const start = dayjs(document.getElementById('start').value).startOf('day');
  const end = dayjs(document.getElementById('end').value).endOf('day');
  const selectedAgent = document.getElementById('agent-filter').value;

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
      .filter(file => file.endsWith('.json'))
      .filter(file => !SPECIAL_JSON_DATEIEN.has(file))
      .forEach(file => {
        const filePath = path.join(folderPath, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const agentName = path.parse(file).name;

        if (selectedAgent && selectedAgent !== agentName) {
          return;
        }

        data
          .filter(pause => {
            const pauseStart = dayjs(pause.start);
            return pauseStart.isAfter(start.subtract(1, 'second')) && pauseStart.isBefore(end.add(1, 'second'));
          })
          .forEach(pause => {
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
        alert('Kein Ordner ausgewaehlt. Export abgebrochen.');
        return;
      }

      const exportPath = path.join(exportFolder, `AdminExport_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.xlsx`);
      workbook.xlsx.writeFile(exportPath).then(() => {
        alert(`Exportiert nach: ${exportPath}`);
      }).catch(error => {
        console.error('Fehler beim Speichern der Excel-Datei:', error);
        alert('Fehler beim Speichern der Datei.');
      });
    });
  });
}

function ladeSonderpausen() {
  ipcRenderer.invoke('sonderpausen-laden').then(sonderpausen => {
    const offenePausen = sonderpausen.filter(pause => pause.status === 'offen');
    const container = document.getElementById('sonderpausen-output');

    if (!offenePausen.length) {
      container.innerHTML = '<p>Keine Sonderpausen vorhanden.</p>';
      return;
    }

    container.innerHTML = `
      <h3>Sonderpausen (Warte auf Freigabe):</h3>
      ${offenePausen.map((pause, index) => `
        <div id="sonderpause-${index}" style="margin-bottom: 10px; padding: 5px; border: 1px solid #ccc;">
          <strong>${escapeHtml(pause.agent)}</strong> | ${escapeHtml(pause.datum)} | ${escapeHtml(pause.von)} - ${escapeHtml(pause.bis)}<br>
          Begruendung: ${escapeHtml(pause.bemerkung)}<br>
          Status: <strong>${escapeHtml(pause.status.toUpperCase())}</strong><br>
          <button onclick='sonderpauseEntscheiden(${index}, ${JSON.stringify(pause.agent)}, ${JSON.stringify(pause.datum)}, ${JSON.stringify(pause.von)}, ${JSON.stringify(pause.bis)}, "genehmigt")'>Genehmigen</button>
          <button onclick='sonderpauseEntscheiden(${index}, ${JSON.stringify(pause.agent)}, ${JSON.stringify(pause.datum)}, ${JSON.stringify(pause.von)}, ${JSON.stringify(pause.bis)}, "abgelehnt")'>Ablehnen</button>
        </div>
      `).join('')}
    `;
  });
}

function sonderpauseEntscheiden(index, agent, datum, von, bis, status) {
  const eintrag = document.getElementById(`sonderpause-${index}`);
  if (eintrag) {
    eintrag.remove();
  }

  showToastAdmin(`Sonderpause wird ${status === 'genehmigt' ? 'genehmigt' : 'abgelehnt'}...`);

  ipcRenderer.invoke('sonderpause-aktualisieren', {
    agent,
    datum,
    von,
    bis,
    status
  }).then(erfolg => {
    if (erfolg) {
      ipcRenderer.send('sonderpausen-aktualisieren', status);
      ladeSonderpausen();
    } else {
      showToastAdmin('Fehler beim Aktualisieren der Sonderpause.', false);
      ladeSonderpausen();
    }
  });
}

function deleteSonderpause(index) {
  if (!confirm('Diese genehmigte Sonderpause wirklich loeschen?')) {
    return;
  }

  ipcRenderer.invoke('sonderpause-loeschen', index).then(erfolg => {
    if (erfolg) {
      alert('Sonderpause geloescht!');
      loadData();
    } else {
      alert('Fehler beim Loeschen.');
    }
  });
}

function startRefreshLoop() {
  if (refreshTimer) {
    return;
  }

  refreshTimer = setInterval(() => {
    if (!adminVisible) {
      return;
    }

    ladeSonderpausen();
    loadScheduledAlerts();
    loadPhoneUsageRequests({ notifyOnNew: true });
  }, 5000);
}

function handleSonderpausenUpdate(payload) {
  if (adminVisible) {
    loadData();
    ladeSonderpausen();
  }

  const status = typeof payload === 'string' ? payload : payload?.status;
  if (!status) {
    return;
  }

  showToastAdmin(
    status === 'genehmigt'
      ? 'Sonderpause genehmigt!'
      : 'Sonderpause abgelehnt!',
    status === 'genehmigt'
  );
}

function initAdminPage() {
  const loginDiv = document.getElementById('login');
  const appDiv = document.getElementById('app');
  const passwordInput = document.getElementById('admin-password');
  const togglePassword = document.getElementById('toggle-password');
  const loginButton = document.getElementById('login-button');
  const alertSendBtn = document.getElementById('alert-send');
  const alertText = document.getElementById('alert-text');
  const alertAllClients = document.getElementById('alert-all-clients');
  const alertScheduleEnabled = document.getElementById('alert-schedule-enabled');
  const alertScheduleAt = document.getElementById('alert-schedule-at');
  const alertSelectAll = document.getElementById('alert-select-all');
  const alertClearAll = document.getElementById('alert-clear-all');

  document.getElementById('start').value = dayjs().format('YYYY-MM-DD');
  document.getElementById('end').value = dayjs().format('YYYY-MM-DD');

  setTimeout(() => {
    if (passwordInput && passwordInput.offsetParent !== null) {
      passwordInput.focus();
    }
  }, 0);

  togglePassword?.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePassword.textContent = isPassword ? 'Verbergen' : 'Auge';
  });

  alertAllClients?.addEventListener('change', syncAlertRecipientState);
  alertScheduleEnabled?.addEventListener('change', syncScheduleState);

  alertSelectAll?.addEventListener('click', () => {
    document.querySelectorAll('#alert-recipients input[type="checkbox"]').forEach(checkbox => {
      checkbox.checked = true;
    });
  });

  alertClearAll?.addEventListener('click', () => {
    document.querySelectorAll('#alert-recipients input[type="checkbox"]').forEach(checkbox => {
      checkbox.checked = false;
    });
  });

  syncAlertRecipientState();
  syncScheduleState();

  alertSendBtn?.addEventListener('click', async () => {
    const msg = alertText.value.trim();
    if (!msg) {
      alert('Bitte zuerst eine Nachricht eingeben!');
      return;
    }

    const onlyFor = alertAllClients.checked ? [] : getSelectedAlertRecipients();
    if (!alertAllClients.checked && !onlyFor.length) {
      alert('Bitte mindestens einen PC auswaehlen.');
      return;
    }

    let scheduledFor = null;
    if (alertScheduleEnabled.checked) {
      if (!alertScheduleAt.value) {
        alert('Bitte eine Versandzeit auswaehlen.');
        return;
      }

      const scheduled = dayjs(alertScheduleAt.value);
      if (!scheduled.isValid() || scheduled.valueOf() <= dayjs().add(30, 'second').valueOf()) {
        alert('Bitte eine zukuenftige Uhrzeit waehlen.');
        return;
      }

      scheduledFor = scheduled.toISOString();
    }

    const result = await ipcRenderer.invoke('send-alert', {
      text: msg,
      onlyFor,
      scheduledFor
    });

    if (result?.scheduled) {
      showToastAdmin(`Nachricht geplant fuer ${formatDateTime(result.scheduledFor)}.`);
      loadScheduledAlerts();
    } else {
      showToastAdmin('Nachricht gesendet.');
      ipcRenderer.send('trigger-alert-window', msg);
    }

    resetAlertComposer();
  });

  function handleLogin() {
    const enteredPassword = passwordInput.value.trim();
    if (enteredPassword !== correctPassword) {
      showToastAdmin('Falsches Passwort! Bitte erneut versuchen.', false);
      passwordInput.value = '';
      setTimeout(() => passwordInput.focus(), 0);
      return;
    }

    loginDiv.style.display = 'none';
    appDiv.style.display = 'flex';
    adminVisible = true;
    passwordInput.blur();

    setTimeout(() => {
      loadAgents();
      loadData();
      ladeSonderpausen();
      loadScheduledAlerts();
      loadPhoneUsageRequests();
      startRefreshLoop();
    }, 100);
  }

  loginButton.addEventListener('click', handleLogin);
  passwordInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      handleLogin();
    }
  });

  document.getElementById('filter-button')?.addEventListener('click', loadData);
  document.getElementById('export-button')?.addEventListener('click', exportToExcel);
}

ipcRenderer.on('sonderpause-aktualisiert', () => {
  if (adminVisible) {
    loadData();
    ladeSonderpausen();
  }
});

ipcRenderer.on('client-status', (_, { clientId, status }) => {
  const li = document.querySelector(`#chat-clients li[data-client-id="${clientId}"]`);
  if (!li) {
    return;
  }

  li.style.backgroundColor = status === 'online' ? 'lightgreen' : 'lightcoral';
});

ipcRenderer.on('sonderpausen-aktualisieren', (_event, payload) => {
  handleSonderpausenUpdate(payload);
});

ipcRenderer.on('phone-usage-updated', () => {
  if (!adminVisible) {
    return;
  }

  loadPhoneUsageRequests({ notifyOnNew: true });
});

window.deletePause = deletePause;
window.deleteSonderpause = deleteSonderpause;
window.sonderpauseEntscheiden = sonderpauseEntscheiden;

document.addEventListener('DOMContentLoaded', initAdminPage);

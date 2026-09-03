window.addEventListener('error', function (e) {
  console.error('Renderer Error:', e.message);
});

window.addEventListener('unhandledrejection', function (e) {
  console.error('Unhandled Promise rejection:', e.reason);
});

const xlsx = require('xlsx');
const dayjs = require('dayjs');
const fs = require('fs');
const { ipcRenderer } = require('electron');
const os = require('os');
const PHONE_USAGE_DURATION_MS = 5 * 60 * 1000;
// Hilfsfunktion für Farben
const getFarbeAnrufdauer = (wert) => wert > 75 ? 'green' : (wert >= 60 ? 'yellow' : 'red');
const getFarbeNachbearbeitung = (wert) => wert <= 12 ? 'green' : (wert <= 18 ? 'yellow' : 'red');
const getFarbeKlingel = (wert) => (wert >= 24 && wert <= 34) ? 'green' : (wert > 34 && wert <= 44 ? 'yellow' : 'red');

let anrufdauerChartInstance = null;
let nachbearbeitungszeitChartInstance = null;
let klingeldauerChartInstance = null;

const filePath = "\\\\192.168.210.42\\Serviceline-Team\\Pausenrechner\\AnrufeProAgent.xlsx"; // Der korrekte Pfad

const appVersion = require('./package.json').version;
document.addEventListener("DOMContentLoaded", () => {
  const versionEl = document.getElementById('app-version');
  if (versionEl) {
    versionEl.textContent = `Version: ${appVersion}`;
  }
});

const adminButton = document.getElementById('admin-button');
adminButton.addEventListener('click', () => {
  ipcRenderer.send('open-admin');
});

const phoneUsageButton = document.getElementById('phone-usage-button');
const phoneUsageStatus = document.getElementById('phone-usage-status');
const pauseButton = document.getElementById('pause-button');
let pauseAktiv = false;
let pauseStartZeit = null;
let backgroundInterval = null;
let activePhoneUsageRequest = null;
let phoneUsageTimer = null;

function getSelectedAgent() {
  return String(document.getElementById('agent')?.value || '').trim();
}

function formatPhoneUsageRemaining(expiresAt) {
  const remainingMs = Math.max(0, dayjs(expiresAt).valueOf() - Date.now());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clearPhoneUsageTimer() {
  if (phoneUsageTimer) {
    clearInterval(phoneUsageTimer);
    phoneUsageTimer = null;
  }
}

function renderPhoneUsageState() {
  if (!phoneUsageButton || !phoneUsageStatus) {
    return;
  }

  const agent = getSelectedAgent();
  const hasActiveRequest = Boolean(
    activePhoneUsageRequest &&
    dayjs(activePhoneUsageRequest.expiresAt).isValid() &&
    dayjs(activePhoneUsageRequest.expiresAt).valueOf() > Date.now()
  );

  if (!hasActiveRequest) {
    activePhoneUsageRequest = null;
    clearPhoneUsageTimer();
  }

  phoneUsageButton.classList.toggle('is-active', hasActiveRequest);
  phoneUsageStatus.classList.toggle('is-active', hasActiveRequest);
  phoneUsageButton.textContent = hasActiveRequest ? 'Handyfreigabe aktiv' : 'Wichtiger Anruf / Handy';
  phoneUsageButton.disabled = hasActiveRequest || !agent;

  if (hasActiveRequest) {
    const expiresAt = dayjs(activePhoneUsageRequest.expiresAt);
    phoneUsageStatus.textContent =
      `Freigabe fuer ${agent} aktiv bis ${expiresAt.format('HH:mm:ss')} Uhr. Restzeit ${formatPhoneUsageRemaining(activePhoneUsageRequest.expiresAt)}.`;
    return;
  }

  if (!agent) {
    phoneUsageStatus.textContent = 'Bitte zuerst einen Agenten waehlen.';
    return;
  }

  phoneUsageStatus.textContent = 'Nur fuer wichtige Anrufe oder wichtige Nachrichten verwenden. Die Freigabe bleibt 5 Minuten sichtbar.';
}

function startPhoneUsageTimer() {
  clearPhoneUsageTimer();
  if (!activePhoneUsageRequest) {
    renderPhoneUsageState();
    return;
  }

  phoneUsageTimer = setInterval(() => {
    const expiresAt = dayjs(activePhoneUsageRequest?.expiresAt);
    if (!expiresAt.isValid() || expiresAt.valueOf() <= Date.now()) {
      activePhoneUsageRequest = null;
      clearPhoneUsageTimer();
    }

    renderPhoneUsageState();
  }, 1000);

  renderPhoneUsageState();
}

async function syncPhoneUsageState() {
  const agent = getSelectedAgent();
  if (!agent) {
    activePhoneUsageRequest = null;
    clearPhoneUsageTimer();
    renderPhoneUsageState();
    return;
  }

  try {
    const state = await ipcRenderer.invoke('get-phone-usage-state', {
      agent,
      clientId: os.hostname()
    });

    activePhoneUsageRequest = state?.active ? state.request : null;
    if (activePhoneUsageRequest) {
      startPhoneUsageTimer();
    } else {
      clearPhoneUsageTimer();
      renderPhoneUsageState();
    }
  } catch (error) {
    console.error('Fehler beim Laden der Handyfreigabe:', error);
    activePhoneUsageRequest = null;
    clearPhoneUsageTimer();
    renderPhoneUsageState();
  }
}

phoneUsageButton?.addEventListener('click', async () => {
  const agent = getSelectedAgent();
  if (!agent) {
    alert('Bitte zuerst einen Agenten waehlen.');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('request-phone-usage', {
      agent,
      clientId: os.hostname(),
      durationMs: PHONE_USAGE_DURATION_MS
    });

    activePhoneUsageRequest = result?.request || null;
    if (activePhoneUsageRequest) {
      startPhoneUsageTimer();
    } else {
      clearPhoneUsageTimer();
      renderPhoneUsageState();
    }

    if (result?.alreadyActive && phoneUsageStatus && activePhoneUsageRequest) {
      phoneUsageStatus.textContent =
        `Fuer ${agent} ist bereits eine Handyfreigabe aktiv. Restzeit ${formatPhoneUsageRemaining(activePhoneUsageRequest.expiresAt)}.`;
      phoneUsageStatus.classList.add('is-active');
    }
  } catch (error) {
    console.error('Handyfreigabe konnte nicht gespeichert werden:', error);
    alert('Handyfreigabe konnte nicht gespeichert werden.');
  }
});

ipcRenderer.on('phone-usage-updated', () => {
  syncPhoneUsageState();
});

function freigabeBeantragen(datum, von, bis) {
  if (document.getElementById('sonderpause-overlay')) return;

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'sonderpause-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '1000';

  // Dialog
  const dialog = document.createElement('div');
  dialog.style.background = 'white';
  dialog.style.padding = '20px';
  dialog.style.borderRadius = '12px';
  dialog.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
  dialog.style.minWidth = '320px';
  dialog.style.fontFamily = 'Arial, sans-serif';
  dialog.innerHTML = `
    <h3 style="margin-top: 0;">Sonderpause beantragen</h3>
    <p style="margin: 8px 0; font-size: 14px;"><strong>${datum}</strong> | ${von} – ${bis}</p>
    <input type="text" id="sonderpause-bemerkung" placeholder="Grund der Sonderpause" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;" />
    <div id="sonderpause-feedback" style="margin-top: 10px; color: green; font-size: 13px;"></div>
    <div style="margin-top: 15px; text-align: right;">
      <button id="sonderpause-abbrechen" style="margin-right: 8px; background: #ddd; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Abbrechen</button>
      <button id="sonderpause-senden" style="background: #d9534f; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">Senden</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Close on outside click
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  // Close Button
  document.getElementById('sonderpause-abbrechen').addEventListener('click', () => {
    overlay.remove();
  });

  // Senden Button
  document.getElementById('sonderpause-senden').addEventListener('click', async () => {
    const bemerkung = document.getElementById('sonderpause-bemerkung').value.trim();
    const feedback = document.getElementById('sonderpause-feedback');
  
    if (!bemerkung) {
      feedback.style.color = 'red';
      feedback.textContent = '❗ Bitte gib einen Grund an.';
      return;
    }
  
    const sonderpausen = await ipcRenderer.invoke('sonderpausen-laden');
  
    const doppelt = sonderpausen.find(pause =>
      pause.datum === datum &&
      pause.von === von &&
      pause.bis === bis &&
      pause.agent === document.getElementById('agent').value
    );
  
    if (doppelt) {
      feedback.style.color = 'orange';
      feedback.textContent = '⚠️ Anfrage existiert bereits.';
      return;
    }
  
    const payload = {
      agent: document.getElementById('agent').value,
      datum,
      von,
      bis,
      bemerkung,
      start: `${datum} ${von}`,
      ende: `${datum} ${bis}`
    };
    
    console.log('➡️ Sende Sonderpause:', payload);
    
    ipcRenderer.send('pause-freigabe-anfrage', payload);
    
    
  
    setTimeout(async () => {
      const sonderpausenNeu = await ipcRenderer.invoke('sonderpausen-laden');
      console.log('📦 Neue Liste geladen nach Antrag:', sonderpausenNeu);
    
      const wiederGefunden = sonderpausenNeu.find(p =>
        p.agent === document.getElementById('agent').value &&
        p.datum === datum &&
        p.von === von &&
        p.bis === bis
      );
    
      if (wiederGefunden) {
        console.log(`📌 Status nach erneutem Laden: ${wiederGefunden.status}`);
      }
    }, 2000); // nach 2 Sekunden
    
    feedback.style.color = 'green';
    feedback.textContent = '✅ Anfrage wurde gespeichert.';
  
    setTimeout(() => {
      overlay.remove();
      document.getElementById('berechnen').click();
    }, 1000);
  });
  
}



// Zustand setzen Funktion
function setPauseButtonState(isPauseAktiv) {
  if (isPauseAktiv) {
    pauseButton.textContent = '⏯️ Pause beenden';
    pauseButton.style.backgroundColor = '#ff4d4d'; // Rot
    pauseButton.style.color = 'white';
    pauseButton.style.animation = 'pulse 1s infinite';

    backgroundInterval = setInterval(() => {
      document.body.style.backgroundColor =
        document.body.style.backgroundColor === 'rgb(255, 220, 220)' ? 'white' : '#ffcccc';
    }, 500);
  } else {
    pauseButton.textContent = '⏯️ Pause starten';
    pauseButton.style.backgroundColor = '#4CAF50'; // Grün
    pauseButton.style.color = 'white';
    pauseButton.style.animation = '';
    clearInterval(backgroundInterval);
    document.body.style.backgroundColor = 'white';
  }
}

// Button Klick-Handler
pauseButton.addEventListener('click', async () => {
  if (!pauseAktiv) {
    pauseAktiv = true;
    pauseStartZeit = new Date();

    await ipcRenderer.send('pause-daten-speichern', {
      start: pauseStartZeit.toISOString(),
      ende: null
    });

    setPauseButtonState(true);

  } else {
    const pauseEndZeit = new Date();

    await ipcRenderer.send('pause-daten-speichern', {
      start: pauseStartZeit.toISOString(),
      ende: pauseEndZeit.toISOString()
    });

    pauseAktiv = false;
    setPauseButtonState(false);

    alert('Pause gespeichert!');
  }
});

// Beim Start prüfen, ob Pause noch aktiv ist
document.addEventListener('DOMContentLoaded', async () => {
  const daten = await ipcRenderer.invoke('pause-daten-laden');
  const letzteOffenePause = daten.reverse().find(p => p.ende === null);

  if (letzteOffenePause) {
    pauseAktiv = true;
    pauseStartZeit = new Date(letzteOffenePause.start);
    setPauseButtonState(true);
  } else {
    setPauseButtonState(false);
  }
});


// Überprüfe, ob die Datei existiert
if (!fs.existsSync(filePath)) {
  console.error(`❌ Excel-Datei nicht gefunden: ${filePath}`);
  output.textContent = `❌ Excel-Datei nicht gefunden: ${filePath}`;
  throw new Error('Datei fehlt');
} else {
  console.log(`✔️ Datei gefunden: ${filePath}`);
}

const select = document.getElementById('agent');
const output = document.getElementById('ergebnis');
const startInput = document.getElementById('start');
const endInput = document.getElementById('end');
const arbeitsbeginn = document.getElementById('arbeitsbeginn');
const arbeitsende = document.getElementById('arbeitsende');

select.addEventListener('change', () => {
  syncPhoneUsageState();
});

renderPhoneUsageState();

document.querySelector("label[for='start']").textContent = 'Pause berechnen von:';
document.querySelector("label[for='end']").textContent = 'Pause berechnen bis:';

document.addEventListener("DOMContentLoaded", function() {
  // Holen des aktuellen Datums
  const heute = dayjs().format('YYYY-MM-DD');
  
  // Setze das Datum in die Felder "Pausen berechnen von" und "Pausen berechnen bis"
  document.getElementById('start').value = heute;
  document.getElementById('end').value = heute;

 // ─────────── Nachrichten-Archiv ───────────
 const archiveStartBtn = document.getElementById('archive-start');
 const archiveEndBtn   = document.getElementById('archive-end');
 const archiveFilter   = document.getElementById('archive-filter');
 const archiveDiv      = document.getElementById('archive-messages');

 if (archiveStartBtn && archiveEndBtn && archiveFilter && archiveDiv) {
   const heute = dayjs().format('YYYY-MM-DD');
   archiveStartBtn.value = heute;
   archiveEndBtn.value   = heute;

   async function loadArchive() {
     const all = await ipcRenderer.invoke('load-archive');
     const from = dayjs(archiveStartBtn.value).startOf('day');
     const to   = dayjs(archiveEndBtn.value).endOf('day');
     const filtered = all.filter(e => {
       const t = dayjs(e.timestamp);
       return t.isBetween(from.subtract(1,'ms'), to);
     });
     archiveDiv.innerHTML = filtered.length
  ? filtered.map(e => `
      <div style="margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:4px;">
        <small>${dayjs(e.timestamp).format('YYYY-MM-DD HH:mm')}</small>
        <div style="white-space: pre-wrap; margin-top:4px;">${e.text}</div>
      </div>
    `).join('')
  : '<p>Keine Nachrichten.</p>';

   }

   archiveFilter.addEventListener('click', loadArchive);
   loadArchive();
 }

 // ⚡️ Nachrichten-Archiv öffnen
 const archiveBtn = document.getElementById('open-archive-button');
 if (archiveBtn) {
   archiveBtn.addEventListener('click', () => {
     ipcRenderer.send('open-archive-window');
   });
 }

});


// Hinzufügen der Enter-Taste Unterstützung für das Dienstende-Feld
arbeitsende.addEventListener('keydown', function(event) {
  if (event.key === 'Enter') {
    document.getElementById('berechnen').click(); // Klick auf "Berechnen" auslösen
  }
});

// Excel-Datei laden
const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
let data = xlsx.utils.sheet_to_json(sheet);

// Agenten extrahieren und dem Dropdown hinzufügen
const agents = [...new Set(data.map(row => row['Agent']).filter(Boolean))];
console.log(agents);  // Debugging-Ausgabe, um die Agenten zu prüfen
agents.forEach(agent => {
  const option = document.createElement('option');
  option.value = agent;
  option.text = agent;
  select.appendChild(option);
});

syncPhoneUsageState();


function createCharts(chartData, nachbearbeitungsData) {
 
 

  const anrufDauern = chartData
  .filter(row => row['Status'] === 'Connected')
  .map(row => parseFloat(row['Dauer in sekunden']))
  .filter(value => !isNaN(value));

  const avgAnrufdauer = anrufDauern.length > 0
    ? anrufDauern.reduce((sum, v) => sum + v, 0) / anrufDauern.length
    : 0;

  const nachbearbeitungsZeiten = nachbearbeitungsData;

  const avgNachbearbeitung = nachbearbeitungsZeiten.length > 0
    ? nachbearbeitungsZeiten.reduce((sum, v) => sum + v, 0) / nachbearbeitungsZeiten.length
    : 0;

  const klingeldauern = chartData
  .filter(row => ['Initialized', 'Alerting', 'On hold'].includes(row['Status']))
  .map(row => parseFloat(row['Dauer in sekunden']))
  .filter(value => !isNaN(value));

  const avgKlingeldauer = klingeldauern.length > 0
    ? klingeldauern.reduce((sum, v) => sum + v, 0) / klingeldauern.length
    : 0;

  console.log('Daten für Charts:', chartData);
  console.log('avgAnrufdauer:', avgAnrufdauer);
  console.log('avgNachbearbeitung:', avgNachbearbeitung);
  console.log('avgKlingeldauer:', avgKlingeldauer);

  if (anrufdauerChartInstance) anrufdauerChartInstance.destroy();
  if (nachbearbeitungszeitChartInstance) nachbearbeitungszeitChartInstance.destroy();
  if (klingeldauerChartInstance) klingeldauerChartInstance.destroy();

  anrufdauerChartInstance = new Chart(document.getElementById('anrufdauerChart'), {
    type: 'bar',
    data: {
      labels: [`Durchschnitt Anrufdauer (Sek) – ${anrufDauern.length} Anrufe`],
      datasets: [{
        label: 'Anrufdauer',
        data: [avgAnrufdauer],
        backgroundColor: getFarbeAnrufdauer(avgAnrufdauer)
      }]
    },
    options: {
      plugins: {
        tooltip: { enabled: true },
        datalabels: {
          anchor: 'end',
          align: 'top',
          formatter: (value) => value.toFixed(2) + ' Sek'
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: avgAnrufdauer > 0 ? Math.max(avgAnrufdauer * 1.5, 10) : 1
        }
      }
    }
  });

  nachbearbeitungszeitChartInstance = new Chart(document.getElementById('nachbearbeitungszeitChart'), {
    type: 'bar',
    data: {
      labels: [`Durchschnitt Nachbearbeitungszeit (Sek) – ${nachbearbeitungsZeiten.length} Anrufe`],
      datasets: [{
        label: 'Nachbearbeitungszeit',
        data: [avgNachbearbeitung],
        backgroundColor: getFarbeNachbearbeitung(avgNachbearbeitung)
      }]
    },
    options: {
      plugins: {
        tooltip: { enabled: true },
        datalabels: {
          anchor: 'end',
          align: 'top',
          formatter: (value) => value.toFixed(2) + ' Sek'
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: avgNachbearbeitung > 0 ? Math.max(avgNachbearbeitung * 1.5, 10) : 1
        }
      }
    }
  });

  klingeldauerChartInstance = new Chart(document.getElementById('klingeldauerChart'), {
    type: 'bar',
    data: {
      labels: [`Durchschnitt Klingeldauer (Sek) – ${klingeldauern.length} Anrufe`],
      datasets: [{
        label: 'Klingeldauer',
        data: [avgKlingeldauer],
        backgroundColor: getFarbeKlingel(avgKlingeldauer)
      }]
    },
    options: {
      plugins: {
        tooltip: { enabled: true },
        datalabels: {
          anchor: 'end',
          align: 'top',
          formatter: (value) => value.toFixed(2) + ' Sek'
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: avgKlingeldauer > 0 ? Math.max(avgKlingeldauer * 1.5, 10) : 1
        }
      }
    }
  });
}
 

document.getElementById('berechnen').addEventListener('click', async () => {
  const agent = select.value;
  const start = dayjs(startInput.value);
  let end = dayjs(endInput.value).endOf('day');  // Standardmäßig bis Mitternacht des eingegebenen Tages

  // Wenn der Endzeitpunkt der heutige Tag ist, setze ihn auf 20:00 Uhr (Dienstende)
  if (end.isSame(dayjs(), 'day')) {
    end = end.hour(20).minute(0).second(0); // Setze das Endzeitpunkt auf 20:00 Uhr für den heutigen Tag
  }

  if (!arbeitsbeginn.value || !arbeitsende.value) {
    output.innerHTML = `<span class="info-red">❗ Bitte Dienstbeginn und Dienstende eingeben, um die Pausenbewertung durchführen zu können.</span>`;
    return;
  }

  const gefiltert = data
    .filter(r => r['Agent'] === agent)
    .map(r => {
      const datum = dayjs(r['Datum']);
      const startZeit = dayjs(`${datum.format('YYYY-MM-DD')} ${r['Start']}`);
      const endeZeit = dayjs(`${datum.format('YYYY-MM-DD')} ${r['Ende']}`);
      return { start: startZeit, ende: endeZeit, datum: datum.format('YYYY-MM-DD') };
    })
    .filter(e => e.start.isValid() && e.ende.isValid() && e.start.isAfter(start) && e.start.isBefore(end))
    .sort((a, b) => a.start - b.start);

  if (gefiltert.length === 0) {
    output.innerHTML = `<span class="info-red">❗ Für den gewählten Zeitraum wurden keine Gesprächsdaten gefunden.</span>`;
    return;
  }

  const gruppiert = {};
  gefiltert.forEach(eintrag => {
    if (!gruppiert[eintrag.datum]) gruppiert[eintrag.datum] = [];
    gruppiert[eintrag.datum].push(eintrag);
  });

  let ausgabe = '';
  let gesamtDifferenz = 0;
  let insgesamtZuVielPause = 0;
  const nachbearbeitungsZeiten = [];

  for (const datum in gruppiert) {
    const eintraege = gruppiert[datum];
    const dienstVon = dayjs(`${datum} ${arbeitsbeginn.value}`);
    let dienstBis = dayjs(`${datum} ${arbeitsende.value}`);

    // Wenn der heutige Tag und das Arbeitsende ist kleiner als 20:00 Uhr, setze das Ende auf 20:00 Uhr
    if (datum === dayjs().format('YYYY-MM-DD') && dienstBis.isBefore(dayjs().hour(20))) {
      dienstBis.set('hour', 20).set('minute', 0).set('second', 0);
    }

    const ersterAnruf = eintraege[0].start;
    const letzterAnruf = eintraege[eintraege.length - 1].ende;

    // Berechnung der Arbeitszeit (zwischen dem ersten und letzten Anruf)
    let arbeitszeitMin = letzterAnruf.diff(ersterAnruf, 'minute');

    const pausen = [];
    let verloreneZeit = 0;
    let gutgeschriebeneZeit = 0;
    let zeileRot = '';
    let zeileGruen = '';

    // Bewertung des ersten Anrufs
if (ersterAnruf.isBefore(dienstVon)) {
  // Früher angefangen: Zeit vor Dienstbeginn wird gutgeschrieben.
  const diff = dienstVon.diff(ersterAnruf, 'minute', true);
  gutgeschriebeneZeit += diff;
  zeileGruen += `   <span class="info-green">🟢 Früher angefangen: ${diff.toFixed(2)} Min gutgeschrieben</span>\n`;
  arbeitszeitMin -= diff;
} else if (ersterAnruf.isAfter(dienstVon)) {
  // Später angefangen: Differenz wird als Pause (verlorene Zeit) gewertet.
  const diff = ersterAnruf.diff(dienstVon, 'minute', true);
  verloreneZeit += diff;
  zeileRot += `   <span class="info-red">🔴 Später angefangen: ${diff.toFixed(2)} Min werden als Pause gewertet</span>\n`;
  
  

  }

// Hier die beiden neuen Konstanten definieren:
const istHeute = datum === dayjs().format('YYYY-MM-DD');
const dienstBis15MinPuffer = dienstBis.add(15, 'minute');

// Bewertung des letzten Anrufs
if (!istHeute || dayjs().isAfter(dienstBis15MinPuffer)) {
  if (letzterAnruf.isBefore(dienstBis)) {
    // Früher aufgehört: Zeit nach letztem Anruf bis Dienstende als Pause.
    const diff = dienstBis.diff(letzterAnruf, 'minute', true);
    verloreneZeit += diff;
    zeileRot += `   <span class="info-red">🔴 Früher aufgehört: ${diff.toFixed(2)} Min werden als Pause gewertet</span>\n`;
  } else if (letzterAnruf.isAfter(dienstBis)) {
    // Später aufgehört: Zeit nach Dienstende wird gutgeschrieben.
    const diff = letzterAnruf.diff(dienstBis, 'minute', true);
    gutgeschriebeneZeit += diff;
    zeileGruen += `   <span class="info-green">🟢 Später aufgehört: ${diff.toFixed(2)} Min gutgeschrieben</span>\n`;
  }
}

    

    // Berechnung der Pausen, wenn mehr als 5 Minuten zwischen Anrufen
    for (let i = 1; i < eintraege.length; i++) {
      const vorherEnde = eintraege[i - 1].ende;
      const naechsterStart = eintraege[i].start;

      if (vorherEnde.format('YYYY-MM-DD') !== naechsterStart.format('YYYY-MM-DD')) continue;

      const pauseMin = naechsterStart.diff(vorherEnde, 'minute', true);

      if (pauseMin > 5) {
        pausen.push({
          von: vorherEnde.format('HH:mm:ss'),
          bis: naechsterStart.format('HH:mm:ss'),
          dauer: pauseMin
        });
      }
      
      // 💡 Problem hier: "pauseMin" ist außerhalb des Scope!
      if (pauseMin >= 0 && pauseMin <= 5) {
        nachbearbeitungsZeiten.push(pauseMin * 60); // in Sekunden
      }
      }

      const sonderpausen = await ipcRenderer.invoke('sonderpausen-laden');
      const genehmigteSonderpausen = sonderpausen.filter(pause =>
        pause.datum === datum &&
        pause.agent === agent &&
        pause.status === 'genehmigt'
      );
      
      const sonderpauseGesamt = genehmigteSonderpausen.reduce((sum, p) => {
        const duration = dayjs(`${datum} ${p.bis}`).diff(dayjs(`${datum} ${p.von}`), 'minute', true);
        return sum + duration;
      }, 0);
      
      const pauseSumme = pausen.reduce((sum, p) => sum + p.dauer, 0) + verloreneZeit - sonderpauseGesamt;
      

    // Berechnung der erlaubten Pause: Wenn der Arbeitszeitraum 6 Stunden oder mehr beträgt, gibt es 30 Minuten Pause
    const dienstDauer = dienstBis.diff(dienstVon, 'minute');
    const sollPause = dienstDauer > 360 ? 30 : 0; // 30 Minuten Pause ab 6 Stunden Arbeitszeit
    const differenz = pauseSumme - sollPause;
    const zuViel = differenz > 0;
    gesamtDifferenz += zuViel ? differenz : 0;

    // Gesamtpause korrekt abziehen
    let gesamtPause = pauseSumme - gutgeschriebeneZeit; // Abziehen der gutschriebenen Zeit

    // Zu viel Pause berechnen: Gesamtpause - Erlaubte Pause
    let zuVielPause = gesamtPause - sollPause;  // Jetzt wird die erlaubte Pause von der Gesamtpause abgezogen
    insgesamtZuVielPause += zuVielPause;  // Hinzufügen zur gesamten zu viel Pause

   

// Immer Pausen durchgehen
pausen.forEach((p, i) => {
  const istSonderpause = sonderpausen.find(pause =>
    pause.datum === datum &&
    pause.von === p.von &&
    pause.bis === p.bis &&
    pause.agent === agent
  );
  
  

  let statusHtml = `<span style="cursor: pointer; color: #007bff; margin-left: 8px; font-size: 14px;" title="Ist das keine Pause? Hier klicken, um eine Sonderpause zu beantragen." onclick="freigabeBeantragen('${datum}', '${p.von}', '${p.bis}')">❔</span>`;



  if (istSonderpause) {
    let farbe = '';
    let icon = '';
    let title = '';

    if (istSonderpause.status === 'offen') {
      farbe = 'info-warning';
      icon = '⏳';
      title = `Beantragt: ${istSonderpause.bemerkung}`;
    } else if (istSonderpause.status === 'genehmigt') {
      farbe = 'info-blue';
      icon = '✅';
      title = `Genehmigt: ${istSonderpause.bemerkung}`;
    } else if (istSonderpause.status === 'abgelehnt') {
      farbe = 'info-red';
      icon = '❌';
      title = `Abgelehnt: ${istSonderpause.bemerkung}`;
    }

    statusHtml = `<span class="${farbe}" title="${title}">${icon}</span>`;
  }

  ausgabe += `   #${i + 1}: ${p.von} – ${p.bis} | ${p.dauer.toFixed(2)} Min ${statusHtml}<br>\n`;
});

    if (pausen.length > 0) ausgabe += `\n`;

    ausgabe += `   🕒 Beginn erster Anruf: ${ersterAnruf.format('HH:mm:ss')} | Ende letzter Anruf: ${letzterAnruf.format('HH:mm:ss')}\n`;
    ausgabe += zeileRot;
    ausgabe += zeileGruen;
    if (verloreneZeit > 0 || gutgeschriebeneZeit > 0) ausgabe += `\n`;

    ausgabe += `   🧮 Pause gesamt: ${gesamtPause.toFixed(2)} Min (inkl. verlorener Zeit und Gutschrift)\n`;
    ausgabe += `   💼 Erlaubte Pause: ${sollPause.toFixed(2)} Min \n`;

    if (zuVielPause > 0) {
      ausgabe += `   <u class="info-red">⛔ Zu viel Pause gemacht: ${zuVielPause.toFixed(2)} Min</u>\n`;
    } else {
      ausgabe += `   ✅ Pausenzeiten eingehalten - super!\n`;
    }

    ausgabe += `\n`;
  }

  if (insgesamtZuVielPause > 0) {
    ausgabe += `<strong class="info-red">⏱️ Insgesamt zu viel Pause an allen Tagen: ${insgesamtZuVielPause.toFixed(2)} Min</strong>`;
  }

  // 💡 Hier dein Nachbearbeitungs-Durchschnitt!
const avgNachbearbeitung = nachbearbeitungsZeiten.length > 0
? nachbearbeitungsZeiten.reduce((sum, v) => sum + v, 0) / nachbearbeitungsZeiten.length
: 0;

console.log('🧮 Durchschnitt Nachbearbeitungszeit (Sek):', avgNachbearbeitung);
  // Manuelle Pausen aus zentraler Datei laden und anzeigen
  const pcName = require('os').hostname();

  let agentMismatchLogged = false;
let datumMismatchLogged = false;
let dauerMissingLogged = false;
let dauerNaNLogged = false;

const gefiltertData = data.filter(row => {
  const datum = dayjs(row['Datum']);
  const agentMatch = row['Agent'] === agent;
  const datumMatch = datum.isAfter(start.subtract(1, 'day')) && datum.isBefore(end.add(1, 'day'));
  const dauerExists = row['Dauer in sekunden'] !== undefined;
  const dauerIsNumber = !isNaN(parseFloat(row['Dauer in sekunden']));

  if (!agentMatch && !agentMismatchLogged) {
    console.log('❌ Agent passt nicht (erstes Vorkommen):', row['Agent']);
    agentMismatchLogged = true;
  }

  if (!datumMatch && !datumMismatchLogged) {
    console.log('❌ Datum passt nicht (erstes Vorkommen):', row['Datum']);
    datumMismatchLogged = true;
  }

  if (!dauerExists && !dauerMissingLogged) {
    console.log('❌ Dauer fehlt (erstes Vorkommen):', row);
    dauerMissingLogged = true;
  }

  if (!dauerIsNumber && !dauerNaNLogged) {
    console.log('❌ Dauer ist keine Zahl (erstes Vorkommen):', row['Dauer in sekunden']);
    dauerNaNLogged = true;
  }

  return agentMatch && datumMatch && dauerExists && dauerIsNumber;
});

console.log('✅ Gefilterte Datenmenge:', gefiltertData.length);



  
  
  
  // Hier richtig!
  const gefiltertDataForCharts = data.filter(row => {
    const datum = dayjs(row['Datum']).format('YYYY-MM-DD');
    return row['Agent'] === agent
      && datum === start.format('YYYY-MM-DD')
      && row['Dauer in sekunden'] !== undefined
      && !isNaN(parseFloat(row['Dauer in sekunden']));
  });

  zeigeAktionenUebersicht(gefiltertDataForCharts);

const gefiltertDataForNachbearbeitung = data
  .filter(row => {
    const datum = dayjs(row['Datum']);
    const agentMatch = row['Agent'] === agent;
    const datumMatch = datum.isAfter(start.subtract(1, 'day')) && datum.isBefore(end.add(1, 'day'));
    const startZeit = dayjs(`${row['Datum']} ${row['Start']}`);
    const endZeit = dayjs(`${row['Datum']} ${row['Ende']}`);
    const zeitraumMatch = startZeit.isValid() && endZeit.isValid() && startZeit.isAfter(start) && startZeit.isBefore(end);
    return agentMatch && datumMatch && zeitraumMatch;
  })
  .sort((a, b) => {
    const aDate = dayjs(`${a['Datum']} ${a['Start']}`);
    const bDate = dayjs(`${b['Datum']} ${b['Start']}`);
    return aDate - bDate;
  });

console.log('📊 Nachbearbeitung Einträge:', gefiltertDataForNachbearbeitung.length);


createCharts(gefiltertDataForCharts, nachbearbeitungsZeiten);
function zeigeAktionenUebersicht(data) {
   console.log('––– zeigeAktionenÜbersicht wurde aufgerufen mit', data.length, 'Zeilen –––');
  console.table(
    data.slice(0,10).map(r => ({
      Datum:   dayjs(r['Datum']).format('YYYY-MM-DD HH:mm:ss'),
      Aktion:  JSON.stringify(r['Aktion']),
      Dauer:   r['Dauer in sekunden']
    }))
  );
  console.log('Einmalige Aktionen:', [...new Set(data.map(r=>r['Aktion']))]);
  const einmaligeMGs = new Set();
  const aktionen = [];

  data.forEach(row => {
    const mg = typeof row['MG-ID'] === 'string' ? row['MG-ID'].trim() : String(row['MG-ID'] || '').trim();
const aktion = typeof row['Aktion'] === 'string' ? row['Aktion'].trim() : String(row['Aktion'] || '').trim();

    // Nur Aktionen mit MG-ID zählen (und pro MG nur einmal)
    if (mg && aktion && !einmaligeMGs.has(mg)) {
      einmaligeMGs.add(mg);
      aktionen.push(aktion);
    }
  });

  const zähler = {
    'Tel. falsch': 0,
    'Nicht erreicht': 0,
    'Ja': 0,
    'Nein': 0,
    'OK': 0,
    'Mitglied ohne Telefonnummer': 0,
    'Storno': 0,
    andere: {}
  };

  aktionen.forEach(a => {
    if (zähler.hasOwnProperty(a)) {
      zähler[a]++;
    } else {
      zähler.andere[a] = (zähler.andere[a] || 0) + 1;
    }
  });

  // Ja/Nein-Quote
  const ja = zähler['Ja'];
  const nein = zähler['Nein'];
  const quote = ja + nein > 0 ? (ja / (ja + nein)) * 100 : 0;

  // Umsatz
  const okAnzahl = zähler['OK'] || 0;
  const mitgliedOhne = zähler['Mitglied ohne Telefonnummer'] || 0;
  const storno = zähler['Storno'] || 0;

  // Welcome-Bereich rendern (setzt auch WC-Werte neu)
  document.getElementById('welcome-calls-inhalt').innerHTML = `
    <ul style="margin: 0 0 6px 0; padding-left: 18px; font-size: 13px; line-height: 1.2;">
      <li>OK: <span id="wc-ok">${okAnzahl}</span></li>
      <li>Mitglied ohne Telefonnummer: <span id="wc-mitglied">${mitgliedOhne}</span></li>
      <li>Storno: <span id="wc-storno">${storno}</span></li>
    </ul>

    <div style="font-size: 13px; color: gray; margin-top: 6px;">
      Telefoniezeit (in Std.): 
      <input type="number" id="telefoniezeit" step="0.01" placeholder="z. B. 2,75" style="width: 80px; font-size: 13px; margin-left: 6px;" />
    </div>
    <div id="umsatz-pro-std" style="margin-top: 6px; font-size: 13px; color: #444;">💶 Umsatz/Std. ca.: –</div>
  `;

  // Umsatzberechnung aktivieren
  function berechneUmsatz() {
    const telefonieInput = document.getElementById('telefoniezeit');
    const telefonieZeit = parseFloat((telefonieInput?.value || '0').replace(',', '.'));
  
    let umsatzProStunde = 0;
    if (telefonieZeit > 0) {
      umsatzProStunde = (okAnzahl * 4.65) / telefonieZeit;
    }
  
    let symbol = '❌';
    let color = 'red';
  
    if (umsatzProStunde >= 85) {
      symbol = '✅';
      color = 'green';
    } else if (umsatzProStunde >= 60) {
      symbol = `<span style="
        display: inline-block;
        width: 18px;
        height: 18px;
        background-color: orange;
        color: black;
        font-weight: bold;
        text-align: center;
        line-height: 18px;
        border-radius: 3px;
        font-size: 14px;">–</span>`;
      color = 'orange';
    }
  
    document.getElementById('umsatz-pro-std').innerHTML =
      `<span style="font-weight: bold; color: ${color}">${symbol} Umsatz/Std. ca.: ${umsatzProStunde.toFixed(2)} €</span>`;
  }
  

  const telefonieInput = document.getElementById('telefoniezeit');
  if (telefonieInput) {
    telefonieInput.addEventListener('input', berechneUmsatz);
    telefonieInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') berechneUmsatz();
    });
    berechneUmsatz(); // initial rechnen
  }

  const quoteText = `${quote.toFixed(2)}%`;
let quoteColor = 'red';
let symbol = '❌';

if (quote >= 65) {
  quoteColor = 'green';
  symbol = '✅';
} else if (quote >= 60) {
  quoteColor = 'orange';
  symbol = `<span style="display: inline-block; width: 18px; height: 18px; background-color: orange; color: black; font-weight: bold; text-align: center; line-height: 18px; border-radius: 3px; font-size: 14px;">–</span>`;
}

const quoteAnzeige = `<span style="font-weight: bold; color: ${quoteColor}">${symbol} Ja-Quote: ${quoteText}</span>`;

  // Ja/Nein-Quote anzeigen
  document.getElementById('telefonaktionen-inhalt').innerHTML = `
  <h3>📞 Telefonaktionen</h3>
  <div class="zeile">• Tel. falsch: <span>${zähler['Tel. falsch']}</span></div>
  <div class="zeile">• Nicht erreicht: <span>${zähler['Nicht erreicht']}</span></div>
  <div class="zeile">• Ja: <span>${ja}</span></div>
  <div class="zeile">• Nein: <span>${nein}</span></div>
  <div class="zeile" style="margin-top: 4px;">${quoteAnzeige}</div>
`;

 
  








  ipcRenderer.invoke('pause-daten-laden').then((manuellePausen) => {
    const startDatum = dayjs(startInput.value).startOf('day');
    const endDatum = dayjs(endInput.value).endOf('day');
  
    const gefiltertePausen = manuellePausen.filter(pause => {
      const pauseStart = dayjs(pause.start);
      return pauseStart.isAfter(startDatum.subtract(1, 'second')) && pauseStart.isBefore(endDatum.add(1, 'second'));
    });
  
    if (gefiltertePausen.length > 0) {
      ausgabe += `\n\n📋 Manuell getrackte Pausen (${pcName}):\n\n`;
  
      gefiltertePausen.forEach((pause, index) => {
        const start = dayjs(pause.start).format('YYYY-MM-DD HH:mm:ss');
        const ende = dayjs(pause.ende).format('YYYY-MM-DD HH:mm:ss');
        const dauer = dayjs(pause.ende).diff(dayjs(pause.start), 'minute', true).toFixed(2);
        ausgabe += `   #${index + 1}: ${start} – ${ende} | ${dauer} Min\n`;
      });
  
      const gesamtManuellePause = gefiltertePausen.reduce((summe, pause) => {
        const dauer = dayjs(pause.ende).diff(dayjs(pause.start), 'minute', true);
        return summe + dauer;
      }, 0).toFixed(2);
  
      ausgabe += `\n🧮 Manuelle Pause gesamt: ${gesamtManuellePause} Min\n`;
  
    } else {
      ausgabe += `\n\n📋 Manuell getrackte Pausen: Keine\n`;
    }
  
    output.innerHTML = ausgabe;
  });




// ✅ Update-Status empfangen
ipcRenderer.removeAllListeners('update-message');
ipcRenderer.on('update-message', (event, message) => {
  const ergebnis = document.getElementById('ergebnis');
  if (ergebnis) {
    ergebnis.textContent = message;
  }

  // Fortschrittsanzeige ein/aus
  const progressContainer = document.getElementById('update-progress-container');
  if (progressContainer) {
    if (message.includes('App wird geladen') || message.includes('Keine Updates verfügbar') || message.includes('Update geladen')) {
      progressContainer.style.display = 'none';
    } else {
      progressContainer.style.display = 'block';
    }
  }
});

ipcRenderer.removeAllListeners('update-progress');
ipcRenderer.on('update-progress', (event, message) => {
  const ergebnis = document.getElementById('ergebnis');
  const progressBar = document.getElementById('update-progress-bar');

  if (ergebnis) ergebnis.textContent = message;

  // Prozent aus der Message extrahieren
  const match = message.match(/(\d+)%/);
  if (match && progressBar) {
    const percent = parseInt(match[1]);
    progressBar.style.width = `${percent}%`;
  }
});

// ✅ Update fertig → App normal verwenden
ipcRenderer.removeAllListeners('update-complete');
ipcRenderer.on('update-complete', () => {
  console.log('✅ Update abgeschlossen. UI wird freigegeben.');

  // Optional: Fortschritt ausblenden
  const progressContainer = document.getElementById('update-progress-container');
  if (progressContainer) {
    progressContainer.style.display = 'none';
  }

});

// ⚠️ Wenn Update läuft → Info anzeigen
ipcRenderer.removeAllListeners('update-in-progress');
ipcRenderer.on('update-in-progress', () => {
  alert('⚠️ Update wird aktuell heruntergeladen. Bitte warten.');
});

 






ipcRenderer.removeAllListeners('sonderpausen-aktualisieren');
ipcRenderer.on('sonderpausen-aktualisieren', () => {
  console.log('🔄 Sonderpausen-Status hat sich geändert! Aktualisiere automatisch...');
  document.getElementById('berechnen').click(); // Automatisch auf "Berechnen" klicken

  // Zeige kleines Pop-up
  const infoBox = document.createElement('div');
  infoBox.style.position = 'fixed';
  infoBox.style.top = '20px';
  infoBox.style.right = '20px';
  infoBox.style.backgroundColor = '#4CAF50';
  infoBox.style.color = 'white';
  infoBox.style.padding = '12px 20px';
  infoBox.style.borderRadius = '8px';
  infoBox.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
  infoBox.style.zIndex = '9999';
  infoBox.style.fontSize = '14px';
  infoBox.style.opacity = '0.95';
  infoBox.textContent = '✅ Deine Sonderpause wurde aktualisiert!';

  document.body.appendChild(infoBox);

  setTimeout(() => {
    infoBox.remove();
  }, 3000);
});
}})

// 🔄 Excel-Datei automatisch neu laden bei Änderungen
function ladeExcelNeu() {
  try {
    console.log('📂 Lade Excel-Datei neu...');
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    data = xlsx.utils.sheet_to_json(sheet);

    // Agentenliste aktualisieren
    const select = document.getElementById('agent');
    if (select) {
      select.innerHTML = ''; // Alle bisherigen Optionen löschen
      const agents = [...new Set(data.map(row => row['Agent']).filter(Boolean))];
      agents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent;
        option.text = agent;
        select.appendChild(option);
      });
      console.log('✅ Agentenliste neu geladen');
      syncPhoneUsageState();
    }
  } catch (error) {
    console.error('❌ Fehler beim Neuladen der Excel:', error);
  }
}

// Beobachte die Datei auf Änderungen
fs.watchFile(filePath, (curr, prev) => {
  if (curr.mtime !== prev.mtime) {
    ladeExcelNeu();
    berechnePausen();
  }
});

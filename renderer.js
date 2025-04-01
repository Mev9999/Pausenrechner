<<<<<<< HEAD
const xlsx = require('xlsx');
const dayjs = require('dayjs');
const fs = require('fs');

const filePath = "\\\\svrstorage\\Telefondatenbanken\\ServicelineReports\\Pausenzeiten\\AnrufeProAgent.xlsx"; // Der korrekte Pfad

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

document.querySelector("label[for='start']").textContent = 'Pause berechnen von:';
document.querySelector("label[for='end']").textContent = 'Pause berechnen bis:';

document.addEventListener("DOMContentLoaded", function() {
  // Holen des aktuellen Datums
  const heute = dayjs().format('YYYY-MM-DD');
  
  // Setze das Datum in die Felder "Pausen berechnen von" und "Pausen berechnen bis"
  document.getElementById('start').value = heute;
  document.getElementById('end').value = heute;
});

// Excel-Datei laden
const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

// Agenten extrahieren und dem Dropdown hinzufügen
const agents = [...new Set(data.map(row => row['Agent']).filter(Boolean))];
console.log(agents);  // Debugging-Ausgabe, um die Agenten zu prüfen
agents.forEach(agent => {
  const option = document.createElement('option');
  option.value = agent;
  option.text = agent;
  select.appendChild(option);
});

document.getElementById('berechnen').addEventListener('click', () => {
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

    // Früher angefangen: Diese Zeit wird abgezogen
    if (ersterAnruf.isBefore(dienstVon)) {
      const plus = dienstVon.diff(ersterAnruf, 'minute', true);
      gutgeschriebeneZeit += plus;
      zeileGruen += `   <span class="info-green">🟢 Früher angefangen: ${plus.toFixed(2)} Min gutgeschrieben</span>\n`;
      // Diese Zeit wird von der Gesamtpause abgezogen
      arbeitszeitMin -= plus;
    }

    // Früher aufgehört: Diese Zeit wird zur verlorenen Zeit hinzugefügt
    if (letzterAnruf.isBefore(dienstBis)) {
      const verfrueht = dienstBis.diff(letzterAnruf, 'minute', true);
      verloreneZeit += verfrueht;
      zeileRot += `   <span class="info-red">🔴 Früher aufgehört: ${verfrueht.toFixed(2)} Min werden als Pause gewertet</span>\n`;
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
    }

    const pauseSumme = pausen.reduce((sum, p) => sum + p.dauer, 0) + verloreneZeit;

    // Berechnung der erlaubten Pause: Wenn der Arbeitszeitraum 6 Stunden oder mehr beträgt, gibt es 30 Minuten Pause
    const dienstDauer = dienstBis.diff(dienstVon, 'minute');
    const sollPause = dienstDauer >= 360 ? 30 : 0; // 30 Minuten Pause ab 6 Stunden Arbeitszeit
    const differenz = pauseSumme - sollPause;
    const zuViel = differenz > 0;
    gesamtDifferenz += zuViel ? differenz : 0;

    // Gesamtpause korrekt abziehen
    let gesamtPause = pauseSumme - gutgeschriebeneZeit; // Abziehen der gutschriebenen Zeit

    // Zu viel Pause berechnen: Gesamtpause - Erlaubte Pause
    let zuVielPause = gesamtPause - sollPause;  // Jetzt wird die erlaubte Pause von der Gesamtpause abgezogen
    insgesamtZuVielPause += zuVielPause;  // Hinzufügen zur gesamten zu viel Pause

    ausgabe += `📅 ${datum}:\n\n`;
    pausen.forEach((p, i) => {
      ausgabe += `   #${i + 1}: ${p.von} – ${p.bis} | ${p.dauer.toFixed(2)} Min\n`;
    });
    if (pausen.length > 0) ausgabe += `\n`;

    ausgabe += `   🕒 Beginn erster Anruf: ${ersterAnruf.format('HH:mm:ss')} | Ende letzter Anruf: ${letzterAnruf.format('HH:mm:ss')}\n`;
    ausgabe += zeileRot;
    ausgabe += zeileGruen;
    if (verloreneZeit > 0 || gutgeschriebeneZeit > 0) ausgabe += `\n`;

    ausgabe += `   🧮 Pause gesamt: ${gesamtPause.toFixed(2)} Min (inkl. verlorener Zeit und Gutschrif)\n`;
    ausgabe += `   💼 Erlaubte Pause: ${sollPause.toFixed(2)} Min \n`;

    if (zuVielPause > 0) {
      ausgabe += `   <u class="info-red">⛔ Zu viel Pause: ${zuVielPause.toFixed(2)} Min</u>\n`;
    } else {
      ausgabe += `   ✅ Pausenregel eingehalten oder zu kurz\n`;
    }

    ausgabe += `\n`;
  }

  if (insgesamtZuVielPause > 0) {
    ausgabe += `<strong class="info-red">⏱️ Insgesamt zu viel Pause an allen Tagen: ${insgesamtZuVielPause.toFixed(2)} Min</strong>`;
  }

  output.innerHTML = ausgabe;
});

// Hinzufügen der Enter-Taste Unterstützung für das Dienstende-Feld
arbeitsende.addEventListener('keydown', function(event) {
  if (event.key === 'Enter') {
    document.getElementById('berechnen').click(); // Klick auf "Berechnen" auslösen
  }
});
=======
const xlsx = require('xlsx');
const dayjs = require('dayjs');
const fs = require('fs');

const filePath = "\\\\svrstorage\\Telefondatenbanken\\ServicelineReports\\Pausenzeiten\\AnrufeProAgent.xlsx"; // Der korrekte Pfad

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

document.querySelector("label[for='start']").textContent = 'Pause berechnen von:';
document.querySelector("label[for='end']").textContent = 'Pause berechnen bis:';

document.addEventListener("DOMContentLoaded", function() {
  // Holen des aktuellen Datums
  const heute = dayjs().format('YYYY-MM-DD');
  
  // Setze das Datum in die Felder "Pausen berechnen von" und "Pausen berechnen bis"
  document.getElementById('start').value = heute;
  document.getElementById('end').value = heute;
});

// Excel-Datei laden
const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

// Agenten extrahieren und dem Dropdown hinzufügen
const agents = [...new Set(data.map(row => row['Agent']).filter(Boolean))];
console.log(agents);  // Debugging-Ausgabe, um die Agenten zu prüfen
agents.forEach(agent => {
  const option = document.createElement('option');
  option.value = agent;
  option.text = agent;
  select.appendChild(option);
});

document.getElementById('berechnen').addEventListener('click', () => {
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

    // Früher angefangen: Diese Zeit wird abgezogen
    if (ersterAnruf.isBefore(dienstVon)) {
      const plus = dienstVon.diff(ersterAnruf, 'minute', true);
      gutgeschriebeneZeit += plus;
      zeileGruen += `   <span class="info-green">🟢 Früher angefangen: ${plus.toFixed(2)} Min gutgeschrieben</span>\n`;
      // Diese Zeit wird von der Gesamtpause abgezogen
      arbeitszeitMin -= plus;
    }

    // Früher aufgehört: Diese Zeit wird zur verlorenen Zeit hinzugefügt
    if (letzterAnruf.isBefore(dienstBis)) {
      const verfrueht = dienstBis.diff(letzterAnruf, 'minute', true);
      verloreneZeit += verfrueht;
      zeileRot += `   <span class="info-red">🔴 Früher aufgehört: ${verfrueht.toFixed(2)} Min werden als Pause gewertet</span>\n`;
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
    }

    const pauseSumme = pausen.reduce((sum, p) => sum + p.dauer, 0) + verloreneZeit;

    // Berechnung der erlaubten Pause: Wenn der Arbeitszeitraum 6 Stunden oder mehr beträgt, gibt es 30 Minuten Pause
    const dienstDauer = dienstBis.diff(dienstVon, 'minute');
    const sollPause = dienstDauer >= 360 ? 30 : 0; // 30 Minuten Pause ab 6 Stunden Arbeitszeit
    const differenz = pauseSumme - sollPause;
    const zuViel = differenz > 0;
    gesamtDifferenz += zuViel ? differenz : 0;

    // Gesamtpause korrekt abziehen
    let gesamtPause = pauseSumme - gutgeschriebeneZeit; // Abziehen der gutschriebenen Zeit

    // Zu viel Pause berechnen: Gesamtpause - Erlaubte Pause
    let zuVielPause = gesamtPause - sollPause;  // Jetzt wird die erlaubte Pause von der Gesamtpause abgezogen
    insgesamtZuVielPause += zuVielPause;  // Hinzufügen zur gesamten zu viel Pause

    ausgabe += `📅 ${datum}:\n\n`;
    pausen.forEach((p, i) => {
      ausgabe += `   #${i + 1}: ${p.von} – ${p.bis} | ${p.dauer.toFixed(2)} Min\n`;
    });
    if (pausen.length > 0) ausgabe += `\n`;

    ausgabe += `   🕒 Beginn erster Anruf: ${ersterAnruf.format('HH:mm:ss')} | Ende letzter Anruf: ${letzterAnruf.format('HH:mm:ss')}\n`;
    ausgabe += zeileRot;
    ausgabe += zeileGruen;
    if (verloreneZeit > 0 || gutgeschriebeneZeit > 0) ausgabe += `\n`;

    ausgabe += `   🧮 Pause gesamt: ${gesamtPause.toFixed(2)} Min (inkl. verlorener Zeit und Gutschrift)\n`;
    ausgabe += `   💼 Erlaubte Pause: ${sollPause.toFixed(2)} Min \n`;

    if (zuVielPause > 0) {
      ausgabe += `   <u class="info-red">⛔ Zu viel Pause: ${zuVielPause.toFixed(2)} Min</u>\n`;
    } else {
      ausgabe += `   ✅ Pausenregel eingehalten oder zu kurz\n`;
    }

    ausgabe += `\n`;
  }

  if (insgesamtZuVielPause > 0) {
    ausgabe += `<strong class="info-red">⏱️ Insgesamt zu viel Pause an allen Tagen: ${insgesamtZuVielPause.toFixed(2)} Min</strong>`;
  }

  output.innerHTML = ausgabe;
});

// Hinzufügen der Enter-Taste Unterstützung für das Dienstende-Feld
arbeitsende.addEventListener('keydown', function(event) {
  if (event.key === 'Enter') {
    document.getElementById('berechnen').click(); // Klick auf "Berechnen" auslösen
  }
});
>>>>>>> 9c67438 (Initial commit)

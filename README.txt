Release-Ablauf

Diese App zieht Updates aus GitHub Releases des Repositories:
https://github.com/Mev9999/Pausenrechner

Wichtig:
- Fuer jedes neue Rollout muss die Version in package.json erhoeht werden.
- Ein Push auf den Branch main startet automatisch den GitHub-Workflow unter .github/workflows/release.yml.
- Der Workflow baut den Windows-Installer, laedt latest.yml plus Setup-Datei in ein GitHub Release hoch und die installierten Clients koennen das Update dann finden.

Empfohlener Ablauf:
1. Code aendern.
2. Version in package.json erhoehen, zum Beispiel von 1.9.3 auf 1.9.4.
3. Alles mit GitHub Desktop committen und nach main pushen.
4. In GitHub unter Actions kurz pruefen, ob der Release-Workflow erfolgreich war.

Lokaler Test:
- npm install
- npm run build

Hinweis:
Wenn dieselbe Versionsnummer erneut gepusht wird, bekommen die Clients kein neues Update. Dann muss die Versionsnummer erneut hochgesetzt werden.

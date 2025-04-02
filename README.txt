Auto Update vornehmen:

- Änderungen machen im code und in der package.json die version erhöhen 1.0.0 auf zb 1.0.1
- npm run build
- npm run publish
=======
Zusatzinfo:

- der Token muss erneuert werden nach 1 Monat: https://github.com/settings/tokens
-  "Generate new token (classic)" for general use - wählen und folgendes anhaken:
✅ repo
✅ workflow
✅ write:packages
- Ablaufdatum und Name setzen und generieren, danach im VS Studio folgenden Befehl mit dem neuen Token:
$env:GH_TOKEN="DEIN_NEUER_TOKEN_HIER"
npm run publish


# Zeitwerk · Gestaltung

Das zuvor getrennt entwickelte Apple-inspirierte Design ist seit Version 5.0 Bestandteil der Anwendung.

- Arbeitsdauer und Fortschritt stehen auf Heute im Mittelpunkt. Nach Feierabend ersetzt eine kompakte Tagesbilanz den Timer.
- Ruhige Inhaltsflächen, dezente blaue Akzente und gezielte Glaseffekte an Navigation und Dialogen. Licht- und Dunkelmodus haben eigene abgestufte Farben.
- Desktop-Seitennavigation und schwebende mobile Navigation; die Auswahl gleitet zwischen den Tabs.
- Einstellungen sind in aufklappbare Gruppen gegliedert. Änderungen speichern automatisch, mit sichtbarem Erfolgs- oder Fehlerstatus.
- Das Zeitkonto öffnet eine Übersicht und bleibt unabhängig vom angezeigten Kalenderjahr aktuell.
- Kalender und Tagesdetails sind getrennt. Urlaub wird in Zeiträumen verwaltet, Feiertage sind optional automatisch und einzeln ausschließbar.
- Kurze Übergänge ohne Animationsbibliothek. Systemeinstellungen für reduzierte Bewegung, Transparenz und erhöhten Kontrast werden berücksichtigt; Glaseffekte haben undurchsichtige Fallbacks.

Die Oberflächenregeln liegen in `zeitwerk/app/static/interface.css`, Basiskomponenten in `styles.css`.

## Isolierte lokale Vorschau

```powershell
$env:DATA_DIR = Join-Path $env:TEMP "zeitwerk-design-preview"
$env:PORT = "18109"
python zeitwerk/app/server.py
```

Öffne `http://127.0.0.1:18109/`. Der getrennte Datenordner schützt bestehende Zeitdaten. Der Server lauscht auf allen Netzwerkinterfaces: nur in einem vertrauenswürdigen Netz testen und danach mit Strg+C beenden.

Regressionstests: `python -m unittest discover -s tests -v`.

Frontend-Berechnung der Wochenbalken: `node tests/test_week_progress.js`.

Live-Konto, ISO-Kalenderwochen und angerechnete Periodensummen: `node tests/test_day_insights.js`.

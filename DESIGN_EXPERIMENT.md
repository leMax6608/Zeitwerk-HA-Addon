# Zeitwerk · Apple-inspiriertes Designexperiment

Dieser Stand liegt ausschließlich auf `experiment/apple-ios-redesign`. Das Home-Assistant-Add-on auf `main`, seine Version und die produktiven Daten bleiben unverändert. Es gibt keinen Push und kein Merge.

## Lokal ansehen

Im experimentellen Worktree in PowerShell:

```powershell
$env:DATA_DIR = Join-Path $env:TEMP "zeitwerk-design-preview"
$env:PORT = "18109"
python zeitwerk/app/server.py
```

Danach `http://127.0.0.1:18109/` im Browser öffnen. Der getrennte Datenordner verhindert, dass die Vorschau produktive Zeitdaten nutzt. Der Entwicklungsserver lauscht derzeit auf allen Netzwerkinterfaces; die Vorschau deshalb nur in einem vertrauenswürdigen Netzwerk starten und nach dem Test mit `Strg+C` beenden.

## Umfang

- Helles, ruhiges Designsystem mit einem zurückhaltenden Akzent; Dunkelmodus bleibt erhalten.
- Selektives Liquid Glass für Navigation und Dialoge, überwiegend deckende Inhaltsflächen.
- Neue Komposition für Heute, Kalender, Auswertung und gruppierte Einstellungen.
- Mobile Bottom-Navigation und iPhone-gerechte Dialog-Sheets.
- Fallbacks für fehlenden Blur sowie reduzierte Transparenz und Bewegung.

Es wurden keine API-, Datenbank- oder Berechnungsregeln geändert. Zum Prüfen: `python -m unittest discover -s tests -v`.

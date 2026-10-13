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

## Designrichtung

- Zeit und Fortschritt stehen auf „Heute“ visuell vor allen Nebenwerten. Der laufende Tag bekommt einen großen Zähler mit Tagesziel-Fortschritt; nach Feierabend steht die Zusammenfassung im Vordergrund.
- Die Desktop-Version nutzt eine feste Seitennavigation, mobil bleibt die schwebende Bottom-Navigation. Der Glaseffekt sitzt an Navigation und Dialogen, nicht auf jeder Inhaltsfläche.
- Die Einstellungen beginnen mit einer kompakten Übersicht. Jeweils ein Bereich öffnet sich zum Bearbeiten; der Speichern-Button erscheint erst nach einer Änderung.
- Der Kalender zeigt nur die tatsächlich benötigten vier bis sechs Wochen. Einträge werden als kleine Punkte mit Kurztext oder Dauer angezeigt; Kürzel und Tagestypen sind aufklappbar. Ein Tag öffnet seine eigene Detailansicht.
- Die Auswertung trennt Kennzahlen, Wochentagsrhythmus, Erfolge und Monatsverlauf. Helles Design, Dunkelmodus sowie reduzierte Transparenz und Bewegung bleiben erhalten.
- In der dritten Iteration sitzt die Zeiterfassung in einer kompakten Tageskarte; Wochenstand und Urlaub folgen separat. Das Tagesprotokoll öffnet sich nur bei Bedarf. Der Dunkelmodus hat eine eigene abgestufte Farbpalette, und jeder geöffnete Einstellungsbereich ist als eigene Fläche mit Rand, Kopf und Inhalt abgegrenzt.
- Die vierte Iteration erklärt Einstellungsgruppen und einzelne Optionen direkter. Schalter zeigen zusätzlich „An“ oder „Aus“, die Auswahl für Motivationsmeldungen ist nur bei aktiviertem Schalter bedienbar, und die Mindestpause steht beim Arbeitsmodell. Kurze Seiten-, Bereichs- und Dialogübergänge geben Feedback; bei „Bewegung reduzieren“ entfallen sie.

Die experimentellen Styles liegen in `zeitwerk/app/static/ios-next.css`, zusätzlich zu den Basiskomponenten in `styles.css`. So kann das Experiment leicht entfernt oder weiterentwickelt werden, ohne den produktiven Zweig zu berühren.

Es wurden keine API-, Datenbank- oder Berechnungsregeln geändert. Zum Prüfen: `python -m unittest discover -s tests -v`.

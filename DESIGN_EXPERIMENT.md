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
- Die Auswahlfläche der mobilen Navigation ist ein einziges Element und gleitet zwischen den Tabs. Bei „Bewegung reduzieren“ springt sie ohne Übergang direkt an die neue Position.
- Das Zahnrad auf „Heute“ öffnet einen individuellen Überstundenplan für den Tag. Er verlängert Countdown und erwartete Endzeit, während das vertragliche Soll unverändert bleibt.
- Nach Feierabend kann freiwillig eine Tagesnotiz ergänzt werden. Texte und Stichpunkte bleiben mit dem Tag gespeichert; Enter setzt einen mit `- ` begonnenen Stichpunkt fort.
- Mitteilungen lassen sich für Arbeitsbeginn, Fortschritt, Tagesziel, fehlende Pause, erfülltes Pausenminimum, die letzten 15 Minuten, Überstundenplan und Feierabend einzeln wählen. Der Motivationspool enthält 36 Formulierungen. Ereignisse werden dauerhaft als bereits versendet markiert.
- Urlaub hat einen eigenen Einstellungsbereich mit Jahresauswahl, Resttagen, regulärem Anspruch und verwaltbaren Zeiträumen. Automatische Feiertage werden über [OpenHolidays](https://www.openholidaysapi.org/de/) geladen und lokal gespeichert. Einzelne Tage können ausgeschlossen und wieder aktiviert werden. Lokale Sonderfeiertage bleiben manuell; Mariä Himmelfahrt in Bayern wird deshalb nicht pauschal ergänzt.
- Der Dunkelmodus nutzt neutrale, abgestufte Grauwerte. Einstellungsicons tragen dezente eigene Farben. Die Übergänge bleiben kurz und reagieren auf die Systemeinstellung für reduzierte Bewegung.

Die experimentellen Styles liegen in `zeitwerk/app/static/ios-next.css`, zusätzlich zu den Basiskomponenten in `styles.css`. So kann das Experiment leicht entfernt oder weiterentwickelt werden, ohne den produktiven Zweig zu berühren.

Die neueste Iteration erweitert auch den experimentellen Backend-Stand. Tagesnotizen, Pläne, Feiertagsausnahmen und bereits geladene Feiertage sind in Sicherungen enthalten. Das Zeitkonto berücksichtigt erst Einträge ab dem eingestellten Startdatum. Zum Prüfen: `python -m unittest discover -s tests -v`.

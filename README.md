<p align="center">
  <img src="zeitwerk/logo.png" alt="Zeitwerk-Logo" width="440">
</p>

<h1 align="center">Arbeitszeit, einfach im Blick.</h1>

<p align="center">
  Eine private Arbeitszeiterfassung als Home-Assistant-App – mit einem klaren Timer, Pausen, Kalender und Zeitkonto.
</p>

Zeitwerk läuft auf deinem Home-Assistant-Gerät. Deine Zeiten bleiben im persistenten Datenordner der App; ein externes Konto oder Cloud-Dienst für die Zeiterfassung ist nicht nötig.

## Das Wichtigste

- **Arbeit und Pause erfassen:** starten, pausieren und den Tag nach Bestätigung abschließen. Vergessene Zeiten lassen sich manuell korrigieren.
- **Den Überblick behalten:** neue Tages- und Feierabendansicht, Kalender, individuelles Tagessoll und aufklappbares Zeitkonto.
- **Den Tag planen:** zusätzliche Arbeitszeit über das Zahnrad planen und nach Feierabend freiwillig eine Tagesnotiz mit Stichpunkten ergänzen.
- **Freie Tage planen:** Urlaubszeiträume in den Einstellungen verwalten; Feiertage je Bundesland automatisch berücksichtigen oder einzelne Ausnahmen wählen.
- **Auf dem iPhone nutzen:** als Web-App im Heimnetz und optional mit Live Activity über die Home-Assistant-Companion-App.
- **Mitteilungen nach Wunsch:** Motivation, Pausen, Tagesziel, geplanter Feierabend und Abschlussbilanz einzeln einstellen.
- **Direkt einstellen:** Änderungen speichern automatisch; die Oberfläche bietet helles Design, Dunkelmodus und flüssige Tabwechsel.
- **Daten sichern:** JSON-Backup zum Wiederherstellen und CSV-Export für Tabellenprogramme.

## Installation

1. Öffne in Home Assistant **Einstellungen → Apps → App-Store → ⋮ → Repositories**.
2. Füge **`https://github.com/leMax6608/Zeitwerk-HA-Addon`** hinzu und lade den App-Store neu.
3. Installiere **Zeitwerk – Arbeitszeit**, starte die App und öffne ihre **Weboberfläche**.
4. Stelle unter **Einstellungen** deine Arbeitstage, Tagesziele und deinen Urlaubsanspruch ein.

Bei einer bestehenden Repository-Installation: Im App-Store **Nach Updates suchen** und Zeitwerk auf **5.0.1** aktualisieren. Vorher eine JSON-Sicherung herunterladen; nach dem Update die Weboberfläche neu laden.

> **Du nutzt bereits eine lokale Zeitwerk-Installation?** Die Repository-Version hat eine andere App-Kennung und übernimmt deine Daten **nicht automatisch**. Lade zuerst unter **Einstellungen → Daten & Sicherung** ein JSON-Backup herunter. Installiere die neue App zusätzlich, importiere das Backup und prüfe deine Zeiten, bevor du die alte Installation entfernst. Beide Apps können nicht gleichzeitig den Host-Port `18099` nutzen; stoppe dafür vorübergehend die alte App.

Eine Anleitung für die [lokale Installation und sichere Aktualisierung](zeitwerk/DOCS.md#lokale-installation-und-aktualisierung) findest du in der ausführlichen Dokumentation.

## Auf dem iPhone

Über **Home Assistant** kannst du Zeitwerk wie gewohnt auch per Nabu Casa öffnen. Für ein eigenes Homescreen-Symbol ohne Home-Assistant-Oberfläche öffne im **privaten Heimnetz** in Safari `http://<HA-IP>:18099` und wähle **Teilen → Zum Home-Bildschirm**.

Nabu Casa stellt diesen Direktport nicht bereit. Unterwegs ist ein **privates VPN** zum Heimnetz die sichere Lösung. **Leite Port `18099` nicht öffentlich im Router weiter:** Der direkte Zugang nutzt nicht die Home-Assistant-Anmeldung.

Die optionale [Live Activity auf dem iPhone](zeitwerk/DOCS.md#iphone-live-activity) läuft über die Home-Assistant-Companion-App; sie ist für die normale Zeiterfassung nicht erforderlich.

## Deine Daten

Zeitbuchungen werden sofort in SQLite unter `/data/zeitwerk.db` gespeichert. Zeitwerk legt zusätzlich eine Sicherheitskopie an. Erstelle trotzdem regelmäßig ein **Home-Assistant-Backup** und lade gelegentlich eine **JSON-Sicherung** auf ein anderes Gerät herunter – besonders vor Updates oder einem Wechsel der Installation.

Im Repository liegen **keine persönlichen Zeiteinträge oder Einstellungen**.

## Mehr erfahren

- [Bedienung, Tageskürzel, Pausen und Live Activity](zeitwerk/DOCS.md)
- [Änderungsverlauf](zeitwerk/CHANGELOG.md)
- [Quellcode der App](zeitwerk/app/)

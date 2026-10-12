# Zeitwerk im Detail

[Zurück zur Übersicht und Installation](../README.md)

## Einrichtung

Unter **Einstellungen → Arbeitsmodell** legst du für jeden Wochentag ein eigenes Tagesziel fest. `00:00` kennzeichnet einen regelmäßig freien Tag. Neue Installationen starten mit einem neutralen Beispielmodell von fünf Tagen à acht Stunden und ohne vorgegebenen Urlaubsanspruch. Prüfe außerdem die Pausenregel, den Beginn der Zeitkonto-Berechnung sowie den Urlaubsanspruch für das jeweilige Kalenderjahr. Zeitguthaben oder Zeitschulden aus dem Vorjahr lassen sich in Minuten übernehmen.

Ein optionales **Monatsbrutto** ermöglicht eine Schätzung des heutigen Verdiensts. Es wird durch die laut Arbeitsmodell geplanten Arbeitstage des jeweiligen Monats geteilt. Während der Arbeit wächst die Anzeige anteilig zum Tagesziel und höchstens bis zum Tagesanteil. Zusätzliche Stunden erhöhen ein festes Monatsgehalt nicht automatisch. Diese Anzeige ist keine Lohnabrechnung und berücksichtigt keine individuellen Zuschläge.

## Arbeitszeit erfassen

Auf **Heute** startest du die Arbeit und bei Bedarf eine Pause. Nach einer Pause kannst du weiterarbeiten. Beginn, Ende, gesamte Pause und Nettoarbeitszeit bleiben in der Tagesansicht sichtbar. Pro Kalendertag gibt es einen Arbeitszeiteintrag.

**Arbeit beenden** erfordert eine Bestätigung. Danach ersetzt eine Tagesbilanz die Timer-Steuerung; ein weiterer normaler Start am selben Tag ist gesperrt. Bei einem versehentlichen Abschluss findest du **Einstellungen → Daten & Sicherung → Erweiterte Korrekturen → Abgeschlossenen Arbeitstag wieder öffnen**. Die Zeit seit dem Abschluss wird dabei als Pause erfasst. Falsche Uhrzeiten oder Pausen korrigierst du besser über **Manuell bearbeiten** in der Tagesansicht. Pausen werden dort als `HH:MM` eingetragen, beispielsweise `00:30`.

Ein **X** bedeutet, dass das Tagesziel vollständig erfüllt ist, ohne einen laufenden Timer oder konkrete Uhrzeiten zu erfassen. Es ist **nicht** das Zeichen für einen normal getrackten Arbeitstag. Zusätzliche Stunden für einen X-Tag lassen sich in **Erweiterte Korrekturen** speichern; der Wert beschreibt die gesamte Zusatzzeit des Tages und wird nicht bei jedem Speichern erneut addiert.

### Tageskürzel

| Kürzel | Bedeutung |
| :--- | :--- |
| **B** | Normal erfasste Arbeit / Schule |
| **X** | Tagesziel pauschal erfüllt |
| **H** | Homeoffice |
| **FT** | Frei / Feiertag, ohne Urlaubstag |
| **U** | Urlaub |
| **K** | Krankheit |
| **S** | Sonderurlaub |
| **F** | Flexzeit-Abbau |
| **A** | Überzeit abfeiern |

Getrackte B- und H-Zeiten sowie X-Tage gehen in die Arbeitszeitsumme ein. Urlaub, Krankheit, Sonderurlaub und FT können das Zeitkonto neutral halten, erscheinen aber nicht als tatsächlich geleistete Arbeit. Alte G-Einträge werden mit ihren Zeiten als B und mit einer erklärenden Notiz weitergeführt.

## Kalender, Urlaub und freie Tage

Tippe im Kalender auf einen Tag, um seine eigene Detailansicht zu öffnen. Für Urlaub über mehrere Tage wähle **Urlaub eintragen** und gib Beginn und Ende an. Zeitwerk überspringt regelmäßig freie Wochentage sowie bereits als **FT** eingetragene Tage – auch dann, wenn der Urlaub an einem solchen Tag beginnt. Diese Tage verbrauchen keinen Urlaub. Andere vorhandene Einträge werden nicht überschrieben.

Für einen Feiertag oder anderen arbeitsfreien Tag nutze **Kalender → Freier Tag**; eine optionale Notiz ist möglich. Das geht auch im Voraus. FT zählt nicht als geleistete Arbeit, erzeugt für das Tagesziel keine Minusstunden und verbraucht keinen Urlaub. Feiertage werden nicht automatisch erkannt; trage die für dich relevanten Tage selbst ein. Pro Datum ist nur ein Tageseintrag möglich.

Geplanter Urlaub reduziert den angezeigten Resturlaub sofort. Im Zeitkonto wird der Urlaubstag erst an seinem jeweiligen Datum berücksichtigt.

## Pausenberechnung

Erfasste Pausen zählen nicht als Arbeitszeit. Zeitwerk prüft folgende Mindestpausen:

| Pausenregel | Arbeitszeit | Mindestpause |
| :--- | :--- | :--- |
| Volljährig | mehr als 6 Stunden | 30 Minuten |
| Volljährig | mehr als 9 Stunden | 45 Minuten |
| Unter 18 | mehr als 4 Stunden 30 Minuten | 30 Minuten |
| Unter 18 | mehr als 6 Stunden | 60 Minuten |

Pausen unter 15 Minuten werden dokumentiert, erfüllen aber in dieser Berechnung keine ausreichende Ruhepause. Ist **Fehlende Mindestpause abziehen** aktiviert, zählt eine nicht genommene Pflichtpause nicht als Arbeitszeit. Die Tagesansicht zeigt an, wenn dokumentierte Pause fehlt.

Die Berechnung ist eine Orientierungshilfe, keine Rechtsberatung. Betriebliche, tarifliche oder abweichende gesetzliche Regeln können weitere Anforderungen stellen.

## iPhone Live Activity

Optional zeigt Zeitwerk die laufende Arbeit über die **Home-Assistant-Companion-App** auf Sperrbildschirm, Dynamic Island und Apple Watch. Dafür werden Home Assistant Core 2026.7 oder neuer, iOS 17.2 oder neuer und erlaubte Mitteilungen für die Companion-App benötigt.

1. Suche in Home Assistant unter **Entwicklerwerkzeuge → Aktionen** nach deiner Aktion `notify.mobile_app_...`.
2. Trage den Teil ab `mobile_app_...` unter **Zeitwerk → Einstellungen → Live Activity** ein.
3. Aktiviere die Funktion, wähle **Verbindung testen** und erlaube die Live Activity auf dem iPhone.

Während der Arbeit läuft die geleistete Nettoarbeitszeit als Timer. In einer Pause zeigt der Timer die **gesamte** heute erfasste Pausenzeit an, nicht nur die aktuelle Pause. Die normale iPhone-Ansicht nennt die voraussichtliche frühestmögliche Endzeit anhand offener Nettoarbeitszeit und noch benötigter Mindestpause. Bei Zustandswechseln wird sie neu berechnet; zusätzliche Pausen verschieben sie. Die Apple-Watch-Ansicht erhält ebenfalls einen laufenden Chronometer.

Bei 25, 50 und 75 Prozent des Tagesziels können optionale Motivationsmitteilungen erscheinen. Unter **Einstellungen → Live Activity → Beispiele für Motivationsmeldungen** siehst du Beispiele. Mit eingetragenem Monatsbrutto kann auch der geschätzte Verdienst genannt werden. Nach dem Arbeitsende schließt Zeitwerk die Live Activity und sendet eine Push-Zusammenfassung mit Beginn, Ende, Arbeits- und Pausenzeit sowie – falls eingerichtet – geschätztem Bruttoverdienst.

Ein Tipp auf die Live Activity öffnet Zeitwerk im Home-Assistant-Ingress. Die von Home Assistant bereitgestellte Vorlage erlaubt keine eigenen Pause- oder Stopp-Tasten und nur einen live laufenden Chronometer. Für frei gestaltete interaktive Ansichten wäre eine eigene native iOS-App nötig. Die Zeiterfassung selbst funktioniert auch ohne zugestellte Benachrichtigungen.

## Lokale Installation und Aktualisierung

Du kannst Zeitwerk ohne GitHub-Repository als lokale Home-Assistant-App installieren:

1. Öffne den Home-Assistant-Konfigurationsordner per Samba, SSH oder Terminal und erstelle darin `/addons/zeitwerk`.
2. Kopiere den **Inhalt** des Ordners [`zeitwerk/`](./) aus diesem Repository hinein. `config.yaml`, `Dockerfile`, `app` und `rootfs` müssen direkt unter `/addons/zeitwerk` liegen.
3. Öffne **Einstellungen → Apps → App-Store → ⋮ → Nach Updates suchen**. Zeitwerk erscheint unter **Lokale Apps**. Installiere und starte es, dann öffne die Weboberfläche.

Vor einem Update: **JSON-Sicherung herunterladen und außerhalb des Home-Assistant-Geräts aufbewahren.** Stoppe danach Zeitwerk und ersetze nur die Programmdateien in `/addons/zeitwerk`. Einen vorhandenen Datenordner nicht überschreiben. Suche im App-Store nach Updates und wähle **Aktualisieren**, nicht **Deinstallieren**. Prüfe nach dem Start einen älteren Arbeitstag und die Einstellungen.

Beim Wechsel von einer lokalen Installation zur GitHub-Version werden Daten wegen der anderen App-Kennung **nicht automatisch übernommen**. Importiere die JSON-Sicherung in die neue App und kontrolliere die Einträge, bevor du die alte entfernst. Da beide standardmäßig Host-Port `18099` verwenden, darf nur eine gleichzeitig auf diesem Port laufen.

## Datensicherheit und Zugriff

Die Datenbank liegt im persistenten App-Datenordner unter `/data/zeitwerk.db`, nicht im Quellcodeordner `/addons/zeitwerk`. Jeder Start-, Pausen-, Fortsetzungs- und Stopp-Vorgang wird sofort als SQLite-Transaktion gespeichert; Zeitwerk hält zusätzlich `/data/zeitwerk-safety.db` als Sicherheitskopie vor. Unter **Einstellungen → Daten & Sicherung** kannst du eine vollständige JSON-Sicherung exportieren und wieder einspielen. Unter **Auswertung** gibt es einen Excel-kompatiblen CSV-Export. Ein normales Home-Assistant-Backup umfasst ebenfalls den App-Datenordner.

Der Direktport `18099` ist nur für ein **vertrauenswürdiges Heimnetz oder ein privates VPN** gedacht und sollte nicht öffentlich weitergeleitet werden. Home Assistant Ingress bleibt der angemeldete Weg für den Fernzugriff über Nabu Casa. Die Web-App kann ihre Oberfläche offline anzeigen, speichert aber bewusst **keine Zeitbuchungen offline zwischen**; zum Erfassen muss der Server erreichbar sein.

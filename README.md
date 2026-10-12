# Zeitwerk – Arbeitszeit für Home Assistant

Zeitwerk ist ein privates, lokales Arbeitszeitkonto als Home-Assistant-Add-on. Home Assistant dient dabei nur als sicherer Host und Fernzugriff; Zeitwerk greift nicht auf deine Geräte oder Entitäten zu.

## Was Zeitwerk kann

- Arbeitszeit und Pausenzeit mit zwei getrennten Live-Zählern erfassen
- Start- und Pausentasten während des Arbeitstags; Arbeit beenden nur nach zusätzlicher Bestätigung
- nach dem Abschluss eine Tagesbilanz statt der Timer-Steuerung anzeigen
- einen versehentlich abgeschlossenen Arbeitstag nur unter **Einstellungen → Daten & Sicherung → Erweiterte Korrekturen** wieder öffnen; die Zwischenzeit zählt als Pause
- pro Kalendertag genau einen Arbeitszeiteintrag führen
- vergessene oder falsche Zeiten über den manuellen Modus korrigieren
- mit Pfeiltasten durch vergangene Tage blättern und pro Tag Beginn, Ende, Pause und Arbeitszeit ansehen
- einen Kalendertag antippen und eine eigene Detailkarte öffnen, ohne die Startseite zu verlassen
- tatsächlichen Arbeitsbeginn und das Arbeitsende als Uhrzeit eintragen
- gesamte Pausendauer im Format `HH:MM` erfassen, etwa `00:30` oder `01:00`
- Tage nach den Kürzeln aus der Vorlage führen:
  - **B** – normale getrackte Büro-/Arbeitszeit
  - **X** – Tagesziel vollständig erfüllt (ohne Uhrzeiten)
  - **H** – Homeoffice
  - **FT** – frei / Feiertag (kein Urlaubstag)
  - **U** – Urlaub
  - **K** – Krankheit
  - **S** – Sonderurlaub
  - **F** – Flexzeit-Abbau
  - **A** – Überzeit abfeiern
- neutrale Voreinstellung mit 40 Wochenstunden und 8 Stunden pro Werktag; jedes Tagesziel ist separat anpassbar
- Mindestpausen für Volljährige automatisch prüfen: 30 Minuten bei mehr als 6 Stunden, 45 Minuten bei mehr als 9 Stunden
- Mindestpausen für Minderjährige prüfen: 30 Minuten bei mehr als 4:30 Stunden, 60 Minuten bei mehr als 6 Stunden
- Wochenstand, laufendes Zeitkonto, Resturlaub, Tagesverdienst, Homeoffice-Tage und Fahrten zur Arbeit anzeigen
- Monatsbrutto hinterlegen und daraus den Tagesanteil anhand der geplanten Arbeitstage des jeweiligen Monats schätzen
- Urlaubsanspruch für jedes Kalenderjahr separat hinterlegen
- Urlaub im Kalender als Zeitraum eintragen; freie Tage werden ausgelassen, andere Einträge nicht überschrieben
- Feiertage und andere arbeitsfreie Tage im Kalender einzeln und auch im Voraus eintragen
- Countdown zum nächsten eingetragenen Urlaub auf der Startseite anzeigen
- Monatskalender und Jahresauswertung mit Wochentag-Durchschnitt, Zielquote und Serien bereitstellen
- Jahresdaten als Excel-kompatible CSV exportieren
- vollständige JSON-Sicherung herunterladen und wieder einspielen
- Daten dauerhaft in Home Assistants geschütztem Add-on-Datenordner speichern
- jeden Start-, Pausen- und Stopp-Klick sofort absturzsicher speichern
- nach jeder Änderung automatisch eine zweite konsistente Sicherheitskopie anlegen
- helles, dunkles oder automatisch ans Gerät angepasstes Farbschema
- einheitliches Icon für Home-Assistant-App-Store, Browser und iPhone-Homescreen
- auf iPhone und iPad als Web-App zum Home-Bildschirm hinzufügen
- optional die laufende Arbeitszeit über Home Assistant als iPhone Live Activity auf Sperrbildschirm und Dynamic Island anzeigen
- optional motivierende Mitteilungen bei 25, 50 und 75 Prozent des Tagesziels senden

## Installation über GitHub

1. Öffne in Home Assistant **Einstellungen → Apps → App-Store** und wähle im Menü **⋮ → Repositories**.
2. Füge die URL dieses GitHub-Repositories (`https://github.com/<GITHUB-BENUTZERNAME>/zeitwerk-ha-addon`) hinzu und lade den App-Store neu.
3. Installiere **Zeitwerk – Arbeitszeit** aus diesem Repository und starte die App.
4. Öffne die Weboberfläche und richte unter **Einstellungen** dein Arbeitsmodell und deinen Urlaubsanspruch ein.

Eine GitHub-Installation hat in Home Assistant eine andere App-Kennung als eine bereits vorhandene lokale Installation. Sie übernimmt deren Daten **nicht automatisch**. Exportiere bei einem Wechsel zuerst die JSON-Sicherung aus der lokalen App, installiere die Repository-Version zusätzlich und importiere die Sicherung dort. Entferne die lokale App erst, wenn du alle Zeiten überprüft und ein weiteres externes Backup angelegt hast. Beide Apps können nicht gleichzeitig denselben Host-Port `18099` verwenden; stoppe vor dem Start der neuen App die lokale Installation oder ändere die Portzuordnung.

## Installation als lokales Add-on

Diese Variante funktioniert weiterhin ohne GitHub-Repository.

1. Installiere in Home Assistant das Add-on **Samba share** oder öffne den Ordner `/addons` per SSH/Terminal.
2. Lege den Ordner `/addons/zeitwerk` an.
3. Kopiere den **Inhalt des Unterordners `zeitwerk/`** aus diesem Projekt in diesen Ordner. `config.yaml`, `Dockerfile`, `app` und `rootfs` müssen direkt in `/addons/zeitwerk` liegen.
4. Öffne in Home Assistant **Einstellungen → Apps → App-Store** (in älteren Versionen: **Add-ons → Add-on-Store**).
5. Öffne oben rechts das Menü **⋮** und wähle **Nach Updates suchen** bzw. **Neu laden**.
6. Unter **Lokale Apps** (früher „Lokale Add-ons“) erscheint nun **Zeitwerk – Arbeitszeit**. Öffne es und wähle **Installieren**.
7. Aktiviere **Beim Systemstart starten** und optional **Watchdog**.
8. Starte das Add-on und klicke auf **Weboberfläche öffnen**.
9. Aktiviere bei Bedarf **In Seitenleiste anzeigen**. Zeitwerk ist dann direkt über die Home-Assistant-Seitenleiste erreichbar – auch über deinen bestehenden Fernzugriff.

### Sicheres Update von einer älteren Zeitwerk-Version

1. Lade in der alten Zeitwerk-Oberfläche unter **Einstellungen → Daten & Sicherung → Sicherung** eine JSON-Sicherung herunter und bewahre sie außerhalb des Home-Assistant-Geräts auf.
2. Stoppe Zeitwerk in **Einstellungen → Apps → Zeitwerk**. Warte, bis die App wirklich beendet ist.
3. Kopiere den Inhalt des Unterordners `zeitwerk/` nach `/addons/zeitwerk`, sodass `config.yaml`, `Dockerfile`, `app` und `rootfs` direkt in diesem Ordner liegen. Ersetze nur diese Programmdateien. Einen möglicherweise vorhandenen `data`-Ordner nicht überschreiben.
4. Öffne den **App-Store**, wähle im Menü **⋮ → Nach Updates suchen** und lade die Seite bei Bedarf neu. Öffne Zeitwerk und wähle **Aktualisieren**. **Nicht deinstallieren** und keine App-Daten löschen.
5. Starte Zeitwerk und kontrolliere einen alten Arbeitstag sowie die Einstellungen. Beim ersten Start legt Version 4.0.1 vor der Migration zusätzlich eine unveränderte SQLite-Kopie unter `/data/zeitwerk-pre-v4.db` an. Frühere getrackte X-Zeiten werden anschließend als normale Büroarbeit B übernommen; bestehende Wochenstunden und Arbeitstage werden in sieben Tagesziele umgerechnet.

Die eigentlichen Zeiten liegen im persistenten App-Datenordner `/data/zeitwerk.db`, nicht in `/addons/zeitwerk`. Die Aktualisierung der Programmdateien fasst diesen Datenordner nicht an. Bewahre die heruntergeladene JSON-Sicherung auf, bis alle Zeiten geprüft sind.

## Als eigenständige Web-App auf iPhone oder iPad

Home Assistant Ingress lädt Zeitwerk innerhalb der Home-Assistant-Oberfläche. Wird diese Seite zum Home-Bildschirm hinzugefügt, gehört die Web-App technisch zu Home Assistant und kann deshalb dessen Startseite öffnen. Zeitwerk stellt deshalb zusätzlich den Direktport `18099` im privaten Heimnetz bereit. Home Assistant richtet diese Zuordnung beim Installieren automatisch aus `config.yaml` ein; ein Konfigurations-Tab ist dafür nicht erforderlich.

1. Ermittle die lokale IP-Adresse deines Home-Assistant-Geräts.
2. Öffne in Safari `http://<HA-IP>:18099` und ersetze `<HA-IP>` durch diese Adresse.
3. Tippe auf **Teilen → Zum Home-Bildschirm**.
4. Öffne Zeitwerk anschließend über das neue Symbol. Es startet nun ohne Home-Assistant-Navigation.

Die Nabu-Casa-Adresse stellt den Home-Assistant-Remotezugriff bereit, aber keinen separaten öffentlichen Port für Apps. Weder `https://…ui.nabu.casa:8099` noch `:18099` funktionieren daher. Für den eigenständigen Zugriff von unterwegs ist ein privates VPN zum Heimnetz die sichere Variante. Der Direktport darf nicht ungefiltert im Router ins Internet freigegeben werden, weil dieser Zugang nicht von Home Assistant angemeldet wird.

> Der bisherige Zugriff über Home Assistant Ingress bleibt zusätzlich erhalten und übernimmt weiterhin die Home-Assistant-Anmeldung.

## Ersteinrichtung

Öffne in Zeitwerk **Einstellungen** und kontrolliere:

1. Arbeitszeit beziehungsweise Tagesziel für jeden Wochentag
2. Pausenregel „Volljährig“ oder „Unter 18“
3. Datum, ab dem das Zeitkonto berechnet werden soll
4. Urlaubsjahr, Urlaubsanspruch und Resturlaub aus dem Vorjahr
5. optionales Monatsbrutto für die Verdienstanzeige
6. Zeitguthaben oder Zeitschuld aus dem Vorjahr in Minuten

## Arbeitstag und Urlaub

Mit **Arbeit beenden** schließt du den heutigen Timer nach einer Sicherheitsabfrage endgültig ab. Die Startseite zeigt danach deine Tagesbilanz; ein zweiter normaler Start am selben Tag ist gesperrt. Falls der Abschluss versehentlich war, öffne **Einstellungen → Daten & Sicherung → Erweiterte Korrekturen → Abgeschlossenen Arbeitstag wieder öffnen**. Die Zeit seit dem Abschluss wird als Pause erfasst. Falsche Uhrzeiten korrigierst du stattdessen in der Tagesansicht über **Manuell bearbeiten**.

Für mehrere Urlaubstage wähle auf der Startseite oder im Kalender **Urlaub eintragen** und gib Von und Bis an. Zeitwerk überspringt Wochentage mit Tagesziel `00:00` sowie bereits als **FT** markierte freie Tage oder Feiertage – auch wenn der Zeitraum auf einem solchen Tag beginnt. Diese Tage bleiben erhalten und verbrauchen keinen Urlaub. Andere bestehende Tageseinträge werden nicht überschrieben. Geplanter Urlaub reduziert den angezeigten Resturlaub sofort, wird aber erst am jeweiligen Datum im Zeitkonto gutgeschrieben.

Für einen Feiertag oder anderen arbeitsfreien Tag wähle im **Kalender → Freier Tag** ein Datum und optional eine Notiz. Das geht auch im Voraus und über **Manuell bearbeiten → FT**. Ein FT-Tag verbraucht keinen Urlaubstag, zählt nicht als geleistete Arbeitszeit und erzeugt für das Tagesziel keine Minusstunden. Es gibt keine automatische Feiertagserkennung; trage die für dich relevanten Tage selbst ein. Pro Tag ist genau ein Eintrag möglich, damit Urlaub oder Arbeitszeit nicht versehentlich doppelt verbucht werden.

### Live Activity auf dem iPhone

Zeitwerk kann Start, Pause, Fortsetzen und Arbeitsende über die Home-Assistant-Companion-App an eine iPhone Live Activity weitergeben. Dafür werden Home Assistant Core 2026.7 oder neuer, iOS 17.2 oder neuer und aktivierte Mitteilungen für die Companion-App benötigt.

Während der Arbeit zeigt die Live Activity die bereits geleistete Nettoarbeitszeit als laufenden Timer. In einer Pause wechselt der Timer auf die gesamte heute erfasste Pausenzeit; eine zweite Pause beginnt daher beim bisherigen Pausenstand und nicht erneut bei null.

Die erweiterte Dynamic Island verwendet eine bewusst kurze Statuszeile. In der normalen Live Activity zeigt das Statusfeld die voraussichtliche frühestmögliche Endzeit. Sie ergibt sich aus der noch offenen Nettoarbeitszeit zuzüglich der noch erforderlichen qualifizierten Mindestpause. Längere oder zusätzliche Pausen verschieben die Endzeit entsprechend beim nächsten Zustandswechsel. In der Apple-Watch-/Smart-Stack-Ansicht steht zusätzlich der laufende Chronometer. Dafür wird kein statischer Fortschrittswert gesendet, weil die Companion-App andernfalls auf der Watch den Chronometer durch den Balken ersetzt.

Die Home-Assistant-Companion-App verwendet zwar eigene feste Darstellungen für Sperrbildschirm und Dynamic Island, nimmt dafür aber denselben Datensatz entgegen. Sie stellt nur einen live laufenden Chronometer bereit. Zwei gleichzeitig sekundengenau laufende Werte – etwa „gearbeitet“ und „übrig“ – oder frei platzierte Texte in den einzelnen Darstellungen sind deshalb ohne eine eigene native iOS-App mit ActivityKit nicht möglich.

1. Öffne in Home Assistant **Entwicklerwerkzeuge → Aktionen** und suche nach deiner Aktion `notify.mobile_app_...`.
2. Trage den Teil ab `mobile_app_...` in Zeitwerk unter **Einstellungen → Live Activity** ein.
3. Aktiviere die Funktion und wähle **Verbindung testen**.
4. Erlaube beim ersten Start die Live-Activity-Freigabe auf dem iPhone.

Die optionalen Motivationsmitteilungen werden bei 25, 50 und 75 Prozent des jeweiligen Tagesziels gesendet. Unter **Einstellungen → Live Activity → Beispiele für Motivationsmeldungen** siehst du eine Vorschau. Bei eingetragenem Monatsbrutto enthält sie auch den ungefähren Verdienst.

Eine reine Safari-Web-App kann Apples ActivityKit nicht selbst verwenden. Zeitwerk nutzt deshalb den von Home Assistant bereitgestellten, angemeldeten Weg über die Companion-App. Die Zeiterfassung bleibt auch dann funktionsfähig, wenn eine Benachrichtigung nicht zugestellt werden kann.

Ein Tipp auf die Live Activity öffnet Zeitwerk direkt im Home-Assistant-Ingress. Eigene Pause- oder Stopp-Schaltflächen innerhalb der Live Activity sind über Home Assistants allgemeine Live-Activity-Vorlage nicht verfügbar. Apple erlaubt solche interaktiven Schaltflächen nur in einer eigenen nativen Widget-Erweiterung mit App Intents.

Beim Beenden der Arbeit sendet Zeitwerk eine normale Push-Zusammenfassung und übermittelt anschließend als letzten Befehl das Schließen der Live Activity. Sie zeigt Beginn und Ende sowie die endgültige Nettoarbeitszeit, die gesamte erfasste Pausenzeit und bei hinterlegtem Monatsbrutto den geschätzten Tagesverdienst brutto. Ein Antippen öffnet wieder direkt Zeitwerk.

Neue Installationen beginnen mit einem neutralen Beispielmodell aus fünf Tagen à 8 Stunden und ohne vorgegebenen Urlaubsanspruch. Unter **Einstellungen → Arbeitsmodell** kann jeder Wochentag ein eigenes Ziel erhalten; `00:00` markiert einen regelmäßig freien Wochentag. Urlaub, Krankheit, Sonderurlaub und FT können das Zeitkonto neutral halten, erscheinen aber **nicht** als geleistete Arbeitszeit. Die Arbeitszeitsummen enthalten getrackte B- und H-Zeiten sowie ausdrücklich als vollständig erfüllt verbuchte X-Tage. Frühere G-Einträge werden mit unveränderten Zeiten als B und einer erklärenden Notiz weitergeführt; falls solche Einträge vorhanden sind, erstellt Zeitwerk vor der Umstellung eine zusätzliche unveränderte Datenbankkopie unter `/data/zeitwerk-pre-g-migration.db`.

Ein **X** für den heutigen Tag schaltet die Startseite auf „Tagesziel erfüllt“ um. Im verborgenen Bereich **Einstellungen → Daten & Sicherung → Erweiterte Korrekturen** kannst du für einen X-Tag bei Bedarf zusätzliche Stunden über dem Tagesziel speichern. Der eingetragene Wert ist die gesamte Zusatzzeit des Tages, nicht ein bei jedem Klick erneut addierter Betrag.

Das **Monatsbrutto** wird für die Anzeige durch die Zahl der laut Arbeitsmodell geplanten Arbeitstage des jeweiligen Kalendermonats geteilt. Beim laufenden Timer wächst der geschätzte Tagesverdienst anteilig zum Tagesziel, höchstens bis zum Tagesanteil; zusätzliche Stunden erhöhen das feste Monatsgehalt nicht automatisch. X sowie bezahlte freie Einträge erhalten in der Schätzung den vollen Tagesanteil. Das ist eine Anzeige, keine Lohnabrechnung oder Aussage über individuelle Zuschläge. Ein früher eingetragener Stundenlohn bleibt intern als Rückfallwert erhalten, bis du ein Monatsbrutto speicherst.

## Pausenberechnung

Erfasste Pausen zählen nicht als Arbeitszeit. Ist die Option **Fehlende Mindestpause abziehen** aktiv, zieht Zeitwerk eine fehlende gesetzliche Mindestpause automatisch von der erfassten Anwesenheitszeit ab. Kurze Pausen unter 15 Minuten werden zwar dokumentiert, ersetzen nach der zugrunde liegenden Regel jedoch keine ausreichende Ruhepause. Die Anzeige warnt, sobald die dokumentierte Pause unter der notwendigen Mindestpause liegt.

Die Berechnung ist eine praktische Hilfe und keine Rechtsberatung. Betriebliche, tarifliche oder abweichende gesetzliche Regeln können zusätzliche Anforderungen enthalten.

## Datensicherung

Unter **Einstellungen → Daten & Sicherung** lässt sich eine vollständige JSON-Datei herunterladen. Diese enthält Einstellungen und Einträge und kann später wieder eingespielt werden. Zusätzlich nimmt ein normales Home-Assistant-Backup den persistenten Add-on-Datenordner mit auf.

Intern nutzt Zeitwerk SQLite im WAL-Modus mit vollständiger Synchronisation. Start, Pause, Weiterarbeiten und Stop werden jeweils sofort als eigene Transaktion gespeichert. Nach jeder Änderung wird außerdem `/data/zeitwerk-safety.db` atomar erneuert. Falls die Hauptdatenbank nach einem Absturz beschädigt sein sollte, wird diese Sicherheitskopie beim Start automatisch verwendet.

Für Excel, LibreOffice oder die Steuerunterlagen gibt es unter **Auswertung** einen CSV-Export für das ausgewählte Jahr.

## Technische Hinweise

- Weboberfläche: responsive HTML, CSS und JavaScript ohne externe Dienste
- Backend: Python-Standardbibliothek
- Datenbank: SQLite unter `/data/zeitwerk.db`
- automatische Sicherheitskopie: `/data/zeitwerk-safety.db`
- interner App-Port: `8099`
- automatisch zugeordneter Host-Port: `18099`
- Zugriff: Home Assistant Ingress oder eigenständig im Heimnetz beziehungsweise über ein privates VPN
- Web-App: Manifest, iOS-Metadaten und Offline-App-Hülle; Zeitbuchungen werden bewusst niemals offline zwischengespeichert
- Netzwerkzugriffe des Add-ons: keine

## Projektstruktur

```text
repository.yaml             Home-Assistant-Repository-Metadaten
zeitwerk/config.yaml        Home-Assistant-App-Metadaten
zeitwerk/build.yaml         Basisimages für alle unterstützten Architekturen
zeitwerk/Dockerfile         Container-Build
zeitwerk/rootfs/.../run     Startdienst im Add-on
zeitwerk/app/server.py      API, SQLite und Webserver
zeitwerk/app/static/        Oberfläche und Web-App-Dateien
tests/                      Regressionstests mit temporärer Datenbank
```

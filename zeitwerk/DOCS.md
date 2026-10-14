# Zeitwerk im Detail

[Zurück zur Übersicht und Installation](../README.md)

## Einrichtung

Einstellungen werden **automatisch gespeichert**. Schalter und Auswahlen sofort, Text- und Zahlenfelder nach einer kurzen Tipp-Pause. Der Status oben zeigt, ob alles gespeichert ist. Ungültige oder unvollständige Werte bleiben zur Korrektur stehen. Bei einem Verbindungsfehler bleiben Änderungen im geöffneten Browser erhalten und Zeitwerk versucht das Speichern erneut. Schließe die Seite erst, wenn „Automatisch gespeichert“ angezeigt wird.

Unter **Einstellungen → Arbeitsmodell** legst du für jeden Wochentag ein eigenes Tagesziel fest. `00:00` kennzeichnet einen regelmäßig freien Tag. Neue Installationen starten mit einem neutralen Beispielmodell von fünf Tagen à acht Stunden und ohne vorgegebenen Urlaubsanspruch. Prüfe außerdem die Pausenregel, den Beginn der Zeitkonto-Berechnung sowie den Urlaubsanspruch für das jeweilige Kalenderjahr. Zeitguthaben oder Zeitschulden aus dem Vorjahr lassen sich in Minuten übernehmen.

Ein optionales **Monatsbrutto** ermöglicht eine Schätzung des heutigen Verdiensts. Es wird durch die laut Arbeitsmodell geplanten Arbeitstage des jeweiligen Monats geteilt. Während der Arbeit wächst die Anzeige anteilig zum Tagesziel und höchstens bis zum Tagesanteil. Zusätzliche Stunden erhöhen ein festes Monatsgehalt nicht automatisch. Diese Anzeige ist keine Lohnabrechnung und berücksichtigt keine individuellen Zuschläge.

## Arbeitszeit erfassen

Auf **Heute** startest du die Arbeit und bei Bedarf eine Pause. Nach einer Pause kannst du weiterarbeiten. Beginn, Ende, gesamte Pause und Nettoarbeitszeit bleiben in der Tagesansicht sichtbar. Pro Kalendertag gibt es einen Arbeitszeiteintrag.

**Arbeit beenden** erfordert eine Bestätigung. Danach ersetzt eine Tagesbilanz die Timer-Steuerung; ein weiterer normaler Start am selben Tag ist gesperrt. Bei einem versehentlichen Abschluss findest du **Einstellungen → Daten & Sicherung → Erweiterte Korrekturen → Abgeschlossenen Arbeitstag wieder öffnen**. Die Zeit seit dem Abschluss wird dabei als Pause erfasst. Falsche Uhrzeiten oder Pausen korrigierst du besser über **Manuell bearbeiten** in der Tagesansicht. Pausen werden dort als `HH:MM` eingetragen, beispielsweise `00:30`.

Ein **X** bedeutet, dass das Tagesziel vollständig erfüllt ist, ohne einen laufenden Timer oder konkrete Uhrzeiten zu erfassen. Es ist **nicht** das Zeichen für einen normal getrackten Arbeitstag. Zusätzliche Stunden für einen X-Tag lassen sich in **Erweiterte Korrekturen** speichern; der Wert beschreibt die gesamte Zusatzzeit des Tages und wird nicht bei jedem Speichern erneut addiert.

Das Zahnrad auf **Heute** öffnet einen optionalen Überstundenplan für diesen Tag. Er verlängert die angezeigte verbleibende Zeit und die erwartete Endzeit, verändert aber nicht dein vertragliches Tagessoll. Nach Feierabend kannst du freiwillig notieren, was du gemacht hast. Beginne eine Zeile mit `- `, um Stichpunkte zu schreiben; Enter führt die Liste fort. Notizen werden separat gespeichert und verändern keine Zeiten.

**Fahrt zur Arbeit** markiert einen Tag mit Arbeitsweg für deine Jahresübersicht. Sie zählt weder Fahrtdauer noch zusätzliche Arbeitszeit.

Die Zeitkonto-Anzeige öffnet eine Übersicht mit angerechneter Zeit, Soll bis heute und Übertrag. Während laufender Arbeit aktualisiert sie sich live. Im Fenster siehst du außerdem den **Stand vor heute**, ohne heutige Stunden und ohne heutiges Soll, sowie die heutige Abweichung vom Soll. Der Stand oben in der Leiste bleibt inklusive heute. Er bleibt aktuell, auch wenn der Kalender ein anderes Jahr zeigt. Einträge vor deinem eingestellten Berechnungsbeginn sind weiterhin sichtbar, werden aber nicht ins Zeitkonto gerechnet.

Die Balken beim **Wochenstand** füllen sich bis zum jeweiligen Tagessoll blau. Zusätzliche Zeit füllt denselben Balken ein zweites Mal von unten violett: zwei Überstunden bei acht Stunden Soll entsprechen beispielsweise einem Viertel des Balkens. Ohne Tagessoll ist geleistete Arbeit vollständig violett. Die genaue Dauer bleibt im Tagesprotokoll sichtbar, auch wenn die zweite Füllung bereits voll ist.

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

Für einen Feiertag oder anderen arbeitsfreien Tag nutze **Kalender → Freier Tag**; eine optionale Notiz ist möglich. Das geht auch im Voraus. FT zählt nicht als geleistete Arbeit, erzeugt für das Tagesziel keine Minusstunden und verbraucht keinen Urlaub. Pro Datum ist nur ein gespeicherter Tageseintrag möglich.

Unter **Einstellungen → Feiertage** kannst du optional dein Bundesland wählen und automatische Feiertage einschalten. Die Daten werden von OpenHolidays geladen und lokal zwischengespeichert. Du kannst einzelne automatische Tage ausschließen und wieder aktivieren. Manuelle Arbeitszeiten bleiben erhalten und haben Vorrang. Gemeindeabhängige Sonderfeiertage solltest du selbst eintragen; Mariä Himmelfahrt wird in Bayern beispielsweise nicht pauschal ergänzt.

Unter **Einstellungen → Urlaub** findest du Anspruch und Resttage für das ausgewählte Jahr sowie deine Urlaubszeiträume. Du kannst Zeiträume direkt hinzufügen, bearbeiten oder entfernen. **Bearbeiten** öffnet Anfang, Ende und Notiz für den ganzen Zeitraum. Änderungen ersetzen die alten Urlaubstage in einem einzigen Speichervorgang. Bei Konflikten bleiben die bisherigen Tage erhalten. Auch im Kalender öffnet ein Urlaubstag die Bearbeitung seines Zeitraums. Ein regulärer Anspruch dient als Standard für Jahre ohne eigene Festlegung. Beim Eintragen werden auch aktivierte automatische Feiertage übersprungen.

## Auswertung und Feierabend

Wechsle im Verlauf zwischen **Wochen** und **Monaten**. Ein Zeitraum öffnet die Tagesdetails. **Gearbeitet** zählt tatsächlich erfasste Arbeitszeit und X-Gutschriften; **angerechnet** enthält zusätzlich gutgeschriebene freie Tage ab dem Berechnungsbeginn. Der **Saldo** ist angerechnet minus Soll, ohne den Jahresübertrag. Laufende Zeiträume zeigen das Soll bis heute; zukünftige das geplante Soll. Alle Dauern sind Stunden:Minuten.

Die Sammlung enthält kleine Meilensteine für Einträge, erfüllte Tagesziele, ausreichende Pausen und Tagesnotizen. Urlaub, Feiertage und andere gutgeschriebene freie Tage unterbrechen eine Zielserie nicht und zählen nicht selbst als erfüllte Arbeitsziele. Überstunden bringen keine zusätzlichen Punkte.

Die freiwillige **Tagesnotiz** öffnet sich in einem eigenen Fenster und speichert nach einer kurzen Tipp-Pause automatisch. Bei einem Fehler bleibt das Fenster mit deiner Eingabe offen; ein neuer Speicherversuch folgt automatisch. „Fertig“ schließt erst nach erfolgreichem Speichern. Der kleine Feierabendmoment animiert nur das Sonnensymbol, einmal pro Tag und Gerät. Unter **Darstellung** ist er abschaltbar; bei reduzierter Bewegung bleibt er aus.

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
2. Trage den Teil ab `mobile_app_...` unter **Zeitwerk → Einstellungen → Mitteilungen** ein.
3. Wähle **Testmitteilung senden**, aktiviere bei Bedarf separat die **Live Activity** und erlaube sie auf dem iPhone.

Während der Arbeit läuft die geleistete Nettoarbeitszeit als Timer. In einer Pause zeigt der Timer die **gesamte** heute erfasste Pausenzeit an, nicht nur die aktuelle Pause. Die normale iPhone-Ansicht nennt die voraussichtliche frühestmögliche Endzeit anhand offener Nettoarbeitszeit und noch benötigter Mindestpause. Bei Zustandswechseln wird sie neu berechnet; zusätzliche Pausen verschieben sie. Die Apple-Watch-Ansicht erhält ebenfalls einen laufenden Chronometer.

Unter **Einstellungen → Mitteilungen** kannst du unabhängig von der Live Activity Nachrichten einzeln einschalten: Arbeitsbeginn, Motivation bei 25/50/75 Prozent, erfülltes Tagesziel, erfülltes Pausenminimum, fehlende Mindestpause, die letzten 15 Minuten, erreichter Überstundenplan und Feierabend. Motivation bietet 36 wechselnde Sprüche; wähle Spruch mit Verdienst, nur Spruch oder nur Prozent. Die kurze Feierabend-Zusammenfassung zeigt den Abstand zum Tagessoll und den Saldo des Zeitkontos; mit eingetragenem Monatsbrutto auch den geschätzten Tagesverdienst. Eine Vorschau steht direkt im Menü. Bereits erfolgreich versendete Tagesereignisse werden dauerhaft vermerkt, damit sie nach einem Neustart nicht erneut ausgelöst werden.

Beim Arbeitsende sendet Zeitwerk zuerst den Befehl zum Schließen der Live Activity und danach gegebenenfalls die separate Zusammenfassung. Wegen der iPhone-Push-Zustellung wird das Schließen verzögert wiederholt, solange kein neuer Timer läuft.

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

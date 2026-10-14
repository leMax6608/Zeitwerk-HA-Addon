# Änderungsverlauf

## 5.1.0

- Live-Zeitkonto; im Konto-Fenster getrennte Anzeige des Guthabens vor heute und der heutigen Abweichung vom Soll
- Urlaubszeiträume lassen sich als Ganzes verschieben, verlängern, kürzen und umbenennen; Änderungen sind atomar, Konflikte überschreiben keine anderen Tage
- Wochen- und Monatsauswertung mit eindeutig beschrifteten Werten und anklickbaren Tagesdetails; angerechnete freie Tage werden erklärt
- Neue Meilensteine für vollständige Einträge, Tagesziele, ausreichende Pausen und Notizen; freie Tage unterbrechen keine Zielserie
- Optionale kleine Feierabendanimation, einmal pro Tag und Gerät; berücksichtigt reduzierte Bewegung
- Tagesnotizen im eigenen Fenster mit automatischem Speichern, Fehleranzeige und Wiederholungsversuch
- Formatierung der Feierabend-Zeitzeile und des Tagesprotokolls bereinigt

## 5.0.1

- Wochenbalken füllen sich bis zum Tagessoll blau und bei Überstunden erneut mit einer violetten Schicht von unten
- Kleine Farblegende und genaue Arbeits-, Soll- und Überstundenzeiten als Tooltip und für Screenreader
- Laufende Wochenbalken aktualisieren sich ohne Neuladen; an Tagen ohne Soll erscheint geleistete Arbeit vollständig als zusätzliche Zeit

## 5.0.0

- Neue Oberfläche mit ruhigen Inhaltsflächen, schwebender mobiler Navigation, gleitender Tab-Markierung und eigenem Dunkelmodus
- Einstellungen speichern automatisch; Eingaben bleiben während des Speicherns erhalten, Fehler werden angezeigt und automatisch erneut versucht
- Zeitkonto öffnet eine eigene Übersicht und zeigt auch beim Blättern im Kalender immer den aktuellen Stand
- Neue Feierabendansicht mit Arbeitszeit, Tagessaldo, Zeiten, Pausen und Bruttoverdienst
- Freiwillige Tagesnotizen mit Stichpunkten; ein individueller Überstundenplan passt Countdown und voraussichtliche Endzeit an, ohne das vertragliche Soll zu verändern
- Erweiterte, einzeln wählbare Mitteilungen für Arbeitsbeginn, Pausen, nahenden Feierabend und erfüllte Überstundenpläne sowie 36 Motivationssprüche
- Eigener Urlaubsbereich mit Jahresauswahl, Resturlaub und verwaltbaren Zeiträumen
- Automatische Feiertage nach Bundesland über OpenHolidays, lokale Zwischenspeicherung und manuelle Ausnahmen; vorhandene Einträge bleiben erhalten
- Sicherungen enthalten auch Tagespläne, Feiertagsausnahmen und geladene Feiertage; Zeitkonto-Berechnung berücksichtigt erst Einträge ab dem eingestellten Startdatum

## 4.4.0

- Live Activity wird beim Arbeitsende vor der separaten Abschlussmeldung geschlossen; verzögerte Löschversuche fangen verspätete iPhone-Pushes ab
- Mitteilungen in den Einstellungen getrennt steuerbar: Motivation, erreichtes Tagesziel und Feierabend-Zusammenfassung
- Motivation wahlweise mit Spruch und Verdienst, nur mit Spruch oder nur als Prozentanzeige
- Feierabend-Mitteilung zeigt kurz den Abstand zum Tagessoll und den Saldo des Zeitkontos

## 4.3.2

- einheitliches Zeitwerk-Icon mit gut lesbarem Z und Fortschrittsring für Home-Assistant-App-Store, Web-App, iPhone-Homescreen und Browser ergänzt
- passende Wortmarke für die Home-Assistant-App-Detailansicht hinzugefügt
- Kopfzeile verwendet nun dasselbe Icon wie die installierte Web-App

## 4.3.1

- öffentliche Repository-Struktur für Home Assistant eingerichtet
- persönliche Beispielwerte durch neutrale Vorgaben ersetzt; vorhandene gespeicherte Einstellungen bleiben unverändert
- Deep-Link aus Benachrichtigungen berücksichtigt nun auch Repository-Installationen

## 4.3.0

- Ein X am heutigen Tag zeigt auf der Startseite sofort die abgeschlossene Tagesbilanz statt des Start-Timers
- Zusatzstunden zu X sind ausschließlich unter Einstellungen → Daten & Sicherung → Erweiterte Korrekturen einstellbar; kein Hinweis auf diesen Weg auf der Startseite
- Monatsbrutto als neue Verdienstgrundlage: durch die geplanten Arbeitstage des jeweiligen Monats geteilt, laufend anteilig und höchstens bis zum Tagesanteil angezeigt; der alte Stundenlohn bleibt als Rückfallwert erhalten, bis ein Monatsbrutto eingetragen ist
- ein Kalendertag öffnet eine eigene Detailkarte mit Status, Zeiten, Zeitkonto und Notiz, ohne die Startseite zu wechseln
- iPhone-Kalender mit größeren, klareren Tagesfeldern und einer mobilen Tageskarte überarbeitet

## 4.2.1

- Urlaubszeiträume dürfen nun auf einem bereits als FT markierten freien Tag oder Feiertag beginnen und solche Tage enthalten; FT bleibt bestehen und wird nicht als Urlaubstag gezählt
- Vorschau und Rückmeldung beim Eintragen machen ausgelassene freie Tage deutlicher

## 4.2.0

- Feiertage und andere arbeitsfreie Tage können direkt im Kalender oder im manuellen Modus als **FT – Frei / Feiertag** eingetragen werden, auch im Voraus
- FT verbraucht keinen Urlaubstag und hält das Zeitkonto für das jeweilige Tagesziel neutral; tatsächliche Arbeitszeit wird nicht vorgetäuscht
- den Tagestyp **G – Geschäftlich** entfernt; vorhandene G-Einträge bleiben mit allen Zeiten erhalten und werden als B mit einer erklärenden Notiz übernommen
- vor dieser Umstellung wird bei vorhandenen G-Einträgen eine unveränderte Datenbankkopie unter `/data/zeitwerk-pre-g-migration.db` angelegt

## 4.1.0

- Arbeitstag wird erst nach Bestätigung endgültig abgeschlossen; ein normaler Neustart am selben Tag ist danach gesperrt
- abgeschlossene Startseite zeigt Arbeitszeit, Pause, Beginn und Ende, geschätzten Verdienst und Abstand zum Tagesziel
- bewusst versteckte Wiederaufnahme unter Einstellungen → Daten & Sicherung → Erweiterte Korrekturen ergänzt
- Urlaub kann als Zeitraum eingetragen werden; freie Wochentage laut Arbeitsmodell werden ausgelassen und vorhandene andere Einträge nicht überschrieben
- Startseite zeigt einen Countdown zum nächsten eingetragenen Urlaub
- Datenbankverbindungen werden nach Transaktionen sofort geschlossen

## 4.0.2

- Zeitkonto oben rechts größer und besser lesbar gestaltet
- Dark Mode mit helleren Anthrazitflächen und einem einheitlichen Mintakzent überarbeitet
- Mindestpausenhinweis aus der Timerkarte entfernt; er bleibt in der Tagesansicht erhalten
- Abschlussmitteilung zeigt bei hinterlegtem Brutto-Stundenlohn den heute verdienten Betrag
- Beispiele für die Motivationsmitteilungen in den Live-Activity-Einstellungen ergänzt

## 4.0.1

- vor der ersten Migration wird eine unveränderte Datenbankkopie als `/data/zeitwerk-pre-v4.db` angelegt
- vorhandene X-Einträge werden bei einer Überschneidung nicht gelöscht
- manuelles Anlegen eines zweiten Arbeits- oder X-Eintrags kann den vorhandenen Tag nicht mehr stillschweigend überschreiben

## 4.0.0

- Oberfläche mit neuem Zeitwerk-Zeichen, lesbarerem Timer, modernem Zeitkonto und vier kompakten Schnellwerten überarbeitet
- eigene Arbeitszeit je Wochentag statt eines gleichmäßig verteilten Tagesziels ergänzt
- normales Tracking verwendet jetzt B für Büro/Arbeit; X verbucht gezielt ein vollständig erfülltes Tagesziel
- bestehende getrackte X-Einträge werden beim Update automatisch verlustfrei zu B migriert
- Urlaubsanspruch kann jetzt für jedes Kalenderjahr separat festgelegt werden
- Brutto-Stundenlohn, laufender Tagesverdienst und Jahresverdienst ergänzt
- optionale, abwechslungsreiche Motivations-Mitteilungen bei 25, 50 und 75 Prozent des Tagesziels ergänzt
- Live Activity wird beim Arbeitsende mit einem abschließenden Löschbefehl zuverlässig geschlossen
- Auswertung um Wochentag-Durchschnitte, Zielquote, erreichte Ziele und aktuelle/beste Serie erweitert

## 3.3.1

- Deep Links der Live Activity und Abschlussmeldung auf den korrekten Pfad `/app/local_zeitwerk` umgestellt
- Apple-Watch-/Smart-Stack-Ansicht zeigt jetzt die laufende Arbeits- beziehungsweise Pausenzeit
- statischen Fortschrittswert entfernt, da dieser im kompakten Watch-Layout den Chronometer vollständig verdrängt hat

## 3.3.0

- nach dem Beenden der Arbeit wird automatisch eine Push-Zusammenfassung gesendet
- Abschlussmeldung enthält Beginn, Ende, Nettoarbeitszeit und gesamte erfasste Pause
- Zusammenfassung erhält ein eigenes grünes Abschluss-Icon und öffnet beim Antippen Zeitwerk

## 3.2.3

- Dynamic-Island-Unterzeile auf einen kurzen Status wie „Arbeit“, „Homeoffice“ oder „Pause“ reduziert
- Statusfeld der normalen Live Activity zeigt die voraussichtliche frühestmögliche Endzeit
- Endzeit berücksichtigt verbleibende Nettoarbeitszeit und die noch notwendige qualifizierte Mindestpause

## 3.2.2

- irreführenden statischen „übrig“-Text aus der Live Activity entfernt
- laufender Timer bleibt zuverlässig die bereits geleistete Nettoarbeitszeit
- Live-Activity-Inhalt für die festen Sperrbildschirm-, Dynamic-Island- und Watch-Darstellungen reduziert

## 3.2.1

- große Live-Activity-Zeit zeigt während der Arbeit wieder die bereits geleistete Nettoarbeitszeit
- verbleibende Zeit bis zum Tagesziel wird als „übrig“ im Status der Fortschrittsanzeige mitgegeben
- Tagesziel-Fortschritt bleibt auch nach Erreichen des Ziels vollständig gefüllt

## 3.2.0

- Live Activity zeigt während der Arbeit die verbleibende Zeit bis zum Tagesziel als Countdown
- neues reduziertes Live-Activity-Design in dunklem Petrol mit Mint-Akzent; Pausen werden in dunklem Blau dargestellt
- Fortschrittsanzeige für Tagesziel und erforderliche Gesamtpause ergänzt
- Pausentimer übernimmt bereits absolvierte Pausen und läuft bei einer weiteren Pause am Gesamtstand weiter
- Timer-Hinweis in der Weboberfläche zeigt jetzt die verbleibende Zeit statt „läuft seit“
- Icon im Verbindungstest durch kontrastreiche weiße Darstellung korrigiert

## 3.1.0

- Live Activity stärker am kompakten Timer-Stil ausgerichtet: Startzeit, Arbeitsart, laufender Timer und klarer Status
- Arbeitsstatus in Türkis, Pausenstatus in Blau sowie dunkler Hintergrund passend zur Zeitwerk-Oberfläche
- Antippen der Live Activity öffnet Zeitwerk direkt im Home-Assistant-Ingress
- Tagespfeile wechseln den Tag jetzt ohne Sprung an den Seitenanfang
- technische Einschränkung direkter Live-Activity-Buttons in der Oberfläche erklärt

## 3.0.0

- Oberfläche vollständig auf einen klaren Arbeitszeit-Timer mit kontextabhängigen Aktionen reduziert
- neues ruhiges, modernes Layout für Smartphone, Tablet und Desktop
- Tagesansicht, Kalender, Auswertung und Einstellungen visuell vereinheitlicht
- optionale Live Activity über die Home-Assistant-Companion-App ergänzt
- Live Activity reagiert auf Start, Pause, Fortsetzen und Arbeitsende ohne sekündliche Push-Nachrichten
- Verbindungstest und verständliche Einrichtung direkt in den Einstellungen

## 2.4.0

- Wiederherstellung der vom Home-Assistant-Supervisor erwarteten isolierten Netzwerkstruktur
- problematisches `host_network` vollständig entfernt
- Direktzugriff wird wieder über die offizielle Portzuordnung `8099/tcp → 18099` bereitgestellt
- Architekturfilter wieder auf `aarch64`, `amd64`, `armhf`, `armv7` und `i386` erweitert, damit die lokale App auf dem vorhandenen System nicht aus dem Store ausgeblendet wird
- lokale App-Definition auf die bereits funktionierende 2.2-Struktur zurückgeführt und von optionalen Metadaten bereinigt

## 2.3.0

- fester Direktzugriff über `http://HOME-ASSISTANT-IP:18099` ohne Konfigurationsseite
- Zeitwerk bindet den Direktport selbst über das Host-Netzwerk
- Home Assistant Ingress bleibt parallel erhalten

## 2.2.0

- gelbgrüne Akzentfarbe vollständig durch eine ruhige Türkis-Navy-Farbwelt ersetzt
- Timer, Schaltflächen, Diagramme, Auswahlzustände und Dark Mode farblich vereinheitlicht
- direkter Netzwerkzugriff nutzt standardmäßig den weniger konfliktanfälligen Host-Port `18099`
- LAN- und private VPN-Zugriffe werden nicht mehr durch eine zusätzliche Adressprüfung verworfen
- klarere Netzwerkanleitung direkt in den Einstellungen

## 2.1.0

- neue Tagesansicht mit Vor- und Zurückblättern durch alle vergangenen Tage
- schneller Sprung zurück zu heute
- Beginn, Ende, gesamte Pause und Arbeitszeit werden für den ausgewählten Tag angezeigt
- Klick auf einen Kalendertag öffnet dessen Tagesansicht statt sofort den Bearbeitungsdialog
- ausgewählter Tag und zugehörige Woche werden sichtbar hervorgehoben

## 2.0.0

- vollständig neue, mobile-first Oberfläche mit ruhiger Instrumentenansicht
- pro Kalendertag wird serverseitig genau ein Arbeitszeiteintrag zugelassen
- gestoppte Arbeitszeit kann am selben Tag über „Weiterarbeiten“ fortgesetzt werden
- Unterbrechungen zwischen Stoppen und Weiterarbeiten werden automatisch als Nichtarbeitszeit berücksichtigt
- klar gekennzeichneter manueller Modus zum Nachtragen und Korrigieren
- optionaler direkter LAN-Zugriff über Port 8099 für eine eigenständige iPhone-Web-App ohne Home-Assistant-Rahmen
- bestehende getrennte Alt-Einträge eines Tages werden beim Upgrade schonend zu einem Tagesdatensatz zusammengeführt

## 1.4.0

- manuelle Arbeitszeit wird mit tatsächlichem Arbeitsbeginn und Arbeitsende erfasst
- Pausendauer wird einheitlich als `HH:MM` eingegeben und angezeigt, zum Beispiel `00:30` oder `01:00`
- Beginn und Ende stehen direkt in der Hauptansicht
- CSV-Export verwendet für Pause und Arbeitszeit ebenfalls das Format `HH:MM`
- Eingaben werden auf plausible Pausendauer geprüft

## 1.3.0

- Hauptansicht konsequent auf Arbeits- und Pausenzeiterfassung reduziert
- zwei getrennte, sekundengenaue Live-Zähler für Arbeit und Pause
- jederzeit sichtbare Start- und Stopp-Tasten für beide Zeitarten
- eindeutige Sperrzustände verhindern unzulässige Bedienfolgen
- Timer-Ereignisse werden sekundengenau und weiterhin sofort gespeichert

## 1.2.0

- vollständiger Dark Mode mit den Optionen System, Hell und Dunkel
- installierbare Web-App-Metadaten für Safari und andere moderne Browser
- eigenes Home-Bildschirm-Icon und Vollbilddarstellung auf iPhone/iPad
- Offline-App-Hülle mit sicherem Netzwerkverhalten für Zeitbuchungen
- Installationshinweis für Nabu Casa direkt in den Einstellungen

## 1.1.0

- Timer-Ablauf als Hauptfunktion klarer beschriftet
- Tagesabschluss zeigt Beginn, Ende, gesamte Pause und reine Arbeitszeit
- Mindestpausenregel direkt am Timer sichtbar
- Urlaub, Krankheit und Sonderurlaub werden nicht mehr als Arbeitszeit summiert
- SQLite auf WAL und vollständige Synchronisation gehärtet
- atomare Sicherheitskopie nach jeder Änderung und automatische Wiederherstellung
- verständliche Verbindungsanzeige statt allgemeinem „failed to fetch"

## 1.0.0

- Erste vollständige Version
- Live-Timer mit Pause und Arbeitsort
- Kalender mit acht Zeitkürzeln
- gesetzliche Pausenprüfung für Voll- und Minderjährige
- Wochen- und Jahresauswertung
- Urlaub, Homeoffice und Pendeltage
- CSV-Export und JSON-Sicherung
- responsive Oberfläche für Smartphone, Tablet und Desktop

#!/usr/bin/env python3
"""Small, dependency-free backend for the Zeitwerk Home Assistant add-on."""

from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DATA_DIR = Path(os.environ.get("DATA_DIR", APP_DIR.parent / "data"))
DB_PATH = DATA_DIR / "zeitwerk.db"
SAFETY_PATH = DATA_DIR / "zeitwerk-safety.db"
PRE_V4_PATH = DATA_DIR / "zeitwerk-pre-v4.db"
PRE_G_MIGRATION_PATH = DATA_DIR / "zeitwerk-pre-g-migration.db"
PORT = int(os.environ.get("PORT", "8099"))
DB_LOCK = threading.RLock()
HOLIDAY_LOCK = threading.RLock()
HOLIDAY_ATTEMPTS = {}
HOLIDAY_ERRORS = {}
GERMAN_STATES = {"BW": "Baden-Württemberg", "BY": "Bayern", "BE": "Berlin", "BB": "Brandenburg", "HB": "Bremen", "HH": "Hamburg", "HE": "Hessen", "MV": "Mecklenburg-Vorpommern", "NI": "Niedersachsen", "NW": "Nordrhein-Westfalen", "RP": "Rheinland-Pfalz", "SL": "Saarland", "SN": "Sachsen", "ST": "Sachsen-Anhalt", "SH": "Schleswig-Holstein", "TH": "Thüringen"}

DEFAULT_SETTINGS = {
    "display_name": "",
    "weekly_hours": 40,
    "workdays": [0, 1, 2, 3, 4],
    "daily_work_minutes": [480, 480, 480, 480, 480, 0, 0],
    "age_group": "adult",
    "vacation_allowance": 0,
    "vacation_allowance_by_year": {},
    "vacation_carryover": 0,
    "previous_balance_minutes": 0,
    "tracking_start_date": date.today().isoformat(),
    "auto_break_deduction": True,
    "theme": "system",
    "after_work_animation_enabled": True,
    "live_activity_enabled": False,
    "live_activity_service": "",
    "milestone_notifications_enabled": False,
    "milestone_notification_style": "saying_money",
    "goal_notification_enabled": True,
    "end_summary_enabled": True,
    "hourly_gross_eur": 0,
    "monthly_gross_eur": 0,
    "pause_minimum_notification_enabled": False,
    "pause_reminder_enabled": False,
    "end_soon_notification_enabled": False,
    "overtime_notification_enabled": False,
    "start_notification_enabled": False,
    "overtime_plan_by_date": {},
    "holidays_enabled": False,
    "holiday_state": "",
    "holiday_exclusions": [],
}

TYPE_LABELS = {
    "B": "Büro / Arbeit",
    "X": "Tagesziel erfüllt",
    "H": "Homeoffice",
    "FT": "Frei / Feiertag",
    "U": "Urlaub",
    "K": "Krankheit",
    "S": "Sonderurlaub",
    "F": "Flexzeit-Abbau",
    "A": "Überzeit abfeiern",
}
VALID_TYPES = set(TYPE_LABELS)
WORK_TYPES = ("B", "H")
LIVE_ACTIVITY_TAG = "zeitwerk_workday"
NOTIFICATION_ACCENT = "#55CCAD"


def normalized_notify_service(value: str) -> str:
    service = str(value or "").strip().lower()
    if service.startswith("notify."):
        service = service.split(".", 1)[1]
    if service and not re.fullmatch(r"mobile_app_[a-z0-9_]+", service):
        raise ValueError("Die Benachrichtigungs-Aktion muss mit mobile_app_ beginnen")
    return service


def zeitwerk_app_url() -> str:
    """Resolve the app panel for local and repository installations."""
    fallback = "/app/local_zeitwerk"
    token = os.environ.get("SUPERVISOR_TOKEN", "")
    if not token:
        return fallback
    request = Request(
        "http://supervisor/addons/self/info",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urlopen(request, timeout=2) as response:
            info = json.load(response).get("data", {})
        repository = str(info.get("repository") or "")
        slug = str(info.get("slug") or "")
        if re.fullmatch(r"[a-zA-Z0-9_-]+", repository) and re.fullmatch(r"[a-zA-Z0-9_-]+", slug):
            panel = slug if slug.startswith(repository + "_") else f"{repository}_{slug}"
            return f"/app/{panel}"
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, TypeError, AttributeError):
        pass
    return fallback


def call_home_assistant_notify(service: str, payload: dict) -> dict:
    """Send through Home Assistant without ever risking the time record itself."""
    token = os.environ.get("SUPERVISOR_TOKEN", "")
    if not token:
        return {"ok": False, "message": "Home-Assistant-API ist lokal nicht verfügbar"}
    try:
        service = normalized_notify_service(service)
    except ValueError as exc:
        return {"ok": False, "message": str(exc)}
    if not service:
        return {"ok": False, "message": "Keine mobile_app-Aktion eingetragen"}
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"http://supervisor/core/api/services/notify/{service}",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=4) as response:
            if response.status >= 300:
                return {"ok": False, "message": f"Home Assistant antwortet mit {response.status}"}
        return {"ok": True, "message": "An Home Assistant gesendet"}
    except HTTPError as exc:
        return {"ok": False, "message": f"Home Assistant lehnt die Aktion ab ({exc.code})"}
    except (URLError, TimeoutError, OSError):
        return {"ok": False, "message": "Home Assistant ist für die Live Activity nicht erreichbar"}


def clear_live_activity(service: str) -> dict:
    return call_home_assistant_notify(service, {
        "message": "clear_notification",
        "data": {"tag": LIVE_ACTIVITY_TAG},
    })


def retry_live_activity_clear(service: str) -> None:
    # A successful HA API response only means the command entered the push
    # queue. A later clear helps when iOS receives the first one out of order.
    try:
        if not active_entry(get_settings()):
            clear_live_activity(service)
    except Exception as exc:
        print(f"Zeitwerk Live Activity cleanup failed: {exc}", flush=True)


def schedule_live_activity_clear_retry(service: str) -> None:
    for delay in (10, 45):
        timer = threading.Timer(delay, retry_live_activity_clear, args=(service,))
        timer.daemon = True
        timer.start()


def signed_duration(minutes: int | float) -> str:
    amount = round(float(minutes or 0))
    sign = "+" if amount >= 0 else "−"
    return f"{sign}{format_duration(abs(amount))}"


def end_summary_payload(settings: dict, item: dict) -> dict:
    work_date = str(item.get("work_date") or date.today().isoformat())
    start_time = str(item.get("start_time") or "")[:5] or "–"
    end_time = str(item.get("end_time") or "")[:5] or "–"
    target = daily_target(settings, work_date)
    day_delta = int(item.get("account_minutes", 0) or 0) - target
    year_start = f"{work_date[:4]}-01-01"
    entries = list_entries(year_start, work_date, settings)
    balance = summary_for(entries, settings, year_start, work_date)["balance_minutes"]
    if work_date[:4] == str(date.today().year):
        balance += int(settings.get("previous_balance_minutes", 0) or 0)
    comparison = f"Heute {signed_duration(day_delta)} zum Soll · Konto {signed_duration(balance)}"
    if has_gross_setting(settings):
        earned = estimated_gross(settings, work_date, item.get("worked_minutes", 0))
        comparison += f" · {format_currency_eur(earned)} brutto"
    return {
        "title": "Zeitwerk · Feierabend",
        "message": comparison,
        "data": {
            "tag": f"zeitwerk_summary_{re.sub(r'[^0-9]', '', work_date)}",
            "subtitle": f"{start_time}–{end_time} · {summary_duration(item.get('worked_minutes', 0))} Arbeit · {summary_duration(item.get('recorded_break_minutes', 0))} Pause",
            "notification_icon": "mdi:check-bold",
            "notification_icon_color": "#FFFFFF",
            "color": NOTIFICATION_ACCENT,
            "url": zeitwerk_app_url(),
        },
    }


def sync_live_activity(settings: dict, phase: str, entry: dict | None = None) -> dict:
    service = settings.get("live_activity_service", "")
    if phase == "stop":
        if not service:
            return {"ok": True, "configured": False}
        clear_result = {"ok": True, "enabled": False}
        if settings.get("live_activity_enabled"):
            clear_result = clear_live_activity(service)
            schedule_live_activity_clear_retry(service)
        summary_result = {"ok": True, "enabled": False}
        if settings.get("end_summary_enabled", True):
            if settings.get("live_activity_enabled"):
                time.sleep(0.6)
            summary_result = call_home_assistant_notify(service, end_summary_payload(settings, entry or {}))
        return {
            "ok": bool(clear_result.get("ok") and summary_result.get("ok")),
            "cleared": clear_result,
            "summary": summary_result,
        }

    if not settings.get("live_activity_enabled"):
        return {"ok": True, "enabled": False}

    paused = phase == "pause"
    item = entry or {}
    net_work_seconds = max(0, int(item.get("net_work_seconds", 0) or 0))
    break_seconds = max(0, int(item.get("recorded_break_seconds", 0) or 0))
    target_minutes = planned_target(settings, item.get("work_date"))
    target_seconds = max(60, target_minutes * 60)
    remaining_seconds = max(0, target_seconds - net_work_seconds)
    short_work_type = {
        "B": "Arbeit",
        "H": "Homeoffice",
    }.get(str(item.get("type") or "B"), "Arbeit")
    accent = "#7C9CFF" if paused else NOTIFICATION_ACCENT
    background = "#0B1220" if paused else "#071A1A"
    icon = "mdi:coffee-outline" if paused else "mdi:timer-outline"
    required_break_minutes = max(
        int(item.get("required_break_minutes", 0) or 0),
        minimum_break(target_minutes, settings.get("age_group", "adult")),
    )
    qualified_break_seconds = max(0, int(item.get("qualified_break_minutes", 0) or 0) * 60)
    remaining_required_break_seconds = max(0, required_break_minutes * 60 - qualified_break_seconds)
    expected_end = datetime.now() + timedelta(seconds=remaining_seconds + remaining_required_break_seconds)
    expected_end_label = expected_end.strftime("%H:%M Uhr")
    message = "Pause" if paused else short_work_type
    payload = {
        "title": "Zeitwerk",
        "message": message,
        "data": {
            "tag": LIVE_ACTIVITY_TAG,
            "live_update": True,
            "critical_text": expected_end_label if remaining_seconds or remaining_required_break_seconds else "Ziel erreicht",
            "notification_icon": icon,
            "notification_icon_color": accent,
            "color": accent,
            "background_color": background,
            "text_color": "#F7FAFB",
            "progress_bar_color": accent,
            "url": zeitwerk_app_url(),
            "relevance_score": 0.9,
            "alert_once": True,
        },
    }
    live_data = payload["data"]
    if paused:
        # A past reference makes iOS count up from all pauses already taken.
        # A later pause therefore continues at the accumulated total instead of 00:00.
        live_data.update({
            "chronometer": True,
            "when": int(time.time()) - break_seconds,
            "when_relative": False,
        })
    else:
        # A past absolute reference renders the already completed net working
        # time as a device-side count-up without per-second push messages.
        live_data.update({
            "chronometer": True,
            "when": int(time.time()) - net_work_seconds,
            "when_relative": False,
        })
    return call_home_assistant_notify(service, payload)


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=10, factory=ClosingConnection)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=10000")
    con.execute("PRAGMA synchronous=FULL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def recover_database_if_needed() -> None:
    """Restore the latest safety copy if SQLite reports corruption after a crash."""
    if not DB_PATH.exists():
        return
    healthy = False
    try:
        con = sqlite3.connect(DB_PATH, timeout=5)
        try:
            healthy = con.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        finally:
            con.close()
    except sqlite3.Error:
        healthy = False
    if healthy or not SAFETY_PATH.exists():
        return
    damaged = DATA_DIR / f"zeitwerk-damaged-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    os.replace(DB_PATH, damaged)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{DB_PATH}{suffix}")
        if sidecar.exists():
            os.replace(sidecar, DATA_DIR / f"{damaged.name}{suffix}")
    shutil.copy2(SAFETY_PATH, DB_PATH)


def create_safety_backup() -> None:
    """Create an atomic, consistent second copy after every committed change."""
    temp_path = DATA_DIR / "zeitwerk-safety.tmp"
    with DB_LOCK:
        if temp_path.exists():
            temp_path.unlink()
        source = db()
        target = sqlite3.connect(temp_path)
        try:
            source.backup(target)
            target.commit()
        finally:
            target.close()
            source.close()
        os.replace(temp_path, SAFETY_PATH)


def preserve_pre_v4_database() -> None:
    """Keep the original database before the first 4.0 schema/data migration."""
    if not DB_PATH.exists() or PRE_V4_PATH.exists():
        return
    temp_path = DATA_DIR / "zeitwerk-pre-v4.tmp"
    with DB_LOCK:
        source = db()
        target = sqlite3.connect(temp_path)
        try:
            source.backup(target)
            target.commit()
        finally:
            target.close()
            source.close()
        os.replace(temp_path, PRE_V4_PATH)


def preserve_legacy_g_database() -> None:
    """Keep an untouched backup before converting historical G entries to B."""
    if not DB_PATH.exists() or PRE_G_MIGRATION_PATH.exists():
        return
    with DB_LOCK:
        source = db()
        try:
            try:
                has_g = source.execute("SELECT 1 FROM entries WHERE type='G' LIMIT 1").fetchone()
            except sqlite3.Error:
                has_g = None
            if not has_g:
                return
            temp_path = DATA_DIR / "zeitwerk-pre-g-migration.tmp"
            target = sqlite3.connect(temp_path)
            try:
                source.backup(target)
                target.commit()
            finally:
                target.close()
            os.replace(temp_path, PRE_G_MIGRATION_PATH)
        finally:
            source.close()


def merge_duplicate_workdays(con: sqlite3.Connection) -> None:
    """Collapse legacy split shifts so one work row remains per calendar day."""
    duplicate_dates = con.execute(
        """SELECT work_date FROM entries
        WHERE type IN ('B','H')
        GROUP BY work_date HAVING COUNT(*) > 1"""
    ).fetchall()
    for result in duplicate_dates:
        rows = con.execute(
            """SELECT * FROM entries WHERE work_date=? AND type IN ('B','H')
            ORDER BY start_time, id""",
            (result["work_date"],),
        ).fetchall()
        keep = rows[0]
        starts = [row["start_time"] for row in rows if row["start_time"]]
        finished_ends = [row["end_time"] for row in rows if row["end_time"]]
        has_active = any(row["start_time"] and not row["end_time"] for row in rows)
        merged_breaks = []
        manual_break = 0
        notes = []
        previous_end = None
        for row in rows:
            row_start = row["start_time"]
            if previous_end and row_start:
                previous_seconds = parse_clock_seconds(previous_end)
                start_seconds = parse_clock_seconds(row_start)
                if previous_seconds is not None and start_seconds is not None and start_seconds > previous_seconds:
                    merged_breaks.append({"start": previous_end, "end": row_start})
            try:
                merged_breaks.extend(json.loads(row["breaks_json"] or "[]"))
            except json.JSONDecodeError:
                pass
            manual_break += max(0, int(row["manual_break_minutes"] or 0))
            if row["note"] and row["note"] not in notes:
                notes.append(row["note"])
            if row["end_time"]:
                if previous_end is None or (parse_clock_seconds(row["end_time"]) or 0) > (parse_clock_seconds(previous_end) or 0):
                    previous_end = row["end_time"]
        con.execute(
            """UPDATE entries SET start_time=?, end_time=?, manual_break_minutes=?, breaks_json=?,
            note=?, commute=?, finalized=?, updated_at=? WHERE id=?""",
            (
                min(starts) if starts else None,
                None if has_active else (max(finished_ends) if finished_ends else None),
                min(600, manual_break),
                json.dumps(merged_breaks),
                " · ".join(notes)[:500],
                1 if any(row["commute"] for row in rows) else 0,
                0 if has_active else 1 if finished_ends else 0,
                max(row["updated_at"] for row in rows),
                keep["id"],
            ),
        )
        con.execute(
            f"DELETE FROM entries WHERE id IN ({','.join('?' for _ in rows[1:])})",
            [row["id"] for row in rows[1:]],
        )


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    recover_database_if_needed()
    preserve_pre_v4_database()
    preserve_legacy_g_database()
    with DB_LOCK, db() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA wal_autocheckpoint=100")
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_date TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'B',
                start_time TEXT,
                end_time TEXT,
                manual_break_minutes INTEGER NOT NULL DEFAULT 0,
                breaks_json TEXT NOT NULL DEFAULT '[]',
                note TEXT NOT NULL DEFAULT '',
                commute INTEGER NOT NULL DEFAULT 0,
                finalized INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(work_date);
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS milestone_notifications (
                entry_id INTEGER NOT NULL,
                milestone INTEGER NOT NULL,
                sent_at TEXT NOT NULL,
                PRIMARY KEY(entry_id, milestone),
                FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS holiday_cache (
                state TEXT NOT NULL,
                year INTEGER NOT NULL,
                holidays_json TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY(state, year)
            );
            """
        )
        con.execute("DROP INDEX IF EXISTS idx_entries_one_work_per_day")
        columns = {row[1] for row in con.execute("PRAGMA table_info(entries)")}
        if "extra_work_minutes" not in columns:
            con.execute("ALTER TABLE entries ADD COLUMN extra_work_minutes INTEGER NOT NULL DEFAULT 0")
        if "finalized" not in columns:
            con.execute("ALTER TABLE entries ADD COLUMN finalized INTEGER NOT NULL DEFAULT 0")
            con.execute("UPDATE entries SET finalized=1 WHERE (type IN ('B','H','G') OR (type='X' AND start_time IS NOT NULL)) AND end_time IS NOT NULL")
        # Before 4.0, X meant ordinary tracked work. Keep those records intact
        # while reserving X from now on for a completed daily target credit.
        con.execute("UPDATE entries SET type='B' WHERE type='X' AND start_time IS NOT NULL")
        con.execute(
            """UPDATE entries SET type='B',
            note=substr(CASE WHEN note='' THEN 'Geschäftlich (früher G)'
            WHEN instr(note, 'Geschäftlich (früher G)')>0 THEN note
            ELSE 'Geschäftlich (früher G) · ' || note END, 1, 500)
            WHERE type='G'"""
        )
        if not con.execute("SELECT 1 FROM settings WHERE key='daily_work_minutes'").fetchone():
            raw_hours = con.execute("SELECT value FROM settings WHERE key='weekly_hours'").fetchone()
            raw_days = con.execute("SELECT value FROM settings WHERE key='workdays'").fetchone()
            try:
                weekly_hours = float(json.loads(raw_hours[0])) if raw_hours else DEFAULT_SETTINGS["weekly_hours"]
                workdays = [int(day) for day in json.loads(raw_days[0])] if raw_days else [0, 1, 2, 3, 4]
            except (TypeError, ValueError, json.JSONDecodeError):
                weekly_hours, workdays = DEFAULT_SETTINGS["weekly_hours"], DEFAULT_SETTINGS["workdays"]
            per_day = round(weekly_hours * 60 / max(1, len(workdays)))
            migrated_targets = [per_day if day in workdays else 0 for day in range(7)]
            con.execute(
                "INSERT INTO settings(key, value) VALUES ('daily_work_minutes', ?)",
                (json.dumps(migrated_targets),),
            )
        for key, value in DEFAULT_SETTINGS.items():
            con.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
                (key, json.dumps(value, ensure_ascii=False)),
            )
        merge_duplicate_workdays(con)
        con.execute(
            """CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_one_work_per_day
            ON entries(work_date) WHERE type IN ('B','H')"""
        )
        con.execute("PRAGMA optimize")
    create_safety_backup()


def get_settings() -> dict:
    result = DEFAULT_SETTINGS.copy()
    with DB_LOCK, db() as con:
        for row in con.execute("SELECT key, value FROM settings"):
            try:
                result[row["key"]] = json.loads(row["value"])
            except json.JSONDecodeError:
                pass
    return result


def daily_targets(settings: dict) -> list[int]:
    configured = settings.get("daily_work_minutes")
    if isinstance(configured, list) and len(configured) == 7:
        try:
            return [max(0, min(24 * 60, int(value or 0))) for value in configured]
        except (TypeError, ValueError):
            pass
    workdays = {int(day) for day in settings.get("workdays", DEFAULT_SETTINGS["workdays"])}
    per_day = round(float(settings.get("weekly_hours", DEFAULT_SETTINGS["weekly_hours"])) * 60 / max(1, len(workdays)))
    return [per_day if day in workdays else 0 for day in range(7)]


def daily_target(settings: dict, day_value=None) -> int:
    if isinstance(day_value, int):
        weekday = day_value
    else:
        try:
            chosen = date.fromisoformat(str(day_value)[:10]) if day_value else date.today()
        except ValueError:
            chosen = date.today()
        weekday = chosen.weekday()
    return daily_targets(settings)[weekday % 7]


def monthly_workdays(settings: dict, day_value: str) -> int:
    chosen = date.fromisoformat(str(day_value)[:10])
    first = chosen.replace(day=1)
    next_month = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    return sum(daily_target(settings, first + timedelta(days=offset)) > 0
               for offset in range((next_month - first).days))


def has_gross_setting(settings: dict) -> bool:
    return float(settings.get("monthly_gross_eur", 0) or 0) > 0 or float(settings.get("hourly_gross_eur", 0) or 0) > 0


def estimated_gross(settings: dict, day_value: str, worked_minutes: int | float) -> float:
    monthly = max(0, float(settings.get("monthly_gross_eur", 0) or 0))
    if monthly:
        target = daily_target(settings, day_value)
        if target <= 0:
            return 0.0
        daily_amount = monthly / max(1, monthly_workdays(settings, day_value))
        return round(daily_amount * min(1, max(0, float(worked_minutes or 0)) / target), 2)
    hourly = max(0, float(settings.get("hourly_gross_eur", 0) or 0))
    return round(max(0, float(worked_minutes or 0)) / 60 * hourly, 2)


def vacation_allowance_for(settings: dict, year: int) -> float:
    values = settings.get("vacation_allowance_by_year", {})
    if isinstance(values, dict):
        value = values.get(str(year), values.get(year))
        if value is not None:
            try:
                return max(0, float(value))
            except (TypeError, ValueError):
                pass
    return max(0, float(settings.get("vacation_allowance", DEFAULT_SETTINGS["vacation_allowance"]) or 0))


def planned_target(settings: dict, day_value=None) -> int:
    key = str(day_value or date.today().isoformat())[:10]
    plans = settings.get("overtime_plan_by_date") or {}
    return daily_target(settings, key) + max(0, min(720, int(plans.get(key, 0) or 0)))


def cached_holidays(settings: dict, year: int) -> list[dict]:
    state = settings.get("holiday_state", "")
    if state not in GERMAN_STATES:
        return []
    with DB_LOCK, db() as con:
        row = con.execute("SELECT holidays_json FROM holiday_cache WHERE state=? AND year=?", (state, year)).fetchone()
    try:
        return json.loads(row[0]) if row else []
    except json.JSONDecodeError:
        return []


def holiday_dates(settings: dict, year: int) -> dict[str, str]:
    if not settings.get("holidays_enabled"):
        return {}
    excluded = set(settings.get("holiday_exclusions") or [])
    return {item["date"]: item["name"] for item in cached_holidays(settings, year) if item["date"] not in excluded}


def refresh_holidays(settings: dict, year: int, force: bool = False) -> bool:
    state = settings.get("holiday_state", "")
    if not settings.get("holidays_enabled") or state not in GERMAN_STATES or not 2000 <= year <= 2100:
        return False
    key = (state, year)
    with HOLIDAY_LOCK:
        with DB_LOCK, db() as con:
            row = con.execute("SELECT fetched_at FROM holiday_cache WHERE state=? AND year=?", key).fetchone()
        if not force:
            try:
                if row and datetime.now() - datetime.fromisoformat(row[0]).replace(tzinfo=None) < timedelta(days=7):
                    return True
            except ValueError:
                pass
            if time.monotonic() - HOLIDAY_ATTEMPTS.get(key, -10000) < 300:
                return bool(row)
        HOLIDAY_ATTEMPTS[key] = time.monotonic()
        query = urlencode({"countryIsoCode": "DE", "subdivisionCode": f"DE-{state}", "languageIsoCode": "DE", "validFrom": f"{year}-01-01", "validTo": f"{year}-12-31"})
        try:
            request = Request("https://openholidaysapi.org/PublicHolidays?" + query, headers={"Accept": "application/json", "User-Agent": "Zeitwerk"})
            with urlopen(request, timeout=4) as response:
                raw = json.load(response)
            if not isinstance(raw, list) or not raw:
                raise ValueError("Für dieses Jahr wurden keine Feiertage geliefert")
            holidays = {}
            for item in raw:
                if item.get("regionalScope") == "Local" or item.get("temporalScope") != "FullDay":
                    continue
                names = item.get("name") or []
                name = next((str(name.get("text", "")) for name in names if name.get("language") == "DE"), "Feiertag")[:160]
                first, last = date.fromisoformat(item["startDate"]), date.fromisoformat(item["endDate"])
                # In Bavaria this only applies in certain municipalities.
                if state == "BY" and first.month == 8 and first.day == 15:
                    continue
                if first.year != year or last.year != year or (last - first).days > 7:
                    continue
                for offset in range((last - first).days + 1):
                    holidays[(first + timedelta(days=offset)).isoformat()] = name
            if not holidays:
                raise ValueError("Keine passenden Feiertage gefunden")
            with DB_LOCK, db() as con:
                con.execute("INSERT INTO holiday_cache(state,year,holidays_json,fetched_at) VALUES(?,?,?,?) ON CONFLICT(state,year) DO UPDATE SET holidays_json=excluded.holidays_json,fetched_at=excluded.fetched_at", (state, year, json.dumps([{"date": day, "name": name} for day, name in sorted(holidays.items())], ensure_ascii=False), datetime.now().isoformat(timespec="seconds")))
            HOLIDAY_ERRORS.pop(key, None)
            create_safety_backup()
            return True
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as exc:
            HOLIDAY_ERRORS[key] = "Feiertage konnten nicht aktualisiert werden. Bereits gespeicherte Daten bleiben verfügbar."
            return bool(row)


def holiday_status(settings: dict, year: int) -> dict:
    state = settings.get("holiday_state", "")
    with DB_LOCK, db() as con:
        row = con.execute("SELECT fetched_at FROM holiday_cache WHERE state=? AND year=?", (state, year)).fetchone()
    return {"year": year, "state": state, "state_name": GERMAN_STATES.get(state, ""), "fetched_at": row[0] if row else None, "error": HOLIDAY_ERRORS.get((state, year)), "holidays": cached_holidays(settings, year)}


def parse_time(value: str | None) -> int | None:
    if not value or not re.fullmatch(r"\d{2}:\d{2}(?::\d{2})?", value):
        return None
    hours, minutes, *_ = map(int, value.split(":"))
    if hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes


def parse_clock_seconds(value: str | None) -> int | None:
    if not value or not re.fullmatch(r"\d{2}:\d{2}(?::\d{2})?", value):
        return None
    parts = list(map(int, value.split(":")))
    hours, minutes = parts[:2]
    seconds = parts[2] if len(parts) == 3 else 0
    if hours > 23 or minutes > 59 or seconds > 59:
        return None
    return hours * 3600 + minutes * 60 + seconds


def parse_duration(value: str | None) -> int | None:
    if value is None or not re.fullmatch(r"\d{1,3}:\d{2}", str(value)):
        return None
    hours, minutes = map(int, str(value).split(":"))
    if minutes > 59:
        return None
    return hours * 60 + minutes


def format_duration(minutes: int | float) -> str:
    safe = max(0, round(float(minutes or 0)))
    return f"{safe // 60:02d}:{safe % 60:02d}"


def summary_duration(minutes: int | float) -> str:
    safe = max(0, round(float(minutes or 0)))
    hours, rest = divmod(safe, 60)
    if hours and rest:
        return f"{hours} Std. {rest} Min."
    if hours:
        return f"{hours} Std."
    return f"{rest} Min."


def format_currency_eur(value: int | float) -> str:
    return f"{max(0, float(value or 0)):,.2f}".replace(",", "_").replace(".", ",").replace("_", ".") + " €"


def segment_durations(segments: list, now_minutes: int | None = None) -> list[int]:
    durations = []
    for segment in segments:
        start = parse_time(segment.get("start"))
        end = parse_time(segment.get("end"))
        if start is None:
            continue
        if end is None:
            end = now_minutes
        if end is not None:
            durations.append(max(0, end - start))
    return durations


def minimum_break(work_minutes: int, age_group: str) -> int:
    if age_group == "minor":
        if work_minutes > 6 * 60:
            return 60
        if work_minutes > 4.5 * 60:
            return 30
        return 0
    if work_minutes > 9 * 60:
        return 45
    if work_minutes > 6 * 60:
        return 30
    return 0


def serialize_entry(row: sqlite3.Row | dict, settings: dict) -> dict:
    item = dict(row)
    try:
        breaks = json.loads(item.get("breaks_json") or "[]")
    except json.JSONDecodeError:
        breaks = []
    start = parse_time(item.get("start_time"))
    end = parse_time(item.get("end_time"))
    today = item["work_date"] == date.today().isoformat()
    if end is None and today and start is not None:
        now = datetime.now()
        end_for_calc = now.hour * 60 + now.minute
    else:
        end_for_calc = end
    elapsed = max(0, (end_for_calc or 0) - (start or 0)) if start is not None and end_for_calc is not None else 0
    start_seconds = parse_clock_seconds(item.get("start_time"))
    end_seconds = parse_clock_seconds(item.get("end_time"))
    if end_seconds is None and today and start_seconds is not None:
        current = datetime.now()
        end_seconds = current.hour * 3600 + current.minute * 60 + current.second
    elapsed_seconds = max(0, (end_seconds or 0) - (start_seconds or 0)) if start_seconds is not None and end_seconds is not None else 0
    live_now = None
    if today:
        current = datetime.now()
        live_now = current.hour * 60 + current.minute
    manual_break = max(0, int(item.get("manual_break_minutes") or 0))
    durations = segment_durations(breaks, live_now)
    recorded_break_seconds = manual_break * 60
    for segment in breaks:
        segment_start = parse_clock_seconds(segment.get("start"))
        segment_end = parse_clock_seconds(segment.get("end"))
        if segment_end is None and today:
            current = datetime.now()
            segment_end = current.hour * 3600 + current.minute * 60 + current.second
        if segment_start is not None and segment_end is not None:
            if segment_end < segment_start:
                segment_end += 24 * 3600
            recorded_break_seconds += max(0, segment_end - segment_start)
    recorded = manual_break + sum(durations)
    raw_work = max(0, elapsed - recorded)
    required = minimum_break(raw_work, settings.get("age_group", "adult"))
    qualified = (manual_break if manual_break >= 15 else 0) + sum(duration for duration in durations if duration >= 15)
    missing = 0 if qualified >= required else max(15, required - qualified)
    applied = recorded + missing if settings.get("auto_break_deduction", True) else recorded
    entry_type = item.get("type", "B")
    target = daily_target(settings, item.get("work_date"))
    worked = max(0, elapsed - applied) if entry_type in WORK_TYPES else (target + max(0, int(item.get("extra_work_minutes") or 0)) if entry_type == "X" else 0)
    credited = target if entry_type in {"U", "K", "S", "FT"} else 0
    account = worked + credited
    item.update(
        {
            "breaks": breaks,
            "recorded_break_minutes": recorded,
            "break_duration": format_duration(recorded),
            "qualified_break_minutes": qualified,
            "required_break_minutes": required,
            "missing_break_minutes": missing,
            "applied_break_minutes": applied,
            "worked_minutes": worked,
            "credited_minutes": credited,
            "account_minutes": account,
            "estimated_gross_eur": estimated_gross(settings, item["work_date"], worked + credited if settings.get("monthly_gross_eur") else worked),
            "elapsed_minutes": elapsed,
            "elapsed_seconds": elapsed_seconds,
            "recorded_break_seconds": recorded_break_seconds,
            "net_work_seconds": max(0, elapsed_seconds - recorded_break_seconds),
            "is_running": bool(start is not None and end is None and entry_type in WORK_TYPES),
            "is_paused": any(segment.get("end") is None for segment in breaks),
            "finalized": bool(item.get("finalized")),
            "type_label": TYPE_LABELS.get(entry_type, entry_type),
        }
    )
    item.pop("breaks_json", None)
    return item


def list_entries(start_date: str, end_date: str, settings: dict) -> list[dict]:
    with DB_LOCK, db() as con:
        rows = con.execute(
            "SELECT * FROM entries WHERE work_date BETWEEN ? AND ? ORDER BY work_date DESC, start_time DESC, id DESC",
            (start_date, end_date),
        ).fetchall()
    entries = [serialize_entry(row, settings) for row in rows]
    occupied = {entry["work_date"] for entry in entries if entry["type"] != "U"}
    for year in range(int(start_date[:4]), int(end_date[:4]) + 1):
        for day, name in holiday_dates(settings, year).items():
            if not start_date <= day <= end_date or day in occupied:
                continue
            entries = [entry for entry in entries if not (entry["work_date"] == day and entry["type"] == "U")]
            entries.append(serialize_entry({"id": f"holiday-{day}", "work_date": day, "type": "FT", "note": name, "automatic_holiday": True, "holiday_name": name}, settings))
    return sorted(entries, key=lambda entry: (entry["work_date"], str(entry.get("start_time") or "")), reverse=True)


def active_entry(settings: dict) -> dict | None:
    with DB_LOCK, db() as con:
        row = con.execute(
            "SELECT * FROM entries WHERE end_time IS NULL AND start_time IS NOT NULL AND type IN ('B','H') ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return serialize_entry(row, settings) if row else None


def next_vacation(settings: dict) -> dict | None:
    today = date.today()
    with DB_LOCK, db() as con:
        rows = con.execute(
            "SELECT work_date FROM entries WHERE type='U' AND work_date>=? ORDER BY work_date",
            (today.isoformat(),),
        ).fetchall()
    dates = sorted({date.fromisoformat(row[0]) for row in rows if row[0] not in holiday_dates(settings, int(row[0][:4]))})
    if not dates:
        return None
    first = dates[0]
    last = first
    count = 1
    for upcoming in dates[1:]:
        next_workday = last + timedelta(days=1)
        while (daily_target(settings, next_workday.isoformat()) == 0 or next_workday.isoformat() in holiday_dates(settings, next_workday.year)) and next_workday < upcoming:
            next_workday += timedelta(days=1)
        if upcoming != next_workday:
            break
        last = upcoming
        count += 1
    return {"start_date": first.isoformat(), "end_date": last.isoformat(), "workdays": count, "days_until": (first - today).days}


def vacation_periods(settings: dict) -> list[dict]:
    with DB_LOCK, db() as con:
        rows = con.execute("SELECT work_date,note FROM entries WHERE type='U' ORDER BY work_date").fetchall()
        free_days = {row[0] for row in con.execute("SELECT work_date FROM entries WHERE type='FT'")}
    periods = []
    for row in rows:
        day = date.fromisoformat(row["work_date"])
        if row["work_date"] in holiday_dates(settings, day.year):
            continue
        previous = periods[-1] if periods else None
        expected = date.fromisoformat(previous["end_date"]) + timedelta(days=1) if previous else day
        while previous and expected < day and (daily_target(settings, expected.isoformat()) == 0 or expected.isoformat() in holiday_dates(settings, expected.year) or expected.isoformat() in free_days):
            expected += timedelta(days=1)
        if previous and expected == day and previous["note"] == row["note"]:
            previous["end_date"] = day.isoformat()
            previous["workdays"] += 1
            previous["dates"].append(day.isoformat())
        else:
            periods.append({"start_date": day.isoformat(), "end_date": day.isoformat(), "workdays": 1, "note": row["note"], "dates": [day.isoformat()]})
    return periods


MOTIVATION_SAYINGS = {
    25: ("Der Anfang ist gemacht – weiter so!", "Du bist gut im Rhythmus.", "Ein guter Start zählt.", "Ein Viertel ist geschafft. Schritt für Schritt.", "Deine erste Etappe steht.", "Schon einiges erledigt – das zählt.", "Du kommst voran. Bleib bei deinem Tempo.", "Ein guter Morgen wird ein guter Tag.", "Der erste Meilenstein gehört dir.", "Heute geht etwas weiter.", "Ein Viertel näher am Feierabend.", "Dein Einsatz macht sich bemerkbar."),
    50: ("Halbzeit – bleib dran!", "Du bist genau auf Kurs.", "Die zweite Hälfte kann kommen.", "Die Hälfte liegt schon hinter dir.", "Halb geschafft. Nimm dir einen Moment dafür.", "Dein Tag nimmt Form an.", "Bergfest! Weiter in deinem Tempo.", "Schon die Hälfte gesammelt.", "Eine solide erste Hälfte.", "Der Feierabend rückt näher.", "Viel geschafft, noch einiges möglich.", "Dein Fortschritt kann sich sehen lassen."),
    75: ("Der Endspurt beginnt!", "Das Ziel ist schon in Sicht.", "Stark geblieben – fast geschafft.", "Nur noch ein Viertel bis zum Tagesziel.", "Du hast heute schon viel geleistet.", "Drei Viertel im Kasten.", "Die letzte Etappe wartet.", "Fast am Ziel – entspannt weiter.", "Das meiste liegt hinter dir.", "Dein Feierabend ist in Reichweite.", "Ein guter Tag geht auf die Zielgerade.", "Noch ein Stück, dann ist das Soll geschafft."),
}


def progress_notification_payload(settings: dict, item: dict, milestone: int) -> dict:
    if milestone == 100:
        return {
            "title": "Zeitwerk · Tagesziel erreicht",
            "message": f"Dein Soll von {format_duration(daily_target(settings, item['work_date']))} Std. ist geschafft. Ab jetzt sammelst du Pluszeit.",
            "data": {
                "tag": f"zeitwerk_goal_{item['id']}",
                "notification_icon": "mdi:check-circle-outline",
                "notification_icon_color": "#FFFFFF",
                "color": NOTIFICATION_ACCENT,
                "url": zeitwerk_app_url(),
            },
        }
    style = settings.get("milestone_notification_style", "saying_money")
    sayings = MOTIVATION_SAYINGS[milestone]
    saying = sayings[(int(item["id"]) + date.fromisoformat(item["work_date"]).toordinal() + milestone) % len(sayings)]
    if style == "percent":
        title, message = "Zeitwerk · Fortschritt", f"{milestone} % deines Tagesziels geschafft."
    elif style == "saying":
        title, message = "Zeitwerk · Motivation", saying
    else:
        title, message = f"Zeitwerk · {milestone} %", saying
        if has_gross_setting(settings):
            earned = estimated_gross(settings, item["work_date"], item.get("worked_minutes", 0))
            message += f" Heute verdient: ca. {format_currency_eur(earned)} brutto."
    return {
        "title": title,
        "message": message,
        "data": {
            "tag": f"zeitwerk_milestone_{item['id']}_{milestone}",
            "notification_icon": "mdi:progress-clock",
            "notification_icon_color": "#FFFFFF",
            "color": NOTIFICATION_ACCENT,
            "url": zeitwerk_app_url(),
        },
    }


def send_progress_notifications(settings: dict, item: dict, *, goal_only: bool = False) -> None:
    service = settings.get("live_activity_service", "")
    if not service:
        return
    milestones = [] if goal_only or not settings.get("milestone_notifications_enabled") else [25, 50, 75]
    if settings.get("goal_notification_enabled", True):
        milestones.append(100)
    if not milestones:
        return
    target = daily_target(settings, item.get("work_date"))
    if target <= 0:
        return
    progress = float(item.get("worked_minutes", 0) or 0) / target
    reached = [milestone for milestone in milestones if progress >= milestone / 100]
    if not reached:
        return
    # Enabling notifications late should not deliver every missed stage at once.
    for skipped in reached[:-1]:
        with DB_LOCK, db() as con:
            con.execute(
                "INSERT OR IGNORE INTO milestone_notifications(entry_id,milestone,sent_at) VALUES(?,?,?)",
                (item["id"], skipped, datetime.now().isoformat(timespec="seconds")),
            )
    milestone = reached[-1]
    with DB_LOCK, db() as con:
        inserted = con.execute(
            "INSERT OR IGNORE INTO milestone_notifications(entry_id,milestone,sent_at) VALUES(?,?,?)",
            (item["id"], milestone, datetime.now().isoformat(timespec="seconds")),
        ).rowcount
    if not inserted:
        return
    result = call_home_assistant_notify(service, progress_notification_payload(settings, item, milestone))
    if not result.get("ok"):
        with DB_LOCK, db() as con:
            con.execute(
                "DELETE FROM milestone_notifications WHERE entry_id=? AND milestone=?",
                (item["id"], milestone),
            )


def check_milestones() -> None:
    settings = get_settings()
    item = active_entry(settings)
    if item:
        send_progress_notifications(settings, item)
        send_day_notifications(settings, item)


def day_notification_payload(settings: dict, item: dict, event: str) -> dict:
    planned = planned_target(settings, item["work_date"])
    required = minimum_break(max(planned, int(item.get("net_work_seconds", 0)) / 60), settings.get("age_group", "adult"))
    extra = planned - daily_target(settings, item["work_date"])
    messages = {
        "start": ("Arbeitszeit gestartet", f"Dein Tagesplan: {format_duration(planned)} Std. Gute Arbeit und einen angenehmen Tag!", "mdi:play-circle-outline"),
        "pause_minimum": ("Pausenziel erreicht", f"{required} Minuten anrechenbare Pause geschafft. Du kannst weiter pausieren oder entspannt weiterarbeiten.", "mdi:coffee-outline"),
        "pause_reminder": ("Zeit für eine Pause", f"Für deine Arbeitszeit sind {required} Minuten Pause nötig. Bisher sind {item.get('qualified_break_minutes', 0)} Minuten anrechenbar.", "mdi:coffee-outline"),
        "end_soon": ("Feierabend in Sicht", "Noch höchstens 15 Minuten bis zu deinem Tagesplan. Zeit, die letzten Aufgaben abzurunden.", "mdi:flag-checkered"),
        "overtime": ("Überstundenplan geschafft", f"Deine geplanten {format_duration(extra)} Std. zusätzlich sind erreicht. Insgesamt {format_duration(planned)} Std. geschafft.", "mdi:check-circle-outline"),
    }
    title, message, icon = messages[event]
    return {"title": f"Zeitwerk · {title}", "message": message, "data": {"tag": f"zeitwerk_{event}_{item['id']}", "notification_icon": icon, "notification_icon_color": "#FFFFFF", "color": NOTIFICATION_ACCENT, "url": zeitwerk_app_url()}}


def send_once_day_notification(settings: dict, item: dict, event: str, key: int) -> bool:
    service = settings.get("live_activity_service", "")
    if not service:
        return False
    with DB_LOCK, db() as con:
        inserted = con.execute("INSERT OR IGNORE INTO milestone_notifications(entry_id,milestone,sent_at) VALUES(?,?,?)", (item["id"], key, datetime.now().isoformat(timespec="seconds"))).rowcount
    if not inserted:
        return False
    result = call_home_assistant_notify(service, day_notification_payload(settings, item, event))
    if not result.get("ok"):
        with DB_LOCK, db() as con:
            con.execute("DELETE FROM milestone_notifications WHERE entry_id=? AND milestone=?", (item["id"], key))
    return bool(result.get("ok"))


def send_day_notifications(settings: dict, item: dict) -> None:
    planned = planned_target(settings, item["work_date"])
    net = int(item.get("net_work_seconds", 0)) / 60
    qualified = int(item.get("qualified_break_minutes", 0))
    required = minimum_break(max(planned, net), settings.get("age_group", "adult"))
    missing_now = minimum_break(net, settings.get("age_group", "adult"))
    if settings.get("pause_minimum_notification_enabled") and required and qualified >= required:
        if send_once_day_notification(settings, item, "pause_minimum", 2000 + required):
            return
    if settings.get("pause_reminder_enabled") and not item.get("is_paused") and missing_now > qualified:
        if send_once_day_notification(settings, item, "pause_reminder", 2100 + missing_now):
            return
    extra = planned - daily_target(settings, item["work_date"])
    if settings.get("overtime_notification_enabled") and extra > 0 and item.get("worked_minutes", 0) >= planned:
        if send_once_day_notification(settings, item, "overtime", 4000 + extra):
            return
    if settings.get("end_soon_notification_enabled") and not item.get("is_paused") and planned >= 30 and 0 < planned - item.get("worked_minutes", 0) <= 15:
        send_once_day_notification(settings, item, "end_soon", 6000 + planned)


def milestone_worker() -> None:
    while True:
        try:
            check_milestones()
        except Exception as exc:  # notifications must never affect time tracking
            print(f"Zeitwerk milestone check failed: {exc}", flush=True)
        time.sleep(30)


def summary_for(entries: list[dict], settings: dict, start_date: str, end_date: str) -> dict:
    configured_start = settings.get("tracking_start_date", start_date)
    try:
        start = max(date.fromisoformat(start_date), date.fromisoformat(configured_start))
    except (TypeError, ValueError):
        start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    target_minutes = 0
    cursor = start
    today = date.today()
    while cursor <= end and cursor <= today:
        target_minutes += daily_target(settings, cursor.isoformat())
        cursor += timedelta(days=1)
    completed_entries = [entry for entry in entries if entry["work_date"] <= today.isoformat()]
    worked = sum(entry["worked_minutes"] for entry in completed_entries)
    account = sum(entry["account_minutes"] for entry in completed_entries)
    balance_account = sum(entry["account_minutes"] for entry in completed_entries if entry["work_date"] >= start.isoformat())
    vacation = sum(1 for entry in entries if entry["type"] == "U")
    homeoffice = sum(1 for entry in entries if entry["type"] == "H")
    commutes = sum(1 for entry in entries if entry.get("commute"))
    gross_earnings = sum(entry["estimated_gross_eur"] for entry in completed_entries)
    return {
        "worked_minutes": worked,
        "target_minutes": target_minutes,
        "credited_minutes": account - worked,
        "account_minutes": balance_account,
        "balance_minutes": balance_account - target_minutes,
        "vacation_days": vacation,
        "homeoffice_days": homeoffice,
        "commute_days": commutes,
        "gross_earnings": round(gross_earnings, 2),
        "daily_target_minutes": daily_target(settings),
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "Zeitwerk/5.1.1"
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
    }

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}", flush=True)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def json_response(self, payload, status=HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def error_response(self, message: str, status=HTTPStatus.BAD_REQUEST) -> None:
        self.json_response({"error": message}, status)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 2_000_000:
            raise ValueError("Anfrage ist zu groß")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def route_path(self) -> str:
        return urlparse(self.path).path.rstrip("/") or "/"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)
        if path.startswith("/api/"):
            return self.handle_api_get(path, query)
        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def translate_path(self, path: str) -> str:
        clean = urlparse(path).path.lstrip("/")
        candidate = (STATIC_DIR / clean).resolve()
        if not str(candidate).startswith(str(STATIC_DIR.resolve())):
            return str(STATIC_DIR / "index.html")
        return str(candidate)

    def handle_api_get(self, path: str, query: dict) -> None:
        settings = get_settings()
        if path == "/api/state":
            today = date.today()
            start_date = query.get("from", [(today - timedelta(days=45)).isoformat()])[0]
            end_date = query.get("to", [(today + timedelta(days=45)).isoformat()])[0]
            try:
                date.fromisoformat(start_date)
                date.fromisoformat(end_date)
            except ValueError:
                return self.error_response("Ungültiger Datumsbereich")
            for year in {int(start_date[:4]), int(end_date[:4]), today.year}:
                refresh_holidays(settings, year)
            entries = list_entries(start_date, end_date, settings)
            current_year_start = f"{today.year}-01-01"
            current_entries = list_entries(current_year_start, today.isoformat(), settings)
            current_account = summary_for(current_entries, settings, current_year_start, today.isoformat())
            current_account["previous_balance_minutes"] = int(settings.get("previous_balance_minutes", 0) or 0)
            current_account["balance_minutes"] += current_account["previous_balance_minutes"]
            today_in_scope = settings.get("tracking_start_date", current_year_start) <= today.isoformat()
            today_account = sum(entry["account_minutes"] for entry in current_entries if entry["work_date"] == today.isoformat()) if today_in_scope else 0
            today_target = daily_target(settings, today.isoformat()) if today_in_scope else 0
            current_account.update({
                "today_account_minutes": today_account,
                "today_target_minutes": today_target,
                "balance_before_today_minutes": current_account["balance_minutes"] - today_account + today_target,
            })
            return self.json_response(
                {
                    "settings": settings,
                    "entries": entries,
                    "active": active_entry(settings),
                    "today_entries": list_entries(today.isoformat(), today.isoformat(), settings),
                    "next_vacation": next_vacation(settings),
                    "holidays": holiday_status(settings, int(start_date[:4])),
                    "vacation_periods": vacation_periods(settings),
                    "summary": summary_for(entries, settings, start_date, end_date),
                    "current_account": current_account,
                    "storage": {"durable": True, "safety_copy": SAFETY_PATH.exists()},
                    "live_activity": {
                        "api_available": bool(os.environ.get("SUPERVISOR_TOKEN")),
                        "configured": bool(settings.get("live_activity_enabled") and settings.get("live_activity_service")),
                    },
                    "type_labels": TYPE_LABELS,
                    "server_time": datetime.now().isoformat(timespec="seconds"),
                }
            )
        if path == "/api/backup.json":
            with DB_LOCK, db() as con:
                rows = [dict(row) for row in con.execute("SELECT * FROM entries ORDER BY work_date, id")]
                holiday_rows = [{"state": row["state"], "year": row["year"], "holidays": json.loads(row["holidays_json"]), "fetched_at": row["fetched_at"]} for row in con.execute("SELECT * FROM holiday_cache ORDER BY state,year")]
            payload = {"version": 1, "exported_at": datetime.now().isoformat(), "settings": settings, "entries": rows, "holiday_cache": holiday_rows}
            data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="zeitwerk-backup-{date.today().isoformat()}.json"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if path == "/api/export.csv":
            year = int(query.get("year", [date.today().year])[0])
            entries = list_entries(f"{year}-01-01", f"{year}-12-31", settings)
            output = io.StringIO()
            writer = csv.writer(output, delimiter=";")
            writer.writerow(["Datum", "Kürzel", "Art", "Beginn", "Ende", "Pause (HH:MM)", "Arbeitszeit (HH:MM)", "Anrechenbar (HH:MM)", "Pendeltag", "Notiz"])
            for entry in reversed(entries):
                writer.writerow([
                    entry["work_date"], entry["type"], entry["type_label"], entry.get("start_time") or "",
                    entry.get("end_time") or "", format_duration(entry["applied_break_minutes"]), format_duration(entry["worked_minutes"]), format_duration(entry["account_minutes"]),
                    "Ja" if entry.get("commute") else "Nein", entry.get("note", ""),
                ])
            data = ("\ufeff" + output.getvalue()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="zeitwerk-{year}.csv"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        return self.error_response("API-Endpunkt nicht gefunden", HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        self.handle_write("POST")

    def do_PUT(self) -> None:
        self.handle_write("PUT")

    def do_DELETE(self) -> None:
        path = self.route_path()
        match = re.fullmatch(r"/api/entries/(\d+)", path)
        if not match:
            return self.error_response("API-Endpunkt nicht gefunden", HTTPStatus.NOT_FOUND)
        settings = get_settings()
        with DB_LOCK, db() as con:
            row = con.execute("SELECT * FROM entries WHERE id = ?", (int(match.group(1)),)).fetchone()
            con.execute("DELETE FROM entries WHERE id = ?", (int(match.group(1)),))
        create_safety_backup()
        if row and row["type"] in WORK_TYPES and row["start_time"] and not row["end_time"] and settings.get("live_activity_enabled"):
            call_home_assistant_notify(settings.get("live_activity_service", ""), {
                "message": "clear_notification",
                "data": {"tag": LIVE_ACTIVITY_TAG},
            })
        return self.json_response({"ok": True})

    def handle_write(self, method: str) -> None:
        path = self.route_path()
        try:
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError) as exc:
            return self.error_response(str(exc) or "Ungültige Daten")
        try:
            if path == "/api/settings" and method == "POST":
                return self.save_settings(payload)
            if path == "/api/live-activity/test" and method == "POST":
                return self.test_live_activity()
            if path == "/api/day-plan" and method == "POST":
                return self.save_day_plan(payload)
            if path == "/api/holidays/refresh" and method == "POST":
                settings = get_settings()
                year = int(payload.get("year", date.today().year))
                refresh_holidays(settings, year, force=True)
                return self.json_response({"ok": True, "holidays": holiday_status(settings, year)})
            if path == "/api/holidays/exception" and method == "POST":
                return self.save_holiday_exception(payload)
            note_match = re.fullmatch(r"/api/entries/(\d+)/note", path)
            if note_match and method == "POST":
                return self.save_note(int(note_match.group(1)), payload)
            if path == "/api/timer/start" and method == "POST":
                return self.timer_start(payload)
            if path == "/api/timer/reopen" and method == "POST":
                return self.timer_reopen()
            if path in {"/api/timer/pause", "/api/timer/resume", "/api/timer/stop"} and method == "POST":
                return self.timer_action(path.rsplit("/", 1)[-1])
            if path == "/api/vacation/range" and method == "POST":
                return self.save_vacation_range(payload)
            if path == "/api/vacation/update" and method == "POST":
                return self.save_vacation_range(payload, replacing=True)
            if path == "/api/vacation/remove" and method == "POST":
                return self.remove_vacation_range(payload)
            if path == "/api/entries/x-extra" and method == "POST":
                return self.save_x_extra(payload)
            if path == "/api/entries" and method == "POST":
                return self.save_entry(payload)
            match = re.fullmatch(r"/api/entries/(\d+)", path)
            if match and method == "PUT":
                return self.save_entry(payload, int(match.group(1)))
            if path == "/api/import" and method == "POST":
                return self.import_backup(payload)
        except (ValueError, TypeError, sqlite3.Error) as exc:
            return self.error_response(str(exc))
        return self.error_response("API-Endpunkt nicht gefunden", HTTPStatus.NOT_FOUND)

    def save_settings(self, payload: dict) -> None:
        allowed = set(DEFAULT_SETTINGS)
        updates = {key: value for key, value in payload.items() if key in allowed}
        weekly = float(updates.get("weekly_hours", get_settings()["weekly_hours"]))
        if weekly <= 0 or weekly > 80:
            raise ValueError("Wochenarbeitszeit muss zwischen 0 und 80 Stunden liegen")
        if "daily_work_minutes" in updates:
            targets = updates["daily_work_minutes"]
            if not isinstance(targets, list) or len(targets) != 7:
                raise ValueError("Für jeden Wochentag wird ein Tagesziel benötigt")
            try:
                targets = [max(0, int(value)) for value in targets]
            except (TypeError, ValueError) as exc:
                raise ValueError("Die Tagesziele sind ungültig") from exc
            if any(value > 24 * 60 for value in targets) or not any(targets):
                raise ValueError("Mindestens ein gültiges Tagesziel wird benötigt")
            updates["daily_work_minutes"] = targets
        if "hourly_gross_eur" in updates:
            rate = float(updates["hourly_gross_eur"] or 0)
            if rate < 0 or rate > 10000:
                raise ValueError("Der Brutto-Stundenlohn ist ungültig")
            updates["hourly_gross_eur"] = rate
        if "monthly_gross_eur" in updates:
            amount = float(updates["monthly_gross_eur"] or 0)
            if amount < 0 or amount > 1000000:
                raise ValueError("Das Monatsbrutto ist ungültig")
            updates["monthly_gross_eur"] = amount
        if "vacation_allowance_by_year" in updates:
            values = updates["vacation_allowance_by_year"]
            if not isinstance(values, dict):
                raise ValueError("Die Urlaubsansprüche sind ungültig")
            cleaned = {}
            for year, value in values.items():
                if not re.fullmatch(r"\d{4}", str(year)):
                    continue
                allowance = float(value)
                if allowance < 0 or allowance > 366:
                    raise ValueError("Der Urlaubsanspruch ist ungültig")
                cleaned[str(year)] = allowance
            updates["vacation_allowance_by_year"] = cleaned
        if "tracking_start_date" in updates:
            try:
                date.fromisoformat(str(updates["tracking_start_date"]))
            except ValueError as exc:
                raise ValueError("Startdatum ist ungültig") from exc
        if updates.get("theme", "system") not in {"system", "light", "dark"}:
            raise ValueError("Unbekannte Darstellung")
        if "live_activity_service" in updates:
            updates["live_activity_service"] = normalized_notify_service(updates["live_activity_service"])
        if "milestone_notification_style" in updates and updates["milestone_notification_style"] not in {"saying_money", "saying", "percent"}:
            raise ValueError("Unbekannter Stil für Motivationsmeldungen")
        if "holiday_state" in updates and updates["holiday_state"] not in {"", *GERMAN_STATES}:
            raise ValueError("Bitte ein gültiges Bundesland wählen")
        if updates.get("holidays_enabled") and not updates.get("holiday_state", get_settings().get("holiday_state")):
            raise ValueError("Bitte zuerst dein Bundesland wählen")
        for flag in ("pause_minimum_notification_enabled", "pause_reminder_enabled", "end_soon_notification_enabled", "overtime_notification_enabled", "start_notification_enabled", "holidays_enabled", "after_work_animation_enabled"):
            if flag in updates and not isinstance(updates[flag], bool):
                raise ValueError("Ungültiger Schalterwert")
        # Day plans and exclusions are changed through their own validated routes.
        updates.pop("overtime_plan_by_date", None)
        updates.pop("holiday_exclusions", None)
        previous_settings = get_settings()
        with DB_LOCK, db() as con:
            for key, value in updates.items():
                con.execute(
                    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, json.dumps(value, ensure_ascii=False)),
                )
        create_safety_backup()
        if previous_settings.get("live_activity_enabled") and updates.get("live_activity_enabled") is False:
            clear_live_activity(previous_settings.get("live_activity_service", ""))
        self.json_response({"ok": True, "settings": get_settings()})

    def save_day_plan(self, payload: dict) -> None:
        day = date.fromisoformat(str(payload.get("work_date", ""))).isoformat()
        extra = int(payload.get("extra_minutes", 0))
        if extra < 0 or extra > 720:
            raise ValueError("Bitte zwischen 0 und 12 Stunden planen")
        settings = get_settings()
        if daily_target(settings, day) + extra > 1440:
            raise ValueError("Der Tagesplan darf höchstens 24 Stunden umfassen")
        with DB_LOCK, db() as con:
            plans = get_settings().get("overtime_plan_by_date", {}).copy()
            if extra:
                plans[day] = extra
            else:
                plans.pop(day, None)
            con.execute("UPDATE settings SET value=? WHERE key='overtime_plan_by_date'", (json.dumps(plans),))
        create_safety_backup()
        current = active_entry(get_settings())
        if current and current["work_date"] == day:
            sync_live_activity(get_settings(), "pause" if current["is_paused"] else "resume", current)
        self.json_response({"ok": True, "extra_minutes": extra})

    def save_holiday_exception(self, payload: dict) -> None:
        day = date.fromisoformat(str(payload.get("work_date", ""))).isoformat()
        if not isinstance(payload.get("excluded"), bool):
            raise ValueError("Ungültige Feiertagsauswahl")
        with DB_LOCK, db() as con:
            excluded = set(get_settings().get("holiday_exclusions") or [])
            if payload["excluded"]:
                excluded.add(day)
            else:
                excluded.discard(day)
            con.execute("UPDATE settings SET value=? WHERE key='holiday_exclusions'", (json.dumps(sorted(excluded)),))
        create_safety_backup()
        self.json_response({"ok": True})

    def save_note(self, entry_id: int, payload: dict) -> None:
        note = str(payload.get("note", ""))
        if len(note) > 2000:
            raise ValueError("Die Tagesnotiz darf höchstens 2000 Zeichen lang sein")
        with DB_LOCK, db() as con:
            row = con.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
            if not row or row["type"] not in {*WORK_TYPES, "X"} or (row["type"] in WORK_TYPES and not row["finalized"]):
                raise ValueError("Tagesnotizen sind nach Abschluss des Arbeitstags möglich")
            con.execute("UPDATE entries SET note=?,updated_at=? WHERE id=?", (note, datetime.now().isoformat(timespec="seconds"), entry_id))
        create_safety_backup()
        self.json_response({"ok": True})

    def test_live_activity(self) -> None:
        settings = get_settings()
        result = call_home_assistant_notify(settings.get("live_activity_service", ""), {
            "title": "Zeitwerk",
            "message": "Verbindung erfolgreich – Mitteilungen sind bereit.",
            "data": {
                "tag": "zeitwerk_test",
                "notification_icon": "mdi:briefcase-check-outline",
                "notification_icon_color": "#FFFFFF",
                "color": NOTIFICATION_ACCENT,
            },
        })
        if not result.get("ok"):
            return self.error_response(result.get("message", "Verbindung fehlgeschlagen"))
        self.json_response(result)

    def validate_entry(self, payload: dict) -> dict:
        work_date = str(payload.get("work_date", ""))
        date.fromisoformat(work_date)
        entry_type = str(payload.get("type", "B")).upper()
        if entry_type not in VALID_TYPES:
            raise ValueError("Unbekanntes Zeitkürzel")
        start = payload.get("start_time") or None
        end = payload.get("end_time") or None
        if start and parse_time(start) is None or end and parse_time(end) is None:
            raise ValueError("Ungültige Uhrzeit")
        if start and end and parse_time(end) <= parse_time(start):
            raise ValueError("Das Ende muss nach dem Beginn liegen")
        timed = entry_type in WORK_TYPES
        if timed and (not start or not end):
            raise ValueError("Für diese Art werden Beginn und Ende benötigt")
        if "break_duration" in payload:
            manual_break = parse_duration(str(payload.get("break_duration") or "00:00"))
            if manual_break is None:
                raise ValueError("Die Pausendauer muss im Format HH:MM angegeben werden")
        else:
            manual_break = max(0, int(payload.get("manual_break_minutes", 0) or 0))
        manual_break = min(600, manual_break)
        if timed and start and end and manual_break > parse_time(end) - parse_time(start):
            raise ValueError("Die Pause kann nicht länger als die Anwesenheitszeit sein")
        return {
            "work_date": work_date,
            "type": entry_type,
            "start_time": start if timed else None,
            "end_time": end if timed else None,
            "manual_break_minutes": manual_break,
            "note": str(payload.get("note", ""))[:2000],
            "commute": 1 if payload.get("commute") and entry_type != "H" else 0,
        }

    def save_entry(self, payload: dict, entry_id: int | None = None) -> None:
        item = self.validate_entry(payload)
        item["finalized"] = 1 if item["type"] in WORK_TYPES else 0
        now = datetime.now().isoformat(timespec="seconds")
        with DB_LOCK, db() as con:
            existing = con.execute(
                "SELECT id FROM entries WHERE work_date=? AND id<>? LIMIT 1",
                (item["work_date"], entry_id or -1),
            ).fetchone()
            if existing:
                raise ValueError("Für diesen Tag gibt es bereits einen Eintrag. Bitte bearbeite den vorhandenen Tag.")
            if entry_id is None:
                cur = con.execute(
                    """INSERT INTO entries(work_date,type,start_time,end_time,manual_break_minutes,breaks_json,note,commute,finalized,created_at,updated_at)
                    VALUES(:work_date,:type,:start_time,:end_time,:manual_break_minutes,'[]',:note,:commute,:finalized,:created_at,:updated_at)""",
                    {**item, "created_at": now, "updated_at": now},
                )
                entry_id = cur.lastrowid
            else:
                con.execute(
                    """UPDATE entries SET work_date=:work_date,type=:type,start_time=:start_time,end_time=:end_time,
                    manual_break_minutes=:manual_break_minutes,breaks_json='[]',note=:note,commute=:commute,finalized=:finalized,
                    extra_work_minutes=CASE WHEN :type='X' THEN extra_work_minutes ELSE 0 END,updated_at=:updated_at WHERE id=:id""",
                    {**item, "updated_at": now, "id": entry_id},
                )
            row = con.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
        create_safety_backup()
        self.json_response({"ok": True, "entry": serialize_entry(row, get_settings())})

    def save_x_extra(self, payload: dict) -> None:
        try:
            work_date = date.fromisoformat(str(payload.get("work_date", ""))).isoformat()
            extra = parse_duration(str(payload.get("extra_duration", "")))
        except ValueError as exc:
            raise ValueError("Bitte ein gültiges Datum angeben") from exc
        if extra is None or extra > 12 * 60:
            raise ValueError("Zusätzliche Stunden bitte als HH:MM zwischen 00:00 und 12:00 angeben")
        with DB_LOCK, db() as con:
            row = con.execute("SELECT * FROM entries WHERE work_date=? AND type='X'", (work_date,)).fetchone()
            if not row:
                raise ValueError("Für diesen Tag gibt es keinen X-Eintrag")
            con.execute("UPDATE entries SET extra_work_minutes=?,updated_at=? WHERE id=?",
                        (extra, datetime.now().isoformat(timespec="seconds"), row["id"]))
            updated = con.execute("SELECT * FROM entries WHERE id=?", (row["id"],)).fetchone()
        create_safety_backup()
        self.json_response({"ok": True, "entry": serialize_entry(updated, get_settings())})

    def timer_start(self, payload: dict) -> None:
        settings = get_settings()
        if active_entry(settings):
            raise ValueError("Es läuft bereits eine Zeiterfassung")
        entry_type = str(payload.get("type", "B")).upper()
        if entry_type not in WORK_TYPES:
            entry_type = "B"
        now = datetime.now()
        stamp = now.isoformat(timespec="seconds")
        time_value = now.strftime("%H:%M:%S")
        with DB_LOCK, db() as con:
            existing = con.execute(
                "SELECT * FROM entries WHERE work_date=? AND type IN ('B','H') LIMIT 1",
                (now.date().isoformat(),),
            ).fetchone()
            if not existing and con.execute(
                "SELECT 1 FROM entries WHERE work_date=? AND type NOT IN ('B','H') LIMIT 1",
                (now.date().isoformat(),),
            ).fetchone():
                raise ValueError("Für heute ist bereits ein Tagestyp eingetragen. Bitte bearbeite oder lösche diesen Eintrag zuerst.")
            if existing:
                raise ValueError("Dieser Arbeitstag ist bereits abgeschlossen. Eine Korrektur ist unter Einstellungen → Daten & Sicherung → Erweiterte Korrekturen möglich.")
            cur = con.execute(
                """INSERT INTO entries(work_date,type,start_time,end_time,manual_break_minutes,breaks_json,note,commute,finalized,created_at,updated_at)
                VALUES(?,?,?,NULL,0,'[]','',?,0,?,?)""",
                (now.date().isoformat(), entry_type, time_value, 0 if entry_type == "H" else 1, stamp, stamp),
            )
            row = con.execute("SELECT * FROM entries WHERE id = ?", (cur.lastrowid,)).fetchone()
        create_safety_backup()
        serialized = serialize_entry(row, settings)
        live_activity = sync_live_activity(settings, "start", serialized)
        if settings.get("start_notification_enabled"):
            send_once_day_notification(settings, serialized, "start", 1001)
        self.json_response({"ok": True, "resumed": False, "entry": serialized, "live_activity": live_activity})

    def timer_reopen(self) -> None:
        settings = get_settings()
        if active_entry(settings):
            raise ValueError("Es läuft bereits eine Zeiterfassung")
        now = datetime.now()
        stamp = now.isoformat(timespec="seconds")
        clock = now.strftime("%H:%M:%S")
        with DB_LOCK, db() as con:
            row = con.execute(
                "SELECT * FROM entries WHERE work_date=? AND type IN ('B','H') LIMIT 1",
                (now.date().isoformat(),),
            ).fetchone()
            if not row or not row["finalized"] or not row["end_time"]:
                raise ValueError("Heute gibt es keinen abgeschlossenen Arbeitstag")
            if parse_clock_seconds(clock) <= parse_clock_seconds(row["end_time"]):
                raise ValueError("Der Abschluss liegt noch nicht vor der aktuellen Uhrzeit")
            breaks = json.loads(row["breaks_json"] or "[]")
            breaks.append({"start": row["end_time"], "end": clock})
            con.execute(
                "UPDATE entries SET end_time=NULL, finalized=0, breaks_json=?, updated_at=? WHERE id=?",
                (json.dumps(breaks), stamp, row["id"]),
            )
            updated = con.execute("SELECT * FROM entries WHERE id=?", (row["id"],)).fetchone()
        create_safety_backup()
        serialized = serialize_entry(updated, settings)
        live_activity = sync_live_activity(settings, "resume", serialized)
        self.json_response({"ok": True, "entry": serialized, "live_activity": live_activity})

    def save_vacation_range(self, payload: dict, replacing: bool = False) -> None:
        try:
            first = date.fromisoformat(str(payload.get("start_date", "")))
            last = date.fromisoformat(str(payload.get("end_date", "")))
        except ValueError:
            raise ValueError("Bitte gültige Start- und Enddaten angeben")
        if last < first or (last - first).days > 366:
            raise ValueError("Der Urlaubszeitraum muss zwischen 1 und 367 Tagen liegen")
        settings = get_settings()
        dates = [first + timedelta(days=offset) for offset in range((last - first).days + 1)]
        work_dates = [day.isoformat() for day in dates if daily_target(settings, day.isoformat()) > 0]
        if not work_dates:
            raise ValueError("Im Zeitraum liegt kein Arbeitstag laut deinem Arbeitsmodell")
        now = datetime.now().isoformat(timespec="seconds")
        note = str(payload.get("note", ""))[:500]
        automatic_days = set()
        for year in {first.year, last.year}:
            refresh_holidays(settings, year)
            automatic_days.update(holiday_dates(settings, year))
        with DB_LOCK, db() as con:
            original_dates = set()
            if replacing:
                raw_dates = payload.get("original_dates")
                if not isinstance(raw_dates, list) or not 1 <= len(raw_dates) <= 367:
                    raise ValueError("Bitte einen vorhandenen Urlaubszeitraum auswählen")
                original_dates = {date.fromisoformat(str(day)).isoformat() for day in raw_dates}
                original_note = str(payload.get("original_note", ""))
                if not any(set(period["dates"]) == original_dates and period["note"] == original_note for period in vacation_periods(settings)):
                    raise ValueError("Dieser Urlaubszeitraum wurde inzwischen geändert. Bitte neu öffnen.")
            rows = con.execute(
                "SELECT work_date,type FROM entries WHERE work_date BETWEEN ? AND ?",
                (first.isoformat(), last.isoformat()),
            ).fetchall()
            existing = {}
            for row in rows:
                existing.setdefault(row["work_date"], set()).add(row["type"])
            conflicts = [day for day in work_dates if existing.get(day, set()) - {"U", "FT"}]
            if conflicts:
                raise ValueError(f"Am {date.fromisoformat(conflicts[0]).strftime('%d.%m.%Y')} besteht bereits ein anderer Eintrag. Bitte diesen zuerst prüfen.")
            if replacing and any("U" in existing.get(day, set()) and day not in original_dates and "FT" not in existing.get(day, set()) and day not in automatic_days for day in work_dates):
                raise ValueError("Der neue Zeitraum überschneidet sich mit anderem Urlaub. Bitte einen freien Zeitraum wählen.")
            vacation_dates = [day for day in work_dates if "FT" not in existing.get(day, set()) and day not in automatic_days]
            if not vacation_dates:
                raise ValueError("Im Zeitraum bleibt nach den eingetragenen freien Tagen kein Urlaubstag übrig")
            if replacing:
                # Validate everything before replacing; failures roll back the entire edit.
                placeholders = ",".join("?" for _ in original_dates)
                con.execute(f"DELETE FROM entries WHERE type='U' AND work_date IN ({placeholders})", sorted(original_dates))
                for day in original_dates:
                    existing.pop(day, None)
            added = 0
            for day in vacation_dates:
                if "U" in existing.get(day, set()):
                    continue
                con.execute(
                    """INSERT INTO entries(work_date,type,start_time,end_time,manual_break_minutes,breaks_json,note,commute,finalized,created_at,updated_at)
                    VALUES(?,'U',NULL,NULL,0,'[]',?,0,0,?,?)""",
                    (day, note, now, now),
                )
                added += 1
        create_safety_backup()
        self.json_response({"ok": True, "added": added, "workdays": len(vacation_dates), "skipped": len(dates) - len(vacation_dates), "free_days": len(work_dates) - len(vacation_dates)})

    def timer_action(self, action: str) -> None:
        settings = get_settings()
        active = active_entry(settings)
        if not active:
            raise ValueError("Es läuft keine Zeiterfassung")
        now = datetime.now()
        time_value = now.strftime("%H:%M:%S")
        breaks = active["breaks"]
        if action == "pause":
            if active["is_paused"]:
                raise ValueError("Die Pause läuft bereits")
            breaks.append({"start": time_value, "end": None})
        elif action == "resume":
            if not active["is_paused"]:
                raise ValueError("Es läuft keine Pause")
            for segment in reversed(breaks):
                if segment.get("end") is None:
                    segment["end"] = time_value
                    break
        elif action == "stop":
            for segment in breaks:
                if segment.get("end") is None:
                    segment["end"] = time_value
        with DB_LOCK, db() as con:
            con.execute(
                "UPDATE entries SET end_time=?, finalized=?, breaks_json=?, updated_at=? WHERE id=?",
                (time_value if action == "stop" else None, 1 if action == "stop" else 0, json.dumps(breaks), now.isoformat(timespec="seconds"), active["id"]),
            )
            row = con.execute("SELECT * FROM entries WHERE id=?", (active["id"],)).fetchone()
        create_safety_backup()
        serialized = serialize_entry(row, settings)
        if action == "stop":
            send_progress_notifications(settings, serialized, goal_only=True)
        else:
            send_day_notifications(settings, serialized)
        live_activity = sync_live_activity(settings, action, serialized)
        self.json_response({"ok": True, "entry": serialized, "live_activity": live_activity})

    def remove_vacation_range(self, payload: dict) -> None:
        first = date.fromisoformat(str(payload.get("start_date", ""))).isoformat()
        last = date.fromisoformat(str(payload.get("end_date", ""))).isoformat()
        if first > last:
            raise ValueError("Ungültiger Urlaubszeitraum")
        with DB_LOCK, db() as con:
            count = con.execute("DELETE FROM entries WHERE type='U' AND work_date BETWEEN ? AND ?", (first, last)).rowcount
        create_safety_backup()
        self.json_response({"ok": True, "removed": count})

    def import_backup(self, payload: dict) -> None:
        if payload.get("version") != 1 or not isinstance(payload.get("entries"), list):
            raise ValueError("Diese Sicherungsdatei wird nicht erkannt")
        settings = dict(payload.get("settings") or {})
        plans = settings.get("overtime_plan_by_date") or {}
        cleaned_plans = {}
        if isinstance(plans, dict):
            for day, value in plans.items():
                try:
                    key = date.fromisoformat(str(day)).isoformat()
                    minutes = int(value)
                    if 0 < minutes <= 720:
                        cleaned_plans[key] = minutes
                except (TypeError, ValueError):
                    continue
        settings["overtime_plan_by_date"] = cleaned_plans
        exclusions = settings.get("holiday_exclusions") or []
        cleaned_exclusions = []
        if isinstance(exclusions, list):
            for day in exclusions:
                try:
                    cleaned_exclusions.append(date.fromisoformat(str(day)).isoformat())
                except ValueError:
                    continue
        settings["holiday_exclusions"] = sorted(set(cleaned_exclusions))
        if settings.get("holiday_state", "") not in GERMAN_STATES:
            settings["holiday_state"] = ""
            settings["holidays_enabled"] = False
        for flag in ("pause_minimum_notification_enabled", "pause_reminder_enabled", "end_soon_notification_enabled", "overtime_notification_enabled", "start_notification_enabled"):
            settings[flag] = bool(settings.get(flag, False))
        if "daily_work_minutes" not in settings:
            try:
                imported_days = [int(day) for day in settings.get("workdays", DEFAULT_SETTINGS["workdays"])]
                imported_target = round(float(settings.get("weekly_hours", DEFAULT_SETTINGS["weekly_hours"])) * 60 / max(1, len(imported_days)))
                settings["daily_work_minutes"] = [imported_target if day in imported_days else 0 for day in range(7)]
            except (TypeError, ValueError):
                settings["daily_work_minutes"] = DEFAULT_SETTINGS["daily_work_minutes"]
        with DB_LOCK, db() as con:
            con.execute("DELETE FROM holiday_cache")
            for cached in (payload.get("holiday_cache") or [])[:500]:
                if not isinstance(cached, dict) or cached.get("state") not in GERMAN_STATES:
                    continue
                try:
                    year = int(cached.get("year", 0))
                    if not 2000 <= year <= 2100:
                        continue
                    holidays = []
                    for holiday in (cached.get("holidays") or [])[:60]:
                        day = date.fromisoformat(str(holiday.get("date", "")))
                        if day.year == year:
                            holidays.append({"date": day.isoformat(), "name": str(holiday.get("name") or "Feiertag")[:160]})
                    if not holidays:
                        continue
                    fetched = datetime.fromisoformat(str(cached.get("fetched_at"))).replace(tzinfo=None).isoformat(timespec="seconds")
                    con.execute("INSERT OR REPLACE INTO holiday_cache VALUES(?,?,?,?)", (cached["state"], year, json.dumps(holidays, ensure_ascii=False), fetched))
                except (TypeError, ValueError, AttributeError):
                    continue
            con.execute("DELETE FROM entries")
            for raw in payload["entries"][:20000]:
                migrated = dict(raw)
                if migrated.get("type") == "G":
                    migrated["type"] = "B"
                    old_note = str(migrated.get("note") or "")
                    migrated["note"] = (f"Geschäftlich (früher G) · {old_note}" if old_note and "Geschäftlich (früher G)" not in old_note else old_note or "Geschäftlich (früher G)")[:500]
                if migrated.get("type") == "X" and migrated.get("start_time"):
                    migrated["type"] = "B"
                item = self.validate_entry(migrated)
                con.execute(
                    """INSERT INTO entries(work_date,type,start_time,end_time,manual_break_minutes,breaks_json,note,commute,finalized,extra_work_minutes,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        item["work_date"], item["type"], item["start_time"], item["end_time"], item["manual_break_minutes"],
                        raw.get("breaks_json", "[]"), item["note"], item["commute"],
                        int(bool(raw.get("finalized", bool(item["end_time"] and item["type"] in WORK_TYPES)))),
                        max(0, min(720, int(raw.get("extra_work_minutes", 0) or 0))) if item["type"] == "X" else 0,
                        raw.get("created_at", datetime.now().isoformat()),
                        raw.get("updated_at", datetime.now().isoformat()),
                    ),
                )
            for key, value in settings.items():
                if key in DEFAULT_SETTINGS:
                    con.execute(
                        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, json.dumps(value, ensure_ascii=False)),
                    )
        create_safety_backup()
        self.json_response({"ok": True, "imported": len(payload["entries"])})


class ZeitwerkServer(ThreadingHTTPServer):
    """Serve ingress plus the Supervisor-mapped LAN or private-VPN port."""

    allow_reuse_address = True


if __name__ == "__main__":
    init_db()
    startup_settings = get_settings()
    if startup_settings.get("live_activity_service"):
        # Also remove an orphaned activity left by a previous add-on crash.
        schedule_live_activity_clear_retry(startup_settings["live_activity_service"])
    threading.Thread(target=milestone_worker, name="zeitwerk-milestones", daemon=True).start()
    os.chdir(STATIC_DIR)
    server = ZeitwerkServer(("0.0.0.0", PORT), Handler)
    print(f"Zeitwerk läuft auf Port {PORT}", flush=True)
    server.serve_forever()

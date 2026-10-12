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
from urllib.parse import parse_qs, urlparse
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
    "live_activity_enabled": False,
    "live_activity_service": "",
    "milestone_notifications_enabled": False,
    "hourly_gross_eur": 0,
    "monthly_gross_eur": 0,
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


def sync_live_activity(settings: dict, phase: str, entry: dict | None = None) -> dict:
    if not settings.get("live_activity_enabled"):
        return {"ok": True, "enabled": False}
    service = settings.get("live_activity_service", "")
    if phase == "stop":
        item = entry or {}
        start_time = str(item.get("start_time") or "")[:5] or "–"
        end_time = str(item.get("end_time") or "")[:5] or "–"
        worked = summary_duration(item.get("worked_minutes", 0))
        paused_for = summary_duration(item.get("recorded_break_minutes", 0))
        earned_amount = estimated_gross(settings, item.get("work_date"), item.get("worked_minutes", 0))
        earned = f" · {format_currency_eur(earned_amount)} brutto verdient" if has_gross_setting(settings) else ""
        work_date = re.sub(r"[^0-9]", "", str(item.get("work_date") or date.today().isoformat()))
        summary_result = call_home_assistant_notify(service, {
            "title": "Zeitwerk",
            "message": f"Arbeit beendet{earned} · {worked} gearbeitet · {paused_for} Pause",
            "data": {
                "tag": f"zeitwerk_summary_{work_date}",
                "subtitle": f"{start_time}–{end_time} Uhr",
                "notification_icon": "mdi:check-bold",
                "notification_icon_color": "#FFFFFF",
                "color": NOTIFICATION_ACCENT,
                "url": zeitwerk_app_url(),
            },
        })
        # The clear must be the final command. Sending the summary immediately
        # after an earlier clear can otherwise overtake it in Apple's push queue.
        time.sleep(0.35)
        clear_result = call_home_assistant_notify(service, {
            "message": "clear_notification",
            "data": {"tag": LIVE_ACTIVITY_TAG},
        })
        return {
            "ok": bool(summary_result.get("ok")),
            "cleared": clear_result,
            "summary": summary_result,
        }

    paused = phase == "pause"
    item = entry or {}
    net_work_seconds = max(0, int(item.get("net_work_seconds", 0) or 0))
    break_seconds = max(0, int(item.get("recorded_break_seconds", 0) or 0))
    target_minutes = daily_target(settings, item.get("work_date"))
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
    return [serialize_entry(row, settings) for row in rows]


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
    dates = sorted({date.fromisoformat(row[0]) for row in rows})
    if not dates:
        return None
    first = dates[0]
    last = first
    count = 1
    for upcoming in dates[1:]:
        next_workday = last + timedelta(days=1)
        while daily_target(settings, next_workday.isoformat()) == 0 and next_workday < upcoming:
            next_workday += timedelta(days=1)
        if upcoming != next_workday:
            break
        last = upcoming
        count += 1
    return {"start_date": first.isoformat(), "end_date": last.isoformat(), "workdays": count, "days_until": (first - today).days}


MILESTONE_MESSAGES = {
    25: (
        "Der Anfang ist gemacht – ein Viertel deines Tagesziels ist geschafft.",
        "25 % erledigt. Du bist gut im Rhythmus.",
        "Erstes Etappenziel erreicht – weiter so.",
    ),
    50: (
        "Halbzeit – die Hälfte deines Tagesziels liegt hinter dir.",
        "50 % geschafft. Ab jetzt geht es Richtung Feierabend.",
        "Starke Halbzeit – du bist genau auf Kurs.",
    ),
    75: (
        "Drei Viertel geschafft – der Endspurt beginnt.",
        "75 % erledigt. Dein Tagesziel ist schon in Sicht.",
        "Nur noch das letzte Viertel – stark geblieben.",
    ),
}


def check_milestones() -> None:
    settings = get_settings()
    if not settings.get("live_activity_enabled") or not settings.get("milestone_notifications_enabled"):
        return
    item = active_entry(settings)
    if not item:
        return
    target = daily_target(settings, item.get("work_date"))
    if target <= 0:
        return
    progress = float(item.get("net_work_seconds", 0) or 0) / (target * 60)
    service = settings.get("live_activity_service", "")
    reached = [milestone for milestone in (25, 50, 75) if progress >= milestone / 100]
    if not reached:
        return
    # If notifications were enabled late in the day, don't send three old
    # milestones in a burst. Mark earlier stages and celebrate only the latest.
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
    variant = MILESTONE_MESSAGES[milestone][(int(item["id"]) + milestone) % 3]
    if has_gross_setting(settings):
        earned = estimated_gross(settings, item["work_date"], item.get("worked_minutes", 0))
        variant += f" Heute bisher ca. {format_currency_eur(earned)} brutto."
    result = call_home_assistant_notify(service, {
        "title": f"Zeitwerk · {milestone} %",
        "message": variant,
        "data": {
            "tag": f"zeitwerk_milestone_{item['id']}_{milestone}",
            "notification_icon": "mdi:progress-clock",
            "notification_icon_color": "#FFFFFF",
            "color": NOTIFICATION_ACCENT,
            "url": zeitwerk_app_url(),
        },
    })
    if not result.get("ok"):
        with DB_LOCK, db() as con:
            con.execute(
                "DELETE FROM milestone_notifications WHERE entry_id=? AND milestone=?",
                (item["id"], milestone),
            )


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
    vacation = sum(1 for entry in entries if entry["type"] == "U")
    homeoffice = sum(1 for entry in entries if entry["type"] == "H")
    commutes = sum(1 for entry in entries if entry.get("commute"))
    gross_earnings = sum(entry["estimated_gross_eur"] for entry in completed_entries)
    return {
        "worked_minutes": worked,
        "target_minutes": target_minutes,
        "credited_minutes": account - worked,
        "balance_minutes": account - target_minutes,
        "vacation_days": vacation,
        "homeoffice_days": homeoffice,
        "commute_days": commutes,
        "gross_earnings": round(gross_earnings, 2),
        "daily_target_minutes": daily_target(settings),
    }


class Handler(SimpleHTTPRequestHandler):
    server_version = "Zeitwerk/4.3.1"
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
            entries = list_entries(start_date, end_date, settings)
            return self.json_response(
                {
                    "settings": settings,
                    "entries": entries,
                    "active": active_entry(settings),
                    "today_entries": list_entries(today.isoformat(), today.isoformat(), settings),
                    "next_vacation": next_vacation(settings),
                    "summary": summary_for(entries, settings, start_date, end_date),
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
            payload = {"version": 1, "exported_at": datetime.now().isoformat(), "settings": settings, "entries": rows}
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
            if path == "/api/timer/start" and method == "POST":
                return self.timer_start(payload)
            if path == "/api/timer/reopen" and method == "POST":
                return self.timer_reopen()
            if path in {"/api/timer/pause", "/api/timer/resume", "/api/timer/stop"} and method == "POST":
                return self.timer_action(path.rsplit("/", 1)[-1])
            if path == "/api/vacation/range" and method == "POST":
                return self.save_vacation_range(payload)
            if path == "/api/entries/x-extra" and method == "POST":
                return self.save_x_extra(payload)
            if path == "/api/entries" and method == "POST":
                return self.save_entry(payload)
            match = re.fullmatch(r"/api/entries/(\d+)", path)
            if match and method == "PUT":
                return self.save_entry(payload, int(match.group(1)))
            if path == "/api/import" and method == "POST":
                return self.import_backup(payload)
        except (ValueError, sqlite3.Error) as exc:
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
        with DB_LOCK, db() as con:
            for key, value in updates.items():
                con.execute(
                    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, json.dumps(value, ensure_ascii=False)),
                )
        create_safety_backup()
        self.json_response({"ok": True, "settings": get_settings()})

    def test_live_activity(self) -> None:
        settings = get_settings()
        result = call_home_assistant_notify(settings.get("live_activity_service", ""), {
            "title": "Zeitwerk",
            "message": "Verbindung erfolgreich – Live Activity ist bereit.",
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
            "note": str(payload.get("note", ""))[:500],
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

    def save_vacation_range(self, payload: dict) -> None:
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
        with DB_LOCK, db() as con:
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
            vacation_dates = [day for day in work_dates if "FT" not in existing.get(day, set())]
            if not vacation_dates:
                raise ValueError("Im Zeitraum bleibt nach den eingetragenen freien Tagen kein Urlaubstag übrig")
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
        live_activity = sync_live_activity(settings, action, serialized)
        self.json_response({"ok": True, "entry": serialized, "live_activity": live_activity})

    def import_backup(self, payload: dict) -> None:
        if payload.get("version") != 1 or not isinstance(payload.get("entries"), list):
            raise ValueError("Diese Sicherungsdatei wird nicht erkannt")
        settings = dict(payload.get("settings") or {})
        if "daily_work_minutes" not in settings:
            try:
                imported_days = [int(day) for day in settings.get("workdays", DEFAULT_SETTINGS["workdays"])]
                imported_target = round(float(settings.get("weekly_hours", DEFAULT_SETTINGS["weekly_hours"])) * 60 / max(1, len(imported_days)))
                settings["daily_work_minutes"] = [imported_target if day in imported_days else 0 for day in range(7)]
            except (TypeError, ValueError):
                settings["daily_work_minutes"] = DEFAULT_SETTINGS["daily_work_minutes"]
        with DB_LOCK, db() as con:
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
    threading.Thread(target=milestone_worker, name="zeitwerk-milestones", daemon=True).start()
    os.chdir(STATIC_DIR)
    server = ZeitwerkServer(("0.0.0.0", PORT), Handler)
    print(f"Zeitwerk läuft auf Port {PORT}", flush=True)
    server.serve_forever()

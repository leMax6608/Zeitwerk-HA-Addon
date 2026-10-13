"""Regression checks for finalizing a day and entering a vacation range."""

import importlib.util
import io
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from datetime import date, datetime, timedelta
from pathlib import Path
from contextlib import contextmanager


class ZeitwerkWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        os.environ["DATA_DIR"] = cls.temp.name
        spec = importlib.util.spec_from_file_location(
            "zeitwerk_test_server", Path(__file__).resolve().parents[1] / "zeitwerk" / "app" / "server.py"
        )
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)
        cls.module.init_db()
        cls.server = cls.module.ZeitwerkServer(("127.0.0.1", 0), cls.module.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.temp.cleanup()

    def request(self, path, payload=None):
        body = json.dumps(payload or {}).encode() if payload is not None else None
        request = urllib.request.Request(
            self.url + path, data=body,
            headers={"Content-Type": "application/json"} if body is not None else {},
        )
        with urllib.request.urlopen(request) as response:
            return json.load(response)

    @contextmanager
    def settings_override(self, **updates):
        with self.module.DB_LOCK, self.module.db() as con:
            original = list(con.execute("SELECT key,value FROM settings"))
            for key, value in updates.items():
                con.execute("UPDATE settings SET value=? WHERE key=?", (json.dumps(value), key))
        try:
            yield self.module.get_settings()
        finally:
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("DELETE FROM settings")
                con.executemany("INSERT INTO settings(key,value) VALUES(?,?)", [(row[0], row[1]) for row in original])

    def test_day_note_updates_only_note_and_preserves_times(self):
        day = "2041-02-05"
        result = self.request("api/entries", {"work_date": day, "type": "B", "start_time": "08:00", "end_time": "16:30", "break_duration": "00:30"})
        entry = result["entry"]
        try:
            note = "- Entwurf fertig\n- Feedback besprochen\n\nMorgen: weiterarbeiten."
            self.request(f"api/entries/{entry['id']}/note", {"note": note})
            updated = self.request(f"api/state?from={day}&to={day}")["entries"][0]
            self.assertEqual(updated["note"], note)
            for field in ("start_time", "end_time", "recorded_break_minutes", "worked_minutes", "finalized"):
                self.assertEqual(updated[field], entry[field])
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request(f"api/entries/{entry['id']}/note", {"note": "a" * 2001})
            error.exception.close()
        finally:
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("DELETE FROM entries WHERE id=?", (entry["id"],))

    def test_current_account_does_not_follow_calendar_year(self):
        today = date.today()
        with self.settings_override(tracking_start_date=today.isoformat(), previous_balance_minutes=90, holidays_enabled=False):
            current = self.request("api/state")["current_account"]
            future = self.request("api/state?from=2048-01-01&to=2048-12-31")["current_account"]
            past = self.request("api/state?from=2020-01-01&to=2020-12-31")["current_account"]
            self.assertEqual(current, future)
            self.assertEqual(current, past)
            self.assertEqual(current["previous_balance_minutes"], 90)
            self.assertEqual(current["balance_minutes"], current["account_minutes"] - current["target_minutes"] + 90)

    def test_partial_settings_save_preserves_other_values_and_survives_restart(self):
        with self.settings_override(display_name="", monthly_gross_eur=0, start_notification_enabled=False):
            self.request("api/settings", {"monthly_gross_eur": 3000})
            self.request("api/settings", {"start_notification_enabled": True})
            self.module.init_db()
            saved = self.module.get_settings()
            self.assertEqual(saved["monthly_gross_eur"], 3000)
            self.assertTrue(saved["start_notification_enabled"])
            self.assertEqual(saved["display_name"], "")

    def test_overtime_plan_is_durable_and_does_not_change_contractual_target(self):
        day = "2041-03-04"
        with self.settings_override(overtime_plan_by_date={}, daily_work_minutes=[480] * 7):
            self.request("api/day-plan", {"work_date": day, "extra_minutes": 60})
            settings = self.module.get_settings()
            self.assertEqual(self.module.daily_target(settings, day), 480)
            self.assertEqual(self.module.planned_target(settings, day), 540)
            self.assertEqual(self.request("api/backup.json")["settings"]["overtime_plan_by_date"][day], 60)
            self.module.init_db()
            self.assertEqual(self.module.get_settings()["overtime_plan_by_date"][day], 60)
            self.request("api/settings", {"overtime_plan_by_date": {}})
            self.assertEqual(self.module.planned_target(self.module.get_settings(), day), 540)
            self.request("api/day-plan", {"work_date": day, "extra_minutes": 0})
            self.assertEqual(self.module.planned_target(self.module.get_settings(), day), 480)

    def test_holiday_credits_before_tracking_start_do_not_inflate_balance(self):
        today = date.today()
        settings = {**self.module.DEFAULT_SETTINGS, "daily_work_minutes": [480] * 7, "tracking_start_date": today.isoformat()}
        entries = [
            {"work_date": (today - timedelta(days=1)).isoformat(), "type": "FT", "worked_minutes": 0, "account_minutes": 480, "estimated_gross_eur": 0},
            {"work_date": today.isoformat(), "type": "B", "worked_minutes": 480, "account_minutes": 480, "estimated_gross_eur": 0},
        ]
        summary = self.module.summary_for(entries, settings, today.replace(month=1, day=1).isoformat(), today.isoformat())
        self.assertEqual(summary["balance_minutes"], 0)

    def test_pause_notifications_are_qualified_deduplicated_and_retry_failures(self):
        day = "2041-04-08"
        entry = self.request("api/entries", {"work_date": day, "type": "B", "start_time": "08:00", "end_time": "16:30", "break_duration": "00:30"})["entry"]
        settings = {**self.module.DEFAULT_SETTINGS, "daily_work_minutes": [480] * 7, "live_activity_service": "mobile_app_test", "pause_minimum_notification_enabled": True}
        item = {**entry, "is_paused": True, "qualified_break_minutes": 20, "net_work_seconds": 360 * 60}
        try:
            with patch.object(self.module, "call_home_assistant_notify", return_value={"ok": True}) as notify:
                self.module.send_day_notifications(settings, item)
                notify.assert_not_called()
            item["qualified_break_minutes"] = 30
            with patch.object(self.module, "call_home_assistant_notify", side_effect=[{"ok": False}, {"ok": True}]) as notify:
                self.module.send_day_notifications(settings, item)
                self.module.send_day_notifications(settings, item)
                self.module.send_day_notifications(settings, item)
                self.assertEqual(notify.call_count, 2)
                self.assertIn("Pausenziel erreicht", notify.call_args.args[1]["title"])
            self.module.init_db()
            with patch.object(self.module, "call_home_assistant_notify") as notify:
                self.module.send_day_notifications(settings, item)
                notify.assert_not_called()
        finally:
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("DELETE FROM entries WHERE id=?", (entry["id"],))

    def test_automatic_holidays_skip_vacation_and_preserve_underlying_entries(self):
        year, holiday = 2042, "2042-01-06"
        with self.settings_override(holidays_enabled=True, holiday_state="BW", holiday_exclusions=[], daily_work_minutes=[480] * 7):
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("INSERT OR REPLACE INTO holiday_cache VALUES(?,?,?,?)", ("BW", year, json.dumps([{"date": holiday, "name": "Heilige Drei Könige"}]), datetime.now().isoformat()))
            try:
                result = self.request("api/vacation/range", {"start_date": holiday, "end_date": "2042-01-07"})
                self.assertEqual(result["added"], 1)
                with patch.object(self.module, "refresh_holidays", return_value=True):
                    entries = self.request(f"api/state?from={holiday}&to=2042-01-07")["entries"]
                automatic = next(entry for entry in entries if entry["work_date"] == holiday)
                self.assertTrue(automatic["automatic_holiday"])
                self.assertEqual(automatic["credited_minutes"], 480)
                self.assertEqual(sum(entry["type"] == "U" for entry in entries), 1)
                self.request("api/holidays/exception", {"work_date": holiday, "excluded": True})
                self.assertFalse(any(entry["work_date"] == holiday for entry in self.module.list_entries(holiday, holiday, self.module.get_settings())))
                manual = self.request("api/entries", {"work_date": holiday, "type": "B", "start_time": "08:00", "end_time": "16:30", "break_duration": "00:30"})["entry"]
                self.request("api/holidays/exception", {"work_date": holiday, "excluded": False})
                restored = self.module.list_entries(holiday, holiday, self.module.get_settings())[0]
                self.assertEqual(restored["id"], manual["id"])
                self.assertEqual(restored["type"], "B")
                with patch.object(self.module, "urlopen", side_effect=urllib.error.URLError("offline")):
                    self.assertTrue(self.module.refresh_holidays(self.module.get_settings(), year, force=True))
                self.assertEqual(self.module.cached_holidays(self.module.get_settings(), year)[0]["date"], holiday)
            finally:
                with self.module.DB_LOCK, self.module.db() as con:
                    con.execute("DELETE FROM entries WHERE work_date BETWEEN ? AND ?", (holiday, "2042-01-07"))
                    con.execute("DELETE FROM holiday_cache WHERE state='BW' AND year=?", (year,))
                self.module.HOLIDAY_ERRORS.pop(("BW", year), None)

    def test_holiday_import_filters_local_partial_and_bavarian_special_days(self):
        raw = [
            {"startDate": "2036-01-01", "endDate": "2036-01-01", "name": [{"language": "DE", "text": "Neujahr"}], "regionalScope": "Regional", "temporalScope": "FullDay"},
            {"startDate": "2036-08-08", "endDate": "2036-08-08", "name": [{"language": "DE", "text": "Lokaler Feiertag"}], "regionalScope": "Local", "temporalScope": "FullDay"},
            {"startDate": "2036-08-15", "endDate": "2036-08-15", "name": [{"language": "DE", "text": "Mariä Himmelfahrt"}], "regionalScope": "Regional", "temporalScope": "FullDay"},
            {"startDate": "2036-12-24", "endDate": "2036-12-24", "name": [{"language": "DE", "text": "Teilfreier Tag"}], "regionalScope": "Regional", "temporalScope": "HalfDay"},
        ]
        settings = {**self.module.DEFAULT_SETTINGS, "holidays_enabled": True, "holiday_state": "BY"}
        try:
            with patch.object(self.module, "urlopen", return_value=io.BytesIO(json.dumps(raw).encode())):
                self.assertTrue(self.module.refresh_holidays(settings, 2036, force=True))
            self.assertEqual(self.module.cached_holidays(settings, 2036), [{"date": "2036-01-01", "name": "Neujahr"}])
        finally:
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("DELETE FROM holiday_cache WHERE state='BY' AND year=2036")

    def test_existing_vacation_on_automatic_holiday_is_preserved_and_reversible(self):
        day = "2043-01-06"
        with self.settings_override(holiday_state="BW", holidays_enabled=True, holiday_exclusions=[], daily_work_minutes=[480] * 7):
            entry = self.request("api/entries", {"work_date": day, "type": "U", "note": "Geplanter Urlaub"})["entry"]
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("INSERT OR REPLACE INTO holiday_cache VALUES(?,?,?,?)", ("BW", 2043, json.dumps([{"date": day, "name": "Heilige Drei Könige"}]), datetime.now().isoformat()))
            try:
                visible = self.module.list_entries(day, day, self.module.get_settings())[0]
                self.assertEqual(visible["type"], "FT")
                self.assertTrue(visible["automatic_holiday"])
                self.assertFalse(any(day in period["dates"] for period in self.module.vacation_periods(self.module.get_settings())))
                with self.module.DB_LOCK, self.module.db() as con:
                    self.assertEqual(con.execute("SELECT type,note FROM entries WHERE id=?", (entry["id"],)).fetchone()[1], "Geplanter Urlaub")
                self.request("api/holidays/exception", {"work_date": day, "excluded": True})
                visible = self.module.list_entries(day, day, self.module.get_settings())[0]
                self.assertEqual(visible["type"], "U")
                self.assertEqual(visible["id"], entry["id"])
            finally:
                with self.module.DB_LOCK, self.module.db() as con:
                    con.execute("DELETE FROM entries WHERE id=?", (entry["id"],))
                    con.execute("DELETE FROM holiday_cache WHERE state='BW' AND year=2043")

    def test_notification_link_uses_actual_repository_slug(self):
        for repository, expected in (("local", "/app/local_zeitwerk"), ("a1b2c3d4", "/app/a1b2c3d4_zeitwerk")):
            response = io.BytesIO(json.dumps({"data": {"repository": repository, "slug": "zeitwerk"}}).encode())
            with patch.dict(os.environ, {"SUPERVISOR_TOKEN": "test-token"}):
                with patch.object(self.module, "urlopen", return_value=response):
                    self.assertEqual(self.module.zeitwerk_app_url(), expected)

    def test_live_activity_is_cleared_before_end_summary(self):
        settings = {**self.module.DEFAULT_SETTINGS, "live_activity_enabled": True,
                    "live_activity_service": "mobile_app_test", "end_summary_enabled": True}
        sent = []
        with patch.object(self.module, "call_home_assistant_notify", side_effect=lambda service, payload: sent.append(payload) or {"ok": True}), \
             patch.object(self.module, "schedule_live_activity_clear_retry") as retry, \
             patch.object(self.module, "end_summary_payload", return_value={"title": "Feierabend", "message": "Fertig"}), \
             patch.object(self.module.time, "sleep"):
            result = self.module.sync_live_activity(settings, "stop", {})
        self.assertTrue(result["ok"])
        self.assertEqual(sent[0], {"message": "clear_notification", "data": {"tag": self.module.LIVE_ACTIVITY_TAG}})
        self.assertEqual(sent[1]["title"], "Feierabend")
        retry.assert_called_once_with("mobile_app_test")

    def test_delayed_live_activity_clear_skips_a_reopened_timer(self):
        with patch.object(self.module, "active_entry", return_value={"id": 1}), \
             patch.object(self.module, "call_home_assistant_notify") as notify:
            self.module.retry_live_activity_clear("mobile_app_test")
        notify.assert_not_called()

    def test_goal_notification_is_independent_and_sent_only_once(self):
        future_monday = date.today() + timedelta(days=56 - date.today().weekday())
        stamp = datetime.now().isoformat(timespec="seconds")
        with self.module.DB_LOCK, self.module.db() as con:
            cur = con.execute(
                """INSERT INTO entries(work_date,type,start_time,end_time,created_at,updated_at)
                VALUES(?,'B','08:00','16:00',?,?)""",
                (future_monday.isoformat(), stamp, stamp),
            )
            entry_id = cur.lastrowid
        settings = {**self.module.DEFAULT_SETTINGS, "live_activity_enabled": False,
                    "live_activity_service": "mobile_app_test", "milestone_notifications_enabled": False,
                    "goal_notification_enabled": True}
        item = {"id": entry_id, "work_date": future_monday.isoformat(), "worked_minutes": 480}
        try:
            with patch.object(self.module, "call_home_assistant_notify", return_value={"ok": True}) as notify:
                self.module.send_progress_notifications(settings, item)
                self.module.send_progress_notifications(settings, item)
            self.assertEqual(notify.call_count, 1)
            self.assertIn("Tagesziel erreicht", notify.call_args.args[1]["title"])
        finally:
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("DELETE FROM entries WHERE id=?", (entry_id,))

    def test_notification_styles_and_goal_message(self):
        item = {"id": 17, "work_date": date.today().isoformat(), "worked_minutes": 240}
        settings = {**self.module.DEFAULT_SETTINGS, "monthly_gross_eur": 3000}
        settings["milestone_notification_style"] = "percent"
        percent = self.module.progress_notification_payload(settings, item, 50)
        self.assertIn("50 %", percent["message"])
        self.assertNotIn("€", percent["message"])
        settings["milestone_notification_style"] = "saying"
        saying = self.module.progress_notification_payload(settings, item, 50)
        self.assertNotIn("50 %", saying["title"] + saying["message"])
        self.assertNotIn("€", saying["message"])
        settings["milestone_notification_style"] = "saying_money"
        earned = self.module.progress_notification_payload(settings, item, 50)
        self.assertIn("€", earned["message"])
        goal = self.module.progress_notification_payload(settings, item, 100)
        self.assertIn("Tagesziel erreicht", goal["title"])

    def test_end_summary_compares_day_and_total_balance(self):
        today = date.today().isoformat()
        target = self.module.daily_target(self.module.DEFAULT_SETTINGS, today)
        item = {"work_date": today, "start_time": "08:00:00", "end_time": "17:00:00",
                "worked_minutes": target + 30, "account_minutes": target + 30,
                "recorded_break_minutes": 30}
        settings = {**self.module.DEFAULT_SETTINGS, "previous_balance_minutes": -15}
        with patch.object(self.module, "list_entries", return_value=[item]), \
             patch.object(self.module, "summary_for", return_value={"balance_minutes": 30}):
            payload = self.module.end_summary_payload(settings, item)
        self.assertIn("Heute +00:30 zum Soll", payload["message"])
        self.assertIn("Konto +00:15", payload["message"])
        self.assertIn("08:00–17:00", payload["data"]["subtitle"])

    def test_finalize_once_and_reopen_only_by_explicit_route(self):
        started = self.request("api/timer/start", {"type": "B"})
        self.assertTrue(started["entry"]["is_running"])
        finished = self.request("api/timer/stop", {})
        self.assertTrue(finished["entry"]["finalized"])
        with self.assertRaises(urllib.error.HTTPError) as blocked:
            self.request("api/timer/start", {"type": "B"})
        blocked.exception.close()

        # Give the explicit reopen route a one-minute-old end time.
        now = datetime.now()
        with self.module.DB_LOCK, self.module.db() as con:
            con.execute(
                "UPDATE entries SET start_time=?, end_time=? WHERE id=?",
                ((now - timedelta(minutes=2)).strftime("%H:%M:%S"),
                 (now - timedelta(minutes=1)).strftime("%H:%M:%S"),
                 finished["entry"]["id"]),
            )
        reopened = self.request("api/timer/reopen", {})
        self.assertTrue(reopened["entry"]["is_running"])
        self.assertFalse(reopened["entry"]["finalized"])
        self.assertEqual(len(reopened["entry"]["breaks"]), 1)
        self.request("api/timer/stop", {})

    def test_free_day_credits_target_without_using_vacation(self):
        day = date.today() + timedelta(days=21 - date.today().weekday())
        payload = {"work_date": day.isoformat(), "type": "FT", "note": "Feiertag"}
        saved = self.request("api/entries", payload)["entry"]
        self.assertEqual(saved["worked_minutes"], 0)
        self.assertEqual(saved["account_minutes"], self.module.daily_target(self.module.get_settings(), day.isoformat()))
        self.assertEqual(saved["type_label"], "Frei / Feiertag")
        with self.assertRaises(urllib.error.HTTPError) as duplicate:
            self.request("api/entries", payload)
        duplicate.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as legacy_type:
            self.request("api/entries", {"work_date": day.isoformat(), "type": "G", "start_time": "09:00", "end_time": "17:00"})
        legacy_type.exception.close()

    def test_vacation_range_skips_free_days_and_is_idempotent(self):
        first = date.today() + timedelta(days=7 - date.today().weekday())
        last = first + timedelta(days=6)
        payload = {"start_date": first.isoformat(), "end_date": last.isoformat(), "note": "Testurlaub"}
        saved = self.request("api/vacation/range", payload)
        self.assertEqual(saved["added"], 5)
        self.assertEqual(saved["skipped"], 2)
        repeated = self.request("api/vacation/range", payload)
        self.assertEqual(repeated["added"], 0)
        state = self.request("api/state")
        self.assertEqual(state["next_vacation"]["start_date"], first.isoformat())
        self.assertEqual(state["next_vacation"]["workdays"], 5)
        today_account = sum(entry["account_minutes"] for entry in state["today_entries"])
        today_target = self.module.daily_target(state["settings"], date.today().isoformat())
        self.assertEqual(state["summary"]["balance_minutes"], today_account - today_target)
        with self.assertRaises(urllib.error.HTTPError) as blocked:
            self.request("api/vacation/range", {"start_date": date.today().isoformat(), "end_date": date.today().isoformat()})
        blocked.exception.close()

    def test_vacation_can_start_on_existing_free_day_without_using_leave(self):
        first = date.today() + timedelta(days=28 - date.today().weekday())
        last = first + timedelta(days=6)
        self.request("api/entries", {"work_date": first.isoformat(), "type": "FT", "note": "Betriebsfrei"})
        saved = self.request("api/vacation/range", {
            "start_date": first.isoformat(), "end_date": last.isoformat(), "note": "Urlaub ab freiem Tag",
        })
        self.assertEqual(saved["added"], 4)
        self.assertEqual(saved["workdays"], 4)
        self.assertEqual(saved["skipped"], 3)
        self.assertEqual(saved["free_days"], 1)
        state = self.request("api/state")
        period = [entry for entry in state["entries"] if first.isoformat() <= entry["work_date"] <= last.isoformat()]
        self.assertEqual(len(period), 5)
        self.assertEqual(next(entry for entry in period if entry["work_date"] == first.isoformat())["type"], "FT")
        self.assertEqual(sum(entry["type"] == "U" for entry in period), 4)
        self.assertEqual(state["next_vacation"]["start_date"], (first + timedelta(days=1)).isoformat())
        repeated = self.request("api/vacation/range", {"start_date": first.isoformat(), "end_date": last.isoformat()})
        self.assertEqual(repeated["added"], 0)
        self.assertEqual(repeated["free_days"], 1)

    def test_x_day_is_complete_and_hidden_extra_hours_are_persistent(self):
        day = date.today() + timedelta(days=35 - date.today().weekday())
        self.request("api/settings", {"monthly_gross_eur": 3000})
        created = self.request("api/entries", {"work_date": day.isoformat(), "type": "X"})["entry"]
        target = self.module.daily_target(self.module.get_settings(), day.isoformat())
        self.assertEqual(created["worked_minutes"], target)
        self.assertEqual(created["extra_work_minutes"], 0)
        daily_gross = 3000 / self.module.monthly_workdays(self.module.get_settings(), day.isoformat())
        self.assertAlmostEqual(created["estimated_gross_eur"], daily_gross, places=2)
        updated = self.request("api/entries/x-extra", {"work_date": day.isoformat(), "extra_duration": "01:30"})["entry"]
        self.assertEqual(updated["worked_minutes"], target + 90)
        self.assertEqual(updated["extra_work_minutes"], 90)
        self.assertAlmostEqual(updated["estimated_gross_eur"], daily_gross, places=2)
        repeated = self.request("api/entries/x-extra", {"work_date": day.isoformat(), "extra_duration": "01:30"})["entry"]
        self.assertEqual(repeated["worked_minutes"], target + 90)
        state = self.request("api/state")
        self.assertEqual(next(item for item in state["entries"] if item["work_date"] == day.isoformat())["extra_work_minutes"], 90)
        with self.assertRaises(urllib.error.HTTPError) as invalid:
            self.request("api/entries/x-extra", {"work_date": date.today().isoformat(), "extra_duration": "00:30"})
        invalid.exception.close()

    def test_monthly_gross_is_split_across_configured_workdays(self):
        settings = self.module.get_settings()
        settings["monthly_gross_eur"] = 3000
        first = date(2026, 10, 1)
        count = self.module.monthly_workdays(settings, first.isoformat())
        self.assertEqual(count, 22)
        target = self.module.daily_target(settings, first.isoformat())
        self.assertAlmostEqual(self.module.estimated_gross(settings, first.isoformat(), target), 3000 / count, places=2)
        self.assertAlmostEqual(self.module.estimated_gross(settings, first.isoformat(), target / 2), 3000 / count / 2, places=2)
        self.assertAlmostEqual(self.module.estimated_gross(settings, first.isoformat(), target + 120), 3000 / count, places=2)
        november = date(2026, 11, 2)
        self.assertEqual(self.module.monthly_workdays(settings, november.isoformat()), 21)
        self.assertGreater(
            self.module.estimated_gross(settings, november.isoformat(), target),
            self.module.estimated_gross(settings, first.isoformat(), target),
        )

    def test_legacy_completed_work_is_finalized_without_losing_times(self):
        with tempfile.TemporaryDirectory() as old_data:
            old_path = Path(old_data) / "zeitwerk.db"
            con = sqlite3.connect(old_path)
            con.execute(
                """CREATE TABLE entries (id INTEGER PRIMARY KEY, work_date TEXT NOT NULL,
                type TEXT NOT NULL, start_time TEXT, end_time TEXT,
                manual_break_minutes INTEGER NOT NULL DEFAULT 0,
                breaks_json TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '',
                commute INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"""
            )
            con.execute(
                """INSERT INTO entries VALUES (1, ?, 'X', '09:00', '17:00', 30, '[]', '', 0, ?, ?)""",
                (date.today().isoformat(), datetime.now().isoformat(), datetime.now().isoformat()),
            )
            con.execute(
                """INSERT INTO entries VALUES (2, ?, 'G', '10:00', '18:00', 30, '[]', 'Kunde', 1, ?, ?)""",
                ((date.today() - timedelta(days=1)).isoformat(), datetime.now().isoformat(), datetime.now().isoformat()),
            )
            con.commit()
            con.close()
            os.environ["DATA_DIR"] = old_data
            try:
                spec = importlib.util.spec_from_file_location(
                    "zeitwerk_legacy_test_server", Path(__file__).resolve().parents[1] / "zeitwerk" / "app" / "server.py"
                )
                migrated = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(migrated)
                migrated.init_db()
                with migrated.DB_LOCK, migrated.db() as restored:
                    row = restored.execute("SELECT type,start_time,end_time,finalized FROM entries WHERE id=1").fetchone()
                    business = restored.execute("SELECT type,start_time,end_time,commute,note FROM entries WHERE id=2").fetchone()
                self.assertEqual(tuple(row), ("B", "09:00", "17:00", 1))
                self.assertEqual(tuple(business), ("B", "10:00", "18:00", 1, "Geschäftlich (früher G) · Kunde"))
                self.assertTrue(migrated.PRE_V4_PATH.exists())
                self.assertTrue(migrated.PRE_G_MIGRATION_PATH.exists())
                backup = sqlite3.connect(migrated.PRE_G_MIGRATION_PATH)
                try:
                    self.assertEqual(backup.execute("SELECT type FROM entries WHERE id=2").fetchone()[0], "G")
                finally:
                    backup.close()
            finally:
                os.environ["DATA_DIR"] = self.temp.name

    def test_y_backup_restores_holidays_plans_and_exceptions_offline(self):
        day = "2035-01-01"
        with self.settings_override(holiday_state="BW", holidays_enabled=True, holiday_exclusions=[day], overtime_plan_by_date={day: 60}):
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("INSERT OR REPLACE INTO holiday_cache VALUES(?,?,?,?)", ("BW", 2035, json.dumps([{"date": day, "name": "Neujahr"}]), datetime.now().isoformat()))
            backup = self.request("api/backup.json")
            self.assertTrue(any(row["year"] == 2035 for row in backup["holiday_cache"]))
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("DELETE FROM holiday_cache WHERE year=2035")
            self.request("api/import", backup)
            restored = self.module.get_settings()
            self.assertEqual(restored["overtime_plan_by_date"][day], 60)
            self.assertIn(day, restored["holiday_exclusions"])
            self.assertEqual(self.module.cached_holidays(restored, 2035)[0]["name"], "Neujahr")
            with patch.object(self.module, "urlopen", side_effect=urllib.error.URLError("offline")):
                self.assertTrue(self.module.refresh_holidays(restored, 2035, force=True))
            with self.module.DB_LOCK, self.module.db() as con:
                con.execute("DELETE FROM holiday_cache WHERE year=2035")
            self.module.HOLIDAY_ERRORS.pop(("BW", 2035), None)

    def test_z_legacy_backup_import_converts_g_without_losing_context(self):
        raw = {
            "work_date": date.today().isoformat(), "type": "G", "start_time": "09:00", "end_time": "17:00",
            "manual_break_minutes": 30, "breaks_json": "[]", "commute": 1, "note": "Außentermin",
        }
        result = self.request("api/import", {"version": 1, "entries": [raw], "settings": {}})
        self.assertEqual(result["imported"], 1)
        entry = self.request("api/state")["today_entries"][0]
        self.assertEqual(entry["type"], "B")
        self.assertEqual(entry["note"], "Geschäftlich (früher G) · Außentermin")
        self.assertTrue(entry["finalized"])


if __name__ == "__main__":
    unittest.main()

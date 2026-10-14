"""Dated calculation, live corrections and read-only vacation planning."""
import importlib.util
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch


class PlanningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        with patch.dict(os.environ, {"DATA_DIR": cls.temp.name}):
            spec = importlib.util.spec_from_file_location("planning_server", Path(__file__).resolve().parents[1] / "zeitwerk/app/server.py")
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

    def setUp(self):
        with self.module.db() as con:
            for table in ("entries", "settings", "holiday_cache"):
                con.execute(f"DELETE FROM {table}")
        self.module.init_db()

    def request(self, path, payload=None, method=None):
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(self.url + path, data=data, method=method, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            return json.load(response)

    def reject(self, path, payload, method=None):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request(path, payload, method)
        self.assertEqual(caught.exception.code, 400)
        with caught.exception as error:
            return json.load(error)["error"]

    def test_dated_model_preserves_baseline_and_handles_boundaries_and_replacement(self):
        self.request("api/settings", {"daily_work_minutes": [480] * 5 + [0, 0]})
        self.request("api/settings/dated", {"kind": "model", "effective_from": "2030-01-01", "daily_work_minutes": [360] * 5 + [0, 0]})
        self.request("api/settings/dated", {"kind": "model", "effective_from": "2030-06-01", "daily_work_minutes": [240] * 5 + [0, 0]})
        settings = self.module.get_settings()
        self.assertEqual(self.module.daily_target(settings, "2029-12-31"), 480)
        self.assertEqual(self.module.daily_target(settings, "2030-01-01"), 360)
        self.assertEqual(self.module.daily_target(settings, "2030-05-31"), 360)
        self.assertEqual(self.module.daily_target(settings, "2030-06-03"), 240)
        self.assertEqual(self.module.daily_target(settings, "2030-06-02"), 0)
        self.assertEqual(self.module.daily_target(settings, date.today()), self.module.DEFAULT_SETTINGS["daily_work_minutes"][date.today().weekday()])
        self.request("api/settings/dated", {"kind": "model", "effective_from": "2030-01-01", "daily_work_minutes": [420] * 5 + [0, 0]})
        self.assertEqual(len(self.module.get_settings()["work_model_history"]), 3)
        self.assertEqual(self.module.daily_target(self.module.get_settings(), "2030-01-01"), 420)
        self.reject("api/settings", {"daily_work_minutes": [100] * 7})
        self.reject("api/settings/dated", {"kind": "model", "effective_from": "2031-01-01", "daily_work_minutes": [1440] * 7})
        self.assertEqual(len(self.module.get_settings()["work_model_history"]), 3)

    def test_historical_salary_is_independent_and_applies_to_x_absences_and_notifications(self):
        self.request("api/settings", {"daily_work_minutes": [480] * 7, "monthly_gross_eur": 3100})
        self.request("api/settings/dated", {"kind": "salary", "effective_from": "2030-02-01", "monthly_gross_eur": 5600})
        self.request("api/settings/dated", {"kind": "model", "effective_from": "2030-02-01", "daily_work_minutes": [240] * 7})
        settings = self.module.get_settings()
        self.assertEqual(self.module.estimated_gross(settings, "2030-01-15", 480), 100)
        self.assertEqual(self.module.estimated_gross(settings, "2030-02-15", 120), 100)
        self.assertEqual(self.module.estimated_gross(settings, "2030-02-15", 480), 200)
        for kind in ("X", "U", "FT"):
            entry = self.request("api/entries", {"work_date": f"2030-02-{15 + ('X','U','FT').index(kind)}", "type": kind})["entry"]
            self.assertEqual(entry["account_minutes"], 240)
            self.assertEqual(entry["estimated_gross_eur"], 200)
        self.request("api/settings/dated", {"kind": "model", "effective_from": "2030-02-15", "daily_work_minutes": [240] * 5 + [0, 0]})
        settings = self.module.get_settings()
        self.assertEqual(self.module.estimated_gross(settings, "2030-02-14", 240), 200)
        self.assertEqual(self.module.estimated_gross(settings, "2030-02-15", 240), 280)
        self.request("api/settings/dated", {"kind": "salary", "effective_from": "2030-03-01", "monthly_gross_eur": 0})
        self.assertTrue(self.module.has_gross_setting(self.module.get_settings(), "2030-02-15"))
        self.assertFalse(self.module.has_gross_setting(self.module.get_settings(), "2030-03-15"))

    def test_dated_changes_survive_restart_and_backup_and_legacy_import_resets_history(self):
        legacy = self.request("api/backup.json")
        legacy["settings"].pop("work_model_history")
        legacy["settings"].pop("salary_history")
        self.request("api/settings/dated", {"kind": "model", "effective_from": "2020-01-01", "daily_work_minutes": [300] * 7})
        self.request("api/settings/dated", {"kind": "salary", "effective_from": "2020-01-01", "monthly_gross_eur": 3000})
        backup = self.request("api/backup.json")
        self.module.init_db()
        self.assertEqual(self.module.daily_target(self.module.get_settings(), "2025-01-01"), 300)
        self.request("api/import", backup)
        self.assertEqual(self.module.get_settings()["salary_history"], backup["settings"]["salary_history"])
        bad = json.loads(json.dumps(backup))
        bad["settings"]["work_model_history"][1]["daily_work_minutes"] = []
        self.reject("api/import", bad)
        self.assertEqual(self.module.get_settings()["work_model_history"], backup["settings"]["work_model_history"])
        self.request("api/import", legacy)
        self.assertEqual(self.module.get_settings()["work_model_history"], [])
        self.assertEqual(self.module.get_settings()["salary_history"], [])

    def test_start_correction_keeps_active_pause_and_does_not_finalize(self):
        class FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls.combine(date.today(), datetime.min.time()).replace(hour=12)
        with patch.object(self.module, "datetime", FixedDatetime):
            entry = self.request("api/timer/start", {"type": "B"})["entry"]
            self.request("api/timer/pause", {})
            with self.module.db() as con:
                con.execute("UPDATE entries SET manual_break_minutes=20,note='Keep',commute=1 WHERE id=?", (entry["id"],))
                original = dict(con.execute("SELECT * FROM entries WHERE id=?", (entry["id"],)).fetchone())
            updated = self.request("api/timer/start-time", {"entry_id": entry["id"], "start_time": "08:15", "end_time": "10:00"})["entry"]
            self.assertIsNone(updated["end_time"])
            self.assertFalse(updated["finalized"])
            self.assertTrue(updated["is_paused"])
            self.assertEqual(updated["start_time"], "08:15:00")
            with self.module.db() as con:
                after = dict(con.execute("SELECT * FROM entries WHERE id=?", (entry["id"],)).fetchone())
            for key in original:
                if key not in {"start_time", "updated_at"}:
                    self.assertEqual(after[key], original[key], key)
            with self.module.db() as con:
                segments = [{"start": "10:00:00", "end": "10:30:00"}] + json.loads(after["breaks_json"])
                con.execute("UPDATE entries SET breaks_json=? WHERE id=?", (json.dumps(segments), entry["id"]))
            self.assertIn("Pause", self.reject("api/timer/start-time", {"entry_id": entry["id"], "start_time": "11:00"}))
            self.reject("api/timer/start-time", {"entry_id": entry["id"], "start_time": "12:01"})
            self.reject("api/timer/start-time", {"entry_id": 999, "start_time": "08:00"})
            self.reject(f"api/entries/{entry['id']}", {"work_date": date.today().isoformat(), "type": "B", "start_time": "08:00", "end_time": "11:00"}, "PUT")
            self.request("api/timer/resume", {})
            self.request("api/timer/stop", {})
            self.reject("api/timer/start-time", {"entry_id": entry["id"], "start_time": "08:00"})

    def test_bridge_planner_four_days_nine_free_and_no_writes(self):
        # Friday is a manually free day, even without automatic holidays.
        settings = self.module.get_settings()
        rows = [{"work_date": "2027-03-26", "type": "FT"}]
        suggestions = self.module.bridge_day_suggestions(settings, 2027, 4, rows, today=date(2027, 1, 1))
        best = suggestions[0]
        self.assertEqual((best["start_date"], best["end_date"], best["free_days"], best["vacation_days"]), ("2027-03-20", "2027-03-28", 9, 4))
        self.assertNotIn("2027-03-26", best["dates_to_book"])
        self.request("api/entries", {"work_date": "2027-03-26", "type": "FT"})
        backup = self.request("api/backup.json")
        class PlannerDate(date):
            @classmethod
            def today(cls):
                return cls(2026, 10, 14)
        with patch.object(self.module, "date", PlannerDate):
            result = self.request("api/vacation/suggestions", {"year": 2027, "max_days": 4})
        self.assertEqual(result["suggestions"][0]["free_days"], 9)
        self.assertEqual(self.request("api/backup.json")["entries"], backup["entries"])

    def test_planner_honors_dated_schedule_conflicts_bookings_and_holiday_exclusions(self):
        settings = self.module.get_settings()
        settings.update(holidays_enabled=True, holiday_state="BE", holiday_exclusions=["2027-03-26"])
        with patch.object(self.module, "cached_holidays", return_value=[{"date": "2027-03-26", "name": "Holiday"}]):
            plain = self.module.bridge_day_suggestions(settings, 2027, 4, [], today=date(2027, 1, 1))
            self.assertLessEqual(max(item["free_days"] for item in plain), 6)
            settings["holiday_exclusions"] = []
            best = self.module.bridge_day_suggestions(settings, 2027, 4, [], today=date(2027, 1, 1))[0]
            self.assertEqual(best["free_days"], 9)
            self.assertEqual(best["holidays"][0]["name"], "Holiday")
            rows = [{"work_date": "2027-03-22", "type": "B"}, {"work_date": "2027-03-23", "type": "U"}]
            suggestions = self.module.bridge_day_suggestions(settings, 2027, 4, rows, today=date(2027, 1, 1))
            for item in suggestions:
                self.assertFalse(item["start_date"] <= "2027-03-22" <= item["end_date"])
                self.assertNotIn("2027-03-23", item["dates_to_book"])
            settings["work_model_history"] = [{"effective_from": "2027-01-01", "daily_work_minutes": [480, 480, 480, 0, 0, 0, 0]}]
            for item in self.module.bridge_day_suggestions(settings, 2027, 4, [], today=date(2027, 1, 1)):
                self.assertTrue(all(date.fromisoformat(day).weekday() < 3 for day in item["dates_to_book"]))


if __name__ == "__main__":
    unittest.main()

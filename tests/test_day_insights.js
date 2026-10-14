"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../zeitwerk/app/static/app.js"), "utf8");
function helper(name, context = {}) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  const end = source.indexOf("\n  function ", start + 1);
  return vm.runInNewContext(`${source.slice(start, end)}; ${name}`, context);
}
const liveAccount = helper("liveAccountMinutes");
const adult = { age_group: "adult", auto_break_deduction: true };
assert.equal(liveAccount({ netSeconds: 360 * 60, qualifiedMinutes: 0 }, adult), 360);
assert.equal(liveAccount({ netSeconds: 480 * 60, qualifiedMinutes: 0 }, adult), 450);
assert.equal(liveAccount({ netSeconds: 480 * 60, qualifiedMinutes: 15 }, adult), 465);
assert.equal(liveAccount({ netSeconds: 480 * 60, qualifiedMinutes: 30 }, adult), 480);
assert.equal(liveAccount({ netSeconds: 555 * 60, qualifiedMinutes: 30 }, adult), 540);
assert.equal(liveAccount({ netSeconds: 480 * 60, qualifiedMinutes: 0 }, { ...adult, auto_break_deduction: false }), 480);
assert.equal(liveAccount({ netSeconds: 271 * 60, qualifiedMinutes: 0 }, { ...adult, age_group: "minor" }), 241);
const week = helper("calendarWeek");
assert.equal(week(new Date(2021, 0, 1)).week, 53);
assert.equal(week(new Date(2021, 0, 1)).year, 2020);
assert.equal(week(new Date(2026, 9, 14)).week, 42);
assert.equal(week(new Date(2027, 0, 4)).week, 1);
const today = new Date();
const key = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
const totals = helper("periodSummary", {
  state: { entries: [{ work_date: key, worked_minutes: 60, account_minutes: 60 }, { work_date: key, worked_minutes: 0, account_minutes: 420 }] },
  isoDate: () => key,
  countsForAccount: () => true,
  targetBetween: () => 480,
});
const result = totals({ first: today, last: today });
assert.equal(result.worked, 60);
assert.equal(result.account, 480);
assert.equal(result.saldo, 0, "Credited time, not only worked time, determines the balance");
console.log("Day insights: live account, ISO weeks and credited period totals passed.");

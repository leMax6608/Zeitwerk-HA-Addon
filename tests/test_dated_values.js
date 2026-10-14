"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../zeitwerk/app/static/app.js"), "utf8");
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end);
}
const state = { settings: {
  daily_work_minutes: Array(7).fill(480), monthly_gross_eur: 3100,
  work_model_history: [
    { effective_from: "0001-01-01", daily_work_minutes: Array(7).fill(480) },
    { effective_from: "2030-02-01", daily_work_minutes: Array(7).fill(240) },
  ],
  salary_history: [
    { effective_from: "0001-01-01", monthly_gross_eur: 3100 },
    { effective_from: "2030-02-01", monthly_gross_eur: 5600 },
    { effective_from: "2030-03-01", monthly_gross_eur: 0 },
  ],
} };
const context = vm.createContext({ state, Date,
  isoDate: value => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; },
  parseISO: value => { const [y,m,d] = value.split("-").map(Number); return new Date(y,m-1,d); },
});
const helpers = ["effectiveValues", "dailyTargets", "weekdayIndex", "targetPerDay", "monthlyWorkdays", "grossForMinutes"].map(extract).join("\n");
vm.runInContext(helpers, context);
assert.equal(context.targetPerDay("2030-01-31"), 480);
assert.equal(context.targetPerDay("2030-02-01"), 240);
assert.equal(context.grossForMinutes("2030-01-15", 480), 100);
assert.equal(context.grossForMinutes("2030-02-15", 120), 100);
assert.equal(context.grossForMinutes("2030-02-15", 480), 200);
assert.equal(context.grossForMinutes("2030-03-15", 480), 0);
assert.equal(context.grossForMinutes("2030-02-15", 240, 0), 0);
state.settings.work_model_history.push({ effective_from: "2030-02-15", daily_work_minutes: [240,240,240,240,240,0,0] });
assert.equal(context.targetPerDay("2030-02-16"), 0);
assert.equal(context.monthlyWorkdays("2030-02-15"), 20);
assert.equal(context.grossForMinutes("2030-02-14", 240), 200, "Later work-week changes must not change earlier earnings in the same month");
assert.equal(context.grossForMinutes("2030-02-15", 240), 280);
const html = fs.readFileSync(path.join(__dirname, "../zeitwerk/app/static/index.html"), "utf8");
const correction = html.split('id="startCorrectionDialog"')[1].split("</dialog>")[0];
assert.ok(correction.includes('id="startCorrectionTime"'));
assert.ok(!correction.includes('id="entryEnd"'));
assert.ok(!correction.includes('type="date"'), "Correction cannot move the running day to another date");
console.log("Dated model and salary: frontend calculations match historical dates; correction has no end field.");

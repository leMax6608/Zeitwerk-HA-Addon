"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Test the actual app helper without starting a browser or changing time data.
const source = fs.readFileSync(path.join(__dirname, "../zeitwerk/app/static/app.js"), "utf8");
const start = source.indexOf("  function weekBarProgress(");
assert.ok(start >= 0, "weekBarProgress must exist");
const end = source.indexOf("\n  function ", start + 1);
const progress = vm.runInNewContext(`${source.slice(start, end)}; weekBarProgress`);
const cases = [
  [0, 480, 0, 0, 0],
  [240, 480, 50, 0, 0],
  [480, 480, 100, 0, 0],
  [600, 480, 100, 25, 120],
  [720, 480, 100, 50, 240],
  [960, 480, 100, 100, 480],
  [1200, 480, 100, 100, 720],
  [300, 240, 100, 25, 60],
  [60, 0, 0, 100, 60],
  [0, 0, 0, 0, 0],
  [-30, 480, 0, 0, 0],
];
for (const [worked, target, goal, overtime, minutes] of cases) {
  const actual = progress(worked, target);
  assert.equal(actual.goalPercent, goal);
  assert.equal(actual.overtimePercent, overtime);
  assert.equal(actual.overtimeMinutes, minutes);
}
assert.ok(progress(481, 480).overtimePercent > 0, "The first overtime minute must be visible");
console.log("Weekly bar progress: 12 cases passed.");

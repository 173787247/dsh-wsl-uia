import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makeHandle, parseHandle, checkHandle, clampInt,
  normalizeWindow, normalizeElement, isInteresting, shouldDescend,
  formatWindows, formatTree, parameters,
} from "../lib/uia.js";

describe("handles", () => {
  it("round-trips", () => {
    assert.equal(makeHandle(1700000000000, 42), "1700000000000.42");
    assert.deepEqual(parseHandle("1700000000000.42"), { epoch: 1700000000000, index: 42 });
  });
  it("rejects malformed", () => {
    assert.equal(parseHandle("nope"), null);
    assert.equal(parseHandle("1"), null);
    assert.equal(parseHandle("1.2.3"), null);
    assert.equal(parseHandle(undefined), null);
  });
  it("accepts a handle from the current observation", () => {
    const r = checkHandle(makeHandle(7, 3), { epoch: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.index, 3);
  });
  it("rejects a handle from an earlier observation", () => {
    const r = checkHandle(makeHandle(6, 3), { epoch: 7 });
    assert.equal(r.ok, false);
    assert.match(r.error, /stale handle/);
  });
  it("reports a malformed handle rather than treating it as stale", () => {
    const r = checkHandle("garbage", { epoch: 7 });
    assert.equal(r.ok, false);
    assert.match(r.error, /malformed/);
  });
});

describe("clampInt", () => {
  it("clamps to the range", () => {
    assert.equal(clampInt(9999, { min: 1, max: 100, fallback: 5 }), 100);
    assert.equal(clampInt(-3, { min: 1, max: 100, fallback: 5 }), 1);
    assert.equal(clampInt(50, { min: 1, max: 100, fallback: 5 }), 50);
  });
  it("falls back on non-numbers", () => {
    assert.equal(clampInt(undefined, { min: 1, max: 100, fallback: 5 }), 5);
    assert.equal(clampInt("abc", { min: 1, max: 100, fallback: 5 }), 5);
    assert.equal(clampInt(NaN, { min: 1, max: 100, fallback: 5 }), 5);
  });
  it("truncates fractions", () => {
    assert.equal(clampInt(4.9, { min: 1, max: 100, fallback: 5 }), 4);
  });
});

describe("normalizeWindow", () => {
  it("coerces and defaults", () => {
    const w = normalizeWindow({ pid: "123", title: "Notepad", width: "800.7" });
    assert.equal(w.pid, 123);
    assert.equal(w.title, "Notepad");
    assert.equal(w.width, 800);
    assert.equal(w.height, 0);
    assert.equal(w.foreground, false);
  });
  it("survives an empty object", () => {
    const w = normalizeWindow({});
    assert.equal(w.pid, 0);
    assert.equal(w.title, "");
  });
});

describe("normalizeElement", () => {
  it("attaches a handle from epoch and index", () => {
    const e = normalizeElement({ depth: 2, controlType: "Button", name: "OK" }, 5, 99);
    assert.equal(e.handle, "99.5");
    assert.equal(e.index, 5);
    assert.equal(e.controlType, "Button");
  });
  it("truncates a very long name", () => {
    const e = normalizeElement({ name: "x".repeat(500) }, 0, 1);
    assert.equal(e.name.length, 200);
  });
  it("defaults patterns to an empty array", () => {
    assert.deepEqual(normalizeElement({}, 0, 1).patterns, []);
  });
});

describe("isInteresting", () => {
  it("keeps named elements", () => {
    assert.equal(isInteresting({ name: "Save", patterns: [] }), true);
  });
  it("keeps unnamed but actionable elements", () => {
    assert.equal(isInteresting({ name: "", patterns: ["InvokePattern"] }), true);
  });
  it("drops anonymous inert elements", () => {
    assert.equal(isInteresting({ name: "", patterns: [] }), false);
  });
});

describe("shouldDescend", () => {
  it("stops at the depth limit", () => {
    assert.equal(shouldDescend(3, { maxDepth: 4 }), true);
    assert.equal(shouldDescend(4, { maxDepth: 4 }), false);
  });
});

describe("formatters", () => {
  it("summarizes windows", () => {
    const out = formatWindows({ ok: true, count: 1, windows: [{ pid: 9, title: "x", width: 1, height: 2, foreground: true }] });
    assert.match(out, /ok=true count=1/);
    assert.match(out, /pid=9 \[fg\]/);
  });
  it("summarizes a tree and flags truncation", () => {
    const out = formatTree({ ok: true, epoch: 1, count: 1, truncated: true, elements: [{ handle: "1.0", depth: 1, controlType: "Button", name: "OK", enabled: true, patterns: ["InvokePattern"] }] });
    assert.match(out, /truncated/);
    assert.match(out, /1\.0 +Button "OK" \[InvokePattern\]/);
  });
  it("marks a disabled element", () => {
    const out = formatTree({ ok: true, elements: [{ handle: "1.0", depth: 0, controlType: "Button", name: "X", enabled: false, patterns: [] }] });
    assert.match(out, /\(disabled\)/);
  });
});

describe("parameters", () => {
  it("declares no additional properties", () => {
    assert.equal(parameters().additionalProperties, false);
  });
  it("lists the three actions", () => {
    assert.deepEqual(parameters().properties.action.enum, ["windows", "tree", "find"]);
  });
});

// Live smoke test: skipped unless the Windows host is reachable. The unit tests
// above cover the pure logic; this one catches what they cannot — the shape of
// what UI Automation actually returns on this machine.
import { detectWsl, windowsBin } from "../lib/wsl-host.js";
import { existsSync } from "node:fs";
import { execute } from "../lib/uia-exec.js";

const canRunLive = detectWsl() && existsSync(windowsBin("powershell.exe"));
describe("live (skipped outside WSL)", { skip: !canRunLive }, () => {
  it("lists at least one top-level window", async () => {
    const v = await execute({ action: "windows" }, { timeoutMs: 40_000 });
    assert.equal(v.ok, true);
    assert.ok(v.count >= 1, "expected at least one window");
    assert.ok(v.windows.every((w) => Number.isInteger(w.pid)));
  });

  it("walks a tree and hands out handles from one epoch", async () => {
    const v = await execute({ action: "tree", maxDepth: 10, maxElements: 300 }, { timeoutMs: 90_000 });
    assert.equal(v.ok, true);
    assert.ok(v.count >= 1, "expected at least one element");
    const epochs = new Set(v.elements.map((e) => e.handle.split(".")[0]));
    assert.equal(epochs.size, 1, "every handle must belong to this observation");
    assert.equal(Number([...epochs][0]), v.epoch);
  });

  it("finds an actionable element", async () => {
    const v = await execute({ action: "find", controlType: "Button", maxDepth: 12, maxElements: 400 }, { timeoutMs: 90_000 });
    assert.equal(v.ok, true);
    assert.ok(v.elements.every((e) => e.controlType === "Button"));
  });
});

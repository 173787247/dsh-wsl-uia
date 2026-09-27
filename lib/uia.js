// UI Automation observation from WSL.
//
// The PowerShell side does the walking; everything here that can be tested
// without Windows is kept pure and exported, so `node --test` runs anywhere.

/** Observation-local handles are `<epoch>.<index>`; the epoch makes a stale one detectable. */
export function makeHandle(epoch, index) {
  return `${epoch}.${index}`;
}

export function parseHandle(handle) {
  if (typeof handle !== "string") return null;
  const m = /^(\d+)\.(\d+)$/.exec(handle.trim());
  if (!m) return null;
  return { epoch: Number(m[1]), index: Number(m[2]) };
}

/**
 * A handle is only usable if it came from an observation of the same window and
 * the current epoch. Anything else means the caller is acting on a picture of
 * the UI that may already be out of date, which is what this check exists to
 * catch rather than paper over.
 */
export function checkHandle(handle, { epoch, pid }) {
  const parsed = parseHandle(handle);
  if (!parsed) return { ok: false, error: `malformed handle: ${String(handle)}` };
  if (parsed.epoch !== epoch) {
    return { ok: false, error: `stale handle: observation epoch ${parsed.epoch}, current ${epoch}` };
  }
  if (pid !== undefined && Number(pid) !== parsed.epoch && !Number.isFinite(pid)) {
    return { ok: false, error: `malformed pid: ${String(pid)}` };
  }
  return { ok: true, ...parsed };
}

export function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Keep the tree bounded: the model gets a slice, not the whole desktop. */
export function shouldDescend(depth, limits) {
  return depth < limits.maxDepth;
}

export function normalizeWindow(w) {
  const pid = Number(w.pid);
  return {
    pid: Number.isFinite(pid) ? pid : 0,
    handle: String(w.handle ?? ""),
    title: String(w.title ?? ""),
    className: String(w.className ?? ""),
    x: Math.trunc(Number(w.x) || 0),
    y: Math.trunc(Number(w.y) || 0),
    width: Math.trunc(Number(w.width) || 0),
    height: Math.trunc(Number(w.height) || 0),
    foreground: Boolean(w.foreground),
  };
}

export function normalizeElement(e, index, epoch) {
  return {
    handle: makeHandle(epoch, index),
    index,
    depth: Math.trunc(Number(e.depth) || 0),
    controlType: String(e.controlType ?? ""),
    name: String(e.name ?? "").slice(0, 200),
    automationId: String(e.automationId ?? ""),
    className: String(e.className ?? ""),
    enabled: Boolean(e.enabled),
    x: Math.trunc(Number(e.x) || 0),
    y: Math.trunc(Number(e.y) || 0),
    width: Math.trunc(Number(e.width) || 0),
    height: Math.trunc(Number(e.height) || 0),
    patterns: Array.isArray(e.patterns) ? e.patterns.map(String) : [],
  };
}

/** An element is worth surfacing if it is named or actionable. */
export function isInteresting(el) {
  return Boolean(el.name) || el.patterns.length > 0;
}

export function formatWindows(v) {
  const lines = [`uia_windows ok=${v.ok} count=${v.count ?? 0}`];
  for (const w of v.windows ?? []) {
    lines.push(`  pid=${w.pid} ${w.foreground ? "[fg]" : "    "} ${w.width}x${w.height} ${w.title || "(untitled)"}`);
  }
  if (v.error) lines.push(`error: ${v.error}`);
  return lines.join("\n");
}

export function formatTree(v) {
  const lines = [`uia_tree ok=${v.ok} epoch=${v.epoch ?? "-"} nodes=${v.count ?? 0}${v.truncated ? " (truncated)" : ""}`];
  if (v.window) lines.push(`window: pid=${v.window.pid} "${v.window.title}"`);
  for (const e of v.elements ?? []) {
    const pad = "  ".repeat(Math.min(e.depth, 6));
    const act = e.patterns.length ? ` [${e.patterns.join(",")}]` : "";
    lines.push(`  ${e.handle} ${pad}${e.controlType} "${e.name}"${e.enabled ? "" : " (disabled)"}${act}`);
  }
  if (v.error) lines.push(`error: ${v.error}`);
  return lines.join("\n");
}

export function parameters() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["windows", "tree", "find"], description: "windows: list top-level windows. tree: read a bounded element tree. find: search a tree for matching elements." },
      pid: { type: "number", description: "Target process id (tree/find). Defaults to the foreground window." },
      windowHandle: { type: "string", description: "Target window handle, as returned by action=windows." },
      maxDepth: { type: "number", description: "Tree depth limit (default 4, max 12)." },
      maxElements: { type: "number", description: "Element budget (default 200, max 1500)." },
      nameContains: { type: "string", description: "find: case-insensitive substring of the element name." },
      controlType: { type: "string", description: "find: control type filter, e.g. Button." },
      actionableOnly: { type: "boolean", description: "Return only elements that expose an action pattern." },
    },
  };
}

export function outputSchema() {
  return { type: "object", additionalProperties: true };
}

export function format(v) {
  if (v.action === "windows") return formatWindows(v);
  return formatTree(v);
}

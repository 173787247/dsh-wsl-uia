// Element location by identity, plus the two actions built on it.
//
// Kept out of uia-exec.js on purpose: the first attempt to add these patched
// that file with string replacement, every anchor missed, and every miss was
// silent — `replace` returns the input unchanged when it does not match. A
// separate module cannot fail that way.
import { runPowerShell } from "./wsl-host.js";
import { clampInt } from "./uia.js";

const PRELUDE = `
$ErrorActionPreference = 'Stop'
# The console codepage mangles non-ASCII window titles; force UTF-8 on the way out.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;using System.Runtime.InteropServices;
public class DshLoc {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
function Dsh-Window([int]$targetPid, [string]$title) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
  $wins = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  foreach ($w in $wins) {
    if ($w.Current.NativeWindowHandle -eq 0) { continue }
    if ($targetPid -gt 0 -and $w.Current.ProcessId -ne $targetPid) { continue }
    if ($title -ne '' -and $w.Current.Name -notlike "*$title*") { continue }
    return $w
  }
  return $null
}
`;

function psq(s) {
  return "'" + String(s ?? "").replace(/'/g, "''") + "'";
}

/**
 * A walk that collects every element whose name equals expectName, optionally
 * narrowed by control type. Exact match, not substring: a substring match on a
 * short name is how you end up with several candidates and no way to choose.
 */
function locate(expectName, expectType, maxDepth, maxElements) {
  return `
$matches = New-Object System.Collections.ArrayList
$seen = 0
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$queue = New-Object System.Collections.Queue
$queue.Enqueue(@{ el = $target; d = 0 })
while ($queue.Count -gt 0 -and $seen -lt ${maxElements}) {
  $item = $queue.Dequeue(); $el = $item.el; $d = $item.d
  $seen++
  if ($d -gt 0) {
    try {
      $ct = $el.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
      $nm = $el.Current.Name
      $typeOk = ${expectType ? `($ct -eq ${psq(expectType)})` : "$true"}
      if ($typeOk -and $nm -eq ${psq(expectName)}) { [void]$matches.Add($el) }
    } catch {}
  }
  if ($d -lt ${maxDepth}) {
    $c = $walker.GetFirstChild($el)
    while ($c) { $queue.Enqueue(@{ el = $c; d = $d + 1 }); $c = $walker.GetNextSibling($c) }
  }
}
`;
}

export function buildWaitScript({ pid, expectName, expectType, maxDepth, maxElements }) {
  return `${PRELUDE}
$target = Dsh-Window ${pid} ''
if ($null -eq $target) { ConvertTo-Json -Compress @{ error = 'no matching window' }; exit }
${locate(expectName, expectType, maxDepth, maxElements)}
if ($matches.Count -eq 0) { ConvertTo-Json -Compress @{ found = $false; searched = $seen }; exit }
ConvertTo-Json -Compress -Depth 4 @{
  found = $true
  count = $matches.Count
  searched = $seen
  element = @{
    controlType = $matches[0].Current.ControlType.ProgrammaticName.Replace('ControlType.','')
    name = $matches[0].Current.Name
    enabled = $matches[0].Current.IsEnabled
  }
  window = @{ pid = $target.Current.ProcessId; title = $target.Current.Name }
}
`;
}

export function buildPathScript({ pid, expectName, expectType, maxDepth, maxElements }) {
  return `${PRELUDE}
$target = Dsh-Window ${pid} ''
if ($null -eq $target) { ConvertTo-Json -Compress @{ error = 'no matching window' }; exit }
${locate(expectName, expectType, maxDepth, maxElements)}
if ($matches.Count -eq 0) { ConvertTo-Json -Compress @{ error = 'no element matched' }; exit }
if ($matches.Count -gt 1) { ConvertTo-Json -Compress @{ error = 'ambiguous: more than one element matched'; count = $matches.Count }; exit }
# Walk up from the match to the window and reverse, so the chain reads root-first.
$el = $matches[0]
$chain = New-Object System.Collections.ArrayList
while ($null -ne $el) {
  [void]$chain.Insert(0, @{
    controlType = $el.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
    name = $el.Current.Name
    automationId = $el.Current.AutomationId
  })
  # Stop at the top-level Window, not at the first element carrying an HWND: a
  # native edit control has its own handle, so testing for one stops on the
  # first level and the chain comes back as a single entry.
  if ($el.Current.ControlType.ProgrammaticName -eq "ControlType.Window") { break }
  $el = $walker.GetParent($el)
}
ConvertTo-Json -Compress -Depth 5 @{ chain = @($chain); searched = $seen }
`;
}

const LIMITS = (args, config) => ({
  expectName: typeof args?.expectName === "string" ? args.expectName : "",
  expectType: typeof args?.expectType === "string" ? args.expectType : "",
  maxDepth: clampInt(args?.maxDepth, { min: 1, max: 12, fallback: 10 }),
  maxElements: clampInt(args?.maxElements, { min: 1, max: 1500, fallback: 1200 }),
  timeoutMs: clampInt(config?.timeoutMs, { min: 1000, max: 120000, fallback: 30000 }),
});

export async function waitForElement(args, config) {
  const o = LIMITS(args, config);
  if (!o.expectName) return { ok: false, action: "wait", error: "expectName is required: name the element to look for" };
  const budget = clampInt(args?.waitMs, { min: 100, max: 60000, fallback: 8000 });
  const started = Date.now();
  let last = { ok: true, action: "wait", found: false, searched: 0, waitedMs: 0 };
  for (;;) {
    const { stdout } = await runPowerShell(
      buildWaitScript({ pid: clampInt(args?.pid, { min: 0, max: 2 ** 31, fallback: 0 }), ...o }),
      { timeoutMs: o.timeoutMs },
    );
    const out = JSON.parse(stdout.trim() || "{}");
    if (out.error) return { ok: false, action: "wait", error: String(out.error) };
    const elapsed = Date.now() - started;
    last = {
      ok: true, action: "wait", found: Boolean(out.found), count: out.count ?? 0,
      searched: out.searched ?? 0, element: out.element, window: out.window, waitedMs: elapsed,
    };
    // A timeout is an answer — "it did not appear" — not a failure.
    if (last.found || elapsed >= budget) break;
    await new Promise((r) => setTimeout(r, elapsed < 2000 ? 400 : 800));
  }
  return last;
}

export async function elementPath(args, config) {
  const o = LIMITS(args, config);
  if (!o.expectName) return { ok: false, action: "path", error: "expectName is required: name the element to trace" };
  const { stdout } = await runPowerShell(
    buildPathScript({ pid: clampInt(args?.pid, { min: 0, max: 2 ** 31, fallback: 0 }), ...o }),
    { timeoutMs: o.timeoutMs },
  );
  const out = JSON.parse(stdout.trim() || "{}");
  if (out.error) return { ok: false, action: "path", error: String(out.error) };
  return { ok: true, action: "path", chain: out.chain ?? [], searched: out.searched ?? 0 };
}

// The Windows side: PowerShell that walks UI Automation and returns JSON.
// Kept apart from lib/uia.js so the pure normalizers stay unit-testable.
import { runPowerShell } from "./wsl-host.js";
import {
  clampInt, normalizeWindow, normalizeElement, isInteresting, shouldDescend,
} from "./uia.js";

const PRELUDE = `
$ErrorActionPreference = 'Stop'
# The console codepage mangles non-ASCII window titles; force UTF-8 on the way out.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public class DshW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
}
"@
# A minimized or hidden window reports an empty rectangle, whose components are
# not convertible to Int32 — they are [+/-]Infinity or NaN. Convert through a
# guard so those windows still appear, at 0x0, instead of throwing.
function Dsh-I([double]$v) { if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { 0 } else { [int]$v } }
function Dsh-Rect($el) {
  try { $r = $el.Current.BoundingRectangle } catch { return @{ x=0; y=0; width=0; height=0 } }
  @{ x=(Dsh-I $r.X); y=(Dsh-I $r.Y); width=(Dsh-I $r.Width); height=(Dsh-I $r.Height) }
}
# Hashtables, not nested arrays: PowerShell flattens @(@(a,b),@(c,d)) into one
# flat array, which silently turns each entry into a scalar and makes the lookup
# below throw.
function Dsh-Patterns($el) {
  $names = @()
  $table = @(
    @{ n='InvokePattern';        p=[System.Windows.Automation.InvokePattern]::Pattern },
    @{ n='ValuePattern';         p=[System.Windows.Automation.ValuePattern]::Pattern },
    @{ n='TogglePattern';        p=[System.Windows.Automation.TogglePattern]::Pattern },
    @{ n='SelectionItemPattern'; p=[System.Windows.Automation.SelectionItemPattern]::Pattern },
    @{ n='ExpandCollapsePattern';p=[System.Windows.Automation.ExpandCollapsePattern]::Pattern },
    @{ n='ScrollPattern';        p=[System.Windows.Automation.ScrollPattern]::Pattern }
  )
  foreach ($row in $table) {
    try { $o = $null; if ($el.TryGetCurrentPattern($row.p, [ref]$o)) { $names += $row.n } } catch {}
  }
  ,$names
}
`;

export function windowsScript() {
  return `${PRELUDE}
$fg = [DshW]::GetForegroundWindow()
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$wins = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$out = @()
foreach ($w in $wins) {
  try {
    $r = Dsh-Rect $w
    $out += [pscustomobject]@{
      pid = $w.Current.ProcessId
      handle = $w.Current.NativeWindowHandle.ToString()
      title = $w.Current.Name
      className = $w.Current.ClassName
      x = $r.x; y = $r.y; width = $r.width; height = $r.height
      foreground = ($w.Current.NativeWindowHandle -eq $fg.ToInt64())
    }
  } catch {}
}
ConvertTo-Json -Compress -Depth 4 @($out)
`;
}

export function treeScript({ pid, maxDepth, maxElements, nameContains, controlType, actionableOnly }) {
  // `$_` is not bound outside a pipeline — these run as plain expressions
  // against `$el`, so they must name it directly.
  const filterName = nameContains ? `$el.Current.Name -like ${psQuote("*" + nameContains + "*")}` : "$true";
  const filterType = controlType ? `$el.Current.ControlType.ProgrammaticName -like ${psQuote("*" + controlType + "*")}` : "$true";
  return `${PRELUDE}
$target = $null
if (${pid || 0} -gt 0) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${pid || 0})
  $roots = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
  if ($roots.Count -gt 0) { $target = $roots[0] }
} else {
  $h = [DshW]::GetForegroundWindow()
  $target = [System.Windows.Automation.AutomationElement]::FromHandle($h)
}
if ($null -eq $target) { ConvertTo-Json -Compress @{ error = 'no matching window' }; exit }
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$out = @()
$queue = New-Object System.Collections.Queue
# A 2-element array is unwrapped by the Enqueue(object) overload, so the
# pair has to be a single object.
$queue.Enqueue(@{ el = $target; d = 0 })
while ($queue.Count -gt 0 -and $out.Count -lt ${maxElements}) {
  $item = $queue.Dequeue(); $el = $item.el; $d = $item.d
  try {
    $r = Dsh-Rect $el
    $pn = Dsh-Patterns $el
    $keep = (${filterName}) -and (${filterType})
    if (${actionableOnly ? "$true" : "$false"}) { $keep = $keep -and ($pn.Count -gt 0) }
    if ($d -gt 0 -and $keep) {
      $out += [pscustomobject]@{
        depth = $d
        controlType = $el.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
        name = $el.Current.Name
        automationId = $el.Current.AutomationId
        className = $el.Current.ClassName
        enabled = $el.Current.IsEnabled
        x = $r.x; y = $r.y; width = $r.width; height = $r.height
        patterns = $pn
      }
    }
  } catch {}
  if ($d -lt ${maxDepth}) {
    $c = $walker.GetFirstChild($el)
    while ($c) { $queue.Enqueue(@{ el = $c; d = $d + 1 }); $c = $walker.GetNextSibling($c) }
  }
}
$w = @{ pid = $target.Current.ProcessId; title = $target.Current.Name }
ConvertTo-Json -Compress -Depth 6 @{ window = $w; elements = @($out) }
`;
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

export async function execute(args, config = {}) {
  const action = args?.action === "windows" ? "windows" : args?.action === "find" ? "find" : "tree";
  const timeoutMs = clampInt(config.timeoutMs, { min: 1000, max: 120000, fallback: 30000 });

  if (action === "windows") {
    const { stdout } = await runPowerShell(windowsScript(), { timeoutMs });
    const raw = JSON.parse(stdout.trim() || "[]");
    const windows = (Array.isArray(raw) ? raw : []).map(normalizeWindow);
    return { ok: true, action, count: windows.length, windows };
  }

  const pid = clampInt(args?.pid, { min: 0, max: 2 ** 31, fallback: 0 });
  const maxDepth = clampInt(args?.maxDepth, { min: 1, max: 12, fallback: 4 });
  const maxElements = clampInt(args?.maxElements, { min: 1, max: 1500, fallback: 200 });
  const script = treeScript({
    pid, maxDepth, maxElements,
    nameContains: typeof args?.nameContains === "string" ? args.nameContains : "",
    controlType: typeof args?.controlType === "string" ? args.controlType : "",
    actionableOnly: Boolean(args?.actionableOnly),
  });
  const { stdout } = await runPowerShell(script, { timeoutMs });
  const raw = JSON.parse(stdout.trim() || "{}");
  if (raw.error) return { ok: false, action, error: raw.error };

  const epoch = Date.now();
  const all = (raw.elements ?? []).map((e, i) => normalizeElement(e, i, epoch));
  const elements = action === "find" ? all.filter(isInteresting) : all;
  return {
    ok: true, action, epoch,
    window: { pid: Number(raw.window?.pid ?? 0), title: String(raw.window?.title ?? "") },
    count: elements.length,
    truncated: elements.length >= maxElements,
    elements,
  };
}

export { shouldDescend };

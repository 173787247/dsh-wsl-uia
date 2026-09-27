import { detectWsl } from "./lib/wsl-host.js";
import * as uia from "./lib/uia.js";
import { execute } from "./lib/uia-exec.js";

export const name = "dsh-wsl-uia";
export const inject = ["tools", "systemPrompt"];

export function apply(ctx, config = {}) {
  const wsl = detectWsl();

  ctx.systemPrompt.section({
    name: "tool:uia_tree",
    order: 210,
    text: "Use uia_tree to observe Windows UI from WSL: action=windows lists top-level windows, action=tree reads a bounded UI Automation element tree, action=find searches it. Every element carries a handle tied to that one observation; pass it to win_invoke / win_type / win_click in dsh-wsl-wininput. A handle from an older observation is rejected on purpose — re-observe instead.",
  });

  ctx.tools.register({
    name: "uia_tree",
    description: "Observe Windows UI from WSL via UI Automation. action=windows lists top-level windows; action=tree returns a bounded element tree with per-observation handles; action=find searches the tree.",
    parameters: uia.parameters(),
    output: {
      schema: uia.outputSchema(),
      render: (_args, value) => [{ type: "text", text: uia.format(value) }],
    },
    timeoutMs: Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 30_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (!wsl) return { ok: false, action: args?.action ?? "tree", error: "not running in WSL" };
      try {
        return await execute(args, config);
      } catch (error) {
        return { ok: false, action: args?.action ?? "tree", error: String(error?.message ?? error) };
      }
    },
    presentCall: (args) => ({ card: "generic", title: `uia_tree ${args?.action ?? "tree"}` }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: result?.content?.some?.((c) => c.text?.includes("ok=false")) ? "uia_tree failed" : "uia_tree",
      content: result?.content,
    }),
  });
}

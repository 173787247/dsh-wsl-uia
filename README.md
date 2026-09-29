# dsh-wsl-uia

DeepSeek Harness plugin: Windows UI Automation observation from WSL: enumerate top-level windows and read a bounded element tree with per-observation handles.

Part of **[dsh-wsl-kit](https://github.com/173787247/dsh-wsl-kit)**.

[中文说明 → README.zh.md](./README.zh.md)

## Install

```sh
dsh plugin --profile web add github:173787247/dsh-wsl-uia
```

## Usage

```
uia_tree action=windows                                  # list top-level windows
uia_tree action=tree pid=1234 maxDepth=6 maxElements=200  # bounded element tree
uia_tree action=find controlType=Button actionableOnly=true
```

## Notes

Every element carries a handle like `1790525657168.6`. The number before the dot is
the observation epoch, so a handle from an older observation is identifiable. Element
**index is not a stable identity** on a live window — two walks of the same tree can
disagree — so pass `expectName` to `win_invoke` rather than relying on position.

## Requirements

- Windows with WSL, and DeepSeek Harness running inside it.
- PowerShell reachable at the standard path (the plugin finds it itself).

## Tests

```sh
npm test
```

The unit tests run anywhere. The live tests are skipped outside WSL.

## Compatibility

| Field | Value |
|-------|-------|
| **Plugin** | `dsh-wsl-uia` **0.1.0** |
| **Minimum dsh** | ≥ **0.1.2** (web UI one-shot `?token=` on Windows relay `:3081`) |
| **Latest verified** | See [dsh-wsl-kit Compatibility](https://github.com/173787247/dsh-wsl-kit#compatibility-2026-09) (currently **`0.2.0-rc.2`**) — single source of truth for the suite |
| **Kit set** | `full` or install alone |

## License

MIT

# dsh-wsl-uia

> 从 WSL 观测 Windows UI：列出顶层窗口，读取有界的 UI Automation 元素树，每个元素带本次观测的句柄。

DeepSeek Harness 插件：Windows UI Automation observation from WSL: enumerate top-level windows and read a bounded element tree with per-observation handles.

属于 **[dsh-wsl-kit](https://github.com/173787247/dsh-wsl-kit)** 的一部分。

[English → README.md](./README.md)

## 安装

```sh
dsh plugin --profile web add github:173787247/dsh-wsl-uia
```

## 用法

```
uia_tree action=windows                                  # list top-level windows
uia_tree action=tree pid=1234 maxDepth=6 maxElements=200  # bounded element tree
uia_tree action=find controlType=Button actionableOnly=true
```

## 说明

Every element carries a handle like `1790525657168.6`. The number before the dot is
the observation epoch, so a handle from an older observation is identifiable. Element
**index is not a stable identity** on a live window — two walks of the same tree can
disagree — so pass `expectName` to `win_invoke` rather than relying on position.

## 依赖

- Windows + WSL，DeepSeek Harness 跑在 WSL 里。
- PowerShell 位于标准路径（插件自己会找）。

## 测试

```sh
npm test
```

单元测试在任何平台都能跑；实时测试在 WSL 之外自动跳过。

## 许可

MIT

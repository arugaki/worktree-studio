# Worktree Studio

> A visual desktop workbench for developing **multiple features in parallel** on a set of independent git repos — each feature gets its own isolated `git worktree` (a branch), with embedded **PowerShell 7** terminals for running **Claude Code / Codex**, and live git status for every repo.

中文简介:**用 git worktree 同时开发多个功能的可视化桌面工具**。一个工作区 = 一个功能 = 一个分支,为涉及的每个仓库创建物理隔离的 worktree,在内嵌的 pwsh7 终端里跑 Claude Code / Codex,左侧实时看各仓库改动。

---

## Why

When you keep several features in flight across the same repos, editing the same file for two features collides. The clean fix is `git worktree`: check out each feature into its own directory (its own branch) so the working trees are physically isolated and never clobber each other.

Worktree Studio puts a GUI on top of that workflow:

- **One tab = one feature = one branch.** Creating a workspace runs `git worktree add … -b <name>` for every selected repo under `<root>/.wt/<name>/`.
- **Physical isolation.** Two workspaces editing the same file in the same repo never conflict — they're different checkouts sharing the same object store.
- **Agent‑first terminals.** Each terminal is a real `pwsh.exe` (ConPTY) with an environment tuned for TUI agents, so `claude` / `codex` run exactly as they would in Windows Terminal.

## Features

- 🌳 **Worktree workspaces** — create/destroy isolated per‑feature worktrees across many repos in one click; auto‑prunes & repairs broken worktrees.
- 🖥️ **Embedded PowerShell 7 terminals** (xterm.js + node‑pty/ConPTY) tuned for **Claude Code / Codex**: truecolor, correct emoji width (unicode11), GPU canvas rendering, frame‑coalesced output so cursor/redraws stay smooth.
- 📊 **Live git status** per repo — branch, ahead/behind, changed files — refreshed on file changes (only the repo that changed, via a single `git status --porcelain=v2`).
- ⚙️ **Settings** — light/dark theme, font family/size, line height, letter spacing, text color, cursor style, scrollback, default shell (pwsh / Windows PowerShell / cmd).
- 🖼️ **Custom terminal background image** with adjustable dim overlay.
- ↔️ **Resizable sidebar**, per‑repo action menu (new terminal / pull / push), auto‑collapse of clean repos.
- 🔀 Push each repo's feature branch and open MRs/PRs on your remote (GitLab/GitHub).

## Download

Grab the latest build from **[Releases](../../releases)**:

- `Worktree Studio Setup x.y.z.exe` — Windows installer (NSIS)
- `Worktree Studio x.y.z.exe` — portable, no install

> Windows 10/11 (x64). PowerShell 7 (`pwsh`) recommended for the best terminal experience.

## Usage

1. Click **＋** in the tab bar → enter a feature name (e.g. `feature-login`) → pick the root directory (the folder containing your repos) → select which repos to include → **Create**.
2. A worktree is created for each repo under `…\.wt\feature-login\` on a branch named after the workspace; a root terminal opens automatically.
3. Run `claude` or `codex` in the terminal. The left panel shows live changes per repo.
4. Use a repo's `⋯` menu to open a terminal in it, or pull / push.
5. Push the branches and open MRs/PRs on your remote. Delete the workspace to clean up the worktrees.

## Development

```bash
npm install        # also fetches the matching node-pty prebuilt (scripts/fetch-pty-prebuild.mjs)
npm run dev        # hot-reload dev
npm run build      # compile to out/
npm run smoke      # headless smoke test: worktree engine + node-pty/pwsh7
npm run package    # unpacked build -> release/win-unpacked/
npm run dist       # installer + portable -> release/
```

## Tech stack

- **Electron 29** + **electron‑vite** + **electron‑builder**
- **React 18 + TypeScript**, **Zustand** for state
- **xterm.js** with `addon-fit` / `addon-canvas` / `addon-unicode11`
- **@homebridge/node‑pty‑prebuilt‑multiarch** — real PTY with a bundled modern ConPTY
- **chokidar** — watches worktrees for live git status

### A note on the Electron version

This project pins **Electron 29** on purpose. There is no C++ toolchain assumed on the build machine, so `node-pty` uses prebuilt binaries; the prebuilt package ships win32‑x64 binaries up to **Electron ABI v121 (= Electron 29)**. `scripts/fetch-pty-prebuild.mjs` fetches the binary matching the installed Electron at `postinstall`. Bumping Electron requires a node‑pty prebuilt that covers the new ABI.

## Architecture

```
Renderer (React + xterm.js)
  ├─ tab bar · workspaces            terminal area (multi pwsh7)
  └─ sidebar: per-repo git status    settings (theme / font / bg image …)
        │  IPC (contextBridge)  │  pty data streamed per frame
Main (Node)
  ├─ pty:      node-pty → pwsh7, agent-friendly env, frame coalescing
  ├─ git:      scan / worktree add·remove·prune / status (porcelain v2)
  ├─ watcher:  chokidar → live status (per-repo refresh)
  └─ store:    workspace persistence (userData)
```

## License

[MIT](./LICENSE)

import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { extname, join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  IPC,
  type CreatePtyInput,
  type CreateWorkspaceInput,
  type RepoStatus
} from '../shared/types'
import * as wsmgr from './workspace'
import * as git from './git'
import {
  createDir,
  createFile,
  deletePath,
  listDir,
  readFileContent,
  renamePath,
  writeFileContent
} from './files'
import { PtyManager, resolveDefaultShell } from './pty'
import { listShellProfiles } from './shells'
import { WatcherManager } from './watcher'

export interface IpcServices {
  ptyManager: PtyManager
  watcher: WatcherManager
}

export function registerIpc(getWindow: () => BrowserWindow | null): IpcServices {
  const send = (channel: string, payload: unknown): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }

  const ptyManager = new PtyManager(
    (id, data) => send(IPC.evtPtyData, { id, data }),
    (id, exitCode) => send(IPC.evtPtyExit, { id, exitCode })
  )
  const watcher = new WatcherManager((workspaceId, repo) =>
    send(IPC.evtGitChanged, { workspaceId, repo })
  )

  ipcMain.handle(IPC.scanRepos, (_e, rootDir: string) => git.scanRepos(rootDir))

  ipcMain.handle(IPC.listWorkspaces, () => {
    const _t0 = Date.now()
    const list = wsmgr.listWorkspaces()
    const _t1 = Date.now()
    for (const w of list) watcher.watch(w)
    if (process.env.WTS_PERF)
      console.log(
        '[perf] listWorkspaces read',
        _t1 - _t0,
        'ms | watcher.watch x' + list.length,
        Date.now() - _t1,
        'ms'
      )
    return list
  })

  ipcMain.handle(IPC.createWorkspace, async (_e, input: CreateWorkspaceInput) => {
    const w = await wsmgr.createWorkspace(input)
    watcher.watch(w)
    return w
  })

  ipcMain.handle(IPC.openDirectory, (_e, rootDir: string) => {
    const w = wsmgr.openDirectory(rootDir)
    watcher.watch(w)
    return w
  })

  ipcMain.handle(
    IPC.removeWorkspace,
    async (_e, args: { id: string; deleteWorktrees: boolean }) => {
      watcher.unwatch(args.id)
      // 先杀掉该工作区所有终端,释放对 worktree 目录的占用
      ptyManager.killByWorkspace(args.id)
      await wsmgr.removeWorkspace(args.id, args.deleteWorktrees)
    }
  )

  ipcMain.handle(IPC.statusAll, async (_e, workspaceId: string): Promise<RepoStatus[]> => {
    const ws = wsmgr.getWorkspace(workspaceId)
    if (!ws) return []
    return Promise.all(
      ws.repos.map((r) => git.getStatus(r.name, wsmgr.worktreePathFor(ws, r.name)))
    )
  })

  ipcMain.handle(
    IPC.status,
    async (_e, args: { workspaceId: string; repo: string }) => {
      const ws = wsmgr.getWorkspace(args.workspaceId)
      if (!ws) return null
      return git.getStatus(args.repo, wsmgr.worktreePathFor(ws, args.repo))
    }
  )

  ipcMain.handle(
    IPC.getFileDiff,
    async (_e, args: { workspaceId: string; repo: string; relPath: string }) => {
      const ws = wsmgr.getWorkspace(args.workspaceId)
      if (!ws) return null
      return git.getFileDiff(wsmgr.worktreePathFor(ws, args.repo), args.relPath)
    }
  )

  ipcMain.handle(
    IPC.pull,
    async (_e, args: { workspaceId: string; repo: string }) => {
      const ws = wsmgr.getWorkspace(args.workspaceId)
      if (!ws) throw new Error('工作区不存在')
      return git.pull(wsmgr.worktreePathFor(ws, args.repo))
    }
  )

  ipcMain.handle(
    IPC.push,
    async (_e, args: { workspaceId: string; repo: string }) => {
      const ws = wsmgr.getWorkspace(args.workspaceId)
      if (!ws) throw new Error('工作区不存在')
      const path = wsmgr.worktreePathFor(ws, args.repo)
      // directory 形态没有统一分支,推送各仓库当前所在分支
      const branch = ws.branch || (await git.currentBranch(path))
      if (!branch) throw new Error('无法确定当前分支(可能处于 detached HEAD)')
      return git.push(path, branch)
    }
  )

  ipcMain.handle(IPC.pickDirectory, async () => {
    const w = getWindow()
    const res = await dialog.showOpenDialog(w!, {
      title: '选择工作区根目录',
      properties: ['openDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IPC.pickImage, async () => {
    const w = getWindow()
    const res = await dialog.showOpenDialog(w!, {
      title: '选择终端背景图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const file = res.filePaths[0]
    try {
      const buf = readFileSync(file)
      const ext = extname(file).slice(1).toLowerCase()
      const mime =
        ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext || 'png'
      return `data:image/${mime};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.readDir, (_e, path: string) => listDir(path))

  ipcMain.handle(IPC.readFile, (_e, path: string) => readFileContent(path))

  ipcMain.handle(IPC.writeFile, (_e, args: { path: string; content: string }) =>
    writeFileContent(args.path, args.content)
  )

  ipcMain.handle(IPC.renamePath, (_e, args: { oldPath: string; newPath: string }) =>
    renamePath(args.oldPath, args.newPath)
  )

  ipcMain.handle(IPC.deletePath, (_e, path: string) => deletePath(path))

  ipcMain.handle(IPC.createFile, (_e, path: string) => createFile(path))

  ipcMain.handle(IPC.createDir, (_e, path: string) => createDir(path))

  // 剪贴板里若有图片,存成临时 PNG 并返回路径(供 Claude Code / Codex 读取);否则返回 null
  ipcMain.handle(IPC.pasteClipboardImage, (): string | null => {
    try {
      const img = clipboard.readImage()
      if (img.isEmpty()) return null
      const dir = join(tmpdir(), 'worktree-studio-paste')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `clip-${Date.now()}.png`)
      writeFileSync(file, img.toPNG())
      return file
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.defaultShell, () => {
    const _t = Date.now()
    const s = resolveDefaultShell()
    if (process.env.WTS_PERF) console.log('[perf] resolveDefaultShell', Date.now() - _t, 'ms ->', s)
    return s
  })

  ipcMain.handle(IPC.listShellProfiles, (_e, includeWsl?: boolean) =>
    listShellProfiles({ includeWsl })
  )

  ipcMain.handle(IPC.ptyCreate, (_e, input: CreatePtyInput) =>
    ptyManager.create({
      id: input.id,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      shellPath: input.shellPath,
      args: input.args,
      cols: input.cols,
      rows: input.rows
    })
  )

  ipcMain.on(IPC.ptyInput, (_e, args: { id: string; data: string }) =>
    ptyManager.write(args.id, args.data)
  )

  ipcMain.on(
    IPC.ptyResize,
    (_e, args: { id: string; cols: number; rows: number }) =>
      ptyManager.resize(args.id, args.cols, args.rows)
  )

  ipcMain.on(IPC.ptyKill, (_e, args: { id: string }) => ptyManager.kill(args.id))

  return { ptyManager, watcher }
}

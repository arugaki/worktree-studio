import { BrowserWindow, dialog, ipcMain } from 'electron'
import { join, extname } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  IPC,
  type CreatePtyInput,
  type CreateWorkspaceInput,
  type RepoStatus
} from '../shared/types'
import * as wsmgr from './workspace'
import * as git from './git'
import { PtyManager, resolveDefaultShell } from './pty'
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
    const list = wsmgr.listWorkspaces()
    for (const w of list) watcher.watch(w)
    return list
  })

  ipcMain.handle(IPC.createWorkspace, async (_e, input: CreateWorkspaceInput) => {
    const w = await wsmgr.createWorkspace(input)
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
      ws.repos.map((r) => git.getStatus(r.name, join(ws.worktreeRoot, r.name)))
    )
  })

  ipcMain.handle(
    IPC.status,
    async (_e, args: { workspaceId: string; repo: string }) => {
      const ws = wsmgr.getWorkspace(args.workspaceId)
      if (!ws) return null
      return git.getStatus(args.repo, join(ws.worktreeRoot, args.repo))
    }
  )

  ipcMain.handle(
    IPC.pull,
    async (_e, args: { workspaceId: string; repo: string }) => {
      const ws = wsmgr.getWorkspace(args.workspaceId)
      if (!ws) throw new Error('工作区不存在')
      return git.pull(join(ws.worktreeRoot, args.repo))
    }
  )

  ipcMain.handle(
    IPC.push,
    async (_e, args: { workspaceId: string; repo: string }) => {
      const ws = wsmgr.getWorkspace(args.workspaceId)
      if (!ws) throw new Error('工作区不存在')
      return git.push(join(ws.worktreeRoot, args.repo), ws.branch)
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

  ipcMain.handle(IPC.defaultShell, () => resolveDefaultShell())

  ipcMain.handle(IPC.ptyCreate, (_e, input: CreatePtyInput) =>
    ptyManager.create({
      id: input.id,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      shellPath: input.shellPath,
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

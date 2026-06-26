import { clipboard, contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type CreatePtyInput,
  type CreateWorkspaceInput,
  type GitChangedEvent,
  type PtyDataEvent,
  type PtyExitEvent,
  type WtsApi
} from '../shared/types'

const api: WtsApi = {
  scanRepos: (rootDir) => ipcRenderer.invoke(IPC.scanRepos, rootDir),
  listWorkspaces: () => ipcRenderer.invoke(IPC.listWorkspaces),
  createWorkspace: (input: CreateWorkspaceInput) =>
    ipcRenderer.invoke(IPC.createWorkspace, input),
  openDirectory: (rootDir) => ipcRenderer.invoke(IPC.openDirectory, rootDir),
  removeWorkspace: (id, deleteWorktrees) =>
    ipcRenderer.invoke(IPC.removeWorkspace, { id, deleteWorktrees }),
  statusAll: (workspaceId) => ipcRenderer.invoke(IPC.statusAll, workspaceId),
  status: (workspaceId, repo) =>
    ipcRenderer.invoke(IPC.status, { workspaceId, repo }),
  getFileDiff: (workspaceId, repo, relPath) =>
    ipcRenderer.invoke(IPC.getFileDiff, { workspaceId, repo, relPath }),
  pull: (workspaceId, repo) => ipcRenderer.invoke(IPC.pull, { workspaceId, repo }),
  push: (workspaceId, repo) => ipcRenderer.invoke(IPC.push, { workspaceId, repo }),
  pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory),
  pickImage: () => ipcRenderer.invoke(IPC.pickImage),
  readDir: (path: string) => ipcRenderer.invoke(IPC.readDir, path),
  readFile: (path: string) => ipcRenderer.invoke(IPC.readFile, path),
  writeFile: (path: string, content: string) =>
    ipcRenderer.invoke(IPC.writeFile, { path, content }),
  renamePath: (oldPath: string, newPath: string) =>
    ipcRenderer.invoke(IPC.renamePath, { oldPath, newPath }),
  deletePath: (path: string) => ipcRenderer.invoke(IPC.deletePath, path),
  createFile: (path: string) => ipcRenderer.invoke(IPC.createFile, path),
  createDir: (path: string) => ipcRenderer.invoke(IPC.createDir, path),
  defaultShell: () => ipcRenderer.invoke(IPC.defaultShell),
  listShellProfiles: (includeWsl?: boolean) =>
    ipcRenderer.invoke(IPC.listShellProfiles, includeWsl),

  clipboardRead: () => clipboard.readText(),
  clipboardWrite: (text: string) => clipboard.writeText(text),
  pasteClipboardImage: () => ipcRenderer.invoke(IPC.pasteClipboardImage),

  ptyCreate: (input: CreatePtyInput) => ipcRenderer.invoke(IPC.ptyCreate, input),
  ptyInput: (id, data) => ipcRenderer.send(IPC.ptyInput, { id, data }),
  ptyResize: (id, cols, rows) =>
    ipcRenderer.send(IPC.ptyResize, { id, cols, rows }),
  ptyKill: (id) => ipcRenderer.send(IPC.ptyKill, { id }),

  onPtyData: (cb) => {
    const h = (_e: unknown, payload: PtyDataEvent): void => cb(payload)
    ipcRenderer.on(IPC.evtPtyData, h)
    return () => ipcRenderer.removeListener(IPC.evtPtyData, h)
  },
  onPtyExit: (cb) => {
    const h = (_e: unknown, payload: PtyExitEvent): void => cb(payload)
    ipcRenderer.on(IPC.evtPtyExit, h)
    return () => ipcRenderer.removeListener(IPC.evtPtyExit, h)
  },
  onGitChanged: (cb) => {
    const h = (_e: unknown, payload: GitChangedEvent): void => cb(payload)
    ipcRenderer.on(IPC.evtGitChanged, h)
    return () => ipcRenderer.removeListener(IPC.evtGitChanged, h)
  }
}

contextBridge.exposeInMainWorld('api', api)

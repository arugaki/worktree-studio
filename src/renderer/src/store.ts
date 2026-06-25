import { create } from 'zustand'
import type {
  CreateWorkspaceInput,
  RepoStatus,
  TerminalMeta,
  TerminalProfile,
  Workspace
} from '@shared/types'
import { disposeTerminal } from './terminals'
import { getSettings } from './settings'

/** 主区域里打开的一个文件标签(id = 绝对路径,天然去重) */
export interface OpenFileMeta {
  workspaceId: string
  /** 绝对路径,同时作为标签 id */
  path: string
  /** 展示用文件名 */
  name: string
}

function wtPath(ws: Workspace, repo: string): string {
  // directory 形态指向原仓库真实路径,worktree 形态指向 .wt 下的子目录
  if (ws.kind === 'directory') {
    const r = ws.repos.find((x) => x.name === repo)
    if (r) return r.sourcePath
  }
  return ws.worktreeRoot + '\\' + repo
}
function genTermId(): string {
  return 'term_' + Math.random().toString(36).slice(2, 10)
}

interface StoreState {
  ready: boolean
  defaultShell: string
  /** 主进程枚举出的可用终端 profile(类似 Windows Terminal 下拉) */
  profiles: TerminalProfile[]
  workspaces: Workspace[]
  activeId: string | null
  statuses: Record<string, RepoStatus[]>
  terminals: Record<string, TerminalMeta[]>
  activeTerminal: Record<string, string | null>
  /** 每个工作区打开的文件标签 */
  openFiles: Record<string, OpenFileMeta[]>
  /** 当前在主区域展示的文件路径;null = 展示终端 */
  activeFile: Record<string, string | null>
  showCreate: boolean
  sidebarCollapsed: boolean
  busy: boolean
  error: string | null

  init: () => Promise<void>
  setActive: (id: string) => void
  toggleSidebar: () => void
  openCreate: () => void
  closeCreate: () => void
  createWorkspace: (input: CreateWorkspaceInput) => Promise<void>
  openDirectory: () => Promise<void>
  removeWorkspace: (id: string, deleteWorktrees: boolean) => Promise<void>
  refreshStatuses: (wsId: string) => Promise<void>
  refreshRepo: (wsId: string, repo: string) => Promise<void>
  addTerminal: (
    wsId: string,
    repo: string,
    opts?: { cwd?: string; title?: string; profile?: TerminalProfile }
  ) => void
  addRootTerminal: (wsId: string, profile?: TerminalProfile) => void
  /** 取默认 profile(设置里选的,回退到列表第一项) */
  defaultProfile: () => TerminalProfile | null
  setActiveTerminal: (wsId: string, id: string) => void
  /** 打开(或激活已打开的)文件标签 */
  openFile: (wsId: string, path: string, name: string) => void
  /** 激活某个已打开的文件标签 */
  setActiveFile: (wsId: string, path: string) => void
  /** 关闭文件标签 */
  closeFile: (wsId: string, path: string) => void
  closeTerminal: (wsId: string, id: string) => void
  closeOtherTerminals: (wsId: string, id: string) => void
  closeTerminalsToRight: (wsId: string, id: string) => void
  duplicateTerminal: (wsId: string, id: string) => void
  renameTerminal: (wsId: string, id: string, title: string) => void
  setTerminalColor: (wsId: string, id: string, color: string | null) => void
  moveTerminal: (wsId: string, fromId: string, toId: string) => void
  setError: (msg: string | null) => void
}

export const useStore = create<StoreState>((set, get) => ({
  ready: false,
  defaultShell: 'pwsh.exe',
  profiles: [],
  workspaces: [],
  activeId: null,
  statuses: {},
  terminals: {},
  activeTerminal: {},
  openFiles: {},
  activeFile: {},
  showCreate: false,
  sidebarCollapsed: false,
  busy: false,
  error: null,

  init: async () => {
    const [shell, profiles, workspaces] = await Promise.all([
      window.api.defaultShell(),
      window.api.listShellProfiles().catch(() => [] as TerminalProfile[]),
      window.api.listWorkspaces()
    ])
    set({ defaultShell: shell, profiles, workspaces, ready: true })

    window.api.onGitChanged(({ workspaceId, repo }) => {
      // 只刷新发生变化的那个仓库,而不是整个工作区的全部仓库
      if (get().workspaces.some((w) => w.id === workspaceId)) {
        void get().refreshRepo(workspaceId, repo)
      }
    })

    if (workspaces.length > 0) {
      get().setActive(workspaces[0].id)
    }
  },

  setActive: (id) => {
    set({ activeId: id })
    void get().refreshStatuses(id)
    // 首次激活:只自动开一个「根目录」终端
    const ws = get().workspaces.find((w) => w.id === id)
    if (ws && (get().terminals[id]?.length ?? 0) === 0) {
      get().addRootTerminal(id)
    }
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  openCreate: () => set({ showCreate: true, error: null }),
  closeCreate: () => set({ showCreate: false }),
  setError: (msg) => set({ error: msg }),

  createWorkspace: async (input) => {
    set({ busy: true, error: null })
    try {
      const ws = await window.api.createWorkspace(input)
      set((s) => ({ workspaces: [...s.workspaces, ws], showCreate: false }))
      get().setActive(ws.id)
    } catch (e) {
      set({ error: String((e as Error)?.message ?? e) })
      throw e
    } finally {
      set({ busy: false })
    }
  },

  openDirectory: async () => {
    set({ error: null })
    const dir = await window.api.pickDirectory()
    if (!dir) return
    set({ busy: true })
    try {
      const ws = await window.api.openDirectory(dir)
      set((s) =>
        s.workspaces.some((w) => w.id === ws.id)
          ? {}
          : { workspaces: [...s.workspaces, ws] }
      )
      get().setActive(ws.id)
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      set({ error: msg })
      window.alert(msg)
    } finally {
      set({ busy: false })
    }
  },

  removeWorkspace: async (id, deleteWorktrees) => {
    // 先关掉该工作区的所有终端
    for (const t of get().terminals[id] ?? []) disposeTerminal(t.id)
    await window.api.removeWorkspace(id, deleteWorktrees)
    set((s) => {
      const workspaces = s.workspaces.filter((w) => w.id !== id)
      const statuses = { ...s.statuses }
      delete statuses[id]
      const terminals = { ...s.terminals }
      delete terminals[id]
      const activeTerminal = { ...s.activeTerminal }
      delete activeTerminal[id]
      const openFiles = { ...s.openFiles }
      delete openFiles[id]
      const activeFile = { ...s.activeFile }
      delete activeFile[id]
      const activeId =
        s.activeId === id ? (workspaces[0]?.id ?? null) : s.activeId
      return { workspaces, statuses, terminals, activeTerminal, openFiles, activeFile, activeId }
    })
    const next = get().activeId
    if (next) get().setActive(next)
  },

  refreshStatuses: async (wsId) => {
    try {
      const list = await window.api.statusAll(wsId)
      set((s) => ({ statuses: { ...s.statuses, [wsId]: list } }))
    } catch {
      /* ignore */
    }
  },

  refreshRepo: async (wsId, repo) => {
    try {
      const st = await window.api.status(wsId, repo)
      if (!st) return
      set((s) => {
        const list = s.statuses[wsId]
        if (!list) return {} // 整个工作区状态还没加载,交给 statusAll
        const idx = list.findIndex((r) => r.repo === repo)
        const next = list.slice()
        if (idx >= 0) next[idx] = st
        else next.push(st)
        return { statuses: { ...s.statuses, [wsId]: next } }
      })
    } catch {
      /* ignore */
    }
  },

  defaultProfile: () => {
    const { profiles } = get()
    if (profiles.length === 0) return null
    const id = getSettings().defaultProfileId
    return profiles.find((p) => p.id === id) ?? profiles[0]
  },

  addTerminal: (wsId, repo, opts) => {
    const ws = get().workspaces.find((w) => w.id === wsId)
    if (!ws) return
    const id = genTermId()
    const profile = opts?.profile ?? get().defaultProfile()
    const meta: TerminalMeta = {
      id,
      workspaceId: wsId,
      repo,
      cwd: opts?.cwd ?? wtPath(ws, repo),
      title: opts?.title ?? repo,
      shellPath: profile?.shellPath ?? get().defaultShell,
      args: profile?.args,
      profileId: profile?.id,
      profileLabel: profile?.label
    }
    set((s) => ({
      terminals: { ...s.terminals, [wsId]: [...(s.terminals[wsId] ?? []), meta] },
      activeTerminal: { ...s.activeTerminal, [wsId]: id },
      // 新建终端时切回终端视图
      activeFile: { ...s.activeFile, [wsId]: null }
    }))
  },

  addRootTerminal: (wsId, profile) => {
    const ws = get().workspaces.find((w) => w.id === wsId)
    if (!ws) return
    // 优先根仓库的 worktree;没有根仓库则落在 worktree 根目录
    const root = ws.repos.find((r) => r.isRoot)
    if (root) get().addTerminal(wsId, root.name, { profile })
    else get().addTerminal(wsId, '根目录', { cwd: ws.worktreeRoot, profile })
  },

  setActiveTerminal: (wsId, id) =>
    set((s) => ({
      activeTerminal: { ...s.activeTerminal, [wsId]: id },
      // 点终端标签时退出文件视图
      activeFile: { ...s.activeFile, [wsId]: null }
    })),

  openFile: (wsId, path, name) => {
    set((s) => {
      const list = s.openFiles[wsId] ?? []
      const exists = list.some((f) => f.path === path)
      return {
        openFiles: exists
          ? s.openFiles
          : { ...s.openFiles, [wsId]: [...list, { workspaceId: wsId, path, name }] },
        activeFile: { ...s.activeFile, [wsId]: path }
      }
    })
  },

  setActiveFile: (wsId, path) =>
    set((s) => ({ activeFile: { ...s.activeFile, [wsId]: path } })),

  closeFile: (wsId, path) =>
    set((s) => {
      const list = (s.openFiles[wsId] ?? []).filter((f) => f.path !== path)
      let active = s.activeFile[wsId]
      if (active === path) {
        // 关掉当前文件:落到剩余最后一个文件,没有则回到终端
        active = list.length > 0 ? list[list.length - 1].path : null
      }
      return {
        openFiles: { ...s.openFiles, [wsId]: list },
        activeFile: { ...s.activeFile, [wsId]: active }
      }
    }),

  closeTerminal: (wsId, id) => {
    disposeTerminal(id)
    set((s) => {
      const list = (s.terminals[wsId] ?? []).filter((t) => t.id !== id)
      let active = s.activeTerminal[wsId]
      if (active === id) active = list[list.length - 1]?.id ?? null
      return {
        terminals: { ...s.terminals, [wsId]: list },
        activeTerminal: { ...s.activeTerminal, [wsId]: active }
      }
    })
  },

  closeOtherTerminals: (wsId, id) => {
    for (const t of get().terminals[wsId] ?? []) if (t.id !== id) disposeTerminal(t.id)
    set((s) => ({
      terminals: { ...s.terminals, [wsId]: (s.terminals[wsId] ?? []).filter((t) => t.id === id) },
      activeTerminal: { ...s.activeTerminal, [wsId]: id }
    }))
  },

  closeTerminalsToRight: (wsId, id) => {
    const list = get().terminals[wsId] ?? []
    const idx = list.findIndex((t) => t.id === id)
    if (idx < 0) return
    for (const t of list.slice(idx + 1)) disposeTerminal(t.id)
    set((s) => {
      const kept = (s.terminals[wsId] ?? []).slice(0, idx + 1)
      let active = s.activeTerminal[wsId]
      if (active && !kept.some((t) => t.id === active)) active = id
      return {
        terminals: { ...s.terminals, [wsId]: kept },
        activeTerminal: { ...s.activeTerminal, [wsId]: active }
      }
    })
  },

  duplicateTerminal: (wsId, id) => {
    const src = (get().terminals[wsId] ?? []).find((t) => t.id === id)
    if (!src) return
    const newId = genTermId()
    const meta: TerminalMeta = {
      ...src,
      id: newId,
      customTitle: undefined // 复制出来的标签用默认标题
    }
    set((s) => {
      const list = s.terminals[wsId] ?? []
      const idx = list.findIndex((t) => t.id === id)
      const next = list.slice()
      next.splice(idx + 1, 0, meta) // 插到源标签右侧
      return {
        terminals: { ...s.terminals, [wsId]: next },
        activeTerminal: { ...s.activeTerminal, [wsId]: newId }
      }
    })
  },

  renameTerminal: (wsId, id, title) => {
    const t = title.trim()
    set((s) => ({
      terminals: {
        ...s.terminals,
        [wsId]: (s.terminals[wsId] ?? []).map((x) =>
          x.id === id ? { ...x, customTitle: t || undefined } : x
        )
      }
    }))
  },

  setTerminalColor: (wsId, id, color) => {
    set((s) => ({
      terminals: {
        ...s.terminals,
        [wsId]: (s.terminals[wsId] ?? []).map((x) =>
          x.id === id ? { ...x, color: color ?? undefined } : x
        )
      }
    }))
  },

  moveTerminal: (wsId, fromId, toId) => {
    if (fromId === toId) return
    set((s) => {
      const list = (s.terminals[wsId] ?? []).slice()
      const from = list.findIndex((t) => t.id === fromId)
      const to = list.findIndex((t) => t.id === toId)
      if (from < 0 || to < 0) return s
      const [moved] = list.splice(from, 1)
      list.splice(to, 0, moved)
      return { terminals: { ...s.terminals, [wsId]: list } }
    })
  }
}))

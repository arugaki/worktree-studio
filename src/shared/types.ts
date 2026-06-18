// 跨进程共享的数据模型与 IPC 通道契约

/** 一个被纳入工作区的 git 仓库(根容器仓库或子仓库) */
export interface RepoRef {
  /** 展示用名字(目录名;根容器仓库用其目录名) */
  name: string
  /** 原始仓库的绝对路径(worktree 的来源) */
  sourcePath: string
  /** 是否为根容器仓库 */
  isRoot: boolean
}

/** 一个功能工作区 = 一个分支 = 一组 worktree */
export interface Workspace {
  id: string
  /** 工作区名,同时作为各仓库的分支名 */
  name: string
  /** 根目录,例如 D:\workspace */
  rootDir: string
  /** 分支名(默认等于 name) */
  branch: string
  /** worktree 落地的父目录,例如 D:\workspace\.wt\<name> */
  worktreeRoot: string
  /** 纳入该工作区的仓库 */
  repos: RepoRef[]
  createdAt: number
}

/** 单个文件的改动状态(porcelain v1) */
export interface FileChange {
  /** 暂存区状态码,如 'M' 'A' 'D' '?' */
  index: string
  /** 工作区状态码 */
  worktree: string
  path: string
}

/** 单个仓库在某工作区下的 git 状态 */
export interface RepoStatus {
  repo: string
  /** 该仓库 worktree 的绝对路径 */
  worktreePath: string
  /** 是否存在 worktree 目录 */
  exists: boolean
  branch: string
  ahead: number
  behind: number
  changes: FileChange[]
  /** 出错信息(若有) */
  error?: string
}

/** 终端会话元信息(渲染进程持有) */
export interface TerminalMeta {
  id: string
  workspaceId: string
  /** 关联的仓库名(用于默认 cwd 与标题) */
  repo: string
  cwd: string
  title: string
  shellPath: string
}

export interface CreateWorkspaceInput {
  name: string
  rootDir: string
  /** 选择纳入的仓库名(来自 scanRepos 的结果) */
  repoNames: string[]
}

export interface ScanResult {
  rootDir: string
  /** 根目录本身是否是 git 仓库 */
  rootIsRepo: boolean
  repos: RepoRef[]
}

export interface CreatePtyInput {
  /** 渲染进程生成的终端 id(避免数据事件竞态) */
  id: string
  workspaceId: string
  repo: string
  cwd: string
  shellPath?: string
  cols?: number
  rows?: number
}

export interface PtyDataEvent {
  id: string
  data: string
}

export interface PtyExitEvent {
  id: string
  exitCode: number
}

export interface GitChangedEvent {
  workspaceId: string
  repo: string
}

/** 暴露给渲染进程的 API 形状(window.api) */
export interface WtsApi {
  scanRepos(rootDir: string): Promise<ScanResult>
  listWorkspaces(): Promise<Workspace[]>
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>
  removeWorkspace(id: string, deleteWorktrees: boolean): Promise<void>
  statusAll(workspaceId: string): Promise<RepoStatus[]>
  status(workspaceId: string, repo: string): Promise<RepoStatus | null>
  pull(workspaceId: string, repo: string): Promise<string>
  push(workspaceId: string, repo: string): Promise<string>
  pickDirectory(): Promise<string | null>
  pickImage(): Promise<string | null>
  defaultShell(): Promise<string>
  ptyCreate(input: CreatePtyInput): Promise<{ id: string; shellPath: string }>
  ptyInput(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  ptyKill(id: string): void
  onPtyData(cb: (e: PtyDataEvent) => void): () => void
  onPtyExit(cb: (e: PtyExitEvent) => void): () => void
  onGitChanged(cb: (e: GitChangedEvent) => void): () => void
}

// ---- IPC 通道名 ----
export const IPC = {
  scanRepos: 'workspace:scanRepos',
  listWorkspaces: 'workspace:list',
  createWorkspace: 'workspace:create',
  removeWorkspace: 'workspace:remove',
  statusAll: 'git:statusAll',
  status: 'git:status',
  pull: 'git:pull',
  push: 'git:push',
  pickDirectory: 'dialog:pickDirectory',
  pickImage: 'dialog:pickImage',
  defaultShell: 'shell:default',
  ptyCreate: 'pty:create',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  // main -> renderer 事件
  evtPtyData: 'pty:data',
  evtPtyExit: 'pty:exit',
  evtGitChanged: 'git:changed'
} as const

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

/**
 * 一个工作区。两种形态:
 * - 'worktree'(默认):一个功能 = 一个分支 = 一组隔离 worktree(落在 .wt/<name> 下)
 * - 'directory':直接打开一个已有目录,就地查看其中各仓库的改动,不创建任何 worktree
 */
export interface Workspace {
  id: string
  /** 形态;缺省视为 'worktree'(兼容旧数据) */
  kind?: 'worktree' | 'directory'
  /** 工作区名;worktree 形态下同时作为各仓库的分支名 */
  name: string
  /** 根目录,例如 D:\workspace */
  rootDir: string
  /** 分支名(worktree 形态默认等于 name;directory 形态为空,分支随各仓库实际而定) */
  branch: string
  /** worktree 落地的父目录,例如 D:\workspace\.wt\<name>;directory 形态即 rootDir 本身 */
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
  /** 启动参数(WSL / Git Bash 等需要) */
  args?: string[]
  /** 关联的终端 profile id(用于图标/类型识别) */
  profileId?: string
  /** profile 显示名,如 "Ubuntu" "PowerShell 7"(用于图标识别与提示) */
  profileLabel?: string
  /** 用户手动重命名的标题(优先级最高) */
  customTitle?: string
  /** 用户设置的标签颜色(hex);null/缺省 = 无 */
  color?: string
}

/** 一个可用的终端配置(类似 Windows Terminal 下拉里的一项) */
export interface TerminalProfile {
  /** 稳定标识(WT 的 guid,或内置/探测项的合成 id) */
  id: string
  /** 显示名,如 "Ubuntu" "Git Bash" "PowerShell 7" */
  label: string
  /** 可执行文件路径 */
  shellPath: string
  /** 启动参数 */
  args?: string[]
  /** 来源:'wt' = Windows Terminal 配置,'git' = Git Bash 探测,'builtin' = 内置兜底 */
  source: 'wt' | 'git' | 'builtin'
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

/** 目录中的一个条目(用于文件树懒加载) */
export interface FileEntry {
  name: string
  /** 绝对路径 */
  path: string
  isDir: boolean
}

/** 某个改动文件的「变更前/变更后」内容(用于并排 diff) */
export interface FileDiffResult {
  /** 变更前 = HEAD 中的版本(新文件为空串) */
  before: string
  /** 变更后 = 工作区当前内容(已删除为空串) */
  after: string
  /** HEAD 中是否存在(false = 新增文件) */
  beforeExists: boolean
  /** 工作区是否存在(false = 已删除) */
  afterExists: boolean
  /** 任一侧为二进制 */
  binary: boolean
  /** 任一侧超出大小上限 */
  tooLarge: boolean
}

/** 读取文件内容的结果 */
export interface FileReadResult {
  path: string
  /** 文本内容(二进制/过大/目录时为空串) */
  content: string
  /** 字节大小 */
  size: number
  /** 是否为二进制文件(含 NUL 字节) */
  binary: boolean
  /** 是否因超过大小上限未读取 */
  tooLarge: boolean
  /** 该路径其实是目录 */
  isDir?: boolean
}

export interface CreatePtyInput {
  /** 渲染进程生成的终端 id(避免数据事件竞态) */
  id: string
  workspaceId: string
  repo: string
  cwd: string
  shellPath?: string
  args?: string[]
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
  /** 直接打开一个已有目录(就地查看改动,不创建 worktree) */
  openDirectory(rootDir: string): Promise<Workspace>
  removeWorkspace(id: string, deleteWorktrees: boolean): Promise<void>
  statusAll(workspaceId: string): Promise<RepoStatus[]>
  status(workspaceId: string, repo: string): Promise<RepoStatus | null>
  /** 取某改动文件的「变更前/变更后」内容(HEAD vs 工作区) */
  getFileDiff(workspaceId: string, repo: string, relPath: string): Promise<FileDiffResult | null>
  pull(workspaceId: string, repo: string): Promise<string>
  push(workspaceId: string, repo: string): Promise<string>
  pickDirectory(): Promise<string | null>
  pickImage(): Promise<string | null>
  /** 列出某目录下的条目(文件树懒加载) */
  readDir(path: string): Promise<FileEntry[]>
  /** 读取某文件内容(查看 / 编辑前) */
  readFile(path: string): Promise<FileReadResult>
  /** 写入文件内容(编辑器保存) */
  writeFile(path: string, content: string): Promise<void>
  /** 重命名 / 移动一个文件或目录 */
  renamePath(oldPath: string, newPath: string): Promise<void>
  /** 删除一个文件或目录(目录递归) */
  deletePath(path: string): Promise<void>
  /** 在某目录下新建空文件 */
  createFile(path: string): Promise<void>
  /** 新建目录 */
  createDir(path: string): Promise<void>
  /** 在系统文件管理器中定位并高亮该文件/目录 */
  showItemInFolder(path: string): void
  /** 用系统默认方式打开路径(目录→文件管理器,文件→默认程序);返回错误信息,成功为空串 */
  openPath(path: string): Promise<string>
  defaultShell(): Promise<string>
  /** 列出可用终端 profile;includeWsl=false 跳过(慢的)WSL 枚举,留到按需再加载 */
  listShellProfiles(includeWsl?: boolean): Promise<TerminalProfile[]>
  clipboardRead(): string
  clipboardWrite(text: string): void
  /** 剪贴板里若有图片,存成临时文件并返回其路径;否则返回 null */
  pasteClipboardImage(): Promise<string | null>
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
  openDirectory: 'workspace:openDirectory',
  removeWorkspace: 'workspace:remove',
  statusAll: 'git:statusAll',
  status: 'git:status',
  getFileDiff: 'git:fileDiff',
  pull: 'git:pull',
  push: 'git:push',
  pickDirectory: 'dialog:pickDirectory',
  pickImage: 'dialog:pickImage',
  readDir: 'fs:readDir',
  readFile: 'fs:readFile',
  writeFile: 'fs:writeFile',
  renamePath: 'fs:rename',
  deletePath: 'fs:delete',
  createFile: 'fs:createFile',
  createDir: 'fs:createDir',
  showItemInFolder: 'shell:showItem',
  openPath: 'shell:openPath',
  pasteClipboardImage: 'clipboard:image',
  defaultShell: 'shell:default',
  listShellProfiles: 'shell:listProfiles',
  ptyCreate: 'pty:create',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  // main -> renderer 事件
  evtPtyData: 'pty:data',
  evtPtyExit: 'pty:exit',
  evtGitChanged: 'git:changed'
} as const

import { existsSync, readFileSync, appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CreateWorkspaceInput,
  RepoRef,
  Workspace
} from '../shared/types'
import {
  addWorktree,
  isGitRepo,
  pruneWorktrees,
  removeWorktree,
  scanRepos
} from './git'
import { loadWorkspaces, saveWorkspaces } from './store'

let cache: Workspace[] | null = null

function all(): Workspace[] {
  if (!cache) cache = loadWorkspaces()
  return cache
}

function persist(): void {
  if (cache) saveWorkspaces(cache)
}

function genId(): string {
  return 'ws_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function baseName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** 校验工作区名能否作为 git 分支名 */
export function validateName(name: string): string | null {
  const n = name.trim()
  if (!n) return '名称不能为空'
  if (!/^[A-Za-z0-9._\-/]+$/.test(n)) return '只能包含字母、数字、. _ - /'
  if (n.startsWith('/') || n.endsWith('/') || n.endsWith('.')) return '名称格式非法'
  if (n.includes('..')) return '名称不能包含 ..'
  return null
}

export function listWorkspaces(): Workspace[] {
  return all()
}

export function getWorkspace(id: string): Workspace | undefined {
  return all().find((w) => w.id === id)
}

/** 把 /.wt/ 加进根容器仓库的 .gitignore(若尚未忽略) */
function ensureWtIgnored(rootDir: string): void {
  if (!isGitRepo(rootDir)) return
  const gi = join(rootDir, '.gitignore')
  try {
    const content = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
    if (/^\/?\.wt\/?\s*$/m.test(content)) return
    const prefix = content.length && !content.endsWith('\n') ? '\n' : ''
    appendFileSync(gi, `${prefix}/.wt/\n`, 'utf8')
  } catch {
    /* 忽略 .gitignore 写入失败,不阻塞创建 */
  }
}

export async function createWorkspace(
  input: CreateWorkspaceInput
): Promise<Workspace> {
  const err = validateName(input.name)
  if (err) throw new Error(err)
  const name = input.name.trim()
  const branch = name

  if (all().some((w) => w.rootDir === input.rootDir && w.name === name)) {
    throw new Error(`该根目录下已存在同名工作区「${name}」`)
  }

  const scan = scanRepos(input.rootDir)
  const selected: RepoRef[] = scan.repos.filter((r) =>
    input.repoNames.includes(r.name)
  )
  if (selected.length === 0) {
    throw new Error('未选择任何仓库,或选择的仓库不是 git 仓库')
  }

  const worktreeRoot = join(input.rootDir, '.wt', name)
  ensureWtIgnored(input.rootDir)

  // 逐个建立 worktree;失败则回滚已建立的部分
  const created: { repo: RepoRef; wt: string }[] = []
  try {
    for (const repo of selected) {
      const wt = join(worktreeRoot, repo.name)
      await addWorktree(repo.sourcePath, wt, branch)
      created.push({ repo, wt })
    }
  } catch (e) {
    for (const c of created) {
      await removeWorktree(c.repo.sourcePath, c.wt)
    }
    throw e
  }

  const ws: Workspace = {
    id: genId(),
    name,
    rootDir: input.rootDir,
    branch,
    worktreeRoot,
    repos: selected,
    createdAt: Date.now()
  }
  all().push(ws)
  persist()
  return ws
}

/**
 * 直接打开一个已有目录:就地扫描其中的 git 仓库,作为一个 'directory' 形态的工作区。
 * 不创建任何 worktree,改动直接读自原仓库;同一目录重复打开则复用已有工作区。
 */
export function openDirectory(rootDir: string): Workspace {
  const dir = rootDir.trim()
  if (!dir) throw new Error('目录不能为空')
  if (!existsSync(dir)) throw new Error('目录不存在')
  const existing = all().find((w) => w.kind === 'directory' && w.rootDir === dir)
  if (existing) return existing

  const scan = scanRepos(dir)
  if (scan.repos.length === 0) {
    throw new Error('该目录下没有发现 git 仓库')
  }

  const ws: Workspace = {
    id: genId(),
    kind: 'directory',
    name: baseName(dir),
    rootDir: dir,
    branch: '',
    worktreeRoot: dir,
    repos: scan.repos,
    createdAt: Date.now()
  }
  all().push(ws)
  persist()
  return ws
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 带重试的递归删除(应对 Windows 下进程刚退出、句柄尚未释放的文件锁) */
async function rmrf(dir: string): Promise<void> {
  for (let i = 0; i < 6; i++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
    } catch {
      /* 下一轮重试 */
    }
    if (!existsSync(dir)) return
    await delay(200)
  }
}

export async function removeWorkspace(
  id: string,
  deleteWorktrees: boolean
): Promise<void> {
  const ws = all().find((w) => w.id === id)
  if (!ws) return
  // directory 形态指向真实目录,绝不删盘上的文件,只从列表移除
  if (deleteWorktrees && ws.kind !== 'directory') {
    // 终端进程可能刚被杀,等一小会儿让 Windows 释放 worktree 目录句柄
    await delay(250)
    for (const repo of ws.repos) {
      const wt = join(ws.worktreeRoot, repo.name)
      await removeWorktree(repo.sourcePath, wt)
      await rmrf(wt) // 兜底:git worktree remove 未删净时强删目录
      // 再 prune 一次:即便上面因文件锁只删了目录,也清掉源仓库里悬空的注册项,
      // 避免下次创建同名工作区时留下「半坏」worktree
      await pruneWorktrees(repo.sourcePath)
    }
    // 删除整个 .wt/<name> 目录
    await rmrf(ws.worktreeRoot)
  }
  cache = all().filter((w) => w.id !== id)
  persist()
}

/** 某仓库在该工作区下的真实工作树路径:directory 形态用原仓库路径,worktree 形态用 .wt 下的子目录 */
export function worktreePathFor(ws: Workspace, repo: string): string {
  if (ws.kind === 'directory') {
    const r = ws.repos.find((x) => x.name === repo)
    if (r) return r.sourcePath
  }
  return join(ws.worktreeRoot, repo)
}

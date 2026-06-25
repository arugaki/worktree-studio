import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { FileChange, RepoRef, RepoStatus, ScanResult } from '../shared/types'

const execFileAsync = promisify(execFile)

/** 扫描时跳过的目录 */
const SKIP_DIRS = new Set(['.wt', 'node_modules', '.git', '.idea', '.vscode'])

async function git(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8'
  })
}

/** 目录是否是一个 git 仓库(工作树根) */
export function isGitRepo(dir: string): boolean {
  try {
    return existsSync(join(dir, '.git'))
  } catch {
    return false
  }
}

/** 扫描根目录下的根容器仓库 + 子仓库 */
export function scanRepos(rootDir: string): ScanResult {
  const repos: RepoRef[] = []
  const rootIsRepo = isGitRepo(rootDir)
  if (rootIsRepo) {
    repos.push({
      name: baseName(rootDir),
      sourcePath: rootDir,
      isRoot: true
    })
  }
  let entries: string[] = []
  try {
    entries = readdirSync(rootDir)
  } catch {
    return { rootDir, rootIsRepo, repos }
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const full = join(rootDir, entry)
    try {
      if (!statSync(full).isDirectory()) continue
    } catch {
      continue
    }
    if (isGitRepo(full)) {
      repos.push({ name: entry, sourcePath: full, isRoot: false })
    }
  }
  return { rootDir, rootIsRepo, repos }
}

function baseName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** 该路径是否是一个能正常工作的 worktree(git 命令可用) */
async function isValidWorktree(worktreePath: string): Promise<boolean> {
  if (!existsSync(worktreePath)) return false
  try {
    await git(worktreePath, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

/**
 * 为某仓库创建(或复用)worktree。
 * - 已是有效 worktree → 幂等跳过
 * - 目录存在但已损坏(注册项丢失等)→ 先清理再重建,避免留下「半坏」worktree
 * - 分支不存在 → git worktree add -b <branch>;分支已存在 → git worktree add <branch>
 */
export async function addWorktree(
  sourcePath: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  if (existsSync(worktreePath)) {
    if (await isValidWorktree(worktreePath)) return // 幂等
    // 损坏的孤立目录:尽力清理注册项与目录,然后重建
    try {
      await git(sourcePath, ['worktree', 'remove', '--force', worktreePath])
    } catch {
      /* 未注册则忽略 */
    }
    try {
      await git(sourcePath, ['worktree', 'prune'])
    } catch {
      /* ignore */
    }
    try {
      rmSync(worktreePath, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 })
    } catch {
      /* ignore */
    }
  }
  try {
    await git(sourcePath, ['worktree', 'add', worktreePath, '-b', branch])
  } catch (e) {
    const msg = String((e as Error).message || e)
    // 分支已存在 → 直接基于已有分支检出
    if (/already exists|a branch named/i.test(msg)) {
      await git(sourcePath, ['worktree', 'add', worktreePath, branch])
    } else {
      throw new Error(`worktree add 失败 (${baseName(sourcePath)}): ${msg}`)
    }
  }
}

/** 移除某仓库的 worktree(强制,容忍目录已被手动删除) */
export async function removeWorktree(
  sourcePath: string,
  worktreePath: string
): Promise<void> {
  try {
    await git(sourcePath, ['worktree', 'remove', '--force', worktreePath])
  } catch {
    // 退而求其次:清理悬空记录
    try {
      await git(sourcePath, ['worktree', 'prune'])
    } catch {
      /* ignore */
    }
  }
}

/** 清理源仓库中所有悬空的 worktree 注册项 */
export async function pruneWorktrees(sourcePath: string): Promise<void> {
  try {
    await git(sourcePath, ['worktree', 'prune'])
  } catch {
    /* ignore */
  }
}


/**
 * 获取某 worktree 的 git 状态。
 * 用单条 `git status --porcelain=v2 --branch -z` 同时拿到分支、ahead/behind、改动文件,
 * 避免之前的 3 条命令(rev-parse + status + rev-list)。
 */
export async function getStatus(
  repo: string,
  worktreePath: string
): Promise<RepoStatus> {
  const base: RepoStatus = {
    repo,
    worktreePath,
    exists: existsSync(worktreePath),
    branch: '',
    ahead: 0,
    behind: 0,
    changes: []
  }
  if (!base.exists) return base
  try {
    const { stdout } = await git(worktreePath, [
      'status',
      '--porcelain=v2',
      '--branch',
      '-z'
    ])
    const tokens = stdout.split('\0')
    const norm = (c: string): string => (c === '.' ? ' ' : c)
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (!t) continue
      if (t.startsWith('# branch.head ')) {
        base.branch = t.slice('# branch.head '.length).trim()
      } else if (t.startsWith('# branch.ab ')) {
        const m = t.match(/\+(\d+)\s+-(\d+)/)
        if (m) {
          base.ahead = parseInt(m[1], 10)
          base.behind = parseInt(m[2], 10)
        }
      } else if (t[0] === '1') {
        const parts = t.split(' ')
        const xy = parts[1] ?? '..'
        base.changes.push({ index: norm(xy[0]), worktree: norm(xy[1]), path: parts.slice(8).join(' ') })
      } else if (t[0] === '2') {
        const parts = t.split(' ')
        const xy = parts[1] ?? '..'
        base.changes.push({ index: norm(xy[0]), worktree: norm(xy[1]), path: parts.slice(9).join(' ') })
        i++ // 跳过下一段(原路径)
      } else if (t[0] === '?') {
        base.changes.push({ index: '?', worktree: '?', path: t.slice(2) })
      }
      // '!' 忽略项不计入
    }
  } catch (e) {
    base.error = String((e as Error).message || e)
  }
  return base
}

/** 读取某工作树当前所在分支名(detached 或出错返回空串) */
export async function currentBranch(worktreePath: string): Promise<string> {
  try {
    const { stdout } = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const b = stdout.trim()
    return b === 'HEAD' ? '' : b
  } catch {
    return ''
  }
}

export async function pull(worktreePath: string): Promise<string> {
  const { stdout, stderr } = await git(worktreePath, ['pull', '--ff-only'])
  return (stdout + stderr).trim()
}

export async function push(
  worktreePath: string,
  branch: string
): Promise<string> {
  const { stdout, stderr } = await git(worktreePath, [
    'push',
    '-u',
    'origin',
    branch
  ])
  return (stdout + stderr).trim()
}

import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Workspace } from '../shared/types'

type ChangeCb = (workspaceId: string, repo: string) => void

/** 需要忽略的路径片段(降低事件风暴) */
const IGNORE = /(^|[\\/])(node_modules|dist|build|out|release|coverage|\.next|\.turbo|\.cache|target|\.git[\\/]objects|\.git[\\/]lfs)([\\/]|$)/

export class WatcherManager {
  private watchers = new Map<string, FSWatcher>()
  private timers = new Map<string, NodeJS.Timeout>()
  private onChange: ChangeCb

  constructor(onChange: ChangeCb) {
    this.onChange = onChange
  }

  /** 监听一个工作区下所有仓库 worktree 的文件变化 */
  watch(ws: Workspace): void {
    for (const repo of ws.repos) {
      const key = `${ws.id}:${repo.name}`
      if (this.watchers.has(key)) continue
      const wt = join(ws.worktreeRoot, repo.name)
      if (!existsSync(wt)) continue
      const w = chokidar.watch(wt, {
        ignored: (p: string) => IGNORE.test(p),
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 }
      })
      const fire = (): void => this.debouncedEmit(ws.id, repo.name)
      w.on('add', fire).on('change', fire).on('unlink', fire).on('addDir', fire).on('unlinkDir', fire)
      this.watchers.set(key, w)
    }
  }

  private debouncedEmit(workspaceId: string, repo: string): void {
    const key = `${workspaceId}:${repo}`
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        this.onChange(workspaceId, repo)
      }, 400)
    )
  }

  unwatch(workspaceId: string): void {
    for (const [key, w] of [...this.watchers.entries()]) {
      if (key.startsWith(workspaceId + ':')) {
        void w.close()
        this.watchers.delete(key)
      }
    }
  }

  closeAll(): void {
    for (const w of this.watchers.values()) void w.close()
    this.watchers.clear()
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}

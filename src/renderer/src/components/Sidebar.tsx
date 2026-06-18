import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileChange, RepoStatus, Workspace } from '@shared/types'
import { useStore } from '../store'

function codeClass(c: string): string {
  switch (c) {
    case 'M':
      return 'st-modified'
    case 'A':
      return 'st-added'
    case 'D':
      return 'st-deleted'
    case 'R':
      return 'st-renamed'
    case '?':
      return 'st-untracked'
    default:
      return 'st-other'
  }
}

function changeLabel(ch: FileChange): { code: string; cls: string } {
  // 优先展示工作区状态,其次暂存区
  const c = ch.worktree !== ' ' && ch.worktree !== '' ? ch.worktree : ch.index
  return { code: c === '?' ? 'U' : c, cls: codeClass(c) }
}

function RepoBlock({
  ws,
  status
}: {
  ws: Workspace
  status: RepoStatus
}): JSX.Element {
  const hasChanges = status.changes.length > 0
  // 有改动自动展开,无改动自动折叠;改动状态翻转时同步,其余时间尊重手动切换
  const [open, setOpen] = useState(hasChanges)
  const prevHas = useRef(hasChanges)
  useEffect(() => {
    if (prevHas.current !== hasChanges) {
      setOpen(hasChanges)
      prevHas.current = hasChanges
    }
  }, [hasChanges])
  const [menuOpen, setMenuOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const addTerminal = useStore((s) => s.addTerminal)
  const refreshStatuses = useStore((s) => s.refreshStatuses)

  const isRoot = ws.repos.find((r) => r.name === status.repo)?.isRoot

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      const out = await fn()
      setMsg(out.split('\n').slice(-1)[0] || '完成')
      await refreshStatuses(ws.id)
    } catch (e) {
      setMsg('✗ ' + String((e as Error)?.message ?? e).split('\n')[0])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="repo-block">
      <div className="repo-head" onClick={() => setOpen((v) => !v)}>
        <span className="repo-caret">{open ? '▾' : '▸'}</span>
        <span className="repo-name">
          {isRoot ? '📦 ' : ''}
          {status.repo}
        </span>
        {!status.exists ? (
          <span className="repo-missing">缺失</span>
        ) : (
          <>
            <span className="repo-branch" title="当前分支">
              🌿 {status.branch || '—'}
            </span>
            {status.ahead > 0 && <span className="repo-ahead">↑{status.ahead}</span>}
            {status.behind > 0 && (
              <span className="repo-behind">↓{status.behind}</span>
            )}
            {status.changes.length > 0 ? (
              <span className="repo-count">{status.changes.length}</span>
            ) : (
              <span className="repo-clean">✓</span>
            )}
            <span
              className="repo-menu-wrap"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="repo-menu-btn"
                title="操作"
                onClick={() => setMenuOpen((v) => !v)}
              >
                ⋯
              </button>
              {menuOpen && (
                <>
                  <div
                    className="menu-backdrop"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="repo-menu">
                    <button
                      onClick={() => {
                        addTerminal(ws.id, status.repo)
                        setMenuOpen(false)
                      }}
                    >
                      ＋ 新建终端
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        void run(() => window.api.pull(ws.id, status.repo))
                        setMenuOpen(false)
                      }}
                    >
                      ⤓ 拉取
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        void run(() => window.api.push(ws.id, status.repo))
                        setMenuOpen(false)
                      }}
                    >
                      ⤴ 推送
                    </button>
                  </div>
                </>
              )}
            </span>
          </>
        )}
      </div>

      {open && status.exists && (
        <div className="repo-body">
          {status.error && <div className="repo-error">{status.error}</div>}
          {status.changes.map((ch) => {
            const { code, cls } = changeLabel(ch)
            return (
              <div className="file-row" key={ch.path} title={ch.path}>
                <span className={'file-code ' + cls}>{code}</span>
                <span className="file-path">{ch.path}</span>
              </div>
            )
          })}
          {msg && <div className="repo-msg">{msg}</div>}
        </div>
      )}
    </div>
  )
}

export function Sidebar({ ws }: { ws: Workspace }): JSX.Element {
  const statuses = useStore((s) => s.statuses[ws.id])
  const refreshStatuses = useStore((s) => s.refreshStatuses)
  const removeWorkspace = useStore((s) => s.removeWorkspace)

  const totalChanges = useMemo(
    () => (statuses ?? []).reduce((n, s) => n + s.changes.length, 0),
    [statuses]
  )

  const onRemove = async (): Promise<void> => {
    const del = window.confirm(
      `删除工作区「${ws.name}」?\n\n点「确定」将同时删除磁盘上的 worktree 目录(分支历史保留在各原仓库)。\n点「取消」则中止。`
    )
    if (!del) return
    await removeWorkspace(ws.id, true)
  }

  return (
    <div className="sidebar-inner">
      <div className="sidebar-head">
        <div className="sidebar-title">{ws.name}</div>
        <div className="sidebar-sub" title={ws.rootDir}>
          📁 {ws.rootDir}
        </div>
        <div className="sidebar-sub">
          🌿 分支 {ws.branch} · {ws.repos.length} 仓库 · {totalChanges} 改动
        </div>
      </div>

      <div className="sidebar-section-label">
        <span>仓库改动</span>
        <button className="icon-btn" title="刷新" onClick={() => refreshStatuses(ws.id)}>
          ⟳
        </button>
      </div>

      <div className="repo-list">
        {(statuses ?? []).map((s) => (
          <RepoBlock key={s.repo} ws={ws} status={s} />
        ))}
        {!statuses && <div className="repo-noop">加载中…</div>}
      </div>

      <div className="sidebar-footer">
        <button className="danger" onClick={onRemove}>
          🗑 删除工作区
        </button>
      </div>
    </div>
  )
}

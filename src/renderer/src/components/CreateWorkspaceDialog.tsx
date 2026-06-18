import { useState } from 'react'
import type { ScanResult } from '@shared/types'
import { useStore } from '../store'

export function CreateWorkspaceDialog(): JSX.Element {
  const closeCreate = useStore((s) => s.closeCreate)
  const createWorkspace = useStore((s) => s.createWorkspace)
  const busy = useStore((s) => s.busy)
  const error = useStore((s) => s.error)
  const setError = useStore((s) => s.setError)

  const [name, setName] = useState('')
  const [rootDir, setRootDir] = useState('')
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)

  const doScan = async (dir: string): Promise<void> => {
    if (!dir) return
    setScanning(true)
    setError(null)
    try {
      const res = await window.api.scanRepos(dir)
      setScan(res)
      setSelected(new Set(res.repos.map((r) => r.name)))
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setScanning(false)
    }
  }

  const pick = async (): Promise<void> => {
    const dir = await window.api.pickDirectory()
    if (dir) {
      setRootDir(dir)
      await doScan(dir)
    }
  }

  const toggle = (repo: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(repo)) next.delete(repo)
      else next.add(repo)
      return next
    })
  }

  const canCreate =
    name.trim().length > 0 &&
    rootDir.trim().length > 0 &&
    selected.size > 0 &&
    !busy

  const submit = async (): Promise<void> => {
    try {
      await createWorkspace({
        name: name.trim(),
        rootDir: rootDir.trim(),
        repoNames: [...selected]
      })
    } catch {
      /* 错误已写入 store.error */
    }
  }

  return (
    <div className="dialog-backdrop" onClick={closeCreate}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">新建工作区</div>
        <div className="dialog-desc">
          为一个功能创建隔离工作区。将为下方选中的每个仓库创建一个 worktree,分支名 = 工作区名。
        </div>

        <label className="field">
          <span>工作区名(= 分支名)</span>
          <input
            autoFocus
            value={name}
            placeholder="例如 feature-login"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          <span>根目录</span>
          <div className="field-row">
            <input
              value={rootDir}
              placeholder="例如 D:\workspace"
              onChange={(e) => setRootDir(e.target.value)}
            />
            <button onClick={pick}>浏览…</button>
            <button onClick={() => doScan(rootDir)} disabled={!rootDir || scanning}>
              {scanning ? '扫描中…' : '扫描'}
            </button>
          </div>
        </label>

        {scan && (
          <div className="repo-pick">
            <div className="repo-pick-head">
              发现 {scan.repos.length} 个 git 仓库
              {scan.rootIsRepo && '(含根容器仓库)'}
            </div>
            <div className="repo-pick-list">
              {scan.repos.length === 0 && (
                <div className="repo-noop">该目录下没有发现 git 仓库</div>
              )}
              {scan.repos.map((r) => (
                <label key={r.name} className="repo-pick-item">
                  <input
                    type="checkbox"
                    checked={selected.has(r.name)}
                    onChange={() => toggle(r.name)}
                  />
                  <span>
                    {r.isRoot ? '📦 ' : '📁 '}
                    {r.name}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-actions">
          <button onClick={closeCreate}>取消</button>
          <button className="primary" disabled={!canCreate} onClick={submit}>
            {busy ? '创建中…' : '创建工作区'}
          </button>
        </div>
      </div>
    </div>
  )
}

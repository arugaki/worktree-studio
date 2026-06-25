import { useStore } from '../store'
import { SettingsMenu } from './SettingsMenu'

export function TabBar(): JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const activeId = useStore((s) => s.activeId)
  const setActive = useStore((s) => s.setActive)
  const openCreate = useStore((s) => s.openCreate)
  const openDirectory = useStore((s) => s.openDirectory)
  const statuses = useStore((s) => s.statuses)

  return (
    <div className="tabbar">
      <div className="tabbar-brand">
        <span className="brand-logo">
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="#fff"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="6.5" cy="5.5" r="2.2" fill="#fff" stroke="none" />
            <circle cx="6.5" cy="18.5" r="2.2" fill="#fff" stroke="none" />
            <circle cx="17.5" cy="9" r="2.2" fill="#fff" stroke="none" />
            <path d="M6.5 7.7 V16.3" />
            <path d="M17.5 11.2 V12.5 a4.5 4.5 0 0 1 -4.5 4.5 H9" />
          </svg>
        </span>
        <span>Worktree Studio</span>
      </div>
      <div className="tabbar-tabs">
        {workspaces.map((w) => {
          const changes = (statuses[w.id] ?? []).reduce(
            (n, s) => n + s.changes.length,
            0
          )
          const isDir = w.kind === 'directory'
          return (
            <div
              key={w.id}
              className={'tab' + (w.id === activeId ? ' active' : '')}
              onClick={() => setActive(w.id)}
              title={
                isDir
                  ? `${w.rootDir} · 目录(就地查看改动)`
                  : `${w.rootDir} · 分支 ${w.branch}`
              }
            >
              <span className="tab-name">
                {isDir && '📂 '}
                {w.name}
              </span>
              {changes > 0 && <span className="tab-badge">{changes}</span>}
            </div>
          )
        })}
        <button className="tab-add" onClick={openCreate} title="新建工作区(创建 worktree)">
          ＋
        </button>
        <button
          className="tab-add"
          onClick={() => void openDirectory()}
          title="打开目录(就地查看改动,不创建 worktree)"
        >
          📂
        </button>
      </div>
      <SettingsMenu />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useStore } from './store'
import { useSettings } from './settings'
import { TabBar } from './components/TabBar'
import { Sidebar } from './components/Sidebar'
import { TerminalArea } from './components/TerminalArea'
import { CreateWorkspaceDialog } from './components/CreateWorkspaceDialog'

export function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const workspaces = useStore((s) => s.workspaces)
  const activeId = useStore((s) => s.activeId)
  const showCreate = useStore((s) => s.showCreate)
  const openCreate = useStore((s) => s.openCreate)
  const openDirectory = useStore((s) => s.openDirectory)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const theme = useSettings((s) => s.theme)
  const sidebarWidth = useSettings((s) => s.sidebarWidth)
  const setSettings = useSettings((s) => s.set)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // 全局快捷键(对齐 Windows Terminal):Ctrl+Shift+T 新建终端,Ctrl+Shift+W 关闭当前终端。
  // 刻意用 Ctrl+Shift+* 而非 Ctrl+T / Ctrl+W —— 后者是 PowerShell/PSReadLine(转置字符、
  // 向后删词)以及 Claude Code 需要的按键,绝不能被我们在捕获阶段截走。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey)) return
      // 在我们的输入框(如重命名)里打字时不拦截
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const st = useStore.getState()
      const wsId = st.activeId
      if (!wsId) return
      if (e.code === 'KeyT') {
        e.preventDefault()
        e.stopPropagation()
        st.addRootTerminal(wsId)
      } else if (e.code === 'KeyW') {
        e.preventDefault()
        e.stopPropagation()
        const tid = st.activeTerminal[wsId]
        if (tid) st.closeTerminal(wsId, tid)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // 拖拽期间只用本地 state 更新宽度,松手才写入设置(避免每帧序列化整份设置/背景图)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    const clamp = (w: number): number => Math.min(620, Math.max(220, w))
    const onMove = (ev: MouseEvent): void => {
      setDragWidth(clamp(startW + (ev.clientX - startX)))
    }
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      setDragWidth(null)
      setSettings({ sidebarWidth: clamp(startW + (ev.clientX - startX)) })
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const effectiveWidth = dragWidth ?? sidebarWidth

  const active = workspaces.find((w) => w.id === activeId) ?? null

  return (
    <div className="app">
      <TabBar />

      {!ready ? (
        <div className="center-state">初始化中…</div>
      ) : workspaces.length === 0 ? (
        <div className="center-state">
          <div className="empty-card">
            <div className="empty-title">还没有工作区</div>
            <div className="empty-desc">
              一个工作区 = 一个功能 = 一个分支。指定根目录(如 D:\workspace)并起个功能名,
              我们会为其中每个仓库创建隔离的 worktree,你就能在内嵌终端里跑 Claude Code / Codex。
              <br />
              或者直接打开一个已有目录,就地查看其中各仓库的改动(不创建 worktree)。
            </div>
            <div className="empty-actions">
              <button className="primary" onClick={openCreate}>
                ＋ 创建第一个工作区
              </button>
              <button onClick={() => void openDirectory()}>
                📂 直接打开一个目录
              </button>
            </div>
          </div>
        </div>
      ) : active ? (
        <div className="main">
          <div
            className={'sidebar' + (sidebarCollapsed ? ' collapsed' : '')}
            style={sidebarCollapsed ? undefined : { width: effectiveWidth }}
          >
            {sidebarCollapsed ? (
              <button
                className="sidebar-expand"
                onClick={toggleSidebar}
                title="展开改动面板"
              >
                ›
              </button>
            ) : (
              <>
                <Sidebar ws={active} />
                <button
                  className="sidebar-collapse"
                  onClick={toggleSidebar}
                  title="折叠改动面板"
                >
                  ‹
                </button>
              </>
            )}
          </div>
          {!sidebarCollapsed && (
            <div
              className="resizer"
              onMouseDown={startResize}
              title="拖拽调整宽度"
            />
          )}
          <div className="content">
            <TerminalArea ws={active} />
          </div>
        </div>
      ) : null}

      {showCreate && <CreateWorkspaceDialog />}
    </div>
  )
}

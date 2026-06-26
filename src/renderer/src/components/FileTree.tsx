import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { FileEntry, Workspace } from '@shared/types'
import { useStore } from '../store'

/** 按扩展名给个朴素的图标 */
function fileIcon(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return '📜'
  if (['json', 'yml', 'yaml', 'toml', 'ini', 'env'].includes(ext)) return '⚙️'
  if (['md', 'markdown', 'txt'].includes(ext)) return '📄'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return '🖼️'
  if (['css', 'scss', 'less'].includes(ext)) return '🎨'
  if (['html', 'htm', 'xml'].includes(ext)) return '🌐'
  return '📃'
}

interface PendingCreate {
  parent: string
  isDir: boolean
}

interface TreeCtx {
  ws: Workspace
  renamingPath: string | null
  pendingCreate: PendingCreate | null
  setRenaming: (path: string | null) => void
  setPendingCreate: (p: PendingCreate | null) => void
  openMenu: (e: React.MouseEvent, entry: FileEntry) => void
}
const TreeContext = createContext<TreeCtx | null>(null)
const useTree = (): TreeCtx => {
  const v = useContext(TreeContext)
  if (!v) throw new Error('TreeContext missing')
  return v
}

/** 内联输入框:用于重命名/新建命名(Electron 不支持 window.prompt) */
function NameInput({
  initial,
  icon,
  pad,
  onSubmit,
  onCancel
}: {
  initial: string
  icon: string
  pad: number
  onSubmit: (v: string) => void
  onCancel: () => void
}): JSX.Element {
  const [v, setV] = useState(initial)
  // 防止 Enter 提交后 unmount 触发 blur 造成二次提交
  const done = useRef(false)
  const submit = (val: string): void => {
    if (done.current) return
    done.current = true
    onSubmit(val)
  }
  const cancel = (): void => {
    if (done.current) return
    done.current = true
    onCancel()
  }
  return (
    <div className="tree-row" style={{ paddingLeft: pad }}>
      <span className="tree-icon">{icon}</span>
      <input
        className="tree-name-edit"
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => (v.trim() ? submit(v) : cancel())}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') submit(v)
          else if (e.key === 'Escape') cancel()
        }}
      />
    </div>
  )
}

/** 加载并渲染某目录的子条目(懒加载),fsNonce 变化时重新拉取 */
function DirChildren({ path, depth }: { path: string; depth: number }): JSX.Element {
  const { pendingCreate, setPendingCreate } = useTree()
  const fsNonce = useStore((s) => s.fsNonce)
  const createEntry = useStore((s) => s.createEntry)
  const setError = useStore((s) => s.setError)
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setErr(null)
    window.api
      .readDir(path)
      .then((e) => alive && setEntries(e))
      .catch((e) => alive && setErr(String((e as Error)?.message ?? e)))
    return () => {
      alive = false
    }
  }, [path, fsNonce])

  const pad = depth * 12 + 8
  const creatingHere = pendingCreate?.parent === path
  const createRow = creatingHere && (
    <NameInput
      initial=""
      icon={pendingCreate!.isDir ? '📁' : '📃'}
      pad={depth * 12 + 8 + 14}
      onCancel={() => setPendingCreate(null)}
      onSubmit={(v) => {
        setPendingCreate(null)
        createEntry(path, v, pendingCreate!.isDir).catch((e) =>
          setError(String((e as Error)?.message ?? e))
        )
      }}
    />
  )

  if (err)
    return (
      <div className="file-tree-msg" style={{ paddingLeft: pad }}>
        ✗ {err}
      </div>
    )
  if (!entries)
    return (
      <div className="file-tree-msg" style={{ paddingLeft: pad }}>
        加载中…
      </div>
    )
  return (
    <>
      {createRow}
      {entries.length === 0 && !creatingHere && (
        <div className="file-tree-msg" style={{ paddingLeft: pad }}>
          空目录
        </div>
      )}
      {entries.map((e) => (
        <Node key={e.path} entry={e} depth={depth} />
      ))}
    </>
  )
}

function Node({ entry, depth }: { entry: FileEntry; depth: number }): JSX.Element {
  const { ws, renamingPath, setRenaming, pendingCreate, openMenu } = useTree()
  const [open, setOpen] = useState(false)
  const openFile = useStore((s) => s.openFile)
  const renameEntry = useStore((s) => s.renameEntry)
  const setError = useStore((s) => s.setError)
  const activeFile = useStore((s) => s.activeFile[ws.id] ?? null)

  const renaming = renamingPath === entry.path
  // 在已折叠的目录里新建时,自动展开以露出输入框
  const forceOpen = entry.isDir && pendingCreate?.parent === entry.path
  const isOpen = open || forceOpen

  const submitRename = (v: string): void => {
    setRenaming(null)
    renameEntry(ws.id, entry.path, v).catch((e) =>
      setError(String((e as Error)?.message ?? e))
    )
  }

  if (entry.isDir) {
    return (
      <div>
        {renaming ? (
          <NameInput
            initial={entry.name}
            icon="📁"
            pad={depth * 12 + 8}
            onSubmit={submitRename}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <div
            className="tree-row"
            style={{ paddingLeft: depth * 12 + 8 }}
            onClick={() => setOpen((v) => !v)}
            onContextMenu={(e) => openMenu(e, entry)}
            title={entry.path}
          >
            <span className="tree-caret">{isOpen ? '▾' : '▸'}</span>
            <span className="tree-icon">{isOpen ? '📂' : '📁'}</span>
            <span className="tree-name">{entry.name}</span>
          </div>
        )}
        {isOpen && <DirChildren path={entry.path} depth={depth + 1} />}
      </div>
    )
  }

  if (renaming)
    return (
      <NameInput
        initial={entry.name}
        icon={fileIcon(entry.name)}
        pad={depth * 12 + 8 + 14}
        onSubmit={submitRename}
        onCancel={() => setRenaming(null)}
      />
    )

  return (
    <div
      className={'tree-row file' + (activeFile === entry.path ? ' active' : '')}
      style={{ paddingLeft: depth * 12 + 8 + 14 }}
      onClick={() => openFile(ws.id, entry.path, entry.name)}
      onContextMenu={(e) => openMenu(e, entry)}
      title={entry.path}
    >
      <span className="tree-icon">{fileIcon(entry.name)}</span>
      <span className="tree-name">{entry.name}</span>
    </div>
  )
}

interface Menu {
  entry: FileEntry
  x: number
  y: number
}

export function FileTree({ ws }: { ws: Workspace }): JSX.Element {
  const [renamingPath, setRenaming] = useState<string | null>(null)
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const deleteEntry = useStore((s) => s.deleteEntry)
  const setError = useStore((s) => s.setError)

  const sep = ws.worktreeRoot.includes('\\') ? '\\' : '/'
  // 文件的父目录,目录自身则作为父目录
  const parentOf = (entry: FileEntry): string =>
    entry.isDir ? entry.path : entry.path.slice(0, entry.path.lastIndexOf(sep))

  const openMenu = (e: React.MouseEvent, entry: FileEntry): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ entry, x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const ctx: TreeCtx = {
    ws,
    renamingPath,
    pendingCreate,
    setRenaming,
    setPendingCreate,
    openMenu
  }

  return (
    <TreeContext.Provider value={ctx}>
      <div
        className="file-tree"
        onContextMenu={(e) => {
          // 空白处右键:在根目录新建
          if (e.target === e.currentTarget) {
            e.preventDefault()
            setMenu({
              entry: { name: '', path: ws.worktreeRoot, isDir: true },
              x: e.clientX,
              y: e.clientY
            })
          }
        }}
      >
        <DirChildren path={ws.worktreeRoot} depth={0} />
      </div>

      {menu && (
        <div
          className="term-ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="term-ctx-item"
            onClick={() => {
              setPendingCreate({ parent: parentOf(menu.entry), isDir: false })
              setMenu(null)
            }}
          >
            新建文件
          </button>
          <button
            className="term-ctx-item"
            onClick={() => {
              setPendingCreate({ parent: parentOf(menu.entry), isDir: true })
              setMenu(null)
            }}
          >
            新建文件夹
          </button>
          <div className="term-ctx-sep" />
          <button
            className="term-ctx-item"
            onClick={() => {
              const t = menu.entry
              setMenu(null)
              if (t.isDir) void window.api.openPath(t.path)
              else window.api.showItemInFolder(t.path)
            }}
          >
            {menu.entry.isDir ? '在文件管理器中打开' : '在文件管理器中显示'}
          </button>
          {menu.entry.name && (
            <>
              <div className="term-ctx-sep" />
              <button
                className="term-ctx-item"
                onClick={() => {
                  setRenaming(menu.entry.path)
                  setMenu(null)
                }}
              >
                重命名
              </button>
              <button
                className="term-ctx-item danger"
                onClick={() => {
                  const target = menu.entry
                  setMenu(null)
                  if (
                    window.confirm(
                      `确定删除 ${target.name}${target.isDir ? '(及其全部内容)' : ''} 吗?此操作不可撤销。`
                    )
                  ) {
                    deleteEntry(ws.id, target.path).catch((e) =>
                      setError(String((e as Error)?.message ?? e))
                    )
                  }
                }}
              >
                删除
              </button>
            </>
          )}
        </div>
      )}
    </TreeContext.Provider>
  )
}

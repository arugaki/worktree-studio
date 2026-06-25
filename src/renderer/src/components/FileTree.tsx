import { useEffect, useState } from 'react'
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

/** 加载并渲染某目录的子条目(懒加载) */
function DirChildren({
  path,
  depth,
  ws
}: {
  path: string
  depth: number
  ws: Workspace
}): JSX.Element {
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setEntries(null)
    setErr(null)
    window.api
      .readDir(path)
      .then((e) => alive && setEntries(e))
      .catch((e) => alive && setErr(String((e as Error)?.message ?? e)))
    return () => {
      alive = false
    }
  }, [path])

  const pad = depth * 12 + 8
  if (err) return <div className="file-tree-msg" style={{ paddingLeft: pad }}>✗ {err}</div>
  if (!entries) return <div className="file-tree-msg" style={{ paddingLeft: pad }}>加载中…</div>
  if (entries.length === 0)
    return <div className="file-tree-msg" style={{ paddingLeft: pad }}>空目录</div>
  return (
    <>
      {entries.map((e) => (
        <Node key={e.path} entry={e} depth={depth} ws={ws} />
      ))}
    </>
  )
}

function Node({
  entry,
  depth,
  ws
}: {
  entry: FileEntry
  depth: number
  ws: Workspace
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const openFile = useStore((s) => s.openFile)
  const activeFile = useStore((s) => s.activeFile[ws.id] ?? null)

  if (entry.isDir) {
    return (
      <div>
        <div
          className="tree-row"
          style={{ paddingLeft: depth * 12 + 8 }}
          onClick={() => setOpen((v) => !v)}
          title={entry.path}
        >
          <span className="tree-caret">{open ? '▾' : '▸'}</span>
          <span className="tree-icon">{open ? '📂' : '📁'}</span>
          <span className="tree-name">{entry.name}</span>
        </div>
        {open && <DirChildren path={entry.path} depth={depth + 1} ws={ws} />}
      </div>
    )
  }

  return (
    <div
      className={'tree-row file' + (activeFile === entry.path ? ' active' : '')}
      style={{ paddingLeft: depth * 12 + 8 + 14 }}
      onClick={() => openFile(ws.id, entry.path, entry.name)}
      title={entry.path}
    >
      <span className="tree-icon">{fileIcon(entry.name)}</span>
      <span className="tree-name">{entry.name}</span>
    </div>
  )
}

export function FileTree({ ws }: { ws: Workspace }): JSX.Element {
  return (
    <div className="file-tree">
      <DirChildren path={ws.worktreeRoot} depth={0} ws={ws} />
    </div>
  )
}

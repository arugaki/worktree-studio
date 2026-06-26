import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileReadResult } from '@shared/types'
import { useStore } from '../store'
import { renderMarkdown } from '../markdown'

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function isMarkdown(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return ext === 'md' || ext === 'markdown'
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

/**
 * 文件查看 / 编辑器:打开即可直接编辑(无需先点「编辑」)。
 * - 普通文本:直接进入可编辑文本框
 * - Markdown:默认渲染预览,点「编辑」切到源码编辑;预览会反映未保存的改动
 * 保存:Ctrl+S 或「保存」按钮。
 */
export function FileViewer({ path, name }: { path: string; name: string }): JSX.Element {
  const md = isMarkdown(name)
  const [res, setRes] = useState<FileReadResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // 默认:普通文件直接可编辑;Markdown 先渲染预览
  const [mode, setMode] = useState<'view' | 'edit'>(md ? 'view' : 'edit')
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const saveFile = useStore((s) => s.saveFile)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    setRes(null)
    setMode(md ? 'view' : 'edit')
    setDirty(false)
    setSaveErr(null)
    window.api
      .readFile(path)
      .then((r) => {
        if (alive) {
          setRes(r)
          setDraft(r.content ?? '')
        }
      })
      .catch((e) => {
        if (alive) setErr(String((e as Error)?.message ?? e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [path, md])

  const lineCount = useMemo(() => {
    const c = draft.endsWith('\n') ? draft.slice(0, -1) : draft
    return c.length === 0 ? 1 : c.split('\n').length
  }, [draft])

  const canEdit = !!res && !res.isDir && !res.binary && !res.tooLarge

  const doSave = async (): Promise<void> => {
    if (!canEdit || saving || !dirty) return
    setSaving(true)
    setSaveErr(null)
    try {
      await saveFile(path, draft)
      setRes((r) => (r ? { ...r, content: draft, size: byteLen(draft) } : r))
      setDirty(false)
    } catch (e) {
      setSaveErr(String((e as Error)?.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  const editor = (
    <textarea
      ref={taRef}
      className="file-view-edit"
      spellCheck={false}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        setDirty(true)
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          void doSave()
        }
      }}
    />
  )

  let body: JSX.Element
  if (loading) {
    body = <div className="file-view-msg">读取中…</div>
  } else if (err) {
    body = <div className="file-view-msg">✗ {err}</div>
  } else if (!res) {
    body = <div className="file-view-msg">无法读取</div>
  } else if (res.isDir) {
    body = <div className="file-view-msg">这是一个目录</div>
  } else if (res.tooLarge) {
    body = (
      <div className="file-view-msg">文件过大({humanSize(res.size)}),为避免卡顿暂不打开。</div>
    )
  } else if (res.binary) {
    body = <div className="file-view-msg">二进制文件({humanSize(res.size)}),不支持文本编辑。</div>
  } else if (md && mode === 'view') {
    body = (
      <div
        className="file-view-md md-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
      />
    )
  } else {
    body = editor
  }

  return (
    <div className="file-view">
      <div className="file-view-head">
        <span className="file-view-name" title={path}>
          {name}
          {dirty ? ' •' : ''}
        </span>
        {res && !res.isDir && (
          <span className="file-view-meta">
            {humanSize(canEdit ? byteLen(draft) : res.size)}
            {canEdit && ` · ${lineCount} 行`}
          </span>
        )}
        <span className="file-view-spacer" />
        {saveErr && <span className="file-view-saveerr">保存失败: {saveErr}</span>}
        {canEdit && (
          <>
            <button
              className="file-view-btn primary"
              disabled={!dirty || saving}
              onClick={() => void doSave()}
              title="保存 (Ctrl+S)"
            >
              {saving ? '保存中…' : '💾 保存'}
            </button>
            {md &&
              (mode === 'view' ? (
                <button className="file-view-btn" onClick={() => setMode('edit')}>
                  ✏ 编辑
                </button>
              ) : (
                <button className="file-view-btn" onClick={() => setMode('view')}>
                  预览
                </button>
              ))}
          </>
        )}
      </div>
      {body}
    </div>
  )
}

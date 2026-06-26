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

/** 文件查看 / 编辑器:支持纯文本编辑保存,Markdown 预览渲染 */
export function FileViewer({ path, name }: { path: string; name: string }): JSX.Element {
  const [res, setRes] = useState<FileReadResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const saveFile = useStore((s) => s.saveFile)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const md = isMarkdown(name)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    setRes(null)
    setMode('view')
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
  }, [path])

  const lineCount = useMemo(() => {
    if (!res?.content) return 0
    const c = res.content.endsWith('\n') ? res.content.slice(0, -1) : res.content
    return c.length === 0 ? 1 : c.split('\n').length
  }, [res])

  const gutter = useMemo(() => {
    let s = ''
    for (let i = 1; i <= lineCount; i++) s += i + '\n'
    return s
  }, [lineCount])

  const canEdit = !!res && !res.isDir && !res.binary && !res.tooLarge

  const doSave = async (): Promise<void> => {
    if (!canEdit || saving) return
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

  const enterEdit = (): void => {
    if (!res) return
    setDraft(res.content ?? '')
    setDirty(false)
    setMode('edit')
  }

  const exitEdit = (): void => {
    setMode('view')
    setDirty(false)
    if (res) setDraft(res.content ?? '')
  }

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
      <div className="file-view-msg">文件过大({humanSize(res.size)}),为避免卡顿暂不预览。</div>
    )
  } else if (res.binary) {
    body = <div className="file-view-msg">二进制文件({humanSize(res.size)}),不支持文本预览。</div>
  } else if (mode === 'edit') {
    body = (
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
  } else if (md) {
    body = (
      <div
        className="file-view-md md-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(res.content || '') }}
      />
    )
  } else {
    body = (
      <div className="file-view-code">
        <pre className="file-view-gutter" aria-hidden>
          {gutter}
        </pre>
        <pre className="file-view-text">{res.content || ''}</pre>
      </div>
    )
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
            {humanSize(res.size)}
            {!res.binary && !res.tooLarge && ` · ${lineCount} 行`}
          </span>
        )}
        <span className="file-view-spacer" />
        {saveErr && <span className="file-view-saveerr">保存失败: {saveErr}</span>}
        {canEdit &&
          (mode === 'edit' ? (
            <>
              <button
                className="file-view-btn primary"
                disabled={!dirty || saving}
                onClick={() => void doSave()}
              >
                {saving ? '保存中…' : '💾 保存'}
              </button>
              <button className="file-view-btn" onClick={exitEdit}>
                {md ? '预览' : '查看'}
              </button>
            </>
          ) : (
            <button className="file-view-btn" onClick={enterEdit}>
              ✏ 编辑
            </button>
          ))}
      </div>
      {body}
    </div>
  )
}

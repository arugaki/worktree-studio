import { useEffect, useMemo, useState } from 'react'
import type { FileReadResult } from '@shared/types'

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 只读文件内容查看器:带行号,纯文本渲染 */
export function FileViewer({ path, name }: { path: string; name: string }): JSX.Element {
  const [res, setRes] = useState<FileReadResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    setRes(null)
    window.api
      .readFile(path)
      .then((r) => {
        if (alive) setRes(r)
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
    // 末尾换行不额外计行
    const c = res.content.endsWith('\n') ? res.content.slice(0, -1) : res.content
    return c.length === 0 ? 1 : c.split('\n').length
  }, [res])

  const gutter = useMemo(() => {
    let s = ''
    for (let i = 1; i <= lineCount; i++) s += i + '\n'
    return s
  }, [lineCount])

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
      <div className="file-view-msg">
        文件过大({humanSize(res.size)}),为避免卡顿暂不预览。
      </div>
    )
  } else if (res.binary) {
    body = (
      <div className="file-view-msg">
        二进制文件({humanSize(res.size)}),不支持文本预览。
      </div>
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
        </span>
        {res && !res.isDir && (
          <span className="file-view-meta">
            {humanSize(res.size)}
            {!res.binary && !res.tooLarge && ` · ${lineCount} 行`}
          </span>
        )}
      </div>
      {body}
    </div>
  )
}

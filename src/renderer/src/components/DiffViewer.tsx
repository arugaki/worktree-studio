import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileDiffResult } from '@shared/types'
import { buildDiffRows, diffStats } from '../diff'

/** 并排差异查看器:左=变更前(HEAD),右=变更后(工作区),竖向滚动联动 */
export function DiffViewer({
  wsId,
  repo,
  relPath,
  name
}: {
  wsId: string
  repo: string
  relPath: string
  name: string
}): JSX.Element {
  const [res, setRes] = useState<FileDiffResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    setRes(null)
    window.api
      .getFileDiff(wsId, repo, relPath)
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
  }, [wsId, repo, relPath])

  const rows = useMemo(
    () => (res && !res.binary && !res.tooLarge ? buildDiffRows(res.before, res.after) : []),
    [res]
  )
  const stats = useMemo(() => diffStats(rows), [rows])

  // 一侧滚动时同步另一侧的竖向位置
  const onScroll = (from: 'l' | 'r') => (): void => {
    if (syncing.current) return
    syncing.current = true
    const src = (from === 'l' ? leftRef : rightRef).current
    const dst = (from === 'l' ? rightRef : leftRef).current
    if (src && dst) dst.scrollTop = src.scrollTop
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }

  let body: JSX.Element
  if (loading) {
    body = <div className="file-view-msg">读取差异中…</div>
  } else if (err) {
    body = <div className="file-view-msg">✗ {err}</div>
  } else if (!res) {
    body = <div className="file-view-msg">无法读取差异</div>
  } else if (res.binary) {
    body = <div className="file-view-msg">二进制文件,无法显示差异。</div>
  } else if (res.tooLarge) {
    body = <div className="file-view-msg">文件过大,暂不显示差异。</div>
  } else if (stats.added === 0 && stats.removed === 0) {
    body = <div className="file-view-msg">无文本差异(可能是权限/换行符/重命名等改动)。</div>
  } else {
    body = (
      <>
        <div className="diff-cols-head">
          <div className="diff-col-label">变更前 · HEAD</div>
          <div className="diff-col-label">变更后 · 工作区</div>
        </div>
        <div className="diff-body">
          <div className="diff-pane" ref={leftRef} onScroll={onScroll('l')}>
            {rows.map((r, i) => (
              <div
                key={i}
                className={
                  'diff-line' +
                  (r.left ? (r.kind === 'eq' ? '' : ' diff-del') : ' diff-blank')
                }
              >
                <span className="diff-gutter">{r.left ? r.left.n : ''}</span>
                <span className="diff-code">{r.left ? r.left.text : ''}</span>
              </div>
            ))}
          </div>
          <div className="diff-pane" ref={rightRef} onScroll={onScroll('r')}>
            {rows.map((r, i) => (
              <div
                key={i}
                className={
                  'diff-line' +
                  (r.right ? (r.kind === 'eq' ? '' : ' diff-ins') : ' diff-blank')
                }
              >
                <span className="diff-gutter">{r.right ? r.right.n : ''}</span>
                <span className="diff-code">{r.right ? r.right.text : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="file-view">
      <div className="file-view-head">
        <span className="file-view-name" title={`${repo}/${relPath}`}>
          {name}
        </span>
        <span className="file-view-meta">{repo}</span>
        <span className="file-view-spacer" />
        {res && !res.binary && !res.tooLarge && (
          <span className="diff-stat">
            <span className="diff-stat-add">+{stats.added}</span>{' '}
            <span className="diff-stat-del">−{stats.removed}</span>
          </span>
        )}
      </div>
      {body}
    </div>
  )
}

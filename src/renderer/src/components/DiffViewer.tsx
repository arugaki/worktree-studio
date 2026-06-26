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
  const [curHunk, setCurHunk] = useState(-1)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setErr(null)
    setRes(null)
    setCurHunk(-1)
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

  // 每处「改动块」(连续的非相等行)的起始行下标,用于上一处/下一处跳转
  const hunkStarts = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].kind !== 'eq' && (i === 0 || rows[i - 1].kind === 'eq')) out.push(i)
    }
    return out
  }, [rows])

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

  // 跳到第 idx 处改动(越界则环绕),把对应行滚动到视图顶部附近
  const gotoHunk = (idx: number): void => {
    const n = hunkStarts.length
    if (n === 0) return
    const i = ((idx % n) + n) % n
    setCurHunk(i)
    const pane = leftRef.current
    const el = pane?.children[hunkStarts[i]] as HTMLElement | undefined
    if (pane && el) {
      const top = Math.max(0, el.offsetTop - 48)
      pane.scrollTop = top
      if (rightRef.current) rightRef.current.scrollTop = top
    }
  }

  // 文件加载后自动定位到第一处改动(还没手动跳过时)
  useEffect(() => {
    if (hunkStarts.length > 0 && curHunk === -1) {
      const id = requestAnimationFrame(() => gotoHunk(0))
      return () => cancelAnimationFrame(id)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hunkStarts])

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
        {hunkStarts.length > 0 && (
          <span className="diff-nav">
            <button
              className="diff-nav-btn"
              title="上一处改动"
              onClick={() => gotoHunk(curHunk < 0 ? hunkStarts.length - 1 : curHunk - 1)}
            >
              ↑
            </button>
            <span className="diff-nav-count">
              {curHunk >= 0 ? curHunk + 1 : '·'}/{hunkStarts.length}
            </span>
            <button
              className="diff-nav-btn"
              title="下一处改动"
              onClick={() => gotoHunk(curHunk + 1)}
            >
              ↓
            </button>
          </span>
        )}
      </div>
      {body}
    </div>
  )
}

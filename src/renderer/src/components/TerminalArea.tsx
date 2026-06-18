import { useEffect, useRef, useState } from 'react'
import type { TerminalMeta, Workspace } from '@shared/types'
import { useStore } from '../store'
import { useSettings } from '../settings'
import { useTermTitles } from '../activity'
import { TerminalPane } from './TerminalPane'
import { TermIcon } from './TermIcon'

/** 标签配色板(6 位 hex,便于拼透明度) */
const TAB_COLORS = ['#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#89b4fa', '#cba6f7', '#94e2d5']

interface CtxMenu {
  id: string
  x: number
  y: number
}

export function TerminalArea({ ws }: { ws: Workspace }): JSX.Element {
  const terminals = useStore((s) => s.terminals[ws.id] ?? [])
  const activeTerm = useStore((s) => s.activeTerminal[ws.id] ?? null)
  const setActiveTerminal = useStore((s) => s.setActiveTerminal)
  const addRootTerminal = useStore((s) => s.addRootTerminal)
  const closeTerminal = useStore((s) => s.closeTerminal)
  const closeOtherTerminals = useStore((s) => s.closeOtherTerminals)
  const closeTerminalsToRight = useStore((s) => s.closeTerminalsToRight)
  const duplicateTerminal = useStore((s) => s.duplicateTerminal)
  const renameTerminal = useStore((s) => s.renameTerminal)
  const setTerminalColor = useStore((s) => s.setTerminalColor)
  const moveTerminal = useStore((s) => s.moveTerminal)
  const profiles = useStore((s) => s.profiles)
  const oscTitles = useTermTitles((s) => s.titles)
  const defaultProfileId = useSettings((s) => s.defaultProfileId)
  const bgImage = useSettings((s) => s.bgImage)
  const bgDim = useSettings((s) => s.bgDim)

  const [menuOpen, setMenuOpen] = useState(false)
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点击外部 / Esc 关闭新建下拉与右键菜单
  useEffect(() => {
    if (!menuOpen && !ctx) return
    const onDown = (e: MouseEvent): void => {
      if (menuOpen && !wrapRef.current?.contains(e.target as Node)) setMenuOpen(false)
      if (ctx) setCtx(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        setCtx(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, ctx])

  const defaultId = defaultProfileId ?? profiles[0]?.id ?? null

  const displayTitle = (t: TerminalMeta): string =>
    t.customTitle || oscTitles[t.id] || t.profileLabel || t.title

  const ctxTerm = ctx ? terminals.find((t) => t.id === ctx.id) : null

  return (
    <div className="term-area">
      <div className="term-tabs">
        <div className="term-tabs-scroll">
          {terminals.map((t) => {
            const colored = t.color
            return (
              <div
                key={t.id}
                className={
                  'term-tab' +
                  (t.id === activeTerm ? ' active' : '') +
                  (dragId === t.id ? ' dragging' : '')
                }
                style={
                  colored
                    ? { borderColor: t.color, background: t.color + '22' }
                    : undefined
                }
                onClick={() => setActiveTerminal(ws.id, t.id)}
                title={(t.profileLabel ? t.profileLabel + ' · ' : '') + t.cwd}
                draggable={editingId !== t.id}
                onDragStart={(e) => {
                  setDragId(t.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => {
                  if (dragId && dragId !== t.id) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragId) moveTerminal(ws.id, dragId, t.id)
                  setDragId(null)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenuOpen(false)
                  setCtx({ id: t.id, x: e.clientX, y: e.clientY })
                }}
                onDoubleClick={() => setEditingId(t.id)}
                onMouseDown={(e) => {
                  // 中键关闭
                  if (e.button === 1) {
                    e.preventDefault()
                    closeTerminal(ws.id, t.id)
                  }
                }}
              >
                <TermIcon meta={t} />
                {editingId === t.id ? (
                  <input
                    className="term-tab-edit"
                    autoFocus
                    defaultValue={displayTitle(t)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      renameTerminal(ws.id, t.id, e.target.value)
                      setEditingId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameTerminal(ws.id, t.id, (e.target as HTMLInputElement).value)
                        setEditingId(null)
                      } else if (e.key === 'Escape') {
                        setEditingId(null)
                      }
                    }}
                  />
                ) : (
                  <span className="term-tab-title">{displayTitle(t)}</span>
                )}
                <button
                  className="term-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTerminal(ws.id, t.id)
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>

        <div className="term-add-wrap" ref={wrapRef}>
          <div className="term-add-split">
            <button
              className="term-add"
              onClick={() => addRootTerminal(ws.id)}
              title="新建终端(默认)"
            >
              ＋
            </button>
            <button
              className="term-add term-add-caret"
              onClick={() => setMenuOpen((v) => !v)}
              title="选择终端类型"
            >
              ▾
            </button>
          </div>
          {menuOpen && (
            <div className="term-profile-menu">
              {profiles.length === 0 && (
                <div className="term-profile-empty">未发现可用终端</div>
              )}
              {profiles.map((p) => (
                <button
                  key={p.id}
                  className={'term-profile-item' + (p.id === defaultId ? ' active' : '')}
                  onClick={() => {
                    addRootTerminal(ws.id, p)
                    setMenuOpen(false)
                  }}
                  title={[p.shellPath, ...(p.args ?? [])].join(' ')}
                >
                  <span className="term-profile-name">{p.label}</span>
                  {p.id === defaultId && <span className="term-profile-tag">默认</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {ctx && ctxTerm && (
        <div
          className="term-ctx-menu"
          style={{ left: ctx.x, top: ctx.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="term-ctx-item"
            onClick={() => {
              setEditingId(ctx.id)
              setCtx(null)
            }}
          >
            重命名
          </button>
          <button
            className="term-ctx-item"
            onClick={() => {
              duplicateTerminal(ws.id, ctx.id)
              setCtx(null)
            }}
          >
            复制
          </button>
          <div className="term-ctx-sep" />
          <div className="term-ctx-colors">
            {TAB_COLORS.map((c) => (
              <button
                key={c}
                className={'term-ctx-swatch' + (ctxTerm.color === c ? ' active' : '')}
                style={{ background: c }}
                title="设置标签颜色"
                onClick={() => {
                  setTerminalColor(ws.id, ctx.id, c)
                  setCtx(null)
                }}
              />
            ))}
            <button
              className="term-ctx-swatch term-ctx-swatch-none"
              title="清除颜色"
              onClick={() => {
                setTerminalColor(ws.id, ctx.id, null)
                setCtx(null)
              }}
            >
              ×
            </button>
          </div>
          <div className="term-ctx-sep" />
          <button
            className="term-ctx-item"
            onClick={() => {
              closeTerminal(ws.id, ctx.id)
              setCtx(null)
            }}
          >
            关闭
          </button>
          <button
            className="term-ctx-item"
            onClick={() => {
              closeOtherTerminals(ws.id, ctx.id)
              setCtx(null)
            }}
          >
            关闭其他
          </button>
          <button
            className="term-ctx-item"
            onClick={() => {
              closeTerminalsToRight(ws.id, ctx.id)
              setCtx(null)
            }}
          >
            关闭右侧
          </button>
        </div>
      )}

      <div className="term-body">
        {bgImage && (
          <>
            <div
              className="term-bg-image"
              style={{ backgroundImage: `url("${bgImage}")` }}
            />
            <div
              className="term-bg-scrim"
              style={{ background: `rgba(8,9,13,${bgDim})` }}
            />
          </>
        )}
        {terminals.length === 0 ? (
          <div className="term-empty">没有终端,点击右上角 ＋ 新建一个</div>
        ) : (
          terminals.map((t) => (
            <TerminalPane key={t.id} meta={t} active={t.id === activeTerm} />
          ))
        )}
      </div>
    </div>
  )
}

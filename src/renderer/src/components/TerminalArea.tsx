import type { Workspace } from '@shared/types'
import { useStore } from '../store'
import { useSettings } from '../settings'
import { TerminalPane } from './TerminalPane'

export function TerminalArea({ ws }: { ws: Workspace }): JSX.Element {
  const terminals = useStore((s) => s.terminals[ws.id] ?? [])
  const activeTerm = useStore((s) => s.activeTerminal[ws.id] ?? null)
  const setActiveTerminal = useStore((s) => s.setActiveTerminal)
  const addRootTerminal = useStore((s) => s.addRootTerminal)
  const closeTerminal = useStore((s) => s.closeTerminal)
  const bgImage = useSettings((s) => s.bgImage)
  const bgDim = useSettings((s) => s.bgDim)

  return (
    <div className="term-area">
      <div className="term-tabs">
        <div className="term-tabs-scroll">
          {terminals.map((t) => (
            <div
              key={t.id}
              className={'term-tab' + (t.id === activeTerm ? ' active' : '')}
              onClick={() => setActiveTerminal(ws.id, t.id)}
              title={t.cwd}
            >
              <span className="term-tab-dot" />
              <span className="term-tab-title">{t.title}</span>
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
          ))}
        </div>

        <div className="term-add-wrap">
          <button
            className="term-add"
            onClick={() => addRootTerminal(ws.id)}
            title="新建根目录终端"
          >
            ＋
          </button>
        </div>
      </div>

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

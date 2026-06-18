import { useEffect, useRef } from 'react'
import type { CreatePtyInput, TerminalMeta } from '@shared/types'
import { attachTerminal, ensureTerminal, refit } from '../terminals'

export function TerminalPane({
  meta,
  active
}: {
  meta: TerminalMeta
  active: boolean
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const input: CreatePtyInput = {
      id: meta.id,
      workspaceId: meta.workspaceId,
      repo: meta.repo,
      cwd: meta.cwd,
      shellPath: meta.shellPath,
      args: meta.args
    }
    ensureTerminal(input)
    if (ref.current) attachTerminal(meta.id, ref.current)

    const ro = new ResizeObserver(() => {
      if (active) refit(meta.id)
    })
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id])

  useEffect(() => {
    if (active && ref.current) {
      attachTerminal(meta.id, ref.current)
      refit(meta.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    <div
      className="term-host"
      ref={ref}
      style={{ display: active ? 'block' : 'none' }}
    />
  )
}

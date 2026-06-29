import { useEffect, useRef } from 'react'
import type { CreatePtyInput, TerminalMeta } from '@shared/types'
import { attachTerminal, ensureTerminal, refit, restoreScroll, saveScroll } from '../terminals'

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
      // attachTerminal 会在下一帧 fit;等其完成、可视区尺寸就绪后再恢复滚动位置
      requestAnimationFrame(() => restoreScroll(meta.id))
      // 切走标签 / 切换工作区卸载本面板前(此时内部滚动状态仍正确)记下位置:
      // display:none 或 DOM 脱离都会让浏览器把可视区 scrollTop 清零。
      return () => saveScroll(meta.id)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    <div
      className="term-host"
      ref={ref}
      // 用 visibility 而非 display:none 隐藏:display:none 会让浏览器把 xterm 可视区的
      // scrollTop 清零、并在重新显示时异步派发一个 scroll 事件,把终端拉回顶部。
      // visibility:hidden 保留布局与滚动位置(.term-host 本就是绝对定位、各面板叠放),
      // 切回时自然停在原处。pointer-events 关掉,避免隐藏面板拦截点击。
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
        zIndex: active ? 1 : 0
      }}
    />
  )
}

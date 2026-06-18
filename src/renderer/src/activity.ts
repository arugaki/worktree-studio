import { create } from 'zustand'

/**
 * 进程通过 OSC 0/2 设置的终端标题(运行时,非持久)。
 * 标签标题优先级:用户重命名 > 这里的进程标题 > profile 名。
 */
interface TitlesState {
  titles: Record<string, string>
  setTitle: (id: string, t: string) => void
  clear: (id: string) => void
}

export const useTermTitles = create<TitlesState>((set) => ({
  titles: {},
  setTitle: (id, t) =>
    set((s) => (s.titles[id] === t ? s : { titles: { ...s.titles, [id]: t } })),
  clear: (id) =>
    set((s) => {
      if (!(id in s.titles)) return s
      const next = { ...s.titles }
      delete next[id]
      return { titles: next }
    })
}))

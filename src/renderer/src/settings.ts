import { create } from 'zustand'

export interface Settings {
  /** 终端字体大小 px */
  fontSize: number
  /** 终端字体(css font-family) */
  fontFamily: string
  /** 光标样式 */
  cursorStyle: 'block' | 'bar' | 'underline'
  /** 终端回滚行数 */
  scrollback: number
  /** 主题 */
  theme: 'dark' | 'light'
  /** 默认终端 profile id(对应主进程枚举出的 TerminalProfile.id);null = 用列表第一项 */
  defaultProfileId: string | null
  /** 行高(倍数) */
  lineHeight: number
  /** 字间距 px */
  letterSpacing: number
  /** 自定义文字颜色(hex),null = 跟随主题 */
  foreground: string | null
  /** 终端背景图(data URL),null 表示无 */
  bgImage: string | null
  /** 背景图暗度遮罩 0~0.9(越大越暗,文字越清晰) */
  bgDim: number
  /** 侧栏宽度 px */
  sidebarWidth: number
}

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Cascadia Code', value: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", Consolas, monospace' },
  { label: 'Maple Mono', value: '"Maple Mono", "Cascadia Code", monospace' },
  { label: 'Consolas', value: 'Consolas, "Courier New", monospace' }
]

export const SCROLLBACK_OPTIONS = [1000, 5000, 10000, 50000, 100000]

const DEFAULTS: Settings = {
  fontSize: 13,
  fontFamily: FONT_OPTIONS[0].value,
  cursorStyle: 'block',
  scrollback: 10000,
  theme: 'dark',
  defaultProfileId: null,
  lineHeight: 1.0,
  letterSpacing: 0,
  foreground: null,
  bgImage: null,
  bgDim: 0.55,
  sidebarWidth: 312
}

const KEY = 'wts.settings'
const KEY_BG = 'wts.bgImage'

function load(): Settings {
  let main: Partial<Settings> = {}
  try {
    main = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>
  } catch {
    /* ignore */
  }
  let bg: string | null = null
  try {
    bg = localStorage.getItem(KEY_BG) || null
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS, ...main, bgImage: bg }
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void
  reset: () => void
}

function snapshot(s: SettingsState): Settings {
  const { set: _s, reset: _r, ...vals } = s
  return vals
}

// 背景图(可能几 MB)单独存,避免每次普通设置变更都把它一起序列化
function persistMain(vals: Settings): void {
  try {
    const { bgImage: _bg, ...rest } = vals
    localStorage.setItem(KEY, JSON.stringify(rest))
  } catch {
    /* ignore */
  }
}
function persistBg(bg: string | null): void {
  try {
    if (bg) localStorage.setItem(KEY_BG, bg)
    else localStorage.removeItem(KEY_BG)
  } catch {
    /* 背景图过大写入失败时忽略(本会话内仍生效) */
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch)
    persistMain(snapshot(get()))
    if ('bgImage' in patch) persistBg(get().bgImage)
  },
  reset: () => {
    const keepWidth = get().sidebarWidth
    const next = { ...DEFAULTS, sidebarWidth: keepWidth }
    set(next)
    persistMain(next)
    persistBg(null)
  }
}))

/** 取当前设置快照(非响应式) */
export function getSettings(): Settings {
  return snapshot(useSettings.getState())
}

// 供截图/调试驱动
;(window as unknown as Record<string, unknown>).__wtsSettings = useSettings

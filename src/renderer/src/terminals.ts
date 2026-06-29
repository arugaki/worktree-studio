import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { CanvasAddon } from '@xterm/addon-canvas'
import type { CreatePtyInput } from '@shared/types'
import { getSettings, useSettings, type Settings } from './settings'
import { useTermTitles } from './activity'

/**
 * 终端实例注册表。
 * xterm 实例与其 DOM 包裹层在这里长期持有,切换工作区标签时组件卸载也不销毁,
 * 从而保留滚动历史和会话(pty 在主进程持续运行)。
 */
export interface TerminalEntry {
  id: string
  term: Terminal
  fit: FitAddon
  wrapper: HTMLDivElement
  ptyCreated: boolean
  meta: CreatePtyInput
  exited: boolean
  /** 是否处于全屏 TUI(alt-screen)模式 */
  altScreen: boolean
  /** 重绘期间是否正在抑制光标显示 */
  suppressing: boolean
  /** 应用(codex)对光标可见性的最终意图 */
  cursorWanted: boolean
}

const entries = new Map<string, TerminalEntry>()
let wired = false

// 按帧合并 pty 输出(类似 ConPTY 的整帧合成),并在全屏 TUI(alt-screen,如 codex)
// 重绘期间抑制硬件光标:codex 每帧把光标在屏幕多处来回移动,逐帧渲染就会「到处闪」。
// 做法:alt-screen 下,只要有数据在流动就让光标保持隐藏;输出静止 130ms 后再把光标
// 显示到最终位置。这样 working 期间不闪,空闲等输入时光标稳定可见;普通 shell 不受影响。
const ptyBuffer = new Map<string, string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>()
function flushPty(): void {
  flushTimer = null
  for (const [id, data] of ptyBuffer) {
    const e = entries.get(id)
    if (!e) continue
    // 有输出在流动时先置「抑制」:本批数据里的 ?25h(显示光标)会被吞掉,而应用自己的
    // ?25l 仍会隐藏光标 → 重绘期间光标保持隐藏;codex 不再到处闪。输出静止 110ms 后,
    // 按应用的最终意图把光标显示到最终位置(空闲等输入时光标稳定可见)。
    e.suppressing = true
    e.term.write(data)
    const old = settleTimers.get(id)
    if (old) clearTimeout(old)
    settleTimers.set(
      id,
      setTimeout(() => {
        settleTimers.delete(id)
        e.suppressing = false
        if (e.cursorWanted && !e.exited) e.term.write('\x1b[?25h')
      }, 110)
    )
  }
  ptyBuffer.clear()
}
/** 把一段 pty 数据送入按帧合并队列(真实 pty 与回放共用) */
export function feedPtyData(id: string, data: string): void {
  ptyBuffer.set(id, (ptyBuffer.get(id) ?? '') + data)
  if (!flushTimer) flushTimer = setTimeout(flushPty, 16)
}

/** 清理某终端的运行时状态(进程标题等) */
function clearTermRuntime(id: string): void {
  useTermTitles.getState().clear(id)
}

/**
 * 过滤无意义的进程标题。pwsh 默认会把窗口标题设成自身 exe 全路径
 * (如 "Administrator: C:\...\pwsh.exe"),WSL/cmd 也可能给出 exe 路径,
 * 这类标题没有信息量、还特别长,直接丢弃 → 标签回退到 profile 名。
 * 真正有用的标题(ssh 主机名、vim 文件名、用户自定义 PS1 标题)才保留。
 */
function meaningfulTitle(raw: string): string | null {
  let t = raw.trim()
  if (!t) return null
  // 去掉提权前缀
  t = t.replace(/^(Administrator|管理员):\s*/i, '').trim()
  // 看起来是个可执行文件路径(以 .exe 结尾)→ 无意义
  if (/\.exe$/i.test(t)) return null
  // Store 应用的长包路径
  if (/WindowsApps/i.test(t)) return null
  return t
}

const DARK_THEME: ITheme = {
  background: '#0b0c11',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  // 选区用半透明强调色,明显且不挡字;失焦时稍暗
  selectionBackground: 'rgba(124, 108, 246, 0.45)',
  selectionInactiveBackground: 'rgba(124, 108, 246, 0.25)',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8'
}

const LIGHT_THEME: ITheme = {
  background: '#f7f8fb',
  foreground: '#2a2e3a',
  cursor: '#5b46c9',
  selectionBackground: 'rgba(109, 92, 246, 0.32)',
  selectionInactiveBackground: 'rgba(109, 92, 246, 0.18)',
  black: '#3b4252',
  red: '#d63864',
  green: '#2e9a63',
  yellow: '#b6831f',
  blue: '#3a66d6',
  magenta: '#a64bc4',
  cyan: '#1c93a8',
  white: '#7a8194',
  brightBlack: '#9aa0ad',
  brightRed: '#d63864',
  brightGreen: '#2e9a63',
  brightYellow: '#b6831f',
  brightBlue: '#3a66d6',
  brightMagenta: '#a64bc4',
  brightCyan: '#1c93a8',
  brightWhite: '#2a2e3a'
}

function buildXtermTheme(s: Settings): ITheme {
  const theme: ITheme = { ...(s.theme === 'light' ? LIGHT_THEME : DARK_THEME) }
  // 自定义文字颜色
  if (s.foreground) theme.foreground = s.foreground
  // 有背景图时把终端背景设为透明,让底层图片透出来(由 CSS 遮罩控制可读性)
  if (s.bgImage) theme.background = 'rgba(0,0,0,0)'
  return theme
}

/** 把设置实时应用到所有已存在的终端 */
function applySettingsToAll(): void {
  const s = getSettings()
  const theme = buildXtermTheme(s)
  for (const e of entries.values()) {
    e.term.options.fontSize = s.fontSize
    e.term.options.fontFamily = s.fontFamily
    e.term.options.cursorStyle = s.cursorStyle
    e.term.options.scrollback = s.scrollback
    e.term.options.lineHeight = s.lineHeight
    e.term.options.letterSpacing = s.letterSpacing
    e.term.options.theme = theme
    try {
      e.fit.fit()
      if (!e.exited) window.api.ptyResize(e.id, e.term.cols, e.term.rows)
    } catch {
      /* ignore */
    }
  }
}

/** 仅初始化一次:把主进程的 pty 数据/退出事件分发到对应终端 */
let lastTermSig = ''
function onSettingsChanged(): void {
  const s = getSettings()
  // 只有终端相关设置变化时才重设所有终端(避免拖侧栏/调暗度时触发全终端 refit)
  const sig = JSON.stringify([
    s.fontSize,
    s.fontFamily,
    s.cursorStyle,
    s.scrollback,
    s.lineHeight,
    s.letterSpacing,
    s.foreground,
    s.theme,
    s.bgImage
  ])
  if (sig === lastTermSig) return
  lastTermSig = sig
  applySettingsToAll()
}

function wireGlobalEvents(): void {
  if (wired) return
  wired = true
  lastTermSig = '' // 首次不主动 apply,终端创建时已读取设置
  useSettings.subscribe(onSettingsChanged)
  window.api.onPtyData(({ id, data }) => feedPtyData(id, data))
  window.api.onPtyExit(({ id, exitCode }) => {
    clearTermRuntime(id)
    const e = entries.get(id)
    if (!e) return
    e.exited = true
    e.term.write(`\r\n\x1b[90m[进程已退出,代码 ${exitCode}]\x1b[0m\r\n`)
  })
}

export function getEntry(id: string): TerminalEntry | undefined {
  return entries.get(id)
}

/** 确保某终端的 xterm 实例存在(尚不创建 pty) */
export function ensureTerminal(meta: CreatePtyInput): TerminalEntry {
  wireGlobalEvents()
  const existing = entries.get(meta.id)
  if (existing) return existing

  const wrapper = document.createElement('div')
  wrapper.className = 'term-wrapper'

  const cfg = getSettings()
  const term = new Terminal({
    fontFamily: cfg.fontFamily,
    fontSize: cfg.fontSize,
    lineHeight: cfg.lineHeight,
    letterSpacing: cfg.letterSpacing,
    // 不强制闪烁:交给 codex / claude 等 TUI 通过转义序列自行控制光标,
    // 否则它们 working 隐藏光标时,xterm 仍会强制闪一个块状光标
    cursorBlink: false,
    cursorStyle: cfg.cursorStyle,
    cursorInactiveStyle: 'none',
    allowProposedApi: true,
    allowTransparency: true, // 背景图功能需要透明
    scrollback: cfg.scrollback,
    theme: buildXtermTheme(cfg)
  })

  const fit = new FitAddon()
  term.loadAddon(fit)

  // Unicode 11:让 emoji / 框线字符宽度正确(Claude Code / Codex 大量使用)
  try {
    const uni = new Unicode11Addon()
    term.loadAddon(uni)
    term.unicode.activeVersion = '11'
  } catch {
    /* ignore */
  }

  term.open(wrapper)

  // 使用 Canvas GPU 渲染器。codex/claude 在 working 时每帧重绘「codex」字标/spinner,
  // DOM 渲染器会逐格重建 DOM,高频下肉眼可见闪烁;Canvas 用离屏画布整块合成(类似
  // Windows Terminal 的 GPU 渲染),重绘平滑不闪。失败则回退到 DOM 渲染器。
  try {
    term.loadAddon(new CanvasAddon())
  } catch {
    /* 回退到 DOM 渲染器 */
  }

  const entry: TerminalEntry = {
    id: meta.id,
    term,
    fit,
    wrapper,
    ptyCreated: false,
    meta,
    exited: false,
    altScreen: false,
    suppressing: false,
    cursorWanted: true
  }

  // 接管 DECSCUSR(CSI Ps SP q):codex 用的 crossterm 会用 `0 q` 重置成「闪烁块」,
  // 会把我们的 cursorBlink=false 覆盖掉。这里强制不闪,并保留用户在设置里选的光标样式。
  term.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, () => {
    term.options.cursorBlink = false
    return true
  })

  // 私有模式处理:
  // - 12:crossterm EnableBlinking,吞掉(强制不闪)
  // - 1049/1047/47:alt-screen 进入/退出,记录状态
  // - 25:记录应用对光标的最终意图;抑制期间吞掉「显示」,避免重绘期间光标闪现
  const onPrivH = (params: (number | number[])[]): boolean => {
    const p = params.length === 1 ? params[0] : -1
    if (p === 12) {
      term.options.cursorBlink = false
      return true
    }
    if (p === 1049 || p === 1047 || p === 47) {
      entry.altScreen = true
      return false
    }
    if (p === 25) {
      entry.cursorWanted = true
      if (entry.suppressing) return true // 重绘期间不显示
      return false
    }
    return false
  }
  const onPrivL = (params: (number | number[])[]): boolean => {
    const p = params.length === 1 ? params[0] : -1
    if (p === 12) {
      term.options.cursorBlink = false
      return true
    }
    if (p === 1049 || p === 1047 || p === 47) {
      entry.altScreen = false
      entry.suppressing = false
      return false
    }
    if (p === 25) {
      entry.cursorWanted = false
      return false
    }
    return false
  }
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, onPrivH)
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, onPrivL)

  // 复制/粘贴快捷键(WT 风格):
  // - Ctrl+C:有选区则复制并清除选区;无选区则放行(正常发送 ^C 中断)
  // - Ctrl+V:粘贴剪贴板(走 xterm.paste,自动处理括号粘贴模式)
  // - Ctrl+Shift+C / Ctrl+Shift+V:传统终端习惯,始终复制/粘贴
  const copySelection = (): boolean => {
    const sel = term.getSelection()
    if (sel) {
      window.api.clipboardWrite(sel)
      term.clearSelection()
      return true
    }
    return false
  }
  const pasteClipboard = (): void => {
    const text = window.api.clipboardRead()
    if (text) term.paste(text)
  }
  // 智能粘贴:剪贴板里若是图片,存成临时文件后把路径交给 TUI(Claude Code / Codex 能读图片
  // 文件路径);否则按文本粘贴。Claude/Codex 在 Windows 下无法直接读系统剪贴板里的图片,
  // 用「写临时文件 + 粘贴路径」来桥接。
  const pasteSmart = (): void => {
    void window.api
      .pasteClipboardImage()
      .then((file) => {
        if (file) term.paste(file)
        else pasteClipboard()
      })
      .catch(() => pasteClipboard())
  }
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    // Ctrl+Enter / Shift+Enter:发送换行 LF(等价于 Ctrl+J)。Claude Code 与 Codex 都把 LF
    // 当作「插入换行」、把回车 CR 当作「提交」。Claude 习惯用 Ctrl+Enter、Codex 习惯用
    // Shift+Enter,这里两者都映射到 LF,于是两个 TUI 的换行快捷键都能正常工作。
    if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey) && !e.altKey && !e.metaKey) {
      e.preventDefault()
      window.api.ptyInput(meta.id, '\n')
      return false
    }
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey
    if (!ctrl) return true
    if (e.code === 'KeyC') {
      if (e.shiftKey) {
        e.preventDefault()
        copySelection()
        return false
      }
      // 无 shift:有选区当复制(吃掉默认),否则放行让 ^C 中断
      if (copySelection()) {
        e.preventDefault()
        return false
      }
      return true
    }
    if (e.code === 'KeyV') {
      // 必须 preventDefault:否则浏览器还会对 xterm 的隐藏 textarea 触发一次「原生粘贴」,
      // 和我们的 term.paste 叠加 → 粘两遍。Ctrl+Shift+V 强制文本;Ctrl+V 优先图片。
      e.preventDefault()
      if (e.shiftKey) pasteClipboard()
      else pasteSmart()
      return false
    }
    return true
  })

  // 右键归「终端层」做复制/粘贴:用捕获阶段吞掉右键的 mousedown/mouseup,别让 xterm 把它
  // 作为鼠标事件上报给应用。否则开了鼠标上报的 TUI(如 Claude Code)收到右键后会自己再
  // 粘一次,叠加我们下面的粘贴 → 「粘贴两次」。左键(选择)、中键不受影响;普通 shell 没开
  // 鼠标上报,行为不变。
  const swallowRightButton = (e: MouseEvent): void => {
    if (e.button === 2) e.stopPropagation()
  }
  wrapper.addEventListener('mousedown', swallowRightButton, true)
  wrapper.addEventListener('mouseup', swallowRightButton, true)

  // Windows 右键:有选区则复制,否则粘贴(类似 conhost 快速编辑)。上面已用捕获阶段吞掉右键
  // 的 mousedown/mouseup,应用收不到右键、不会自己再粘一次,所以这里只粘一次、不会重复。
  wrapper.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    if (!copySelection()) pasteSmart()
  })

  // 用户输入 → 写入 pty
  term.onData((data) => window.api.ptyInput(meta.id, data))

  // 进程通过 OSC 0/2 设置的标题 → 反映到标签(类似 WT 的动态标题),先过滤掉无意义的 exe 路径标题
  term.onTitleChange((title) => {
    const t = meaningfulTitle(title)
    if (t) useTermTitles.getState().setTitle(meta.id, t)
    else useTermTitles.getState().clear(meta.id)
  })

  entries.set(meta.id, entry)
  return entry
}

/** 把终端挂到可见容器,并完成首启 pty / 尺寸同步 */
export function attachTerminal(id: string, container: HTMLElement): void {
  const e = entries.get(id)
  if (!e) return
  if (e.wrapper.parentElement !== container) {
    container.appendChild(e.wrapper)
  }
  // 下一帧测量尺寸再 fit(确保容器已布局)
  requestAnimationFrame(() => {
    try {
      e.fit.fit()
    } catch {
      /* 容器尺寸未就绪 */
    }
    const cols = e.term.cols
    const rows = e.term.rows
    if (!e.ptyCreated) {
      e.ptyCreated = true
      void window.api
        .ptyCreate({ ...e.meta, cols, rows })
        .catch((err) => {
          e.term.write(`\r\n\x1b[31m终端启动失败: ${String(err)}\x1b[0m\r\n`)
        })
    } else if (!e.exited) {
      window.api.ptyResize(id, cols, rows)
    }
    e.term.focus()
  })
}

/** 容器尺寸变化时重新 fit + 通知 pty */
export function refit(id: string): void {
  const e = entries.get(id)
  if (!e || e.exited) return
  try {
    e.fit.fit()
    window.api.ptyResize(id, e.term.cols, e.term.rows)
  } catch {
    /* ignore */
  }
}

/** 彻底销毁某终端(关闭终端时调用) */
export function disposeTerminal(id: string): void {
  clearTermRuntime(id)
  const e = entries.get(id)
  if (!e) return
  window.api.ptyKill(id)
  try {
    e.term.dispose()
  } catch {
    /* ignore */
  }
  e.wrapper.remove()
  entries.delete(id)
}

// 测试钩子(供 WTS_VERIFY 无界面校验):
// 喂入 codex 真实发的 DECSCUSR `0 q`、`5 q`、模式 12,验证 cursorBlink 被强制为 false。
;(window as unknown as Record<string, unknown>).__wtsTestCursor = () =>
  new Promise<string>((resolve) => {
    const e = ensureTerminal({
      id: '__cursor_test__',
      workspaceId: '__test__',
      repo: 'x',
      cwd: '.'
    })
    e.term.options.cursorBlink = true
    e.term.write('\x1b[5 q')
    e.term.write('\x1b[?12h')
    e.term.write('\x1b[0 q', () => {
      setTimeout(() => {
        const core = (e.term as unknown as { _core?: any })._core
        const dec = core?._coreService?.decPrivateModes
        const internalBlink = dec ? dec.cursorBlink : 'n/a'
        const optBlink = e.term.options.cursorBlink
        disposeTerminal('__cursor_test__')
        resolve(JSON.stringify({ optBlink, internalBlink }))
      }, 60)
    })
  })

// 回放钩子(供 WTS_REPLAY 截帧诊断):把录制的 codex 字节按原时序写入一个全屏终端。
;(window as unknown as Record<string, unknown>).__wtsReplay = (payload: string): number => {
  const chunks = JSON.parse(payload) as { t: number; d: string }[]
  const root = document.getElementById('root')
  if (root) (root as HTMLElement).style.display = 'none'
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;padding:6px;background:#1e1e2e'
  // 若设置了背景图,套用到 host(验证 xterm 透明能否透出底图)
  const bg = getSettings().bgImage
  if (bg) {
    host.style.backgroundImage = `url("${bg}")`
    host.style.backgroundSize = 'cover'
    const scrim = document.createElement('div')
    scrim.style.cssText = `position:absolute;inset:0;background:rgba(8,9,13,${getSettings().bgDim})`
    host.appendChild(scrim)
  }
  document.body.appendChild(host)
  const e = ensureTerminal({
    id: '__replay__',
    workspaceId: '__r__',
    repo: 'x',
    cwd: '.'
  })
  e.wrapper.style.position = 'relative'
  e.wrapper.style.zIndex = '1'
  host.appendChild(e.wrapper)
  try {
    e.fit.fit()
  } catch {
    /* ignore */
  }
  e.term.focus() // 与真实 app 一致:聚焦,光标才会显示/闪烁
  ;(window as unknown as Record<string, unknown>).__replayEntry = e
  let maxT = 0
  for (const c of chunks) {
    if (c.t > maxT) maxT = c.t
    setTimeout(() => {
      try {
        feedPtyData(e.id, c.d) // 走与真实 pty 相同的按帧合并/光标抑制路径
      } catch {
        /* ignore */
      }
    }, c.t)
  }
  return maxT
}

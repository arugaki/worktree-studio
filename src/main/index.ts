import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { registerIpc, type IpcServices } from './ipc'
import { runSmoke } from './smoke'

// 启动耗时基准(模块加载 ≈ 进程启动)
const APP_T0 = Date.now()

/** 回放录制的 codex pty 日志并截取连续帧,用于肉眼诊断「到底什么在闪」 */
async function runReplay(): Promise<number> {
  const logFile = process.env.WTS_REPLAY as string
  const outDir = 'D:\\zwork\\replay-frames'
  mkdirSync(outDir, { recursive: true })
  const chunks: { t: number; d: string }[] = []
  if (logFile === 'PROBE') {
    // 最小复现:清屏→写文字→定位光标→显示光标→codex 的 `0 q`(闪烁块请求)
    chunks.push({
      t: 0,
      d: '\x1b[2J\x1b[H cursor blink probe line\r\n\r\nXXXX\x1b[3;15H\x1b[?25h\x1b[0 q'
    })
  } else if (logFile === 'PROBE2') {
    // 模拟 codex:反复发送 `0 q`(每 60ms 一次,共 ~3s),光标定位固定处并显示
    chunks.push({ t: 0, d: '\x1b[2J\x1b[H repeated 0q probe\r\n\r\nYYYY' })
    for (let i = 0; i < 50; i++) {
      chunks.push({ t: 100 + i * 60, d: '\x1b[3;15H\x1b[?25h\x1b[0 q' })
    }
  } else {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
    for (const ln of lines) {
      const sp = ln.indexOf(' ')
      if (sp < 0) continue
      const t = parseInt(ln.slice(0, sp), 10)
      if (Number.isNaN(t)) continue
      try {
        chunks.push({ t, d: JSON.parse(ln.slice(sp + 1)) })
      } catch {
        /* ignore */
      }
    }
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    show: true,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  await new Promise((r) => setTimeout(r, 600))
  if (process.env.WTS_REPLAY_BG) {
    const grad =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%237c6cf6'/%3E%3Cstop offset='1' stop-color='%23f178c6'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='200' height='200' fill='url(%23g)'/%3E%3C/svg%3E"
    await win.webContents.executeJavaScript(
      `window.__wtsSettings.getState().set({bgImage:${JSON.stringify(grad)}, bgDim:0.5}); true`
    )
  }
  const maxT: number = await win.webContents.executeJavaScript(
    `window.__wtsReplay(${JSON.stringify(JSON.stringify(chunks))})`
  )

  // 截帧起点:WTS_REPLAY_START=动画期间某偏移;'post'=动画结束后(隔离光标)
  const frames = parseInt(process.env.WTS_REPLAY_FRAMES || '12', 10)
  const intervalMs = parseInt(process.env.WTS_REPLAY_INTERVAL || '120', 10)
  const startEnv = process.env.WTS_REPLAY_START
  const waitMs = !startEnv || startEnv === 'post' ? maxT + 1000 : parseInt(startEnv, 10)
  await new Promise((r) => setTimeout(r, waitMs))
  const blinkState = await win.webContents.executeJavaScript(
    `(() => { const e = window.__replayEntry; const cur = e?.term?.element?.querySelector('.xterm-cursor-layer canvas, .xterm-cursor'); return JSON.stringify({ optBlink: e?.term?.options?.cursorBlink }) })()`
  )
  console.log('[replay] cursor 选项:', blinkState)
  for (let i = 0; i < frames; i++) {
    const img = await win.webContents.capturePage()
    writeFileSync(join(outDir, `f${String(i).padStart(2, '0')}.png`), img.toPNG())
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  console.log('[replay] 已截图到', outDir)
  return chunks.length
}

let mainWindow: BrowserWindow | null = null
let services: IpcServices | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#0e0f15',
    title: 'Worktree Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (process.env.WTS_PERF) console.log('[perf] ready-to-show', Date.now() - APP_T0, 'ms')
    mainWindow?.show()
  })
  if (process.env.WTS_PERF)
    mainWindow.webContents.once('did-finish-load', () =>
      console.log('[perf] did-finish-load', Date.now() - APP_T0, 'ms')
    )
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  // 无界面冒烟测试模式
  if (process.env.WTS_SMOKE === '1') {
    const code = await runSmoke()
    app.exit(code)
    return
  }

  // 回放截帧诊断模式
  if (process.env.WTS_REPLAY) {
    await runReplay()
    app.exit(0)
    return
  }

  // 退出流程自测:加载真实界面(会自动起一个 pwsh 终端),3s 后关窗,验证能否干净退出
  if (process.env.WTS_EXITTEST) {
    services = registerIpc(() => mainWindow)
    createWindow()
    mainWindow!.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        console.log('[exittest] 关闭窗口…')
        mainWindow?.close()
      }, 3500)
    })
    return // 全局 window-all-closed 处理退出
  }

  // UI 截图模式:加载真实界面,等状态加载后截图
  if (process.env.WTS_SHOT) {
    services = registerIpc(() => mainWindow)
    createWindow()
    mainWindow!.setSize(1380, 860)
    mainWindow!.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const wc = mainWindow!.webContents
        try {
          const a = await wc.capturePage()
          writeFileSync('D:\\zwork\\ui-shot-1.png', a.toPNG())
          // 打开设置面板再截一张
          await wc.executeJavaScript(
            "document.querySelector('.settings-btn')?.click(); true"
          )
          await new Promise((r) => setTimeout(r, 400))
          writeFileSync('D:\\zwork\\ui-shot-2.png', (await wc.capturePage()).toPNG())
          // 浅色主题
          await wc.executeJavaScript(
            "window.__wtsSettings.getState().set({theme:'light'}); true"
          )
          await new Promise((r) => setTimeout(r, 400))
          writeFileSync('D:\\zwork\\ui-shot-3.png', (await wc.capturePage()).toPNG())
          // 背景图(渐变 svg)+ 深色
          const bg =
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%237c6cf6'/%3E%3Cstop offset='1' stop-color='%23f178c6'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='200' height='200' fill='url(%23g)'/%3E%3C/svg%3E"
          await wc.executeJavaScript(
            `window.__wtsSettings.getState().set({theme:'dark', bgImage:${JSON.stringify(bg)}}); true`
          )
          await new Promise((r) => setTimeout(r, 600))
          writeFileSync('D:\\zwork\\ui-shot-4.png', (await wc.capturePage()).toPNG())
          console.log('[shot] 已保存 ui-shot-1..4.png')
        } catch (e) {
          console.error('[shot] 失败', e)
        }
        app.exit(0)
      }, 2600)
    })
    return
  }

  services = registerIpc(() => mainWindow)
  createWindow()

  // 无界面渲染校验:确认 React 挂载 + 预加载桥可用
  if (process.env.WTS_VERIFY === '1' && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const wc = mainWindow!.webContents
        try {
          const hasApi = await wc.executeJavaScript('typeof window.api')
          const apiKeys = await wc.executeJavaScript(
            'window.api ? Object.keys(window.api).length : 0'
          )
          const rootKids = await wc.executeJavaScript(
            "document.getElementById('root')?.childElementCount ?? 0"
          )
          const brand = await wc.executeJavaScript(
            "document.querySelector('.tabbar-brand')?.textContent || ''"
          )
          const cursor = await wc.executeJavaScript(
            'window.__wtsTestCursor ? window.__wtsTestCursor() : "no-hook"'
          )
          console.log('[verify] typeof window.api =', hasApi, '| api 方法数 =', apiKeys)
          console.log('[verify] #root 子节点 =', rootKids, '| 品牌文字 =', JSON.stringify(brand))
          console.log('[verify] 光标诊断 =', cursor)
          let cursorOk = false
          try {
            const c = JSON.parse(String(cursor))
            cursorOk = c.optBlink === false
          } catch {
            /* ignore */
          }
          const ok =
            hasApi === 'object' &&
            Number(apiKeys) >= 10 &&
            Number(rootKids) > 0 &&
            String(brand).includes('Worktree') &&
            cursorOk
          console.log(ok ? '[verify] ✅ 渲染进程正常' : '[verify] ❌ 渲染异常')
          app.exit(ok ? 0 : 1)
        } catch (e) {
          console.error('[verify] 异常:', e)
          app.exit(1)
        }
      }, 1200)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let cleanedUp = false
function cleanup(): void {
  if (cleanedUp) return
  cleanedUp = true
  try {
    services?.ptyManager.killAll()
  } catch {
    /* ignore */
  }
  try {
    services?.watcher.closeAll()
  } catch {
    /* ignore */
  }
}

function hardExit(): void {
  cleanup()
  // node-pty 的原生句柄会让 app.exit()/app.quit() 后主进程仍不退出,导致便携版宿主进程
  // 一直挂着、锁住 exe。先杀掉所有 Electron 子进程(GPU/渲染/utility——主进程被强杀后它们
  // 不会自行退出),再 SIGKILL 主进程自身。getAppMetrics 提供全部进程 pid,无自杀竞态。
  try {
    for (const m of app.getAppMetrics()) {
      if (m.pid !== process.pid) {
        try {
          process.kill(m.pid, 'SIGKILL')
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  try {
    process.kill(process.pid, 'SIGKILL')
  } catch {
    /* ignore */
  }
  app.exit(0)
}

app.on('window-all-closed', () => {
  hardExit()
})

app.on('before-quit', cleanup)

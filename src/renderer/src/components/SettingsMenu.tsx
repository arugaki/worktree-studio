import { useState } from 'react'
import {
  FONT_OPTIONS,
  SCROLLBACK_OPTIONS,
  SHELL_OPTIONS,
  useSettings
} from '../settings'

const CURSOR_STYLES: { key: 'block' | 'bar' | 'underline'; label: string }[] = [
  { key: 'block', label: '块' },
  { key: 'bar', label: '竖线' },
  { key: 'underline', label: '下划线' }
]

function Stepper({
  value,
  min,
  max,
  step,
  fmt,
  onChange
}: {
  value: number
  min: number
  max: number
  step: number
  fmt?: (v: number) => string
  onChange: (v: number) => void
}): JSX.Element {
  const round = (v: number): number => Math.round(v * 100) / 100
  return (
    <div className="stepper">
      <button onClick={() => onChange(round(Math.max(min, value - step)))}>−</button>
      <span className="stepper-val">{fmt ? fmt(value) : value}</span>
      <button onClick={() => onChange(round(Math.min(max, value + step)))}>＋</button>
    </div>
  )
}

export function SettingsMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const s = useSettings()

  const pickBg = async (): Promise<void> => {
    const data = await window.api.pickImage()
    if (data) s.set({ bgImage: data })
  }

  return (
    <div className="settings-wrap">
      <button
        className={'settings-btn' + (open ? ' active' : '')}
        title="设置"
        onClick={() => setOpen((v) => !v)}
      >
        ⚙
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="settings-panel">
            <div className="settings-section">外观</div>
            <div className="settings-row">
              <span className="settings-label">主题</span>
              <div className="segmented">
                <button
                  className={s.theme === 'dark' ? 'active' : ''}
                  onClick={() => s.set({ theme: 'dark' })}
                >
                  深色
                </button>
                <button
                  className={s.theme === 'light' ? 'active' : ''}
                  onClick={() => s.set({ theme: 'light' })}
                >
                  浅色
                </button>
              </div>
            </div>

            <div className="settings-section">终端</div>
            <div className="settings-row">
              <span className="settings-label">字体大小</span>
              <Stepper
                value={s.fontSize}
                min={9}
                max={28}
                step={1}
                onChange={(v) => s.set({ fontSize: v })}
              />
            </div>
            <div className="settings-row">
              <span className="settings-label">字体</span>
              <select
                className="settings-select"
                value={s.fontFamily}
                onChange={(e) => s.set({ fontFamily: e.target.value })}
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <span className="settings-label">行高</span>
              <Stepper
                value={s.lineHeight}
                min={1}
                max={2}
                step={0.1}
                fmt={(v) => v.toFixed(1)}
                onChange={(v) => s.set({ lineHeight: v })}
              />
            </div>
            <div className="settings-row">
              <span className="settings-label">字间距</span>
              <Stepper
                value={s.letterSpacing}
                min={0}
                max={4}
                step={0.5}
                fmt={(v) => v + 'px'}
                onChange={(v) => s.set({ letterSpacing: v })}
              />
            </div>
            <div className="settings-row">
              <span className="settings-label">文字颜色</span>
              <div className="color-field">
                <input
                  type="color"
                  className="color-input"
                  value={s.foreground ?? (s.theme === 'light' ? '#2a2e3a' : '#cdd6f4')}
                  onChange={(e) => s.set({ foreground: e.target.value })}
                />
                {s.foreground && (
                  <button onClick={() => s.set({ foreground: null })}>
                    跟随主题
                  </button>
                )}
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">光标样式</span>
              <div className="segmented">
                {CURSOR_STYLES.map((c) => (
                  <button
                    key={c.key}
                    className={s.cursorStyle === c.key ? 'active' : ''}
                    onClick={() => s.set({ cursorStyle: c.key })}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">回滚行数</span>
              <select
                className="settings-select"
                value={s.scrollback}
                onChange={(e) => s.set({ scrollback: Number(e.target.value) })}
              >
                {SCROLLBACK_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <span className="settings-label">默认 Shell</span>
              <select
                className="settings-select"
                value={s.shell}
                onChange={(e) =>
                  s.set({ shell: e.target.value as typeof s.shell })
                }
              >
                {SHELL_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-section">终端背景图</div>
            {s.bgImage && (
              <div
                className="bg-preview"
                style={{ backgroundImage: `url("${s.bgImage}")` }}
              />
            )}
            <div className="settings-row">
              <span className="settings-label">图片</span>
              <div className="bg-actions">
                <button onClick={pickBg}>选择图片…</button>
                {s.bgImage && (
                  <button onClick={() => s.set({ bgImage: null })}>清除</button>
                )}
              </div>
            </div>
            {s.bgImage && (
              <div className="settings-row">
                <span className="settings-label">暗度</span>
                <input
                  className="settings-range"
                  type="range"
                  min={0}
                  max={0.85}
                  step={0.05}
                  value={s.bgDim}
                  onChange={(e) => s.set({ bgDim: Number(e.target.value) })}
                />
              </div>
            )}

            <div className="settings-foot">
              <button onClick={() => s.reset()}>恢复默认</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

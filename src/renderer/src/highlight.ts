// 代码语法高亮(只读),基于 highlight.js。
// - 按文件后缀自动识别语言(detectLang)
// - 也可在文件查看器右下角手动切换(LANGUAGES 列表)
// 用完整版以获得最广的语言覆盖(含 powershell / dockerfile / toml 等),
// 桌面端无需顾虑体积。
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

/** 语言选择器里展示的常见语言:value 为 highlight.js 的语言 id。 */
export const LANGUAGES: { id: string; label: string }[] = [
  { id: 'plaintext', label: 'Plain Text' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'json', label: 'JSON' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'less', label: 'Less' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'php', label: 'PHP' },
  { id: 'bash', label: 'Shell / Bash' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'sql', label: 'SQL' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'ini', label: 'INI' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'swift', label: 'Swift' },
  { id: 'lua', label: 'Lua' },
  { id: 'r', label: 'R' },
  { id: 'perl', label: 'Perl' },
  { id: 'diff', label: 'Diff' }
]

/** 后缀(不含点,小写)→ highlight.js 语言 id。 */
const EXT_TO_LANG: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  py: 'python',
  pyw: 'python',
  java: 'java',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  lua: 'lua',
  r: 'r',
  pl: 'perl',
  pm: 'perl',
  diff: 'diff',
  patch: 'diff',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'plaintext',
  log: 'plaintext'
}

/** 一些没有后缀但有固定名字的文件。 */
const NAME_TO_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.gitignore': 'plaintext',
  '.npmrc': 'ini',
  '.editorconfig': 'ini'
}

/** 根据文件名推断语言 id;无法识别时返回 'plaintext'。 */
export function detectLang(name: string): string {
  const lower = name.toLowerCase()
  if (NAME_TO_LANG[lower]) return NAME_TO_LANG[lower]
  const dot = lower.lastIndexOf('.')
  if (dot >= 0) {
    const ext = lower.slice(dot + 1)
    if (EXT_TO_LANG[ext]) return EXT_TO_LANG[ext]
  }
  return 'plaintext'
}

/**
 * 把源码渲染成高亮 HTML。lang 为 'plaintext' 或 highlight.js 不认识的语言时,
 * 仅做 HTML 转义、不上色。
 */
export function highlightCode(src: string, lang: string): string {
  if (lang && lang !== 'plaintext' && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(src, { language: lang, ignoreIllegals: true }).value
    } catch {
      /* 落到转义分支 */
    }
  }
  return escapeHtml(src)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

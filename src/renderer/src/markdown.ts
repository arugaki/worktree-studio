// Markdown → HTML,基于成熟库 markdown-it(GitHub 风格)。
// - 表格 / 删除线:GFM 内置
// - 任务列表勾选框:markdown-it-task-lists 插件
// - html: false:不解析原始 HTML,避免打开恶意 .md 时的 XSS(配合 dangerouslySetInnerHTML)
import MarkdownIt from 'markdown-it'
// @ts-expect-error 该插件无类型声明
import taskLists from 'markdown-it-task-lists'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false
}).use(taskLists, { enabled: true, label: true })

// 链接统一在新标签打开,并加 noreferrer
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

export function renderMarkdown(src: string): string {
  return md.render(src)
}

export type TextFormat = "json" | "linux-shell"

interface HeredocSpec {
  delimiter: string
  stripTabs: boolean
}

type ShellQuote = "single" | "double" | "backtick" | null

interface ShellLineAnalysis {
  quote: ShellQuote
  code: string
  heredocs: HeredocSpec[]
  hasComment: boolean
}

/** 从 Shell 的 << / <<- 操作符后读取 here-doc 结束标记。 */
function readHeredocSpec(line: string, operatorIndex: number): HeredocSpec | null {
  let cursor = operatorIndex + 2
  if (line[cursor] === "<") return null

  const stripTabs = line[cursor] === "-"
  if (stripTabs) cursor += 1
  while (line[cursor] === " " || line[cursor] === "\t") cursor += 1

  const quote = line[cursor]
  if (quote === "'" || quote === '"') {
    const end = line.indexOf(quote, cursor + 1)
    if (end < 0) return null
    const delimiter = line.slice(cursor + 1, end)
    return delimiter ? { delimiter, stripTabs } : null
  }

  if (line[cursor] === "\\") cursor += 1
  const match = line.slice(cursor).match(/^[^\s;|&()<>]+/)
  return match?.[0] ? { delimiter: match[0], stripTabs } : null
}

/**
 * 扫描一行 Shell，忽略引号内字符后返回影响换行判断的语法信息。
 * 这不是完整 Shell parser，只处理换行清理需要关注的结构。
 */
function analyzeShellLine(line: string, initialQuote: ShellQuote): ShellLineAnalysis {
  let quote = initialQuote
  let code = ""
  let hasComment = false
  const heredocs: HeredocSpec[] = []

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (quote === "single") {
      if (char === "'") quote = null
      continue
    }
    if (quote === "double") {
      if (char === "\\") {
        index += 1
      } else if (char === '"') {
        quote = null
      }
      continue
    }
    if (quote === "backtick") {
      if (char === "\\") {
        index += 1
      } else if (char === "`") {
        quote = null
      }
      continue
    }

    if (char === "\\") {
      code += char
      if (index + 1 < line.length) {
        code += line[index + 1]
        index += 1
      }
      continue
    }
    if (char === "'") {
      quote = "single"
      continue
    }
    if (char === '"') {
      quote = "double"
      continue
    }
    if (char === "`") {
      quote = "backtick"
      continue
    }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      hasComment = true
      break
    }
    if (char === "<" && line[index + 1] === "<") {
      const heredoc = readHeredocSpec(line, index)
      if (heredoc) heredocs.push(heredoc)
    }

    code += char
  }

  return { quote, code, heredocs, hasComment }
}

function endsWithShellContinuation(code: string): boolean {
  const trimmed = code.trimEnd()
  if (/(?:\\|\|\|?|&&|;{1,2}|&|\(|\{)$/.test(trimmed)) return true
  return /(?:^|\s)(?:then|do|else|elif|case|in)$/.test(trimmed)
}

function startsWithShellBoundary(line: string): boolean {
  const trimmed = line.trimStart()
  return (
    /^(?:then|do|else|elif|fi|done|esac)(?:\s|;|$)/.test(trimmed) ||
    /^[})]/.test(trimmed)
  )
}

function joinWrappedLine(output: string, nextLine: string): string {
  const left = output.replace(/[ \t]+$/, "")
  const right = nextLine.replace(/^[ \t]+/, "")
  if (!left || !right) return left + right
  return `${left} ${right}`
}

/**
 * 合并从网页复制时产生的普通折行，同时保留有 Shell 语义的换行：
 * 显式反斜杠/运算符续行、多行引号、注释、空行及 here-doc。
 */
export function formatLinuxShellCommand(input: string): string {
  const lines = input.replace(/\r\n?/g, "\n").split("\n")
  while (lines.length > 0 && lines[0].trim() === "") lines.shift()
  while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop()
  if (lines.length === 0) return ""

  let output = lines[0]
  let quote: ShellQuote = null
  let activeHeredoc: HeredocSpec | null = null
  const pendingHeredocs: HeredocSpec[] = []

  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index]
    const nextLine = lines[index + 1]
    let preserveNewline = false

    if (activeHeredoc) {
      preserveNewline = true
      const delimiterLine = activeHeredoc.stripTabs
        ? line.replace(/^\t+/, "")
        : line
      if (delimiterLine === activeHeredoc.delimiter) {
        activeHeredoc = pendingHeredocs.shift() ?? null
      }
    } else {
      const analysis = analyzeShellLine(line, quote)
      quote = analysis.quote
      pendingHeredocs.push(...analysis.heredocs)

      preserveNewline =
        quote !== null ||
        analysis.hasComment ||
        line.trim() === "" ||
        nextLine.trim() === "" ||
        endsWithShellContinuation(analysis.code) ||
        startsWithShellBoundary(nextLine)

      if (pendingHeredocs.length > 0) {
        activeHeredoc = pendingHeredocs.shift() ?? null
        preserveNewline = true
      }
    }

    output = preserveNewline
      ? `${output}\n${nextLine}`
      : joinWrappedLine(output, nextLine)
  }

  return output
}

export function formatJson(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ""
  return JSON.stringify(JSON.parse(trimmed), null, 2)
}

export function formatText(format: TextFormat, input: string): string {
  return format === "json" ? formatJson(input) : formatLinuxShellCommand(input)
}

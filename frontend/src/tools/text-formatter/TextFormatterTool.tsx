import { Check, Copy, Eraser, Plus, WandSparkles, X } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { usePersistedState } from "@/lib/storage/usePersistedState"
import { cn } from "@/lib/utils"

import { formatText, type TextFormat } from "./formatters"
import { LineNumberedTextarea } from "./LineNumberedTextarea"

interface FormatterSession {
  id: string
  format: TextFormat
  input: string
  wrapLines: boolean
  output: string
  error: string | null
}

interface PersistedFormatterSession {
  id: string
  format: TextFormat
  input: string
  wrapLines?: boolean
}

interface TextFormatterPersistedState {
  sessions: PersistedFormatterSession[]
  activeId: string | null
}

interface FormatOption {
  value: TextFormat
  label: string
  description: string
  placeholder: string
}

const STORAGE_KEY = "text-formatter:state"

const FORMAT_OPTIONS: FormatOption[] = [
  {
    value: "json",
    label: "JSON",
    description: "校验 JSON，并使用 2 个空格进行标准缩进。",
    placeholder: '{"name":"my-small-tools","enabled":true}',
  },
  {
    value: "linux-shell",
    label: "Linux 命令行",
    description:
      "输入时自动合并网页复制产生的普通折行；保留反斜杠、Shell 运算符、多行引号、注释、空行与 here-doc 换行。多个独立命令请用空行分隔。",
    placeholder: "curl --request POST\n  --header 'Content-Type: application/json'\n  https://example.com/api",
  },
]

function createSession(
  format: TextFormat = "json",
  wrapLines = false,
): FormatterSession {
  return {
    id: crypto.randomUUID(),
    format,
    input: "",
    wrapLines,
    output: "",
    error: null,
  }
}

function toPersisted(session: FormatterSession): PersistedFormatterSession {
  return {
    id: session.id,
    format: session.format,
    input: session.input,
    wrapLines: session.wrapLines,
  }
}

function fromPersisted(session: PersistedFormatterSession): FormatterSession {
  return {
    ...session,
    wrapLines: session.wrapLines ?? false,
    output:
      session.format === "linux-shell"
        ? formatText(session.format, session.input)
        : "",
    error: null,
  }
}

function formatOption(format: TextFormat): FormatOption {
  return FORMAT_OPTIONS.find((option) => option.value === format) ?? FORMAT_OPTIONS[0]
}

function sessionLabel(session: FormatterSession, index: number): string {
  return `${formatOption(session.format).label} ${index + 1}`
}

export function TextFormatterTool() {
  const initialSessionRef = useRef<FormatterSession | null>(null)
  if (!initialSessionRef.current) initialSessionRef.current = createSession()

  const [sessions, setSessions] = useState<FormatterSession[]>([
    initialSessionRef.current,
  ])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editorMaxHeight, setEditorMaxHeight] = useState<number>()
  const inputEditorRef = useRef<HTMLDivElement>(null)

  const {
    value: persisted,
    setValue: setPersisted,
    loaded,
  } = usePersistedState<TextFormatterPersistedState>(STORAGE_KEY, {
    sessions: [],
    activeId: null,
  })

  useLayoutEffect(() => {
    const inputEditor = inputEditorRef.current
    if (!inputEditor) return

    /**
     * 编辑框最大高度 = 编辑框顶部到其所在滚动视口底部的可用空间
     * - 编辑框下方固定的卡片内边距留白。
     *
     * 编辑框上方（页面标题区 + Tab 标题区 + 格式选择/说明 + 标签行）
     * 及编辑框所在滚动视口均为固定布局，不随编辑框自身内容变化，
     * 因此上限稳定；到达上限后编辑框只在内部滚动。
     */
    const updateMaxHeight = () => {
      const card = inputEditor.closest('[data-slot="card"]')
      const main = inputEditor.closest("main")
      const scrollArea = main?.querySelector('[data-slot="scroll-area"]')
      if (!card || !main || !scrollArea) return
      const scrollViewport = Array.from(scrollArea.children).find(
        (element) =>
          element instanceof HTMLElement &&
          getComputedStyle(element).overflowY === "scroll",
      )
      if (!(scrollViewport instanceof HTMLElement)) return

      const viewportRect = scrollViewport.getBoundingClientRect()
      const editorTop = inputEditor.getBoundingClientRect().top
      const cardStyle = getComputedStyle(card)
      const cardBottomPadding = Number.parseFloat(cardStyle.paddingBottom)
      const availableHeight =
        viewportRect.bottom - editorTop - cardBottomPadding
      setEditorMaxHeight(Math.max(0, Math.floor(availableHeight)))
    }

    updateMaxHeight()
    window.addEventListener("resize", updateMaxHeight)
    return () => {
      window.removeEventListener("resize", updateMaxHeight)
    }
  }, [])

  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!loaded || hydratedRef.current) return
    hydratedRef.current = true
    if (persisted.sessions.length > 0) {
      setSessions(persisted.sessions.map(fromPersisted))
      setActiveId(persisted.activeId)
    }
    setHydrated(true)
  }, [loaded, persisted])

  useEffect(() => {
    if (!loaded || !hydrated) return
    setPersisted({
      sessions: sessions.map(toPersisted),
      activeId,
    })
  }, [sessions, activeId, loaded, hydrated, setPersisted])

  const activeSession =
    sessions.find((session) => session.id === activeId) ?? sessions[0]
  const activeOption = formatOption(activeSession.format)

  const updateSession = useCallback(
    (id: string, patch: Partial<FormatterSession>) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === id ? { ...session, ...patch } : session,
        ),
      )
    },
    [],
  )

  const addSession = () => {
    const session = createSession(activeSession.format, activeSession.wrapLines)
    setSessions((current) => [...current, session])
    setActiveId(session.id)
    setCopied(false)
  }

  const closeSession = (id: string) => {
    const index = sessions.findIndex((session) => session.id === id)
    const remaining = sessions.filter((session) => session.id !== id)

    if (remaining.length === 0) {
      const replacement = createSession()
      setSessions([replacement])
      setActiveId(replacement.id)
    } else {
      setSessions(remaining)
      if (activeSession.id === id) {
        setActiveId(remaining[Math.min(index, remaining.length - 1)].id)
      }
    }
    setCopied(false)
  }

  const handleFormat = () => {
    try {
      const output = formatText(activeSession.format, activeSession.input)
      updateSession(activeSession.id, { output, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法格式化输入内容"
      updateSession(activeSession.id, {
        output: "",
        error: `JSON 格式错误：${message}`,
      })
    }
    setCopied(false)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeSession.output)
    setCopied(true)
  }

  const handleClear = () => {
    updateSession(activeSession.id, { input: "", output: "", error: null })
    setCopied(false)
  }

  return (
    <Card>
      <CardContent>
        <div className="sticky top-0 z-10 -mx-6 border-b bg-card px-6 pb-2 pt-3">
          <div className="flex flex-wrap items-end gap-1">
            {sessions.map((session, index) => {
              const isActive = session.id === activeSession.id
              return (
                <div
                  key={session.id}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-sm",
                    isActive
                      ? "border-border bg-card text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    className="max-w-40 truncate"
                    onClick={() => {
                      setActiveId(session.id)
                      setCopied(false)
                    }}
                  >
                    {sessionLabel(session, index)}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeSession(session.id)}
                    title="关闭文本"
                    aria-label={`关闭 ${sessionLabel(session, index)}`}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )
            })}
            <button
              type="button"
              onClick={addSession}
              className="mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-4" /> 新建文本
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-wrap items-end gap-4">
              <div>
                <label
                  htmlFor={`text-format-${activeSession.id}`}
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  文本格式
                </label>
                <select
                  id={`text-format-${activeSession.id}`}
                  value={activeSession.format}
                  onChange={(event) => {
                    const format = event.target.value as TextFormat
                    updateSession(activeSession.id, {
                      format,
                      output:
                        format === "linux-shell"
                          ? formatText(format, activeSession.input)
                          : "",
                      error: null,
                    })
                    setCopied(false)
                  }}
                  className="h-9 w-48 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={activeSession.wrapLines}
                onClick={() =>
                  updateSession(activeSession.id, {
                    wrapLines: !activeSession.wrapLines,
                  })
                }
                className="flex h-9 items-center gap-2 rounded-md px-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    activeSession.wrapLines ? "bg-primary" : "bg-muted-foreground/30",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 size-4 rounded-full bg-background shadow-sm transition-transform",
                      activeSession.wrapLines && "translate-x-4",
                    )}
                  />
                </span>
                自动换行
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleClear}>
                <Eraser /> 清空
              </Button>
              <Button onClick={handleFormat}>
                <WandSparkles /> 格式化
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{activeOption.description}</p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <label
                htmlFor={`text-input-${activeSession.id}`}
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                输入
              </label>
              <LineNumberedTextarea
                ref={inputEditorRef}
                id={`text-input-${activeSession.id}`}
                value={activeSession.input}
                wrapLines={activeSession.wrapLines}
                maxHeight={editorMaxHeight}
                onChange={(event) => {
                  const input = event.target.value
                  updateSession(activeSession.id, {
                    input,
                    output:
                      activeSession.format === "linux-shell"
                        ? formatText(activeSession.format, input)
                        : "",
                    error: null,
                  })
                  setCopied(false)
                }}
                placeholder={activeOption.placeholder}
              />
            </div>

            <div>
              <div className="mb-1.5 flex h-5 items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">输出</span>
                {activeSession.output && (
                  <Button size="sm" variant="ghost" onClick={handleCopy}>
                    {copied ? <Check /> : <Copy />}
                    {copied ? "已复制" : "复制"}
                  </Button>
                )}
              </div>
              <LineNumberedTextarea
                id={`text-output-${activeSession.id}`}
                readOnly
                value={activeSession.output}
                wrapLines={activeSession.wrapLines}
                maxHeight={editorMaxHeight}
                placeholder="格式化结果将显示在这里…"
              />
            </div>
          </div>

          {activeSession.error && (
            <p role="alert" className="text-sm text-destructive">
              {activeSession.error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

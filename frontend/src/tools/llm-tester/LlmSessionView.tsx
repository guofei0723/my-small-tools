import {
  AlertTriangle,
  ChevronDown,
  Eraser,
  Loader2,
  Plug,
  Send,
  Settings2,
  Square,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { LlmClient, type LlmLogEntry } from "@/lib/llm/client"
import type { ChatMessage, CompletionUsage, ModelInfo } from "@/lib/llm/types"
import { cn } from "@/lib/utils"

const inputCls =
  "h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50"

/** 解析 "Key: Value" 每行一个的请求头文本 */
function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const sepIndex = trimmed.indexOf(":")
    if (sepIndex <= 0) continue
    headers[trimmed.slice(0, sepIndex).trim()] = trimmed
      .slice(sepIndex + 1)
      .trim()
  }
  return headers
}

/** 常用服务提供商预设：选择后自动填充 API 地址（容器 tab 标签也依赖此表） */
export const PROVIDER_PRESETS = [
  { id: "custom", name: "自定义", baseUrl: "" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  {
    id: "qwen",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  { id: "moonshot", name: "Kimi", baseUrl: "https://api.moonshot.cn/v1" },
  { id: "ollama", name: "Ollama 本地", baseUrl: "http://localhost:11434/v1" },
]

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false })
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function LogEntryItem({ entry }: { entry: LlmLogEntry }) {
  const dotColor = {
    request: "bg-sky-500",
    response: "bg-emerald-500",
    info: "bg-zinc-400",
    error: "bg-red-500",
  }[entry.direction]

  return (
    <details className="group rounded-md border bg-background/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
        <span className={cn("size-2 shrink-0 rounded-full", dotColor)} />
        <span className="font-medium">{entry.label}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">
          {formatTime(entry.timestamp)}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      {entry.body !== undefined && (
        <div className="border-t px-3 py-2">
          <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(entry.body, null, 2)}
          </pre>
        </div>
      )}
    </details>
  )
}

/** 界面用对话消息：在协议消息基础上携带思考过程（reasoning_content），发送给 API 时剔除 */
interface UiChatMessage extends ChatMessage {
  reasoning?: string
}

function MessageBubble({ message }: { message: UiChatMessage }) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm",
          isUser ? "border-primary/30 bg-primary/10" : "bg-muted/40",
        )}
      >
        {message.reasoning && (
          <details className="group mb-2">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-amber-600">
              <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
              思考过程
            </summary>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap font-mono text-xs text-amber-700">
              {message.reasoning}
            </pre>
          </details>
        )}
        {message.content}
      </div>
    </div>
  )
}

/** 最近一次请求的分析指标 */
interface Metrics {
  mode: "stream" | "non-stream"
  durationMs: number
  firstTokenMs: number | null
  usage: CompletionUsage | null
  tokensPerSecond: number | null
  chunkCount: number
  finishReason: string | null
}

/** 单个测试会话的完整状态（由容器统一持有，支持多会话并存） */
export interface LlmSession {
  id: string
  // 连接配置
  provider: string
  baseUrl: string
  apiKey: string
  extraHeadersText: string
  useProxy: boolean
  showAdvanced: boolean
  // 测试连接
  testing: boolean
  connectionMessage: { ok: boolean; text: string } | null
  models: ModelInfo[]
  // 对话
  model: string
  systemPrompt: string
  showSystem: boolean
  temperature: string
  maxTokens: string
  streamEnabled: boolean
  messages: UiChatMessage[]
  input: string
  sending: boolean
  streamingReply: string | null
  liveReasoning: string
  /** 思考过程是否仍在输出：true 时展开显示，输出完成后折叠 */
  reasoningInProgress: boolean
  /** 当前进行中请求的中止控制器（容器关闭会话时用于中断） */
  abortController: AbortController | null
  // 分析
  metrics: Metrics | null
  rawResponse: unknown
  logs: LlmLogEntry[]
  error: string | null
}

/** 会话字段更新器：支持函数式更新（如并发日志追加） */
export type SessionUpdater =
  | Partial<LlmSession>
  | ((prev: LlmSession) => Partial<LlmSession>)

interface LlmSessionViewProps {
  session: LlmSession
  onPatch: (updater: SessionUpdater) => void
}

/** 单个测试会话界面：连接配置 + 流式对话 + 性能/用量分析 */
export function LlmSessionView({ session, onPatch }: LlmSessionViewProps) {
  // 同步累积用的本地 ref（onPatch 为异步状态更新，中止时需要拿到最新值）
  const streamingReplyRef = useRef("")
  const liveReasoningRef = useRef("")
  // 日志 id 按会话递增，保证列表 key 唯一
  const logSeq = useRef(0)
  const chatBoxRef = useRef<HTMLDivElement | null>(null)

  /** 日志统一入口：会话内递增 id 避免跨请求重复 key */
  const handleLog = useCallback(
    (entry: LlmLogEntry) => {
      logSeq.current += 1
      onPatch((prev) => ({
        logs: [...prev.logs, { ...entry, id: logSeq.current }],
      }))
    },
    [onPatch],
  )

  /** 按当前连接配置构建客户端（每次请求新建，保持无状态） */
  const buildClient = () => {
    const headers = parseHeaders(session.extraHeadersText)
    return new LlmClient({
      baseUrl: session.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: session.apiKey.trim() || undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      proxy: session.useProxy ? "/api/llm/proxy" : undefined,
      onLog: handleLog,
    })
  }

  const handleProviderChange = (id: string) => {
    const preset = PROVIDER_PRESETS.find((item) => item.id === id)
    onPatch({
      provider: id,
      ...(preset && preset.baseUrl ? { baseUrl: preset.baseUrl } : {}),
    })
  }

  /** 测试连接：GET /models 获取模型列表 */
  const handleTestConnection = async () => {
    if (!session.baseUrl.trim()) {
      onPatch({ connectionMessage: { ok: false, text: "请先填写 API 地址" } })
      return
    }
    const controller = new AbortController()
    onPatch({ testing: true, connectionMessage: null, models: [] })
    try {
      const list = await buildClient().listModels(controller.signal)
      onPatch((prev) => ({
        models: list,
        connectionMessage: {
          ok: true,
          text:
            list.length > 0
              ? `连接成功：发现 ${list.length} 个模型，点击下方标签即可选用`
              : "连接成功（服务未返回模型列表）",
        },
        model:
          list.length > 0 && !list.some((item) => item.id === prev.model)
            ? list[0].id
            : prev.model,
      }))
    } catch (err) {
      onPatch({
        models: [],
        connectionMessage: { ok: false, text: describeError(err) },
      })
    } finally {
      onPatch({ testing: false })
    }
  }

  const handleSend = async () => {
    const text = session.input.trim()
    const targetModel = session.model.trim()
    if (!session.baseUrl.trim()) {
      onPatch({ error: "请先填写 API 地址" })
      return
    }
    if (!targetModel) {
      onPatch({ error: "请填写模型名称，或先点击「测试连接」获取模型列表" })
      return
    }
    if (!text || session.sending) return

    const tempValue = Number(session.temperature)
    const maxTokensValue = Number(session.maxTokens)
    const temp = Number.isFinite(tempValue) ? tempValue : undefined
    const maxTok =
      Number.isFinite(maxTokensValue) && maxTokensValue > 0
        ? maxTokensValue
        : undefined

    const userMessage: ChatMessage = { role: "user", content: text }
    const requestMessages: ChatMessage[] = [
      ...(session.systemPrompt.trim()
        ? [{ role: "system" as const, content: session.systemPrompt.trim() }]
        : []),
      // 剔除界面附加的思考过程字段，仅发送协议字段
      ...session.messages.map((m) => ({ role: m.role, content: m.content })),
      userMessage,
    ]

    const controller = new AbortController()
    streamingReplyRef.current = ""
    liveReasoningRef.current = ""
    onPatch({
      error: null,
      input: "",
      metrics: null,
      rawResponse: null,
      liveReasoning: "",
      streamingReply: "",
      reasoningInProgress: false,
      sending: true,
      abortController: controller,
      messages: [...session.messages, userMessage],
    })

    try {
      if (session.streamEnabled) {
        const result = await buildClient().chatStream(
          requestMessages,
          { model: targetModel, temperature: temp, maxTokens: maxTok },
          (chunk) => {
            streamingReplyRef.current += chunk.delta
            liveReasoningRef.current += chunk.reasoningDelta
            const patch: Partial<LlmSession> = {
              streamingReply: streamingReplyRef.current,
              liveReasoning: liveReasoningRef.current,
            }
            // 推理阶段展开，开始输出正文后折叠
            if (chunk.reasoningDelta) patch.reasoningInProgress = true
            else if (chunk.delta) patch.reasoningInProgress = false
            onPatch(patch)
          },
          controller.signal,
        )
        if (result.text) {
          onPatch((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: "assistant",
                content: result.text,
                reasoning: result.reasoningText || undefined,
              },
            ],
          }))
        }
        onPatch({
          metrics: {
            mode: "stream",
            durationMs: result.durationMs,
            firstTokenMs: result.firstTokenMs,
            usage: result.usage,
            tokensPerSecond: result.tokensPerSecond,
            chunkCount: result.chunkCount,
            finishReason: result.finishReason,
          },
          rawResponse: result.rawChunks,
        })
      } else {
        const { completion, durationMs } = await buildClient().chat(
          requestMessages,
          { model: targetModel, temperature: temp, maxTokens: maxTok },
          controller.signal,
        )
        const content = completion.choices?.[0]?.message?.content ?? ""
        onPatch((prev) => ({
          messages: [...prev.messages, { role: "assistant", content }],
        }))
        const usage = completion.usage ?? null
        onPatch({
          metrics: {
            mode: "non-stream",
            durationMs,
            firstTokenMs: null,
            usage,
            tokensPerSecond:
              usage && usage.completion_tokens > 0
                ? usage.completion_tokens / (durationMs / 1000)
                : null,
            chunkCount: 0,
            finishReason: completion.choices?.[0]?.finish_reason ?? null,
          },
          rawResponse: completion,
        })
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // 用户手动停止：保留已生成的部分内容与思考过程（含仅输出推理、内容尚未开始的场景）
        const partial = streamingReplyRef.current
        const partialReasoning = liveReasoningRef.current
        if (partial.trim() || partialReasoning.trim()) {
          onPatch((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: "assistant",
                content: partial,
                reasoning: partialReasoning || undefined,
              },
            ],
          }))
        }
      } else {
        onPatch({ error: describeError(err) })
      }
    } finally {
      onPatch({
        sending: false,
        streamingReply: null,
        reasoningInProgress: false,
        abortController: null,
      })
    }
  }

  const handleStop = () => {
    session.abortController?.abort()
  }

  const handleClearChat = () => {
    if (session.sending) return
    onPatch({
      messages: [],
      streamingReply: null,
      liveReasoning: "",
      metrics: null,
      rawResponse: null,
      error: null,
    })
  }

  /** 新内容到达时滚动到底部 */
  useEffect(() => {
    const el = chatBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.messages, session.streamingReply, session.liveReasoning])

  const base = session.baseUrl.trim().replace(/\/+$/, "")

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- 连接配置 ---------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">连接配置</h2>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={session.provider}
            onChange={(event) => handleProviderChange(event.target.value)}
            className={cn(inputCls, "w-32")}
          >
            {PROVIDER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <input
            value={session.baseUrl}
            onChange={(event) => onPatch({ baseUrl: event.target.value })}
            placeholder="API 根地址，如 https://api.deepseek.com/v1"
            spellCheck={false}
            className={cn(inputCls, "min-w-0 flex-1 font-mono text-xs")}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestConnection}
            disabled={session.testing}
          >
            {session.testing ? <Loader2 className="animate-spin" /> : <Plug />}
            {session.testing ? "测试中…" : "测试连接"}
          </Button>
        </div>

        <input
          type="password"
          value={session.apiKey}
          onChange={(event) => onPatch({ apiKey: event.target.value })}
          placeholder="API Key（选填，非空时自动转为 Authorization: Bearer）"
          spellCheck={false}
          className={cn(inputCls, "w-full font-mono text-xs")}
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={session.useProxy}
              onChange={(event) => onPatch({ useProxy: event.target.checked })}
              className="size-3.5 accent-primary"
            />
            经后端代理转发
          </label>
          <button
            type="button"
            onClick={() => onPatch({ showAdvanced: !session.showAdvanced })}
            className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            <Settings2 className="size-3.5" />
            {session.showAdvanced ? "收起附加请求头" : "附加请求头"}
          </button>
          <span className="text-xs text-muted-foreground">
            {session.useProxy
              ? "后端真实请求，目标无需 CORS（需先启动 npm run dev:server）"
              : "浏览器直连，目标服务器需开启 CORS"}
          </span>
        </div>

        {session.showAdvanced && (
          <textarea
            value={session.extraHeadersText}
            onChange={(event) => onPatch({ extraHeadersText: event.target.value })}
            placeholder={"每行一个，格式：Key: Value\n例：\nX-Organization: org-xxx"}
            spellCheck={false}
            className={cn(inputCls, "h-20 w-full resize-y py-2 font-mono text-xs")}
          />
        )}

        {base && (
          <p className="text-xs text-muted-foreground">
            请求目标：{base}/models、{base}/chat/completions
          </p>
        )}

        {session.connectionMessage && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
              session.connectionMessage.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700",
            )}
          >
            <AlertTriangle
              className={cn(
                "mt-0.5 size-4 shrink-0",
                session.connectionMessage.ok ? "opacity-0" : "",
              )}
            />
            <span className="min-w-0 break-words">
              {session.connectionMessage.text}
            </span>
          </div>
        )}

        {session.models.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {session.models.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPatch({ model: item.id })}
                title={item.owned_by ? `owned_by: ${item.owned_by}` : item.id}
                className={cn(
                  "max-w-64 truncate rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  item.id === session.model
                    ? "border-primary/50 bg-primary/10"
                    : "hover:bg-accent",
                )}
              >
                {item.id}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ---------- 对话 ---------- */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">对话</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClearChat}
            disabled={session.sending || session.messages.length === 0}
          >
            <Trash2 /> 清空对话
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={session.model}
            onChange={(event) => onPatch({ model: event.target.value })}
            placeholder="模型（如 deepseek-chat）"
            spellCheck={false}
            className={cn(inputCls, "w-52 font-mono text-xs")}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            temperature
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={session.temperature}
              onChange={(event) => onPatch({ temperature: event.target.value })}
              className={cn(inputCls, "w-18 px-2 font-mono text-xs")}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            max_tokens
            <input
              type="number"
              step="any"
              min="1"
              value={session.maxTokens}
              onChange={(event) => onPatch({ maxTokens: event.target.value })}
              className={cn(inputCls, "w-24 px-2 font-mono text-xs")}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={session.streamEnabled}
              onChange={(event) =>
                onPatch({ streamEnabled: event.target.checked })
              }
              className="size-3.5 accent-primary"
            />
            流式输出
          </label>
          <button
            type="button"
            onClick={() => onPatch({ showSystem: !session.showSystem })}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {session.showSystem ? "收起系统提示词" : "设置系统提示词"}
          </button>
        </div>

        {session.showSystem && (
          <textarea
            value={session.systemPrompt}
            onChange={(event) => onPatch({ systemPrompt: event.target.value })}
            placeholder="System 提示词，如：你是一个严谨的助手…"
            className={cn(inputCls, "h-20 w-full resize-y py-2 text-sm")}
          />
        )}

        {/* 消息区：历史 + 正在生成的回复 */}
        <div
          ref={chatBoxRef}
          className="flex max-h-[420px] min-h-40 flex-col gap-2 overflow-auto rounded-md border p-3"
        >
          {session.messages.length === 0 && session.streamingReply === null && (
            <p className="m-auto text-sm text-muted-foreground">
              输入消息开始对话，将实时展示流式输出与性能指标
            </p>
          )}
          {session.messages.map((message, index) => (
            <MessageBubble key={index} message={message} />
          ))}
          {session.streamingReply !== null && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg border bg-muted/40 px-3 py-2">
                {session.liveReasoning && (
                  <details
                    className="group mb-2"
                    // 推理输出中默认展开，完成后移除 open 属性折叠（之后用户可自由展开）
                    open={session.reasoningInProgress || undefined}
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-amber-600">
                      <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                      推理过程（reasoning_content）
                    </summary>
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap font-mono text-xs text-amber-700">
                      {session.liveReasoning}
                    </pre>
                  </details>
                )}
                <pre className="whitespace-pre-wrap text-sm">
                  {session.streamingReply}
                  {session.sending && (
                    <span className="animate-pulse text-muted-foreground">▍</span>
                  )}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={session.input}
            onChange={(event) => onPatch({ input: event.target.value })}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                handleSend()
              }
            }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            spellCheck={false}
            disabled={session.sending}
            className={cn(inputCls, "min-h-20 flex-1 resize-y py-2 text-sm")}
          />
          {session.sending ? (
            <Button variant="destructive" size="sm" onClick={handleStop}>
              <Square /> 停止
            </Button>
          ) : (
            <Button size="sm" onClick={handleSend} disabled={!session.input.trim()}>
              <Send /> 发送
            </Button>
          )}
        </div>
      </section>

      {/* ---------- 分析 ---------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">分析</h2>

        {session.error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{session.error}</span>
          </div>
        )}

        {session.metrics && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="总耗时"
              value={`${session.metrics.durationMs.toFixed(0)} ms`}
              hint="端到端（含网络）"
            />
            <MetricCard
              label="首 token 延迟"
              value={
                session.metrics.firstTokenMs !== null
                  ? `${session.metrics.firstTokenMs.toFixed(0)} ms`
                  : "—"
              }
              hint="TTFT，仅流式"
            />
            <MetricCard
              label="输出 tokens"
              value={
                session.metrics.usage
                  ? String(session.metrics.usage.completion_tokens)
                  : "—"
              }
              hint="来自 usage"
            />
            <MetricCard
              label="输出速度"
              value={
                session.metrics.tokensPerSecond !== null
                  ? `${session.metrics.tokensPerSecond.toFixed(1)} tok/s`
                  : "—"
              }
              hint="completion_tokens / 耗时"
            />
          </div>
        )}

        {session.metrics && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <span>
              输入 {session.metrics.usage?.prompt_tokens ?? "—"} tokens
            </span>
            <span>总计 {session.metrics.usage?.total_tokens ?? "—"} tokens</span>
            {session.metrics.mode === "stream" && (
              <span>SSE {session.metrics.chunkCount} 个 chunk</span>
            )}
            <span>finish_reason：{session.metrics.finishReason ?? "—"}</span>
          </div>
        )}

        {session.rawResponse !== null && (
          <details className="group rounded-md border">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium">
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              原始响应
              <span className="text-xs font-normal text-muted-foreground">
                {Array.isArray(session.rawResponse)
                  ? `${session.rawResponse.length} 个 SSE chunk`
                  : "JSON"}
              </span>
            </summary>
            <div className="border-t p-3">
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                {JSON.stringify(session.rawResponse, null, 2)}
              </pre>
            </div>
          </details>
        )}

        {/* 请求日志：不限制最大高度，随内容自适应 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">请求日志</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onPatch({ logs: [] })}
              disabled={session.logs.length === 0}
            >
              <Eraser /> 清空
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {session.logs.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                暂无日志，发送请求后自动记录原始报文
              </p>
            )}
            {session.logs.map((entry) => (
              <LogEntryItem key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

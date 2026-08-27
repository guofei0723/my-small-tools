import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatMessage,
  CompletionUsage,
  ModelInfo,
} from "./types"

/** 日志条目：direction 为 request/response 时 body 为原始报文 */
export interface LlmLogEntry {
  id: number
  timestamp: number
  direction: "request" | "response" | "info" | "error"
  label: string
  body?: unknown
}

export interface LlmClientOptions {
  /** API 根地址，如 https://api.openai.com/v1（不含 /chat/completions） */
  baseUrl: string
  /** API Key：非空时自动转为 Authorization: Bearer */
  apiKey?: string
  /** 附加请求头（如组织 ID），覆盖默认头 */
  headers?: Record<string, string>
  /**
   * 后端代理端点（如 "/api/llm/proxy"）。设置后所有请求经后端转发，
   * 目标服务器无需开启 CORS；不设置则浏览器直连。
   */
  proxy?: string
  /** 每次收发报文时回调，用于 UI 展示调试日志 */
  onLog?: (entry: LlmLogEntry) => void
}

/** 流式对话中每个 chunk 的增量回调参数 */
export interface StreamChunk {
  delta: string
  reasoningDelta: string
  usage: CompletionUsage | null
  raw: ChatCompletionChunk
}

/** 流式对话完整结果 + 性能指标 */
export interface StreamResult {
  text: string
  reasoningText: string
  usage: CompletionUsage | null
  finishReason: string | null
  /** 端到端总耗时（毫秒） */
  durationMs: number
  /** 首个 token 延迟 TTFT（毫秒）；流未返回任何内容时为空 */
  firstTokenMs: number | null
  /** 输出速度（tokens/秒）；服务未返回 usage 时为空 */
  tokensPerSecond: number | null
  chunkCount: number
  /** 全部原始 SSE chunk，便于查看原始报文 */
  rawChunks: ChatCompletionChunk[]
}

/** 非流式对话结果 + 耗时 */
export interface ChatResult {
  completion: ChatCompletion
  durationMs: number
}

/** 对话参数：模型 + 可选采样参数 */
export interface ChatParams {
  model: string
  temperature?: number
  maxTokens?: number
}

/** LLM 调用失败（网络 / HTTP 统一包装） */
export class LlmError extends Error {
  readonly status?: number
  readonly responseBody?: string

  constructor(message: string, status?: number, responseBody?: string) {
    super(message)
    this.name = "LlmError"
    this.status = status
    this.responseBody = responseBody
  }
}

/**
 * 轻量 OpenAI 兼容 LLM 客户端：
 * - listModels()：GET /models，验证连接并列出模型
 * - chat()：非流式对话
 * - chatStream()：流式对话（SSE 解析 + 性能指标采集）
 * - 网络层可切换：设置 proxy 后请求发到同源后端，否则浏览器直连。
 *   所有请求都走 doRequest() 统一出口，保持代理/直连双通道可用。
 */
export class LlmClient {
  private readonly options: LlmClientOptions
  private logId = 0

  constructor(options: LlmClientOptions) {
    this.options = options
  }

  /** GET /models：验证连接并获取模型列表 */
  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const label = "GET /models"
    this.log("request", label, { url: this.joinUrl("/models") })
    const res = await this.doRequest("GET", "/models", this.jsonHeaders(), undefined, signal)
    const body = await this.readBody(res, label)
    let models: ModelInfo[] = []
    try {
      models = (JSON.parse(body) as { data?: ModelInfo[] }).data ?? []
    } catch {
      // 非 JSON 响应视为空列表，连接信息已在响应体中原样记录
    }
    this.log("response", `response ${label}`, { count: models.length })
    return models
  }

  /** 非流式对话：POST /chat/completions（stream: false） */
  async chat(
    messages: ChatMessage[],
    params: ChatParams,
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    const started = performance.now()
    const payload = this.buildPayload(messages, params, false)
    this.log("request", "POST /chat/completions", payload)
    const res = await this.doRequest(
      "POST",
      "/chat/completions",
      this.jsonHeaders(),
      JSON.stringify(payload),
      signal,
    )
    const body = await this.readBody(res, "POST /chat/completions")
    const completion = JSON.parse(body) as ChatCompletion
    const durationMs = performance.now() - started
    this.log("response", "response POST /chat/completions", completion)
    return { completion, durationMs }
  }

  /**
   * 流式对话：POST /chat/completions（stream: true）。
   * 逐 chunk 通过 onChunk 回调增量内容，结束后返回汇总结果与性能指标。
   */
  async chatStream(
    messages: ChatMessage[],
    params: ChatParams,
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal,
  ): Promise<StreamResult> {
    const started = performance.now()
    const payload = this.buildPayload(messages, params, true)
    this.log("request", "POST /chat/completions (stream)", payload)

    const res = await this.doRequest(
      "POST",
      "/chat/completions",
      this.jsonHeaders(),
      JSON.stringify(payload),
      signal,
    )
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      this.log("error", `HTTP ${res.status}`, body || res.statusText)
      throw new LlmError(
        `HTTP ${res.status} ${res.statusText}${body ? `：${body.slice(0, 500)}` : ""}`,
        res.status,
        body,
      )
    }

    // 流式累加器：用对象属性接收回调写入，避免 let 变量被 TS 控制流分析误判
    // （闭包内赋值对外层不可见，会收窄为 null 导致 never 类型）
    const acc = {
      text: "",
      reasoningText: "",
      usage: null as CompletionUsage | null,
      finishReason: null as string | null,
      firstTokenMs: null as number | null,
      rawChunks: [] as ChatCompletionChunk[],
    }

    await this.readSse(res.body, (eventName, data) => {
      if (eventName !== "message" || data === "[DONE]") return
      let chunk: ChatCompletionChunk
      try {
        chunk = JSON.parse(data) as ChatCompletionChunk
      } catch {
        // 非 JSON 的 message 事件忽略
        return
      }
      acc.rawChunks.push(chunk)
      const delta = chunk.choices?.[0]?.delta
      const content = delta?.content
      const reasoning = delta?.reasoning_content
      if (content) {
        if (acc.firstTokenMs === null) {
          acc.firstTokenMs = performance.now() - started
        }
        acc.text += content
      }
      if (reasoning) {
        if (acc.firstTokenMs === null) {
          acc.firstTokenMs = performance.now() - started
        }
        acc.reasoningText += reasoning
      }
      if (chunk.usage) acc.usage = chunk.usage
      const reason = chunk.choices?.[0]?.finish_reason
      if (reason) acc.finishReason = reason
      onChunk({
        delta: content ?? "",
        reasoningDelta: reasoning ?? "",
        usage: acc.usage,
        raw: chunk,
      })
    })

    const durationMs = performance.now() - started
    const result: StreamResult = {
      text: acc.text,
      reasoningText: acc.reasoningText,
      usage: acc.usage,
      finishReason: acc.finishReason,
      durationMs,
      firstTokenMs: acc.firstTokenMs,
      tokensPerSecond:
        acc.usage && acc.usage.completion_tokens > 0
          ? acc.usage.completion_tokens / (durationMs / 1000)
          : null,
      chunkCount: acc.rawChunks.length,
      rawChunks: acc.rawChunks,
    }
    this.log("response", "response POST /chat/completions (stream)", {
      status: res.status,
      chunkCount: acc.rawChunks.length,
      usage: acc.usage,
      finishReason: acc.finishReason,
      durationMs: Math.round(durationMs),
      // 流式拼接后的完整内容（含思考过程），便于在日志中直接查看返回结果
      text: acc.text,
      reasoningText: acc.reasoningText || undefined,
    })
    return result
  }

  // ---------- 内部实现 ----------

  private buildPayload(
    messages: ChatMessage[],
    params: ChatParams,
    stream: boolean,
  ): ChatCompletionRequest {
    const payload: ChatCompletionRequest = {
      model: params.model,
      messages,
      stream,
    }
    if (params.temperature !== undefined) payload.temperature = params.temperature
    if (params.maxTokens !== undefined && params.maxTokens > 0) {
      payload.max_tokens = params.maxTokens
    }
    return payload
  }

  private jsonHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.options.headers,
    }
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`
    return headers
  }

  /** 实际发起 HTTP 请求：代理模式发到后端（同源，后端再真实请求目标），直连模式直接请求目标 */
  private async doRequest(
    method: "GET" | "POST",
    path: string,
    headers: Record<string, string>,
    body: string | undefined,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = this.joinUrl(path)
    try {
      if (this.options.proxy) {
        return await fetch(this.options.proxy, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, method, headers, body }),
          signal,
        })
      }
      return await fetch(url, { method, headers, body, signal })
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error
      this.log("error", "网络请求失败", this.describeNetworkError(error))
      throw new LlmError(this.describeNetworkError(error))
    }
  }

  private joinUrl(path: string): string {
    return this.options.baseUrl.replace(/\/+$/, "") + path
  }

  private async readBody(res: Response, label: string): Promise<string> {
    const body = await res.text().catch(() => "")
    if (!res.ok) this.throwHttpError(res, body, label)
    return body
  }

  private throwHttpError(res: Response, body: string, label: string): never {
    this.log("error", `${label} HTTP ${res.status}`, body || res.statusText)
    throw new LlmError(
      `${label}：HTTP ${res.status} ${res.statusText}${body ? `：${body.slice(0, 500)}` : ""}`,
      res.status,
      body,
    )
  }

  /** 读取 SSE 流，逐事件回调（event 名 + data 原文） */
  private async readSse(
    body: ReadableStream<Uint8Array> | null,
    onEvent: (eventName: string, data: string) => void,
  ): Promise<void> {
    if (!body) return
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let eventName = "message"
    let dataLines: string[] = []

    const flushEvent = () => {
      if (dataLines.length > 0) {
        onEvent(eventName, dataLines.join("\n"))
      }
      eventName = "message"
      dataLines = []
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex: number
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "")
        buffer = buffer.slice(newlineIndex + 1)
        if (line === "") {
          flushEvent()
        } else if (line.startsWith(":")) {
          // SSE 注释行（含心跳 ping），忽略
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart())
        }
      }
    }
    flushEvent()
  }

  private describeNetworkError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    if (/fetch|network|failed/i.test(message)) {
      if (this.options.proxy) {
        return "无法连接后端代理，请确认 Rust 服务已启动（项目根目录运行 npm run dev:server）"
      }
      return "无法连接到目标服务。请确认地址正确、服务已启动；若目标未开启 CORS，可切换为经后端代理转发"
    }
    return message
  }

  private log(
    direction: LlmLogEntry["direction"],
    label: string,
    body?: unknown,
  ): void {
    this.options.onLog?.({
      id: ++this.logId,
      timestamp: Date.now(),
      direction,
      label,
      body,
    })
  }
}

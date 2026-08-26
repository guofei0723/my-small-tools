import type {
  CallToolResult,
  InitializeParams,
  InitializeResult,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  ListToolsResult,
  McpTool,
  McpTransportType,
} from "./types"

/** 协议版本回退顺序：优先最新，服务器不兼容时逐个降级 */
const PROTOCOL_VERSIONS = ["2025-06-18", "2024-11-05", "2024-10-07"] as const

/** 日志条目：direction 为 request/response 时 body 为 JSON-RPC 报文 */
export interface McpLogEntry {
  id: number
  timestamp: number
  direction: "request" | "response" | "info" | "error"
  label: string
  body?: unknown
}

export interface McpClientOptions {
  /** MCP server 地址（Streamable HTTP 为 /mcp 端点，SSE 为 /sse 端点） */
  url: string
  transport: McpTransportType
  /** 附加请求头，如 Authorization（会覆盖默认头） */
  headers?: Record<string, string>
  /**
   * 后端代理端点（如 "/api/proxy"）。设置后所有请求经后端转发，
   * 目标服务器无需开启 CORS；不设置则浏览器直连。
   */
  proxy?: string
  /** 每次收发报文时回调，用于 UI 展示调试日志 */
  onLog?: (entry: McpLogEntry) => void
}

/** MCP 调用失败（网络 / HTTP / JSON-RPC 错误统一包装） */
export class McpError extends Error {
  readonly code?: number

  constructor(message: string, code?: number) {
    super(message)
    this.name = "McpError"
    this.code = code
  }
}

/**
 * 轻量 MCP 客户端：
 * - 支持 Streamable HTTP（POST JSON，响应可为 JSON 或 SSE 流）
 * - 支持老式 SSE 传输（先建立事件流取 endpoint，再 POST）
 * - 自动管理 Mcp-Session-Id 会话
 * - 每个请求/响应都通过 onLog 上报，方便调试
 */
export class McpClient {
  private readonly options: McpClientOptions
  private requestId = 0
  private logId = 0
  private sessionId: string | null = null
  private postUrl: string | null = null
  private controller: AbortController | null = null
  private connected = false
  private disposed = false

  constructor(options: McpClientOptions) {
    this.options = options
  }

  /**
   * 建立连接：SSE 传输先解析 endpoint，随后 initialize 握手
   * 并发送 notifications/initialized，协议版本不兼容时自动降级重试。
   */
  async connect(): Promise<InitializeResult> {
    this.assertActive()

    if (this.options.transport === "sse") {
      await this.setupSseEndpoint()
    }

    let lastError: unknown = null
    for (const version of PROTOCOL_VERSIONS) {
      try {
        return await this.initialize(version)
      } catch (error) {
        lastError = error
        if (!(error instanceof McpError)) throw error
        // 仅协议版本导致的错误才降级重试，其余直接抛出
        if (error.code !== undefined) continue
        throw error
      }
    }
    throw lastError instanceof Error ? lastError : new McpError("initialize 失败")
  }

  /** 获取服务器上的全部工具定义 */
  async listTools(): Promise<McpTool[]> {
    this.assertConnected()
    const response = await this.post({
      id: this.nextId(),
      method: "tools/list",
      params: {},
    })
    this.assertOk(response, "tools/list")
    return (response.result as ListToolsResult).tools ?? []
  }

  /** 调用工具，返回结构化结果 */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    this.assertConnected()
    const response = await this.post({
      id: this.nextId(),
      method: "tools/call",
      params: { name, arguments: args },
    })
    this.assertOk(response, `tools/call ${name}`)
    return response.result as CallToolResult
  }

  /** 断开连接（中止挂起请求，之后不可复用） */
  disconnect(): void {
    this.disposed = true
    this.connected = false
    this.controller?.abort()
    this.controller = null
  }

  // ---------- 内部实现 ----------

  private async initialize(protocolVersion: string): Promise<InitializeResult> {
    const params: InitializeParams = {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "mcp-debugger", version: "0.1.0" },
    }
    const response = await this.post({
      id: this.nextId(),
      method: "initialize",
      params,
    })
    this.assertOk(response, "initialize")
    const result = response.result as InitializeResult
    if (!result.protocolVersion || !result.serverInfo) {
      throw new McpError("initialize 返回了不完整的 result")
    }
    this.connected = true
    // 握手成功后发送 initialized 通知（202 空响应，忽略返回）
    await this.post({ method: "notifications/initialized" })
    return result
  }

  /** 老式 SSE 传输：GET 建立事件流，等待 endpoint 事件后关闭 GET 流 */
  private async setupSseEndpoint(): Promise<void> {
    const headers = { Accept: "text/event-stream", ...this.options.headers }
    this.controller = new AbortController()
    this.log("info", "打开 SSE 流", this.options.url)

    let res: Response
    try {
      res = await this.doRequest({
        method: "GET",
        url: this.options.url,
        headers,
      })
    } catch (error) {
      throw new McpError(
        `无法建立 SSE 连接：${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const sessionId = res.headers.get("mcp-session-id")
    if (sessionId) this.sessionId = sessionId

    if (!res.ok) {
      throw new McpError(`SSE 连接失败：HTTP ${res.status} ${res.statusText}`)
    }
    if (!res.body) {
      throw new McpError("SSE 连接没有返回响应体")
    }

    const endpoint = await this.waitForEndpoint(res.body)
    if (!endpoint) {
      throw new McpError("SSE 流中未收到 endpoint 事件")
    }
    this.postUrl = new URL(endpoint, this.options.url).toString()
    this.log("info", "SSE endpoint", this.postUrl)
  }

  /** 从 SSE 流中读取第一个 event: endpoint 的 data */
  private waitForEndpoint(body: ReadableStream<Uint8Array>): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let eventName = "message"
      let dataLines: string[] = []
      let settled = false

      const finish = (endpoint: string | null) => {
        if (settled) return
        settled = true
        this.controller?.abort()
        resolve(endpoint)
      }

      const flushEvent = (): boolean => {
        if (eventName === "endpoint" && dataLines.length > 0) {
          finish(dataLines.join("\n").trim())
          return true
        }
        eventName = "message"
        dataLines = []
        return false
      }

      const pump = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              finish(null)
              return
            }
            buffer += decoder.decode(value, { stream: true })
            let newlineIndex: number
            while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, newlineIndex).replace(/\r$/, "")
              buffer = buffer.slice(newlineIndex + 1)
              if (line === "") {
                if (flushEvent()) return
              } else if (line.startsWith(":")) {
                // SSE 注释行，忽略
              } else if (line.startsWith("event:")) {
                eventName = line.slice(6).trim()
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trimStart())
              }
            }
            pump()
          })
          .catch(() => finish(null))
      }
      pump()
    })
  }

  /** 发送 JSON-RPC 报文（请求或通知），解析并返回对应响应 */
  private async post(
    message:
      | Omit<JsonRpcRequest, "jsonrpc">
      | Omit<JsonRpcNotification, "jsonrpc">,
  ): Promise<JsonRpcResponse | null> {
    const payload: JsonRpcRequest | JsonRpcNotification = {
      jsonrpc: "2.0",
      ...message,
    }
    const isNotification = !("id" in message)
    const label = isNotification
      ? `notify ${message.method}`
      : `request ${message.method}`
    const url = this.postUrl ?? this.options.url

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.options.headers,
    }
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId

    this.log("request", label, payload)

    this.controller = new AbortController()
    let res: Response
    try {
      res = await this.doRequest({
        method: "POST",
        url,
        headers,
        body: JSON.stringify(payload),
      })
    } catch (error) {
      this.log("error", "网络请求失败", this.describeNetworkError(error))
      throw new McpError(this.describeNetworkError(error))
    }

    const sessionId = res.headers.get("mcp-session-id")
    if (sessionId && sessionId !== this.sessionId) {
      this.sessionId = sessionId
      this.log("info", "会话 ID", sessionId)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      this.log("error", `HTTP ${res.status}`, text || res.statusText)
      throw new McpError(
        `HTTP ${res.status} ${res.statusText}${text ? `：${text.slice(0, 500)}` : ""}`,
      )
    }

    const messages = await this.parseResponse(res)
    const requestId = isNotification ? null : (message as { id: number | string }).id
    const matched =
      messages.find(
        (item) => requestId !== null && String(item.id) === String(requestId),
      ) ?? messages[0]
    if (matched) this.log("response", `response ${label}`, matched)
    return matched ?? null
  }

  /**
   * 实际发起 HTTP 请求：代理模式发到后端（同源，后端再真实请求目标），
   * 直连模式直接发到目标地址。返回的 Response 可直接读 body 流。
   */
  private async doRequest(options: {
    method: "GET" | "POST"
    url: string
    headers: Record<string, string>
    body?: string
  }): Promise<Response> {
    const signal = this.controller?.signal
    if (this.options.proxy) {
      return fetch(this.options.proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: options.url,
          method: options.method,
          headers: options.headers,
          body: options.body,
        }),
        signal,
      })
    }
    return fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal,
    })
  }

  /** 解析响应体：application/json 单响应 或 text/event-stream 流式响应 */
  private async parseResponse(res: Response): Promise<JsonRpcResponse[]> {
    const contentType = res.headers.get("content-type") ?? ""
    if (contentType.includes("text/event-stream")) {
      return this.readEventStream(res.body)
    }
    const text = await res.text()
    if (!text.trim()) return []
    try {
      return [JSON.parse(text) as JsonRpcResponse]
    } catch {
      this.log("error", "非法 JSON 响应", text.slice(0, 500))
      throw new McpError("服务器返回了非法的 JSON 响应")
    }
  }

  /** 读取 SSE 流，收集所有 event: message 事件中的 JSON-RPC 响应 */
  private async readEventStream(
    body: ReadableStream<Uint8Array> | null,
  ): Promise<JsonRpcResponse[]> {
    if (!body) return []
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const messages: JsonRpcResponse[] = []
    let buffer = ""
    let eventName = "message"
    let dataLines: string[] = []

    const flushEvent = () => {
      if (eventName === "message" && dataLines.length > 0) {
        const raw = dataLines.join("\n").trim()
        if (raw) {
          try {
            messages.push(JSON.parse(raw) as JsonRpcResponse)
          } catch {
            // 非 JSON 的 message 事件忽略
          }
        }
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
          // SSE 注释行（含 ping），忽略
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart())
        }
      }
    }
    flushEvent()
    return messages
  }

  private assertOk(
    response: JsonRpcResponse | null,
    label: string,
  ): asserts response is JsonRpcResponse & { result: unknown } {
    if (!response) {
      throw new McpError(`${label}：服务器未返回响应`)
    }
    if (response.error) {
      this.log("error", `${label} 失败`, response.error)
      throw new McpError(
        `${label}：${response.error.message}`,
        response.error.code,
      )
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new McpError("客户端已断开，请重新连接")
  }

  private assertConnected(): void {
    if (this.disposed) throw new McpError("客户端已断开，请重新连接")
    if (!this.connected) throw new McpError("尚未完成 initialize 握手")
  }

  private nextId(): number {
    return ++this.requestId
  }

  private describeNetworkError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    if (/fetch|network|failed/i.test(message)) {
      if (this.options.proxy) {
        return (
          "无法连接后端代理，请确认 Rust 服务已启动" +
          "（在项目根目录运行 npm run dev:server）"
        )
      }
      return (
        "无法连接到 MCP 服务器。请确认地址正确、服务器已启动；" +
        "若服务器未开启 CORS，浏览器直连会被拦截，可切换为后端代理模式"
      )
    }
    return message
  }

  private log(
    direction: McpLogEntry["direction"],
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

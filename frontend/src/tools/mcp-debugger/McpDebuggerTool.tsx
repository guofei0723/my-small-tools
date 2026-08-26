import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  ChevronDown,
  Eraser,
  Loader2,
  Play,
  Plug,
  Search,
} from "lucide-react"
import { useCallback, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { McpClient, type McpLogEntry } from "@/lib/mcp/client"
import {
  extractSchemaFields,
  generateExampleFromSchema,
  type SchemaField,
} from "@/lib/mcp/schema"
import type {
  CallToolResult,
  InitializeResult,
  McpTool,
  McpTransportType,
} from "@/lib/mcp/types"
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

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false })
}

function JsonBlock({
  value,
  className,
}: {
  value: unknown
  className?: string
}) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value])
  return (
    <pre
      className={cn(
        "overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed",
        className,
      )}
    >
      {text}
    </pre>
  )
}

function SchemaFieldsTable({ fields }: { fields: SchemaField[] }) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">该工具不需要参数</p>
  }
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="py-1.5 pr-3 font-medium">参数</th>
          <th className="py-1.5 pr-3 font-medium">类型</th>
          <th className="py-1.5 pr-3 font-medium">必填</th>
          <th className="py-1.5 font-medium">说明</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.name} className="border-b last:border-0">
            <td className="py-1.5 pr-3 font-mono text-xs">{field.name}</td>
            <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">
              {field.type}
            </td>
            <td className="py-1.5 pr-3">
              {field.required ? (
                <span className="text-xs text-amber-600">必填</span>
              ) : (
                <span className="text-xs text-muted-foreground">可选</span>
              )}
            </td>
            <td className="py-1.5 text-xs text-muted-foreground">
              {field.description ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LogEntryItem({ entry }: { entry: McpLogEntry }) {
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
          <JsonBlock value={entry.body} />
        </div>
      )}
    </details>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm">{value}</div>
    </div>
  )
}

function CallResultView({
  result,
}: {
  result: { ok: boolean; value: unknown }
}) {
  const value = result.value

  // 请求层错误（网络 / HTTP / JSON-RPC error）
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "string"
  ) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
          <AlertTriangle className="size-4" /> 调用失败
        </p>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-700">
          {(value as { error: string }).error}
        </pre>
      </div>
    )
  }

  const callResult = value as CallToolResult
  return (
    <div className="flex flex-col gap-2">
      <p
        className={cn(
          "flex items-center gap-1.5 text-sm font-medium",
          callResult.isError ? "text-red-600" : "text-emerald-600",
        )}
      >
        {callResult.isError ? (
          <AlertTriangle className="size-4" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        {callResult.isError ? "工具返回错误" : "调用成功"}
      </p>
      <div className="flex flex-col gap-2">
        {callResult.content?.map((item, index) => {
          if (item.type === "text") {
            return (
              <pre
                key={index}
                className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs"
              >
                {item.text}
              </pre>
            )
          }
          if (item.type === "image") {
            return (
              <p
                key={index}
                className="rounded-md border px-3 py-2 text-xs text-muted-foreground"
              >
                图片内容（mimeType: {String(item.mimeType ?? "未知")}，base64{" "}
                {(item.data as string | undefined)?.length ?? 0} 字符）
              </p>
            )
          }
          return <JsonBlock key={index} value={item} />
        })}
        {callResult.structuredContent !== undefined && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              structuredContent
            </p>
            <JsonBlock value={callResult.structuredContent} />
          </div>
        )}
      </div>
    </div>
  )
}

export function McpDebuggerTool() {
  const [url, setUrl] = useState("http://localhost:3001/mcp")
  const [transport, setTransport] = useState<McpTransportType>("http")
  const [useProxy, setUseProxy] = useState(true)
  const [headersText, setHeadersText] = useState("")
  const [showHeaders, setShowHeaders] = useState(false)

  const [client, setClient] = useState<McpClient | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [serverInfo, setServerInfo] = useState<InitializeResult | null>(null)
  const [tools, setTools] = useState<McpTool[]>([])
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<McpLogEntry[]>([])

  const [argsText, setArgsText] = useState("{}")
  const [argsError, setArgsError] = useState<string | null>(null)
  const [calling, setCalling] = useState(false)
  const [callResult, setCallResult] = useState<{
    ok: boolean
    value: unknown
  } | null>(null)

  const isConnected = client !== null

  const handleLog = useCallback((entry: McpLogEntry) => {
    setLogs((prev) => [...prev, entry])
  }, [])

  const resetArgs = useCallback((tool: McpTool) => {
    const example = generateExampleFromSchema(tool.inputSchema) ?? {}
    setArgsText(JSON.stringify(example, null, 2))
    setArgsError(null)
    setCallResult(null)
  }, [])

  const handleConnect = async () => {
    const targetUrl = url.trim()
    if (!targetUrl) {
      setError("请输入 MCP 服务器地址")
      return
    }
    setError(null)
    setConnecting(true)
    setLogs([])
    setCallResult(null)

    const nextClient = new McpClient({
      url: targetUrl,
      transport,
      headers: parseHeaders(headersText),
      // 默认经 Rust 后端代理真实请求，目标服务器无需开启 CORS
      proxy: useProxy ? "/api/proxy" : undefined,
      onLog: handleLog,
    })
    setClient(nextClient)
    try {
      const info = await nextClient.connect()
      setServerInfo(info)
      const toolList = await nextClient.listTools()
      setTools(toolList)
      if (toolList.length > 0) {
        setSelectedToolName(toolList[0].name)
        resetArgs(toolList[0])
      } else {
        setSelectedToolName(null)
        setArgsText("{}")
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setServerInfo(null)
      setTools([])
      setSelectedToolName(null)
      nextClient.disconnect()
      setClient(null)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = () => {
    client?.disconnect()
    setClient(null)
    setServerInfo(null)
    setTools([])
    setSelectedToolName(null)
    setArgsText("{}")
    setCallResult(null)
    setError(null)
  }

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.name === selectedToolName) ?? null,
    [tools, selectedToolName],
  )

  const filteredTools = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return tools
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(keyword) ||
        (tool.description ?? "").toLowerCase().includes(keyword),
    )
  }, [tools, search])

  const handleCall = async () => {
    if (!client || !selectedTool) return
    let args: unknown
    try {
      args = JSON.parse(argsText || "{}")
    } catch (err) {
      setArgsError(
        `参数不是合法的 JSON：${err instanceof Error ? err.message : String(err)}`,
      )
      return
    }
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      setArgsError("参数必须是 JSON 对象（{}）")
      return
    }
    setArgsError(null)
    setCalling(true)
    setCallResult(null)
    try {
      const result = await client.callTool(
        selectedTool.name,
        args as Record<string, unknown>,
      )
      setCallResult({ ok: !result.isError, value: result })
    } catch (err) {
      setCallResult({
        ok: false,
        value: { error: err instanceof Error ? err.message : String(err) },
      })
    } finally {
      setCalling(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP 调试器</CardTitle>
        <CardDescription>
          连接 MCP 服务器，查看工具定义并调用工具（支持 Streamable HTTP 与 SSE
          传输；默认经 Rust 后端代理，目标无需 CORS）
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* 连接区 */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={transport}
              onChange={(event) =>
                setTransport(event.target.value as McpTransportType)
              }
              disabled={isConnected || connecting}
              className={cn(inputCls, "w-24")}
            >
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
            </select>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://localhost:3001/mcp"
              disabled={isConnected || connecting}
              className={cn(inputCls, "min-w-0 flex-1 font-mono text-xs")}
            />
            {isConnected ? (
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                <Plug /> 断开
              </Button>
            ) : (
              <Button size="sm" onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Cable />
                )}
                {connecting ? "连接中…" : "连接"}
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={useProxy}
                onChange={(event) => setUseProxy(event.target.checked)}
                disabled={isConnected || connecting}
                className="size-3.5 accent-primary"
              />
              经后端代理转发
            </label>
            <button
              type="button"
              onClick={() => setShowHeaders((prev) => !prev)}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {showHeaders ? "收起请求头" : "设置请求头"}
            </button>
            <span className="text-xs text-muted-foreground">
              {useProxy
                ? "后端真实请求，目标服务器无需 CORS（需先启动 npm run dev:server）"
                : "浏览器直连，目标服务器需开启 CORS"}
            </span>
          </div>

          {showHeaders && (
            <textarea
              value={headersText}
              onChange={(event) => setHeadersText(event.target.value)}
              placeholder={
                "每行一个，格式：Key: Value\n例：\nAuthorization: Bearer your-token"
              }
              spellCheck={false}
              className={cn(inputCls, "h-24 w-full resize-y py-2 font-mono text-xs")}
            />
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
        </div>

        {/* 服务器信息 */}
        {serverInfo && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <InfoItem
              label="服务器"
              value={`${serverInfo.serverInfo.name} v${serverInfo.serverInfo.version}`}
            />
            <InfoItem label="协议版本" value={serverInfo.protocolVersion} />
            <InfoItem label="工具数量" value={String(tools.length)} />
          </div>
        )}

        {/* 主区域：工具列表 + 详情/调用 */}
        {isConnected && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[300px_1fr]">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索工具…"
                  className={cn(inputCls, "w-full pl-8")}
                />
              </div>
              <div className="flex max-h-[440px] flex-col gap-1 overflow-auto pr-1">
                {filteredTools.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    没有找到工具
                  </p>
                )}
                {filteredTools.map((tool) => (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => {
                      setSelectedToolName(tool.name)
                      resetArgs(tool)
                    }}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors",
                      selectedToolName === tool.name
                        ? "border-primary/40 bg-primary/5"
                        : "hover:bg-accent",
                    )}
                  >
                    <div className="text-sm font-medium">{tool.name}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {tool.description || "（无描述）"}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-0">
              {selectedTool ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="text-base font-semibold">
                      {selectedTool.name}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedTool.description || "（无描述）"}
                    </p>
                  </div>

                  <div className="rounded-md border p-3">
                    <h4 className="mb-2 text-sm font-medium">参数定义</h4>
                    <SchemaFieldsTable
                      fields={extractSchemaFields(selectedTool.inputSchema)}
                    />
                  </div>

                  <details className="rounded-md border">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                      inputSchema（完整 JSON）
                    </summary>
                    <div className="border-t p-3">
                      <JsonBlock value={selectedTool.inputSchema} />
                    </div>
                  </details>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-medium">调用参数</h4>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resetArgs(selectedTool)}
                      >
                        重新生成示例
                      </Button>
                    </div>
                    <textarea
                      value={argsText}
                      onChange={(event) => {
                        setArgsText(event.target.value)
                        setArgsError(null)
                      }}
                      spellCheck={false}
                      className={cn(
                        inputCls,
                        "h-40 w-full resize-y py-2 font-mono text-xs",
                        argsError && "border-red-400",
                      )}
                    />
                    {argsError && (
                      <p className="text-xs text-red-600">{argsError}</p>
                    )}
                    <div>
                      <Button
                        size="sm"
                        onClick={handleCall}
                        disabled={calling}
                      >
                        {calling ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Play />
                        )}
                        {calling ? "调用中…" : "调用工具"}
                      </Button>
                    </div>
                  </div>

                  {callResult && <CallResultView result={callResult} />}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  该服务器没有暴露任何工具
                </p>
              )}
            </div>
          </div>
        )}

        {/* 请求日志 */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">请求日志</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLogs([])}
              disabled={logs.length === 0}
            >
              <Eraser /> 清空
            </Button>
          </div>
          <div className="flex max-h-72 flex-col gap-1 overflow-auto">
            {logs.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                暂无日志，连接服务器后自动记录 JSON-RPC 报文
              </p>
            )}
            {logs.map((entry) => (
              <LogEntryItem key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

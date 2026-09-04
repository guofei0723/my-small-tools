import {
  Check,
  ChevronDown,
  Copy,
  Eraser,
  FileJson,
  Send,
  Square,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const inputCls =
  "h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

const STANDARD_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "text/plain",
  "text/xml",
]

export interface HeaderRow {
  id: string
  key: string
  value: string
  enabled: boolean
}

export interface CookieRow {
  id: string
  name: string
  value: string
  enabled: boolean
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
  contentType: string
  durationMs: number
  size: number
}

/** 单个 HTTP 请求标签的完整状态 */
export interface HttpSession {
  id: string
  label: string
  url: string
  method: HttpMethod
  contentType: string
  headers: HeaderRow[]
  cookies: CookieRow[]
  body: string
  sending: boolean
  response: HttpResponse | null
  error: string | null
  responseView: "pretty" | "raw"
  copied: boolean
  abortController: AbortController | null
}

/** 持久化的 HTTP 请求配置，不包含响应和请求控制器等运行态 */
export interface HttpPersistedSession {
  id: string
  label: string
  url: string
  method: HttpMethod
  contentType: string
  headers: HeaderRow[]
  cookies: CookieRow[]
  body: string
}

export type SessionUpdater =
  | Partial<HttpSession>
  | ((session: HttpSession) => Partial<HttpSession>)

export function createHttpSession(): HttpSession {
  return {
    id: crypto.randomUUID(),
    label: "",
    url: "",
    method: "GET",
    contentType: "application/json",
    headers: [
      {
        id: crypto.randomUUID(),
        key: "Authorization",
        value: "Bearer <token>",
        enabled: false,
      },
    ],
    cookies: [],
    body: '{\n  "hello": "world"\n}',
    sending: false,
    response: null,
    error: null,
    responseView: "pretty",
    copied: false,
    abortController: null,
  }
}

export function sessionEndpoint(session: Pick<HttpSession, "url">): string {
  const url = session.url.trim()
  if (!url) return "新请求"
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split("/").filter(Boolean)
    return parts.at(-1) ?? "/"
  } catch {
    const path = url.split(/[?#]/, 1)[0]
    return path.split("/").filter(Boolean).at(-1) ?? url
  }
}

export function sessionUrl(session: Pick<HttpSession, "url">): string {
  return session.url.trim() || "未设置 URL"
}

/** 用于兼容已有持久化字段的标签：界面展示最后一段 endpoint 和完整 URL。 */
export function sessionLabel(session: Pick<HttpSession, "url">): string {
  return sessionUrl(session)
}

export function toPersisted(session: HttpSession): HttpPersistedSession {
  return {
    id: session.id,
    label: sessionLabel(session),
    url: session.url,
    method: session.method,
    contentType: session.contentType,
    headers: session.headers,
    cookies: session.cookies,
    body: session.body,
  }
}

export function fromPersisted(session: HttpPersistedSession): HttpSession {
  const defaults = createHttpSession()
  const restored = { ...defaults, ...session }
  const isPreviousDefaultHeader =
    restored.headers.length === 1 &&
    restored.headers[0].key.toLowerCase() === "accept" &&
    restored.headers[0].value === "application/json" &&
    restored.headers[0].enabled

  // 兼容早期版本的默认 Accept，迁移为新的 Authorization 默认项。
  if (isPreviousDefaultHeader) restored.headers = defaults.headers
  return restored
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return "text-emerald-600"
  if (status >= 300 && status < 400) return "text-amber-600"
  return "text-red-600"
}

/** 这些是浏览器/开发代理链路的元数据，不属于目标服务的业务响应。 */
function isInfrastructureHeader(name: string): boolean {
  const normalized = name.toLowerCase()
  return normalized.startsWith("access-control-") || normalized === "x-mcp-proxy"
}

interface HttpSessionViewProps {
  session: HttpSession
  onPatch: (updater: SessionUpdater) => void
}

export function HttpSessionView({ session, onPatch }: HttpSessionViewProps) {
  const [requestTab, setRequestTab] = useState<"headers" | "cookies">("headers")
  const bodyAllowed = session.method !== "GET" && session.method !== "HEAD"
  const contentTypeSelectValue =
    session.contentType === ""
      ? ""
      : STANDARD_CONTENT_TYPES.includes(session.contentType)
        ? session.contentType
        : "__custom__"
  const parsedResponse = useMemo(
    () => (session.response ? formatJson(session.response.body) : null),
    [session.response],
  )
  const responseText =
    session.response && session.responseView === "pretty" && parsedResponse !== null
      ? parsedResponse
      : session.response?.body ?? ""
  const canFormatResponse = parsedResponse !== null

  const patch = (value: Partial<HttpSession>) => onPatch(value)

  const updateHeader = (id: string, value: Partial<HeaderRow>) => {
    onPatch((current) => ({
      headers: current.headers.map((header) =>
        header.id === id ? { ...header, ...value } : header,
      ),
    }))
  }

  const removeHeader = (id: string) => {
    onPatch((current) => ({
      headers: current.headers.filter((header) => header.id !== id),
    }))
  }

  const clearRequest = () => {
    patch({
      url: "",
      method: "GET",
      contentType: "application/json",
      headers: [],
      cookies: [],
      body: "",
      response: null,
      error: null,
    })
  }

  const prettyPrintRequest = () => {
    const formatted = formatJson(session.body)
    if (formatted !== null) patch({ body: formatted })
  }

  const sendRequest = async () => {
    const url = session.url.trim()
    if (!url) {
      patch({ error: "请输入请求 URL" })
      return
    }

    try {
      const parsedUrl = new URL(url)
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        patch({ error: "仅支持 http:// 或 https:// 地址" })
        return
      }
    } catch {
      patch({ error: "URL 格式不正确，请包含 http:// 或 https://" })
      return
    }

    const headers: Record<string, string> = {}
    for (const header of session.headers) {
      const key = header.key.trim()
      if (header.enabled && key) headers[key] = header.value
    }
    if (bodyAllowed && session.contentType.trim()) {
      const existingContentType = Object.keys(headers).find(
        (key) => key.toLowerCase() === "content-type",
      )
      if (existingContentType) delete headers[existingContentType]
      headers["Content-Type"] = session.contentType.trim()
    }

    const cookieValue = session.cookies
      .filter((cookie) => cookie.enabled && cookie.name.trim())
      .map((cookie) => `${cookie.name.trim()}=${cookie.value}`)
      .join("; ")
    if (cookieValue) {
      const existingCookie = Object.keys(headers).find(
        (key) => key.toLowerCase() === "cookie",
      )
      if (existingCookie) delete headers[existingCookie]
      headers.Cookie = cookieValue
    }

    const controller = new AbortController()
    patch({
      sending: true,
      error: null,
      response: null,
      copied: false,
      abortController: controller,
    })
    const started = performance.now()

    try {
      const proxyResponse = await fetch("/api/http/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          method: session.method,
          headers,
          body: bodyAllowed && session.body ? session.body : undefined,
        }),
        signal: controller.signal,
      })
      const body = await proxyResponse.text()
      const contentType = proxyResponse.headers.get("content-type") ?? ""
      const size = new TextEncoder().encode(body).length
      patch({
        response: {
          status: proxyResponse.status,
          statusText: proxyResponse.statusText,
          headers: [...proxyResponse.headers.entries()].filter(
            ([key]) => !isInfrastructureHeader(key),
          ),
          body,
          contentType,
          durationMs: Math.round(performance.now() - started),
          size,
        },
        responseView: "pretty",
      })
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        patch({ error: "请求已取消" })
      } else {
        patch({ error: `请求失败：${describeError(requestError)}` })
      }
    } finally {
      patch({ sending: false, abortController: null })
    }
  }

  const copyResponse = async () => {
    if (!session.response) return
    try {
      await navigator.clipboard.writeText(responseText)
      patch({ copied: true })
      window.setTimeout(() => patch({ copied: false }), 1500)
    } catch {
      patch({ error: "复制失败，请检查浏览器剪贴板权限" })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>请求配置</CardTitle>
            <Button size="sm" variant="ghost" onClick={clearRequest} disabled={session.sending}>
              <Eraser /> 清空
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor={`http-url-${session.id}`} className="text-xs font-medium text-muted-foreground">
              请求地址
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label="HTTP 方法"
                value={session.method}
                onChange={(event) => patch({ method: event.target.value as HttpMethod })}
                className={cn(inputCls, "w-full shrink-0 font-mono sm:w-28")}
                disabled={session.sending}
              >
                {HTTP_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
              <input
                id={`http-url-${session.id}`}
                value={session.url}
                onChange={(event) => patch({ url: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void sendRequest()
                }}
                placeholder="https://example.com/api"
                spellCheck={false}
                className={cn(inputCls, "min-w-0 flex-1 font-mono text-xs")}
                disabled={session.sending}
              />
              {session.sending ? (
                <Button variant="destructive" onClick={() => session.abortController?.abort()}>
                  <Square /> 停止
                </Button>
              ) : (
                <Button onClick={() => void sendRequest()} disabled={!session.url.trim()}>
                  <Send /> 发送请求
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              请求统一经 Rust 后端代理转发，目标服务无需开启 CORS。
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div role="tablist" aria-label="请求附加信息" className="flex border-b">
              <button
                type="button"
                role="tab"
                aria-selected={requestTab === "headers"}
                onClick={() => setRequestTab("headers")}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium",
                  requestTab === "headers"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Headers
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {session.headers.length}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={requestTab === "cookies"}
                onClick={() => setRequestTab("cookies")}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium",
                  requestTab === "cookies"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Cookies
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {session.cookies.length}
                </span>
              </button>
            </div>

            {requestTab === "headers" ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground">请求 Headers</h3>
                <p className="mt-1 text-xs text-muted-foreground">未勾选的行不会发送；Content-Type 在下方单独设置。</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onPatch((current) => ({
                    headers: [
                      ...current.headers,
                      { id: crypto.randomUUID(), key: "", value: "", enabled: true },
                    ],
                  }))
                }
                disabled={session.sending}
              >
                添加 Header
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {session.headers.map((header) => (
                <div key={header.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={header.enabled}
                    onChange={(event) => updateHeader(header.id, { enabled: event.target.checked })}
                    aria-label="启用 Header"
                    className="size-3.5 shrink-0 accent-primary"
                    disabled={session.sending}
                  />
                  <input
                    value={header.key}
                    onChange={(event) => updateHeader(header.id, { key: event.target.value })}
                    placeholder="Header 名称"
                    spellCheck={false}
                    className={cn(inputCls, "min-w-0 flex-1 font-mono text-xs")}
                    disabled={session.sending}
                  />
                  <input
                    value={header.value}
                    onChange={(event) => updateHeader(header.id, { value: event.target.value })}
                    placeholder="Header 值"
                    spellCheck={false}
                    className={cn(inputCls, "min-w-0 flex-[1.5] font-mono text-xs")}
                    disabled={session.sending}
                  />
                  <button
                    type="button"
                    title="删除 Header"
                    onClick={() => removeHeader(header.id)}
                    className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                    disabled={session.sending}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
                {session.headers.length === 0 && (
                  <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                    暂无自定义 Header
                  </p>
                )}
              </div>
            </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground">请求 Cookies</h3>
                <p className="mt-1 text-xs text-muted-foreground">启用的 Cookie 会合并为目标请求的 Cookie Header。</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onPatch((current) => ({
                    cookies: [
                      ...current.cookies,
                      { id: crypto.randomUUID(), name: "", value: "", enabled: true },
                    ],
                  }))
                }
                disabled={session.sending}
              >
                添加 Cookie
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {session.cookies.map((cookie) => (
                <div key={cookie.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cookie.enabled}
                    onChange={(event) =>
                      onPatch((current) => ({
                        cookies: current.cookies.map((item) =>
                          item.id === cookie.id ? { ...item, enabled: event.target.checked } : item,
                        ),
                      }))
                    }
                    aria-label="启用 Cookie"
                    className="size-3.5 shrink-0 accent-primary"
                    disabled={session.sending}
                  />
                  <input
                    value={cookie.name}
                    onChange={(event) =>
                      onPatch((current) => ({
                        cookies: current.cookies.map((item) =>
                          item.id === cookie.id ? { ...item, name: event.target.value } : item,
                        ),
                      }))
                    }
                    placeholder="Cookie 名称"
                    spellCheck={false}
                    className={cn(inputCls, "min-w-0 flex-1 font-mono text-xs")}
                    disabled={session.sending}
                  />
                  <input
                    value={cookie.value}
                    onChange={(event) =>
                      onPatch((current) => ({
                        cookies: current.cookies.map((item) =>
                          item.id === cookie.id ? { ...item, value: event.target.value } : item,
                        ),
                      }))
                    }
                    placeholder="Cookie 值"
                    spellCheck={false}
                    className={cn(inputCls, "min-w-0 flex-[1.5] font-mono text-xs")}
                    disabled={session.sending}
                  />
                  <button
                    type="button"
                    title="删除 Cookie"
                    onClick={() =>
                      onPatch((current) => ({
                        cookies: current.cookies.filter((item) => item.id !== cookie.id),
                      }))
                    }
                    className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                    disabled={session.sending}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
                {session.cookies.length === 0 && (
                  <p className="rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                    暂无 Cookie
                  </p>
                )}
              </div>
            </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={`http-content-type-${session.id}`} className="text-xs font-medium text-muted-foreground">
              Content-Type
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                id={`http-content-type-${session.id}`}
                value={contentTypeSelectValue}
                onChange={(event) =>
                  patch({
                    contentType:
                      event.target.value === "__custom__"
                        ? "application/octet-stream"
                        : event.target.value,
                  })
                }
                className={cn(inputCls, "w-full sm:w-72")}
                disabled={session.sending || !bodyAllowed}
              >
                <option value="application/json">application/json</option>
                <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                <option value="text/plain">text/plain</option>
                <option value="text/xml">text/xml</option>
                <option value="">不设置</option>
                <option value="__custom__">自定义</option>
              </select>
              {!STANDARD_CONTENT_TYPES.includes(session.contentType) && session.contentType !== "" && (
                <input
                  value={session.contentType}
                  onChange={(event) => patch({ contentType: event.target.value })}
                  placeholder="例如 application/graphql"
                  spellCheck={false}
                  className={cn(inputCls, "min-w-0 flex-1 font-mono text-xs")}
                  disabled={session.sending || !bodyAllowed}
                />
              )}
            </div>
            {!bodyAllowed && (
              <p className="text-xs text-muted-foreground">{session.method} 请求通常不携带请求体。</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={`http-body-${session.id}`} className="text-xs font-medium text-muted-foreground">
                请求 Body
              </label>
              {bodyAllowed && (
                <Button size="sm" variant="ghost" onClick={prettyPrintRequest} disabled={session.sending || !session.body.trim()}>
                  <FileJson /> 格式化 JSON
                </Button>
              )}
            </div>
            <textarea
              id={`http-body-${session.id}`}
              value={session.body}
              onChange={(event) => patch({ body: event.target.value })}
              placeholder={bodyAllowed ? '{\n  "key": "value"\n}' : "当前方法不发送请求体"}
              spellCheck={false}
              className={cn(inputCls, "h-40 w-full resize-y py-2 font-mono text-xs leading-relaxed")}
              disabled={session.sending || !bodyAllowed}
            />
          </div>

          {session.error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {session.error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>响应</CardTitle>
            {session.response && (
              <div className="flex items-center gap-2">
                <span className={cn("font-mono text-sm font-semibold", statusClass(session.response.status))}>
                  {session.response.status} {session.response.statusText || ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {session.response.durationMs} ms · {formatBytes(session.response.size)}
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!session.response ? (
            <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              发送请求后在这里查看响应内容
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <details className="group rounded-md border" open>
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium">
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  响应 Headers
                  <span className="text-xs font-normal text-muted-foreground">{session.response.headers.length}</span>
                </summary>
                <div className="border-t px-3 py-2">
                  <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                    {session.response.headers.length > 0
                      ? session.response.headers.map(([key, value]) => `${key}: ${value}`).join("\n")
                      : "（代理未透传响应 Headers）"}
                  </pre>
                </div>
              </details>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 rounded-md border p-0.5">
                    <button
                      type="button"
                      onClick={() => patch({ responseView: "pretty" })}
                      disabled={!canFormatResponse}
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        session.responseView === "pretty" ? "bg-accent font-medium" : "text-muted-foreground",
                        !canFormatResponse && "cursor-not-allowed opacity-50",
                      )}
                    >
                      格式化
                    </button>
                    <button
                      type="button"
                      onClick={() => patch({ responseView: "raw" })}
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        session.responseView === "raw" ? "bg-accent font-medium" : "text-muted-foreground",
                      )}
                    >
                      原始
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{session.response.contentType || "未知 Content-Type"}</span>
                    <Button size="sm" variant="ghost" onClick={() => void copyResponse()}>
                      {session.copied ? <Check /> : <Copy />}
                      {session.copied ? "已复制" : "复制"}
                    </Button>
                  </div>
                </div>
                <pre className="max-h-128 min-h-40 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md bg-muted/40 p-4 font-mono text-xs leading-relaxed">
                  {responseText || "（空响应）"}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        请求配置会自动保存到当前工具配置中，响应内容不会持久化。
      </p>
    </div>
  )
}

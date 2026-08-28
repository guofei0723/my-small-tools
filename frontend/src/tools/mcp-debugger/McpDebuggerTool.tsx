import { Plus, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Card, CardContent } from "@/components/ui/card"
import type { McpTransportType } from "@/lib/mcp/types"
import { usePersistedState } from "@/lib/storage/usePersistedState"
import { cn } from "@/lib/utils"

import { McpSessionView, type McpSession, type SessionUpdater } from "./McpSessionView"

/** 新建一个空会话（状态均为默认值，url 预填常用本地地址） */
function createSession(): McpSession {
  return {
    id: crypto.randomUUID(),
    label: "",
    url: "http://localhost:3001/mcp",
    transport: "http",
    useProxy: true,
    headersText: "",
    showHeaders: true,
    status: "idle",
    client: null,
    serverInfo: null,
    tools: [],
    selectedToolName: null,
    search: "",
    argsText: "{}",
    argsError: null,
    calling: false,
    callResult: null,
    error: null,
    logs: [],
  }
}

/** 持久化到 IndexedDB 的会话配置（仅稳定配置字段，剥离全部运行态） */
export interface McpPersistedSession {
  id: string
  /** tab 标签名：连接成功拿到服务器名后写入并持久化 */
  label: string
  url: string
  transport: McpTransportType
  useProxy: boolean
  headersText: string
  showHeaders: boolean
}

/** 工具级持久化文档：会话配置列表 + 上次激活的会话 */
interface McpPersistedState {
  sessions: McpPersistedSession[]
  activeId: string | null
}

const MCP_STORAGE_KEY = "mcp-debugger:state"

/** 会话 → 持久化快照（剥离连接实例/工具列表/日志等运行态字段） */
function toPersisted(session: McpSession): McpPersistedSession {
  return {
    id: session.id,
    label: sessionLabel(session),
    url: session.url,
    transport: session.transport,
    useProxy: session.useProxy,
    headersText: session.headersText,
    showHeaders: session.showHeaders,
  }
}

/** 持久化快照 → 完整会话（其余字段取 createSession 默认值） */
function fromPersisted(persisted: McpPersistedSession): McpSession {
  return { ...createSession(), ...persisted }
}

/** tab 标签：优先持久化的 label（连接后为服务器名），否则显示 url 的 host */
function sessionLabel(session: McpSession): string {
  if (session.label) return session.label
  const host = session.url.replace(/^https?:\/\//i, "").split("/")[0]
  return host || "新连接"
}

const statusDotClass = {
  idle: "bg-zinc-400",
  connecting: "animate-pulse bg-amber-500",
  connected: "bg-emerald-500",
} as const

export function McpDebuggerTool() {
  const [sessions, setSessions] = useState<McpSession[]>(() => [createSession()])
  const [activeId, setActiveId] = useState<string | null>(null)

  // ---- IndexedDB 持久化：只保存配置快照，不保存运行态 ----
  const {
    value: persisted,
    setValue: setPersisted,
    loaded,
  } = usePersistedState<McpPersistedState>(MCP_STORAGE_KEY, {
    sessions: [],
    activeId: null,
  })

  // 初次读取完成后用持久化配置回填会话（只水合一次，之后以用户操作为准）
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!loaded || hydratedRef.current) return
    hydratedRef.current = true
    if (persisted.sessions.length > 0) {
      setSessions(persisted.sessions.map(fromPersisted))
      setActiveId(persisted.activeId)
    }
  }, [loaded, persisted])

  // 会话或激活 tab 变化后写入（写入由 hook 防抖，卸载时自动冲刷）
  useEffect(() => {
    if (!loaded) return
    setPersisted({
      sessions: sessions.map(toPersisted),
      activeId,
    })
  }, [sessions, activeId, loaded, setPersisted])

  const activeSession =
    sessions.find((session) => session.id === activeId) ?? sessions[0]

  const updateSession = useCallback((id: string, updater: SessionUpdater) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== id) return session
        const patch = typeof updater === "function" ? updater(session) : updater
        return { ...session, ...patch }
      }),
    )
  }, [])

  const addSession = () => {
    const session = createSession()
    setSessions((prev) => [...prev, session])
    setActiveId(session.id)
  }

  const closeSession = (id: string) => {
    const index = sessions.findIndex((session) => session.id === id)
    const session = sessions[index]
    session?.client?.disconnect()
    const remaining = sessions.filter((session) => session.id !== id)
    setSessions(remaining)
    if (activeId === id) {
      const neighbor = remaining[Math.min(index, remaining.length - 1)]
      setActiveId(neighbor?.id ?? null)
    }
  }

  return (
    <Card>
      {/* 会话 tab 栏：sticky 固定在滚动视口顶部，仅内容区滚动 */}
      <CardContent>
        <div className="sticky top-0 z-10 -mx-6 border-b bg-card px-6 pb-2 pt-3">
          <div className="flex flex-wrap items-end gap-1">
            {sessions.map((session) => {
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
                  <span
                    className={cn("size-2 shrink-0 rounded-full", statusDotClass[session.status])}
                  />
                  <button
                    type="button"
                    className="max-w-40 truncate"
                    title={session.url}
                    onClick={() => setActiveId(session.id)}
                  >
                    {sessionLabel(session)}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeSession(session.id)}
                    title="关闭连接"
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
              <Plus className="size-4" /> 新建连接
            </button>
          </div>
        </div>

        {/* 会话内容：所有 tab 保持挂载（切换不丢状态），非激活的隐藏 */}
        <div className="mt-5">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(session.id === activeSession.id ? "" : "hidden")}
            >
              <McpSessionView
                session={session}
                onPatch={(updater) => updateSession(session.id, updater)}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

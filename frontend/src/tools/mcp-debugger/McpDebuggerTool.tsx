import { Plus, X } from "lucide-react"
import { useCallback, useState } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import { McpSessionView, type McpSession, type SessionUpdater } from "./McpSessionView"

/** 新建一个空会话（状态均为默认值，url 预填常用本地地址） */
function createSession(): McpSession {
  return {
    id: crypto.randomUUID(),
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

/** tab 标签：连接后显示服务器名，未连接显示 host */
function sessionLabel(session: McpSession): string {
  if (session.serverInfo) return session.serverInfo.serverInfo.name
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

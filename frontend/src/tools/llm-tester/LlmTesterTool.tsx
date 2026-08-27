import { Plus, X } from "lucide-react"
import { useCallback, useState } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import {
  LlmSessionView,
  PROVIDER_PRESETS,
  type LlmSession,
  type SessionUpdater,
} from "./LlmSessionView"

/** 新建一个空会话（状态均为默认值） */
function createSession(): LlmSession {
  return {
    id: crypto.randomUUID(),
    provider: "custom",
    baseUrl: "",
    apiKey: "",
    extraHeadersText: "",
    useProxy: true,
    showAdvanced: false,
    testing: false,
    connectionMessage: null,
    models: [],
    model: "",
    systemPrompt: "",
    showSystem: false,
    temperature: "0.7",
    maxTokens: "2048",
    streamEnabled: true,
    messages: [],
    input: "",
    sending: false,
    streamingReply: null,
    liveReasoning: "",
    reasoningInProgress: false,
    abortController: null,
    metrics: null,
    rawResponse: null,
    logs: [],
    error: null,
  }
}

/** tab 标签：有地址显示 host，否则显示提供商名 */
function sessionLabel(session: LlmSession): string {
  if (session.baseUrl) {
    const host = session.baseUrl.replace(/^https?:\/\//i, "").split("/")[0]
    if (host) return host
  }
  return (
    PROVIDER_PRESETS.find((preset) => preset.id === session.provider)?.name ??
    "新连接"
  )
}

const statusDotClass = {
  idle: "bg-zinc-400",
  streaming: "animate-pulse bg-amber-500",
} as const

export function LlmTesterTool() {
  const [sessions, setSessions] = useState<LlmSession[]>(() => [createSession()])
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
    // 中断该会话进行中的请求（流式/连接测试）
    session?.abortController?.abort()
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
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      statusDotClass[session.sending ? "streaming" : "idle"],
                    )}
                  />
                  <button
                    type="button"
                    className="max-w-40 truncate"
                    title={session.baseUrl || session.provider}
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
              <LlmSessionView
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

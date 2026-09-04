import { Plus, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { usePersistedState } from "@/lib/storage/usePersistedState"
import { cn } from "@/lib/utils"

import {
  HttpSessionView,
  createHttpSession,
  fromPersisted,
  sessionEndpoint,
  sessionLabel,
  sessionUrl,
  toPersisted,
  type HttpPersistedSession,
  type HttpSession,
  type SessionUpdater,
} from "./HttpSessionView"

interface HttpPersistedState {
  sessions: HttpPersistedSession[]
  activeId: string | null
}

interface LegacyHttpRequestConfig extends HttpPersistedSession {}

const HTTP_STORAGE_KEY = "http-client:request"
const INITIAL_PERSISTED_STATE: HttpPersistedState = {
  sessions: [],
  activeId: null,
}

const statusDotClass = {
  idle: "bg-zinc-400",
  sending: "animate-pulse bg-amber-500",
  response: "bg-emerald-500",
  error: "bg-red-500",
} as const

function isPersistedState(value: unknown): value is HttpPersistedState {
  if (!value || typeof value !== "object") return false
  const candidate = value as { sessions?: unknown; activeId?: unknown }
  return Array.isArray(candidate.sessions) && (candidate.activeId === null || typeof candidate.activeId === "string")
}

function isLegacyRequest(value: unknown): value is LegacyHttpRequestConfig {
  if (!value || typeof value !== "object") return false
  const candidate = value as { url?: unknown; method?: unknown; headers?: unknown }
  return typeof candidate.url === "string" && typeof candidate.method === "string" && Array.isArray(candidate.headers)
}

function getStatusDot(session: HttpSession): string {
  if (session.sending) return statusDotClass.sending
  if (session.error) return statusDotClass.error
  if (session.response) return statusDotClass.response
  return statusDotClass.idle
}

export function HttpClientTool() {
  const [sessions, setSessions] = useState<HttpSession[]>(() => [createHttpSession()])
  const [activeId, setActiveId] = useState<string | null>(null)
  const {
    value: persisted,
    setValue: setPersisted,
    loaded,
  } = usePersistedState<HttpPersistedState>(HTTP_STORAGE_KEY, INITIAL_PERSISTED_STATE)

  const hydratedRef = useRef(false)
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (!loaded || hydratedRef.current) return
    hydratedRef.current = true

    if (isPersistedState(persisted) && persisted.sessions.length > 0) {
      setSessions(persisted.sessions.map(fromPersisted))
      setActiveId(persisted.activeId)
    } else if (isLegacyRequest(persisted)) {
      const migrated = fromPersisted(persisted)
      setSessions([migrated])
      setActiveId(migrated.id)
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

  const updateSession = useCallback((id: string, updater: SessionUpdater) => {
    setSessions((previous) =>
      previous.map((session) => {
        if (session.id !== id) return session
        const patch = typeof updater === "function" ? updater(session) : updater
        const next = { ...session, ...patch }
        return { ...next, label: sessionLabel(next) }
      }),
    )
  }, [])

  const addSession = () => {
    const session = createHttpSession()
    setSessions((previous) => [...previous, session])
    setActiveId(session.id)
  }

  const closeSession = (id: string) => {
    const index = sessions.findIndex((session) => session.id === id)
    const session = sessions[index]
    session?.abortController?.abort()
    const remaining = sessions.filter((item) => item.id !== id)
    setSessions(remaining)

    if (activeId === id) {
      const neighbor = remaining[Math.min(index, remaining.length - 1)]
      setActiveId(neighbor?.id ?? null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent>
          <div className="sticky top-0 z-10 -mx-6 border-b bg-card px-6 pb-2 pt-3">
            <div className="flex flex-wrap items-end gap-1">
              {sessions.map((session) => {
                const isActive = session.id === activeSession?.id
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
                    <span className={cn("size-2 shrink-0 rounded-full", getStatusDot(session))} />
                    <button
                      type="button"
                      title={session.url || "新请求"}
                      onClick={() => setActiveId(session.id)}
                      className="min-w-0 max-w-52 text-left"
                    >
                      <span className="block truncate font-mono text-xs font-medium">
                        {sessionEndpoint(session)}
                      </span>
                      <span className="block max-w-64 truncate text-[11px] text-muted-foreground">
                        {sessionUrl(session)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => closeSession(session.id)}
                      title="关闭请求"
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
                <Plus className="size-4" /> 新建请求
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {sessions.map((session) => (
        <div key={session.id} className={cn(session.id === activeSession?.id ? "" : "hidden")}>
          <HttpSessionView
            session={session}
            onPatch={(updater) => updateSession(session.id, updater)}
          />
        </div>
      ))}
    </div>
  )
}

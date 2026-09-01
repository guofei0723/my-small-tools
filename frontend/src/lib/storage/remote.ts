/**
 * 后端配置存储（SQLCipher/AES 加密 SQLite）的远程 API + 全局锁门状态机。
 *
 * 状态机：ensureConfigGate() 检查 /api/config/status ——
 * - 未初始化 → 触发 bootstrap（设置口令）弹窗
 * - 已锁定 → 触发 unlock（输入口令）弹窗
 * - 正常 → 直接放行
 * 弹窗由 ConfigStorageBanner 渲染，通过 resolveGate() 结束等待。
 * 后端不可达时静默降级为本地 IndexedDB（fallback）。
 */

export interface ConfigStatus {
  /** 配置库是否已初始化（meta 表中存在盐） */
  initialized: boolean
  /** 是否锁定（本机钥匙串无口令） */
  locked: boolean
}

export type RemoteResult<T> =
  | { status: "ok"; value: T }
  | { status: "not-found" }
  | { status: "locked" }
  | { status: "error" }

/** 当前需要用户交互的「锁门」请求 */
export type GateRequest = "bootstrap" | "unlock" | null
/** 锁门结束方式：ok=已解锁/已初始化；fallback=用户选择本地缓存 */
export type GateResult = { ok: true } | { ok: false; fallback: true }

// ---- 锁门状态机（模块级，供多个 hook 实例共享，Banner 组件驱动） ----

let gateRequest: GateRequest = null
let gateResolvers: Array<(result: GateResult) => void> = []
const gateListeners = new Set<() => void>()
/** 用户本次会话内选择过「本地缓存」则不再弹窗 */
let gateDismissed = false

export function getGateRequest(): GateRequest {
  return gateRequest
}

export function subscribeGate(listener: () => void): () => void {
  gateListeners.add(listener)
  return () => {
    gateListeners.delete(listener)
  }
}

function notifyGate() {
  for (const listener of gateListeners) listener()
}

/** Banner 组件在用户完成交互后调用：结束所有等待中的 ensureConfigGate() */
export function resolveGate(result: GateResult) {
  if (!result.ok) gateDismissed = true
  if (result.ok) {
    // bootstrap/unlock 成功：使 status 缓存失效，后续工具挂载时重新获取
    // （否则同一会话内切换工具会拿着旧的「未初始化」状态再次弹窗）
    statusCache = null
  }
  gateRequest = null
  const resolvers = gateResolvers
  gateResolvers = []
  notifyGate()
  for (const resolve of resolvers) resolve(result)
}

// ---- 状态查询与锁门 ----

let statusCache: Promise<ConfigStatus> | null = null

/** 获取后端配置库状态（成功后在会话内缓存；失败自动失效以便重试） */
export function fetchConfigStatus(): Promise<ConfigStatus> {
  if (!statusCache) {
    statusCache = fetch("/api/config/status")
      .then((resp) => {
        if (!resp.ok) throw new Error(`status ${resp.status}`)
        return resp.json() as Promise<ConfigStatus>
      })
      .catch((err) => {
        statusCache = null
        throw err
      })
  }
  return statusCache
}

/**
 * 确保配置库可用后再继续读写。
 * - 后端可达且已解锁 → 直接放行
 * - 未初始化 / 已锁定 → 触发对应弹窗，等待用户操作（解锁成功放行 / 选择本地缓存降级）
 * - 后端不可达 → 立即降级本地存储
 */
export async function ensureConfigGate(): Promise<GateResult> {
  try {
    const status = await fetchConfigStatus()
    if (status.initialized && !status.locked) return { ok: true }
    if (gateDismissed) return { ok: false, fallback: true }
    gateRequest = status.initialized ? "unlock" : "bootstrap"
    notifyGate()
    return await new Promise<GateResult>((resolve) => gateResolvers.push(resolve))
  } catch {
    return { ok: false, fallback: true }
  }
}

// ---- 键值读写 ----

export async function remoteGet<T>(key: string): Promise<RemoteResult<T>> {
  try {
    const resp = await fetch(`/api/config/${encodeURIComponent(key)}`)
    if (resp.status === 200) return { status: "ok", value: (await resp.json()) as T }
    if (resp.status === 404) return { status: "not-found" }
    if (resp.status === 423) return { status: "locked" }
    return { status: "error" }
  } catch {
    return { status: "error" }
  }
}

export type WriteResult = "ok" | "locked" | "error"

export async function remoteSet(key: string, value: unknown): Promise<WriteResult> {
  try {
    const resp = await fetch(`/api/config/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    })
    if (resp.ok) return "ok"
    if (resp.status === 423) return "locked"
    return "error"
  } catch {
    return "error"
  }
}

export async function remoteDelete(key: string): Promise<WriteResult> {
  try {
    const resp = await fetch(`/api/config/${encodeURIComponent(key)}`, {
      method: "DELETE",
    })
    if (resp.ok) return "ok"
    if (resp.status === 423) return "locked"
    return "error"
  } catch {
    return "error"
  }
}

// ---- bootstrap / unlock ----

export type PassphraseResult = "ok" | "wrong" | "error"

/** 首次使用：设置口令并初始化加密配置库 */
export async function bootstrapConfig(passphrase: string): Promise<PassphraseResult> {
  try {
    const resp = await fetch("/api/config/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    })
    if (resp.ok) return "ok"
    return "error"
  } catch {
    return "error"
  }
}

/** 新机器迁移：输入口令解锁并写入本机钥匙串 */
export async function unlockConfig(passphrase: string): Promise<PassphraseResult> {
  try {
    const resp = await fetch("/api/config/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    })
    if (resp.ok) return "ok"
    if (resp.status === 401) return "wrong"
    return "error"
  } catch {
    return "error"
  }
}

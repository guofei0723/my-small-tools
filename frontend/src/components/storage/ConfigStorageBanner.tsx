import { useState, useSyncExternalStore } from "react"
import { Check, Copy, KeyRound, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  bootstrapConfig,
  getGateRequest,
  resolveGate,
  subscribeGate,
  unlockConfig,
} from "@/lib/storage/remote"
import { cn } from "@/lib/utils"

const inputCls =
  "h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50"

/** 生成一个强随机口令（40 位十六进制），便于复制进密码管理器 */
function generatePassphrase(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40)
}

/**
 * 配置存储锁门弹窗：挂载于 AppLayout，由 remote.ts 的 gate 状态机驱动。
 * - bootstrap：首次使用，设置配置库口令（启用加密存储）
 * - unlock：新机器迁移，输入口令解锁并写入本机钥匙串
 * 也可「改用本地缓存」降级为 IndexedDB（本会话不再提示）。
 */
export function ConfigStorageBanner() {
  const request = useSyncExternalStore(subscribeGate, getGateRequest)
  const [passphrase, setPassphrase] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!request) return null
  const isBootstrap = request === "bootstrap"

  const handleSubmit = async () => {
    setBusy(true)
    setError(null)
    const result = isBootstrap
      ? await bootstrapConfig(passphrase)
      : await unlockConfig(passphrase)
    setBusy(false)
    if (result === "ok") {
      resolveGate({ ok: true })
      setPassphrase("")
      return
    }
    if (result === "wrong") setError("口令不正确，请重试")
    else setError("操作失败，请确认后端服务已启动")
  }

  const handleDismiss = () => {
    resolveGate({ ok: false, fallback: true })
    setPassphrase("")
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(passphrase)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时忽略（用户可手动选择复制）
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-2">
          {isBootstrap ? (
            <ShieldCheck className="size-4 text-primary" />
          ) : (
            <KeyRound className="size-4 text-primary" />
          )}
          <h2 className="text-sm font-semibold">
            {isBootstrap ? "初始化加密配置存储" : "配置库已锁定"}
          </h2>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {isBootstrap ? (
            <>
              首次使用：为配置库设置口令（至少 8 位）。<b>所有工具共用一个配置库口令</b>，
              口令经 PBKDF2 派生密钥，配置将加密保存在后端，请把口令存入你的密码管理器——
              遗忘后数据不可恢复。
            </>
          ) : (
            <>
              该机器尚未保存配置库口令（新机器迁移：拷贝 config.db + 口令）。
              <b>所有工具共用一个口令</b>，输入后会自动写入本机钥匙串，之后无需再输。
            </>
          )}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && passphrase.length >= 8 && !busy) handleSubmit()
            }}
            placeholder={isBootstrap ? "设置配置库口令" : "输入配置库口令"}
            className={cn(inputCls, "min-w-0 flex-1 font-mono text-xs")}
            autoFocus
          />
          {isBootstrap && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPassphrase(generatePassphrase())}
              title="生成强随机口令"
            >
              生成
            </Button>
          )}
          {isBootstrap && passphrase && (
            <Button type="button" variant="outline" size="sm" onClick={handleCopy} title="复制口令">
              {copied ? <Check /> : <Copy />}
            </Button>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleDismiss}>
            改用本地缓存
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={busy || passphrase.length < 8}
          >
            {busy ? "处理中…" : isBootstrap ? "启用加密存储" : "解锁"}
          </Button>
        </div>
      </div>
    </div>
  )
}

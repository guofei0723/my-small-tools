import { Check, Copy, RefreshCw, ShieldCheck } from "lucide-react"
import { useCallback, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

const CHARSETS = {
  alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  "url-safe": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  hex: "0123456789abcdef",
} as const

type CharsetId = keyof typeof CHARSETS

const CHARSET_LABELS: Record<CharsetId, string> = {
  alphanumeric: "字母和数字",
  "url-safe": "URL 安全字符",
  hex: "十六进制",
}

const DEFAULT_COUNT = 5
const DEFAULT_LENGTH = 32
const DEFAULT_PREFIX = "sk-"

function normalizeLength(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(128, Math.max(8, Math.trunc(parsed)))
    : 8
}

function generateRandomPart(length: number, charset: string): string {
  let result = ""
  const maxUnbiasedValue = Math.floor(0x100000000 / charset.length) * charset.length
  const randomValues = new Uint32Array(32)

  while (result.length < length) {
    crypto.getRandomValues(randomValues)
    for (const value of randomValues) {
      if (value >= maxUnbiasedValue) continue
      result += charset[value % charset.length]
      if (result.length === length) break
    }
  }

  return result
}

function generateKeys(
  count: number,
  length: number,
  prefix: string,
  charset: CharsetId,
): string[] {
  return Array.from({ length: count }, () =>
    `${prefix}${generateRandomPart(length, CHARSETS[charset])}`,
  )
}

export function ApiKeyGeneratorTool() {
  const [count, setCount] = useState(DEFAULT_COUNT)
  const [length, setLength] = useState(String(DEFAULT_LENGTH))
  const [prefix, setPrefix] = useState(DEFAULT_PREFIX)
  const [charset, setCharset] = useState<CharsetId>("alphanumeric")
  const [keys, setKeys] = useState(() =>
    generateKeys(DEFAULT_COUNT, DEFAULT_LENGTH, DEFAULT_PREFIX, "alphanumeric"),
  )
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)

  const regenerate = useCallback(() => {
    const normalizedLength = normalizeLength(length)
    setLength(String(normalizedLength))
    setKeys(generateKeys(count, normalizedLength, prefix, charset))
    setCopiedIndex(null)
    setCopiedAll(false)
  }, [charset, count, length, prefix])

  const copySingle = useCallback(async (value: string, index: number) => {
    await navigator.clipboard.writeText(value)
    setCopiedIndex(index)
    setCopiedAll(false)
  }, [])

  const copyAll = useCallback(async () => {
    await navigator.clipboard.writeText(keys.join("\n"))
    setCopiedIndex(null)
    setCopiedAll(true)
  }, [keys])

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Key 生成器</CardTitle>
        <CardDescription>
          使用 Web Crypto 安全随机生成 API Key，不会上传或保存任何密钥
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label
              htmlFor="api-key-prefix"
              className="mb-1.5 block text-xs text-muted-foreground"
            >
              前缀
            </label>
            <input
              id="api-key-prefix"
              value={prefix}
              maxLength={32}
              onChange={(event) => setPrefix(event.target.value)}
              placeholder="例如 sk-"
              className="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>
          <div>
            <label
              htmlFor="api-key-length"
              className="mb-1.5 block text-xs text-muted-foreground"
            >
              随机部分长度
            </label>
            <input
              id="api-key-length"
              type="number"
              min={8}
              max={128}
              value={length}
              onChange={(event) => setLength(event.target.value)}
              onBlur={() => setLength(String(normalizeLength(length)))}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>
          <div>
            <label
              htmlFor="api-key-count"
              className="mb-1.5 block text-xs text-muted-foreground"
            >
              数量
            </label>
            <input
              id="api-key-count"
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(event) => {
                const value = Math.min(50, Math.max(1, Number(event.target.value) || 1))
                setCount(value)
              }}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>
          <div>
            <label
              htmlFor="api-key-charset"
              className="mb-1.5 block text-xs text-muted-foreground"
            >
              字符集
            </label>
            <select
              id="api-key-charset"
              value={charset}
              onChange={(event) => setCharset(event.target.value as CharsetId)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              {Object.entries(CHARSET_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={regenerate}>
            <RefreshCw />
            生成 API Key
          </Button>
          <Button variant="outline" onClick={copyAll}>
            {copiedAll ? <Check /> : <Copy />}
            {copiedAll ? "已复制全部" : "复制全部"}
          </Button>
        </div>

        <ul className="mt-4 flex flex-col gap-2">
          {keys.map((key, index) => (
            <li
              key={`${key}-${index}`}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <code className="min-w-0 flex-1 break-all font-mono text-sm">{key}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copySingle(key, index)}
                className={cn(copiedIndex === index && "text-emerald-600")}
              >
                {copiedIndex === index ? <Check /> : <Copy />}
                {copiedIndex === index ? "已复制" : "复制"}
              </Button>
            </li>
          ))}
        </ul>

        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          长度指前缀之后的随机字符数，建议生产环境使用至少 32 位随机字符
        </p>
      </CardContent>
    </Card>
  )
}

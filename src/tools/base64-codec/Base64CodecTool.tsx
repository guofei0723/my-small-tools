import { ArrowDownUp, Copy } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type Mode = "encode" | "decode"

/** UTF-8 文本 -> Base64（btoa 只支持 Latin-1，需先转字节） */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/** Base64 -> UTF-8 文本 */
function base64ToUtf8(base64: string): string {
  const binary = atob(base64.trim())
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const PLACEHOLDER: Record<Mode, string> = {
  encode: "输入要编码为 Base64 的文本…",
  decode: "输入要解码的 Base64 字符串…",
}

export function Base64CodecTool() {
  const [mode, setMode] = useState<Mode>("encode")
  const [input, setInput] = useState("")
  const [output, setOutput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleConvert = () => {
    setError(null)
    setCopied(false)
    try {
      setOutput(
        mode === "encode" ? utf8ToBase64(input) : base64ToUtf8(input),
      )
    } catch {
      setError("转换失败：输入内容不是有效的 Base64 字符串")
      setOutput("")
    }
  }

  const swapMode = () => {
    setMode((prev) => (prev === "encode" ? "decode" : "encode"))
    setInput(output)
    setOutput("")
    setError(null)
    setCopied(false)
  }

  const copyOutput = async () => {
    await navigator.clipboard.writeText(output)
    setCopied(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Base64 编解码</CardTitle>
        <CardDescription>
          支持中文等多字节字符（内部按 UTF-8 处理）
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {mode === "encode" ? "文本 → Base64" : "Base64 → 文本"}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConvert}>
              {mode === "encode" ? "编码" : "解码"}
            </Button>
            <Button size="sm" variant="outline" onClick={swapMode}>
              <ArrowDownUp />
              互换方向
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="base64-input"
              className="mb-1.5 block text-xs text-muted-foreground"
            >
              输入
            </label>
            <textarea
              id="base64-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={PLACEHOLDER[mode]}
              rows={8}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">输出</span>
              {output && (
                <Button size="sm" variant="ghost" onClick={copyOutput}>
                  <Copy />
                  {copied ? "已复制" : "复制"}
                </Button>
              )}
            </div>
            <textarea
              readOnly
              value={output}
              placeholder="转换结果将显示在这里…"
              rows={8}
              className="w-full resize-y rounded-md border bg-muted px-3 py-2 font-mono text-sm outline-none"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  )
}

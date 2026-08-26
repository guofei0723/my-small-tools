import { Check, Copy, RefreshCw } from "lucide-react"
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

function generateUuid(): string {
  return crypto.randomUUID()
}

export function UuidGeneratorTool() {
  const [count, setCount] = useState(5)
  const [uuids, setUuids] = useState<string[]>(() =>
    Array.from({ length: 5 }, generateUuid),
  )
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)

  const regenerate = useCallback(() => {
    setUuids(Array.from({ length: count }, generateUuid))
    setCopiedIndex(null)
    setCopiedAll(false)
  }, [count])

  const copySingle = useCallback(async (value: string, index: number) => {
    await navigator.clipboard.writeText(value)
    setCopiedIndex(index)
    setCopiedAll(false)
  }, [])

  const copyAll = useCallback(async () => {
    await navigator.clipboard.writeText(uuids.join("\n"))
    setCopiedIndex(null)
    setCopiedAll(true)
  }, [uuids])

  return (
    <Card>
      <CardHeader>
        <CardTitle>UUID 生成器</CardTitle>
        <CardDescription>基于浏览器 crypto.randomUUID 生成 v4 UUID</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <label htmlFor="uuid-count" className="text-sm">
            数量
          </label>
          <input
            id="uuid-count"
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => {
              const value = Math.min(100, Math.max(1, Number(event.target.value) || 1))
              setCount(value)
            }}
            className="h-9 w-20 rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
          <Button size="sm" onClick={regenerate}>
            <RefreshCw />
            重新生成
          </Button>
          <Button size="sm" variant="outline" onClick={copyAll}>
            {copiedAll ? <Check /> : <Copy />}
            {copiedAll ? "已复制全部" : "复制全部"}
          </Button>
        </div>

        <ul className="mt-4 flex flex-col gap-2">
          {uuids.map((uuid, index) => (
            <li
              key={`${uuid}-${index}`}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <code className="min-w-0 flex-1 truncate font-mono text-sm">
                {uuid}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copySingle(uuid, index)}
                className={cn(copiedIndex === index && "text-emerald-600")}
              >
                {copiedIndex === index ? <Check /> : <Copy />}
                {copiedIndex === index ? "已复制" : "复制"}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

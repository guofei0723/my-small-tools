import { ArrowDownUp } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type Direction = "ts-to-date" | "date-to-ts"

function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

export function TimestampConverterTool() {
  const [direction, setDirection] = useState<Direction>("ts-to-date")
  const [timestamp, setTimestamp] = useState(() => String(Math.floor(Date.now() / 1000)))
  const [dateText, setDateText] = useState(() => formatDateTime(new Date()))
  const [tsError, setTsError] = useState<string | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)

  const nowSeconds = Math.floor(Date.now() / 1000)

  const handleTimestampChange = (value: string) => {
    setTimestamp(value)
    setTsError(null)
    const num = Number(value.trim())
    if (!value.trim() || Number.isNaN(num)) {
      setDateText("")
      setTsError("请输入有效的数字时间戳")
      return
    }
    // 13 位视为毫秒，否则按秒处理
    const ms = value.trim().length >= 13 ? num : num * 1000
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) {
      setDateText("")
      setTsError("无法解析该时间戳")
      return
    }
    setDateText(formatDateTime(date))
  }

  const handleDateChange = (value: string) => {
    setDateText(value)
    setDateError(null)
    const date = new Date(value.replace(" ", "T"))
    if (Number.isNaN(date.getTime())) {
      setTsError(null)
      setDateError("请输入有效日期时间，例如 2026-08-24 12:00:00")
      return
    }
    setDateError(null)
    setTimestamp(String(Math.floor(date.getTime() / 1000)))
  }

  const swapDirection = () => {
    setDirection((prev) => (prev === "ts-to-date" ? "date-to-ts" : "ts-to-date"))
    setTsError(null)
    setDateError(null)
  }

  const useNow = () => {
    setTimestamp(String(nowSeconds))
    handleTimestampChange(String(nowSeconds))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>时间戳转换</CardTitle>
        <CardDescription>
          秒级 / 毫秒级 Unix 时间戳与本地日期时间互相转换
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {direction === "ts-to-date" ? "时间戳 → 日期时间" : "日期时间 → 时间戳"}
          </span>
          <Button size="sm" variant="outline" onClick={swapDirection}>
            <ArrowDownUp />
            互换方向
          </Button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="ts-input"
              className="mb-1.5 block text-xs text-muted-foreground"
            >
              时间戳（秒或毫秒均可）
            </label>
            <input
              id="ts-input"
              type="text"
              inputMode="numeric"
              value={timestamp}
              onChange={(event) => handleTimestampChange(event.target.value)}
              placeholder="例如 1784880000"
              className="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
            <Button size="sm" variant="ghost" className="mt-2" onClick={useNow}>
              使用当前时间戳（{nowSeconds}）
            </Button>
          </div>

          <div>
            <label
              htmlFor="date-input"
              className="mb-1.5 block text-xs text-muted-foreground"
            >
              日期时间（本地时区）
            </label>
            <input
              id="date-input"
              type="text"
              value={dateText}
              onChange={(event) => handleDateChange(event.target.value)}
              placeholder="例如 2026-08-24 12:00:00"
              className="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>
        </div>

        {tsError && <p className="mt-3 text-sm text-destructive">{tsError}</p>}
        {dateError && <p className="mt-3 text-sm text-destructive">{dateError}</p>}
      </CardContent>
    </Card>
  )
}

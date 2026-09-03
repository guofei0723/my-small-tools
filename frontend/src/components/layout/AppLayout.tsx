import { Suspense, useEffect, useState } from "react"

import { ConfigStorageBanner } from "@/components/storage/ConfigStorageBanner"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ToolDefinition } from "@/tools/types"

import { Sidebar } from "./Sidebar"

interface AppLayoutProps {
  tools: ToolDefinition[]
  activeTool: ToolDefinition
  onSelectTool: (id: string) => void
}

export function AppLayout({ tools, activeTool, onSelectTool }: AppLayoutProps) {
  // 访问过的工具保持挂载（切换页面不丢状态），未访问过的仍按需懒加载
  const [visitedIds, setVisitedIds] = useState<string[]>(() => [activeTool.id])

  useEffect(() => {
    setVisitedIds((prev) =>
      prev.includes(activeTool.id) ? prev : [...prev, activeTool.id],
    )
  }, [activeTool.id])

  // 首次进入某工具时它尚不在 visitedIds（effect 尚未运行），需保证本帧渲染
  const shownTools = tools.filter(
    (tool) => tool.id === activeTool.id || visitedIds.includes(tool.id),
  )

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar
        tools={tools}
        activeToolId={activeTool.id}
        onSelectTool={onSelectTool}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b px-6 py-4">
          <h1 className="text-xl font-semibold">{activeTool.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {activeTool.description}
          </p>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-6">
            {/* 工具内容：已访问过的全部保持挂载，仅激活项可见（切换回来状态不丢） */}
            {shownTools.map((tool) => {
              const isActive = tool.id === activeTool.id
              const Component = tool.component
              return (
                <div
                  key={tool.id}
                  className={cn(isActive ? "" : "hidden")}
                  aria-hidden={!isActive}
                >
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                        加载中…
                      </div>
                    }
                  >
                    <Component />
                  </Suspense>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </main>

      {/* 配置存储锁门弹窗（首次设置口令 / 新机器解锁），由 remote.ts gate 驱动 */}
      <ConfigStorageBanner />
    </div>
  )
}

import { Wrench } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { ToolDefinition } from "@/tools/types"

interface SidebarProps {
  tools: ToolDefinition[]
  activeToolId: string
  onSelectTool: (id: string) => void
}

export function Sidebar({ tools, activeToolId, onSelectTool }: SidebarProps) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Wrench className="size-5" />
        <span className="font-semibold">我的小工具</span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-1 p-2">
          {tools.map((tool) => {
            const Icon = tool.icon
            const isActive = tool.id === activeToolId

            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onSelectTool(tool.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{tool.name}</span>
              </button>
            )
          })}
        </nav>
      </ScrollArea>
    </aside>
  )
}

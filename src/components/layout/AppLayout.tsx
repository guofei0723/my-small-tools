import { ScrollArea } from "@/components/ui/scroll-area"
import type { ToolDefinition } from "@/tools/types"

import { Sidebar } from "./Sidebar"

interface AppLayoutProps {
  tools: ToolDefinition[]
  activeTool: ToolDefinition
  onSelectTool: (id: string) => void
}

export function AppLayout({ tools, activeTool, onSelectTool }: AppLayoutProps) {
  const ActiveComponent = activeTool.component

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
            <ActiveComponent />
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}

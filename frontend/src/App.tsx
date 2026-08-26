import { useState } from "react"

import { AppLayout } from "@/components/layout/AppLayout"
import { tools } from "@/tools/registry"

export function App() {
  const [activeToolId, setActiveToolId] = useState(tools[0].id)
  const activeTool = tools.find((tool) => tool.id === activeToolId) ?? tools[0]

  return (
    <AppLayout
      tools={tools}
      activeTool={activeTool}
      onSelectTool={setActiveToolId}
    />
  )
}

import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom"

import { AppLayout } from "@/components/layout/AppLayout"
import { tools } from "@/tools/registry"

/** 当前 URL 对应的工具页：/ 重定向到默认工具，未知 id 同样回退到默认工具 */
function ToolPage() {
  const { toolId } = useParams()
  const navigate = useNavigate()
  const activeTool = tools.find((tool) => tool.id === toolId) ?? null

  if (!activeTool) {
    return <Navigate to={`/${tools[0].id}`} replace />
  }

  return (
    <AppLayout
      tools={tools}
      activeTool={activeTool}
      onSelectTool={(id) => navigate(`/${id}`)}
    />
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/${tools[0].id}`} replace />} />
      <Route path="/:toolId" element={<ToolPage />} />
      <Route path="*" element={<Navigate to={`/${tools[0].id}`} replace />} />
    </Routes>
  )
}

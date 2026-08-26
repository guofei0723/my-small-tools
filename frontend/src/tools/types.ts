import type { ComponentType, LazyExoticComponent } from "react"
import type { LucideIcon } from "lucide-react"

/** 工具渲染组件（懒加载，仅选中时按需加载） */
export type ToolComponent = LazyExoticComponent<ComponentType>

/**
 * 一个工具的完整定义：元数据 + 渲染组件。
 * 新增工具时，在 registry.tsx 中追加一条即可自动出现在左侧列表。
 */
export interface ToolDefinition {
  id: string
  name: string
  description: string
  icon: LucideIcon
  component: ToolComponent
}

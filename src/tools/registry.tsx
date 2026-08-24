import { Binary, Clock3, Fingerprint } from "lucide-react"

import { Base64CodecTool } from "./base64-codec/Base64CodecTool"
import { TimestampConverterTool } from "./timestamp-converter/TimestampConverterTool"
import type { ToolDefinition } from "./types"
import { UuidGeneratorTool } from "./uuid-generator/UuidGeneratorTool"

/** 全部工具注册表：左侧列表按此顺序展示 */
export const tools: ToolDefinition[] = [
  {
    id: "uuid-generator",
    name: "UUID 生成器",
    description: "批量生成 UUID v4，支持单个复制与一键复制全部",
    icon: Fingerprint,
    component: UuidGeneratorTool,
  },
  {
    id: "base64-codec",
    name: "Base64 编解码",
    description: "UTF-8 文本与 Base64 之间的互相转换",
    icon: Binary,
    component: Base64CodecTool,
  },
  {
    id: "timestamp-converter",
    name: "时间戳转换",
    description: "Unix 时间戳与日期时间互相转换（秒 / 毫秒）",
    icon: Clock3,
    component: TimestampConverterTool,
  },
]

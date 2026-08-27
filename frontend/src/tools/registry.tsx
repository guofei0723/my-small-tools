import { lazy } from "react"
import { Binary, Bot, Cable, Clock3, Fingerprint } from "lucide-react"

import type { ToolDefinition } from "./types"

const UuidGeneratorTool = lazy(() =>
  import("./uuid-generator/UuidGeneratorTool").then((module) => ({
    default: module.UuidGeneratorTool,
  })),
)

const Base64CodecTool = lazy(() =>
  import("./base64-codec/Base64CodecTool").then((module) => ({
    default: module.Base64CodecTool,
  })),
)

const TimestampConverterTool = lazy(() =>
  import("./timestamp-converter/TimestampConverterTool").then((module) => ({
    default: module.TimestampConverterTool,
  })),
)

const McpDebuggerTool = lazy(() =>
  import("./mcp-debugger/McpDebuggerTool").then((module) => ({
    default: module.McpDebuggerTool,
  })),
)

const LlmTesterTool = lazy(() =>
  import("./llm-tester/LlmTesterTool").then((module) => ({
    default: module.LlmTesterTool,
  })),
)

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
  {
    id: "mcp-debugger",
    name: "MCP 调试器",
    description:
      "同时连接多个 MCP 服务器，查看工具定义并调用工具（支持 Streamable HTTP 与 SSE 传输；默认经后端代理，目标无需 CORS）",
    icon: Cable,
    component: McpDebuggerTool,
  },
  {
    id: "llm-tester",
    name: "LLM 服务测试器",
    description:
      "测试 OpenAI 兼容的大模型服务：配置连接、流式/非流式对话、分析首 token 延迟与输出速度等性能指标",
    icon: Bot,
    component: LlmTesterTool,
  },
]

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: unknown
}

/** JSON-RPC 2.0 通知（无 id，不期待响应） */
export interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

/** JSON-RPC 2.0 响应 */
export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number | string | null
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

/** initialize 请求参数 */
export interface InitializeParams {
  protocolVersion: string
  capabilities: Record<string, unknown>
  clientInfo: { name: string; version: string }
}

/** initialize 结果 */
export interface InitializeResult {
  protocolVersion: string
  capabilities: Record<string, unknown>
  serverInfo: { name: string; version: string }
  instructions?: string
}

/** MCP 工具定义（tools/list 返回的每一项） */
export interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
}

/** tools/list 结果 */
export interface ListToolsResult {
  tools: McpTool[]
  nextCursor?: string
}

/** tools/call 结果中的内容项 */
export interface McpContentItem {
  type: string
  text?: string
  [key: string]: unknown
}

/** tools/call 结果 */
export interface CallToolResult {
  content: McpContentItem[]
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

/** 传输方式：Streamable HTTP（现代标准）或 老式 SSE */
export type McpTransportType = "http" | "sse"

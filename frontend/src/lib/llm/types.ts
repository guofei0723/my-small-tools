/** OpenAI 兼容 Chat Completions 协议类型（DeepSeek / 通义 / Kimi / Ollama 等均兼容） */

/** 对话角色 */
export type ChatRole = "system" | "user" | "assistant"

export interface ChatMessage {
  role: ChatRole
  content: string
}

/** 会话令牌用量统计 */
export interface CompletionUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/** POST /chat/completions 请求体 */
export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
}

/** 非流式响应 */
export interface ChatCompletion {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: string; content: string | null }
    finish_reason: string | null
  }>
  usage?: CompletionUsage | null
}

/** 流式响应中的单个 SSE chunk */
export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    /** 增量内容；reasoning_content 为 DeepSeek-R1 等模型的推理过程 */
    delta: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
    }
    finish_reason: string | null
  }>
  usage?: CompletionUsage | null
}

/** GET /models 响应中的模型条目 */
export interface ModelInfo {
  id: string
  object?: string
  created?: number
  owned_by?: string
}

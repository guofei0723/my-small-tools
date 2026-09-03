/**
 * LLM token 数量的经验估算（纯前端、无第三方 tokenizer）。
 *
 * 各家模型（OpenAI / DeepSeek / Qwen / Kimi / Ollama 等）的分词器与词表各不相同，
 * 浏览器端无法拿到精确结果，这里只提供界面参考：
 * - 中日韩文字、全角符号等「宽字符」按 1 字符 ≈ 1 token；
 * - 其余字符（英文、数字、半角符号、空白）按约 4 字符 ≈ 1 token。
 *
 * 精确数量请以请求返回的 usage.prompt_tokens / completion_tokens 为准。
 */

/** 中日韩等宽字符（含假名/谚文、CJK 标点、全角形式）是否按 1 字 ≈ 1 token 估算 */
function isWideChar(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意文字
    (code >= 0x20000 && code <= 0x2ebef) || // CJK 扩展 B 及以后
    (code >= 0x3040 && code <= 0x30ff) || // 日文假名
    (code >= 0xac00 && code <= 0xd7af) || // 韩文谚文音节
    (code >= 0x3000 && code <= 0x303f) || // CJK 标点
    (code >= 0xff00 && code <= 0xffef) // 全角形式（含全角字母数字）
  )
}

/** 估算一段文本的 token 数量；空文本返回 0，非空至少为 1 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let wide = 0
  let narrow = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (isWideChar(code)) wide++
    else narrow++
  }
  const tokens = wide + narrow / 4
  return Math.max(1, Math.round(tokens))
}

/**
 * 紧凑的 token 数格式化：千以下显示完整数字，千以上用 k（如 3.2k）。
 * 用于与字节大小（1.3 KB）并排展示时保持简短。
 */
export function formatTokenEstimate(tokens: number): string {
  if (tokens < 1000) return tokens.toLocaleString("zh-CN")
  return `${(tokens / 1000).toFixed(1).replace(/\.0$/, "")}k`
}

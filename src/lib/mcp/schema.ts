/** 从 JSON Schema 中提取的字段信息（用于参数表格展示） */
export interface SchemaField {
  name: string
  required: boolean
  type: string
  description?: string
}

const MAX_EXAMPLE_DEPTH = 4

/**
 * 提取对象 schema 的顶层字段列表。
 * 支持 properties / required，以及 allOf 简单合并。
 */
export function extractSchemaFields(
  schema: Record<string, unknown> | undefined,
): SchemaField[] {
  if (!schema || typeof schema !== "object") return []
  const raw = schema as Record<string, unknown>
  const merged = mergeAllOf(raw)
  const requiredSet = new Set<string>(
    Array.isArray(merged.required) ? merged.required.map(String) : [],
  )
  const properties = (merged.properties ?? {}) as Record<string, unknown>
  return Object.entries(properties).map(([name, prop]) => ({
    name,
    required: requiredSet.has(name),
    type: describeType(prop as Record<string, unknown>),
    description: (prop as Record<string, unknown>).description as
      | string
      | undefined,
  }))
}

/** 将 allOf 里的子 schema 合并进顶层（浅合并，用于常见场景） */
function mergeAllOf(schema: Record<string, unknown>): Record<string, unknown> {
  const allOf = schema.allOf
  if (!Array.isArray(allOf) || allOf.length === 0) return schema
  const merged: Record<string, unknown> = { ...schema }
  delete merged.allOf
  for (const item of allOf) {
    if (!item || typeof item !== "object") continue
    const sub = item as Record<string, unknown>
    merged.properties = { ...(merged.properties as object), ...(sub.properties as object) }
    merged.required = [
      ...(Array.isArray(merged.required) ? (merged.required as unknown[]) : []),
      ...(Array.isArray(sub.required) ? (sub.required as unknown[]) : []),
    ]
    if (!merged.type && sub.type) merged.type = sub.type
  }
  return merged
}

function describeType(schema: Record<string, unknown> | undefined): string {
  if (!schema) return "any"
  const type = schema.type
  if (Array.isArray(type)) return type.join(" | ")
  if (type === "object") return "object"
  if (type === "array") {
    return `array<${describeType((schema.items as Record<string, unknown>) ?? undefined)}>`
  }
  if (typeof type === "string") return type
  if (Array.isArray(schema.enum)) return "enum"
  if (schema.anyOf || schema.oneOf) return "union"
  if (schema.$ref) return `$ref:${String(schema.$ref)}`
  return "any"
}

/**
 * 根据 JSON Schema 生成最小示例参数，便于快速发起调用。
 * 对象只填必填字段（无必填时取前 3 个），有默认值 / 枚举时优先使用。
 */
export function generateExampleFromSchema(
  schema: Record<string, unknown> | undefined,
  depth = 0,
): unknown {
  if (!schema || typeof schema !== "object") return undefined
  const s = schema as Record<string, unknown>
  if (depth > MAX_EXAMPLE_DEPTH) return undefined
  if (s.default !== undefined) return s.default
  if (s.const !== undefined) return s.const
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0]

  if (Array.isArray(s.anyOf)) {
    const first = pickNonNullVariant(s.anyOf as Record<string, unknown>[])
    if (first) return generateExampleFromSchema(first, depth + 1)
  }
  if (Array.isArray(s.oneOf)) {
    const first = pickNonNullVariant(s.oneOf as Record<string, unknown>[])
    if (first) return generateExampleFromSchema(first, depth + 1)
  }

  let type = s.type
  if (Array.isArray(type)) {
    const nonNull = (type as unknown[]).find((item) => item !== "null")
    type = nonNull
  }

  switch (type) {
    case "object": {
      const properties = (s.properties ?? {}) as Record<string, unknown>
      const required = (s.required ?? []) as string[]
      const keys =
        required.length > 0
          ? required
          : Object.keys(properties).slice(0, 3)
      const result: Record<string, unknown> = {}
      for (const key of keys) {
        const prop = properties[key] as Record<string, unknown> | undefined
        if (!prop) continue
        const value = generateExampleFromSchema(prop, depth + 1)
        if (value !== undefined) result[key] = value
      }
      return result
    }
    case "array":
      return [generateExampleFromSchema((s.items as Record<string, unknown>) ?? {}, depth + 1)]
    case "string":
      if (s.format === "date-time") return new Date().toISOString()
      if (s.format === "date") return new Date().toISOString().slice(0, 10)
      return "示例文本"
    case "integer": {
      if (typeof s.minimum === "number") return s.minimum
      if (typeof s.min === "number") return s.min
      return 0
    }
    case "number": {
      if (typeof s.minimum === "number") return s.minimum
      if (typeof s.min === "number") return s.min
      return 0.5
    }
    case "boolean":
      return true
    case "null":
      return null
    default:
      return undefined
  }
}

function pickNonNullVariant(
  variants: Record<string, unknown>[],
): Record<string, unknown> | null {
  for (const variant of variants) {
    if (variant?.type === "null") continue
    return variant
  }
  return null
}

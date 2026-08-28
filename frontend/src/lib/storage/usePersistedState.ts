import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

import { idbGet, idbSet } from "./idb"

export interface UsePersistedStateOptions {
  /** 写入防抖毫秒数，默认 1000（避免每个按键都触发一次 IndexedDB 写入） */
  debounceMs?: number
}

export interface PersistedStateResult<T> {
  /** 当前值：首次挂载为 initial，IndexedDB 数据异步就绪后替换为持久化数据 */
  value: T
  setValue: Dispatch<SetStateAction<T>>
  /**
   * 是否已完成 IndexedDB 初次读取。
   * loaded 为 true 之前 value 只是默认值，此时不要依赖它；
   * 需要「读取后回填状态」的工具应等 loaded 后再做一次性的水合。
   */
  loaded: boolean
}

/**
 * 通用持久化 state：用法与 useState 一致，数据自动防抖写入 IndexedDB。
 *
 * key 约定为 `"<tool-id>:<record-id>"`（见 idb.ts），后续新增工具直接复用即可。
 * 保存内容建议只放「用户配置」，运行态（日志/流式回复/连接对象等）不要放进来。
 *
 * 安全保证：
 * - loaded 之前绝不写入，避免默认值覆盖已持久化数据；
 * - 卸载时立即冲刷一次，防抖窗口内的最后修改不会因切换工具而丢失。
 */
export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
  options?: UsePersistedStateOptions,
): PersistedStateResult<T> {
  const debounceMs = options?.debounceMs ?? 1000
  const [value, setValue] = useState<T>(initial)
  const [loaded, setLoaded] = useState(false)

  // 始终持有最新值，供防抖定时器与卸载冲刷读取
  const latestRef = useRef(value)
  useEffect(() => {
    latestRef.current = value
  })
  const loadedRef = useRef(loaded)
  useEffect(() => {
    loadedRef.current = loaded
  })

  // 首次挂载（或 key 变更）：读取持久化数据，完成后置 loaded
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void (async () => {
      const stored = await idbGet<T>(key)
      if (cancelled) return
      setValue((prev) => (stored !== undefined ? stored : prev))
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [key])

  // value 变化后防抖写入；loaded 之前不写，避免覆盖已持久化数据
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(() => {
      void idbSet(key, latestRef.current)
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [value, loaded, key, debounceMs])

  // 卸载时冲刷：防抖定时器被清除后补写最后一次修改
  useEffect(() => {
    return () => {
      if (loadedRef.current) {
        void idbSet(key, latestRef.current)
      }
    }
  }, [key])

  return { value, setValue, loaded }
}

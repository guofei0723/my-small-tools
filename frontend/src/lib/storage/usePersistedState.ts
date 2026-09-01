import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

import { idbGet, idbSet } from "./idb"
import { ensureConfigGate, remoteGet, remoteSet } from "./remote"

export interface UsePersistedStateOptions {
  /** 写入防抖毫秒数，默认 1000（避免每个按键都触发一次写入） */
  debounceMs?: number
}

export interface PersistedStateResult<T> {
  /** 当前值：首次挂载为 initial，存储数据异步就绪后替换为持久化数据 */
  value: T
  setValue: Dispatch<SetStateAction<T>>
  /**
   * 是否已完成初次读取。loaded 为 true 之前 value 只是默认值；
   * 需要「读取后回填状态」的工具应等 loaded 后再做一次性的水合。
   */
  loaded: boolean
}

/**
 * 通用持久化 state：用法与 useState 一致，数据自动防抖写入。
 *
 * 存储通道（后端优先、IndexedDB 降级）：
 * - 后端可达且已解锁 → 读写 `/api/config/:key`（SQLite + AES-256-GCM 加密落盘）
 * - 后端不可达 / 用户选择本地缓存 / 后端锁定 → 读写 IndexedDB
 * - 远端 404（首次使用后端）→ 回读 IndexedDB 旧数据，随后首次写入自动迁移到后端
 *
 * key 约定为 `"<tool-id>:<record-id>"`（见 idb.ts），后续新增工具直接复用即可。
 * 保存内容建议只放「用户配置」，运行态（日志/流式回复/连接对象等）不要放进来。
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
  /** 当前会话是否走远端存储（初次读取后确定；远端写入失败即降级本地） */
  const useRemoteRef = useRef(false)

  // 首次挂载（或 key 变更）：确保锁门放行 → 读取存储数据
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    void (async () => {
      let stored: T | undefined
      let useRemote = false

      const gate = await ensureConfigGate()
      if (cancelled) return
      if (gate.ok) {
        useRemote = true
        const result = await remoteGet<T>(key)
        if (cancelled) return
        if (result.status === "ok") {
          stored = result.value
        } else if (result.status !== "not-found") {
          // 读取失败（锁定/后端错误）：本会话转本地
          useRemote = false
        }
        // not-found：远端无数据，走下面的 IndexedDB 回读（迁移旧数据）
      }

      if (stored === undefined) {
        stored = await idbGet<T>(key)
      }
      if (cancelled) return
      if (stored !== undefined) setValue(stored)
      useRemoteRef.current = useRemote
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [key])

  // 写入：远端优先；远端失败（含锁定）时本会话降级为 IndexedDB
  const writeValue = useCallback(
    (next: T) => {
      void (async () => {
        if (useRemoteRef.current) {
          const result = await remoteSet(key, next)
          if (result === "ok") return
          useRemoteRef.current = false
        }
        await idbSet(key, next)
      })()
    },
    [key],
  )

  // value 变化后防抖写入；loaded 之前不写，避免覆盖已持久化数据
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(() => {
      void writeValue(latestRef.current)
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [value, loaded, key, debounceMs, writeValue])

  // 卸载时冲刷：防抖定时器被清除后补写最后一次修改
  useEffect(() => {
    return () => {
      if (loadedRef.current) {
        void writeValue(latestRef.current)
      }
    }
  }, [key, writeValue])

  return { value, setValue, loaded }
}

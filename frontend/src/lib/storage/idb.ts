/**
 * 极简 IndexedDB 封装（无第三方依赖）。
 *
 * 约定：
 * - 单个数据库 `my-small-tools`、单个对象仓库 `kv`（keyPath: "key"），避免频繁升版本。
 * - key 采用 `"<tool-id>:<record-id>"` 命名空间约定，不同工具互不干扰；
 *   新增工具无需迁移，直接使用自己的命名空间即可。
 * - 所有操作失败时仅 console 告警并优雅降级（返回 undefined / 静默跳过），
 *   不阻断页面功能。
 */

const DB_NAME = "my-small-tools"
const STORE_NAME = "kv"
const DB_VERSION = 1

/** 复用的数据库连接（单例） */
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

interface KvRecord<T> {
  key: string
  value: T
}

/** 读取一条记录；不存在或出错时返回 undefined */
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb()
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key)
      request.onsuccess = () => {
        const record = request.result as KvRecord<T> | undefined
        resolve(record?.value)
      }
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error(`[storage] idbGet "${key}" failed:`, error)
    return undefined
  }
}

/** 写入（覆盖）一条记录；失败仅告警 */
export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite")
      transaction.objectStore(STORE_NAME).put({ key, value } satisfies KvRecord<T>)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } catch (error) {
    console.error(`[storage] idbSet "${key}" failed:`, error)
  }
}

/** 删除一条记录（如「清空配置」功能）；失败仅告警 */
export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite")
      transaction.objectStore(STORE_NAME).delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } catch (error) {
    console.error(`[storage] idbDelete "${key}" failed:`, error)
  }
}

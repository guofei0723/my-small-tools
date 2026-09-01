//! 配置存储模块：SQLite + 应用层 AES-256-GCM 加密 + OS 钥匙串口令。
//!
//! 前端各工具的配置（`usePersistedState` 的远端后端）通过本模块读写。
//! 数据落在 `server/config.db`（SQLite，所有 value 列均为 AES-256-GCM 密文），
//! 密钥由用户口令经 PBKDF2-SHA256 派生，口令保存在 OS 钥匙串
//! （Windows Credential Manager / macOS Keychain / Linux Secret Service），
//! 因此 db 文件可随意拷贝迁移，口令另行保管，新机器解锁一次即写入该机钥匙串。
//!
//! 为什么不用 SQLCipher：其 Windows 构建硬依赖系统 OpenSSL（vendored 还需完整
//! Perl），本机均不可用；改用 RustCrypto 应用层加密（aes-gcm + pbkdf2，纯 Rust），
//! 对数据内容提供等效的 AES-256 保护，口令/迁移流程与 SQLCipher 方案完全一致。
//!
//! 状态机：
//! - 未初始化（db 文件不存在）→ `POST /api/config/bootstrap` 设置口令并建库
//! - 已初始化但锁定（本机钥匙串无口令）→ `POST /api/config/unlock` 输入口令解锁
//! - 正常（钥匙串已有口令，启动时自动解锁）→ 直接键值读写
//!
//! 遗忘口令 = 数据不可恢复（密钥由口令派生，无后门），口令是唯一主凭据。

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use axum::{
    body::Bytes,
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use pbkdf2::pbkdf2_hmac;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::state::AppState;

/// 钥匙串标识：服务名 + 账号名
const KEYRING_SERVICE: &str = "my-small-tools";
const KEYRING_ACCOUNT: &str = "config-db";

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
/// PBKDF2 迭代次数（OWASP 推荐 ≥ 600k，本地工具取 200k 平衡速度）
const PBKDF2_ROUNDS: u32 = 200_000;

/// meta 表固定键名
const META_SALT: &str = "salt";
const META_CHECK: &str = "check";

/// key 命名空间校验：`<tool-id>:<record-id>`，仅允许字母、数字、- _ :，长度 ≤ 128
fn is_valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
}

/// 全局配置存储：SQLite 连接 + 内存中的 AES 密钥（None = 锁定，等待 bootstrap/unlock）
pub struct ConfigStore {
    db_path: PathBuf,
    key: Mutex<Option<[u8; KEY_LEN]>>,
    conn: Mutex<Option<Connection>>,
}

impl ConfigStore {
    pub fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            key: Mutex::new(None),
            conn: Mutex::new(None),
        }
    }

    /// 启动时用钥匙串中的口令自动解锁（本机正常路径）；
    /// 钥匙串为空或配置库未初始化则保持锁定，等待前端触发 bootstrap/unlock。
    pub fn auto_unlock(&self) {
        match get_keyring_passphrase() {
            Ok(Some(passphrase)) if self.is_initialized() => {
                match unlock_conn(&self.db_path, &passphrase) {
                    Ok((conn, key)) => {
                        *self.key.lock().unwrap() = Some(key);
                        *self.conn.lock().unwrap() = Some(conn);
                        println!("[config] 配置库已用系统钥匙串口令解锁（AES-256-GCM 加密）");
                    }
                    Err(err) => eprintln!("[config] 用钥匙串口令打开配置库失败，保持锁定：{err}"),
                }
            }
            Ok(Some(_)) => {
                println!("[config] 钥匙串有口令但配置库未初始化，等待重新初始化");
            }
            Ok(None) => {
                if self.db_path.exists() && self.is_initialized() {
                    println!("[config] 配置库已初始化但本机钥匙串无口令，等待解锁");
                }
            }
            Err(err) => eprintln!("[config] 读取钥匙串失败：{err}"),
        }
    }

    /// 配置库是否已初始化：meta 表中存在盐（而非仅文件存在，
    /// 避免因自动解锁失败留下的空文件被误判为已初始化）。
    fn is_initialized(&self) -> bool {
        if !self.db_path.exists() {
            return false;
        }
        Connection::open_with_flags(&self.db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .and_then(|conn| {
                conn.query_row("SELECT 1 FROM meta WHERE key = ?1", [META_SALT], |_| Ok(()))
            })
            .is_ok()
    }

    fn is_locked(&self) -> bool {
        self.key.lock().unwrap().is_none()
    }

    fn conn(&self) -> Option<std::sync::MutexGuard<'_, Option<Connection>>> {
        self.conn.lock().ok()
    }

    fn key(&self) -> Option<[u8; KEY_LEN]> {
        self.key.lock().unwrap().clone()
    }
}

// ---------- 加解密 ----------

fn new_random<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::getrandom(&mut buf).expect("生成随机数失败");
    buf
}

fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ROUNDS, &mut key);
    key
}

/// 加密 → base64(nonce ‖ 密文+tag)
fn encrypt_value(key: &[u8; KEY_LEN], plaintext: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = new_random::<NONCE_LEN>();
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|err| format!("加密失败：{err}"))?;
    let mut blob = Vec::with_capacity(nonce.len() + ct.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ct);
    Ok(B64.encode(blob))
}

/// 解密：base64 → 拆 nonce + 密文（含 tag 校验）
fn decrypt_value(key: &[u8; KEY_LEN], blob: &str) -> Result<String, String> {
    let data = B64
        .decode(blob)
        .map_err(|err| format!("密文格式错误：{err}"))?;
    if data.len() <= NONCE_LEN {
        return Err("密文长度非法".to_string());
    }
    let (nonce, ct) = data.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "口令不正确或数据被篡改".to_string())?;
    String::from_utf8(plaintext).map_err(|_| "解密内容不是文本".to_string())
}

// ---------- 数据库 ----------

fn open_conn(db_path: &Path, create: bool) -> rusqlite::Result<Connection> {
    let conn = if create {
        Connection::open(db_path)?
    } else {
        // 不创建文件：避免解锁失败留下空 db 干扰后续初始化判定
        Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_WRITE)?
    };
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (
             key   TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS kv (
             key        TEXT PRIMARY KEY,
             value      TEXT NOT NULL,
             updated_at INTEGER NOT NULL
         );",
    )?;
    Ok(conn)
}

fn read_salt(conn: &Connection) -> Result<[u8; 16], String> {
    let encoded: String = conn
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            [META_SALT],
            |row| row.get(0),
        )
        .map_err(|err| format!("读取盐失败：{err}"))?;
    let salt: Vec<u8> = B64.decode(encoded).map_err(|err| format!("盐格式错误：{err}"))?;
    if salt.len() != 16 {
        return Err("盐长度非法".to_string());
    }
    let mut out = [0u8; 16];
    out.copy_from_slice(&salt);
    Ok(out)
}

/// 用口令解锁现有配置库：读盐 → 派生密钥 → 解密校验值（口令错则校验失败）
fn unlock_conn(db_path: &Path, passphrase: &str) -> Result<(Connection, [u8; KEY_LEN]), String> {
    let conn = open_conn(db_path, false).map_err(|err| format!("打开配置库失败：{err}"))?;
    let salt = read_salt(&conn)?;
    let key = derive_key(passphrase, &salt);
    let check: String = conn
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            [META_CHECK],
            |row| row.get(0),
        )
        .map_err(|err| format!("读取口令校验值失败：{err}"))?;
    // 校验失败（口令错）返回错误
    decrypt_value(&key, &check)?;
    Ok((conn, key))
}

// ---------- 钥匙串 ----------

fn get_keyring_passphrase() -> Result<Option<String>, keyring::Error> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?;
    match entry.get_password() {
        Ok(pass) => Ok(Some(pass)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err),
    }
}

fn set_keyring_passphrase(passphrase: &str) -> Result<(), keyring::Error> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)?.set_password(passphrase)
}

// ---------- 路由 ----------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/config/status", get(status))
        .route("/api/config/bootstrap", post(bootstrap))
        .route("/api/config/unlock", post(unlock))
        .route("/api/config/change-passphrase", post(change_passphrase))
        .route(
            "/api/config/{key}",
            get(get_value).put(put_value).delete(delete_value),
        )
}

#[derive(Serialize)]
struct StatusResponse {
    /// 配置库是否已初始化（db 文件已建并设置口令）
    initialized: bool,
    /// 是否锁定（已初始化但本机钥匙串无口令，需输入口令解锁）
    locked: bool,
}

async fn status(State(state): State<AppState>) -> Json<StatusResponse> {
    let store = &state.config_store;
    Json(StatusResponse {
        initialized: store.is_initialized(),
        locked: store.is_locked(),
    })
}

#[derive(Deserialize)]
struct PassphraseBody {
    passphrase: String,
}

/// 首次使用：设置口令、初始化并加密配置库
async fn bootstrap(
    State(state): State<AppState>,
    Json(body): Json<PassphraseBody>,
) -> Response {
    let store = &state.config_store;
    let passphrase = body.passphrase.trim().to_string();
    if passphrase.is_empty() {
        return error(StatusCode::BAD_REQUEST, "passphrase_required", "口令不能为空");
    }
    if passphrase.len() < 8 {
        return error(
            StatusCode::BAD_REQUEST,
            "passphrase_too_short",
            "口令至少 8 个字符",
        );
    }
    if store.is_initialized() {
        return error(
            StatusCode::CONFLICT,
            "already_initialized",
            "配置库已初始化，请改用 /api/config/unlock",
        );
    }
    let conn = match open_conn(&store.db_path, true) {
        Ok(conn) => conn,
        Err(err) => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "db_error",
                &format!("创建配置库失败：{err}"),
            )
        }
    };
    let salt = new_random::<16>();
    let key = derive_key(&passphrase, &salt);
    let check = match encrypt_value(&key, "ok") {
        Ok(check) => check,
        Err(err) => {
            return error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "crypto_error",
                &format!("初始化加密校验值失败：{err}"),
            )
        }
    };
    if let Err(err) = conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2), (?3, ?4)",
        rusqlite::params![META_SALT, B64.encode(salt), META_CHECK, check],
    ) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "db_error",
            &format!("初始化配置库失败：{err}"),
        );
    }
    if let Err(err) = set_keyring_passphrase(&passphrase) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "keyring_error",
            &format!("保存口令到系统钥匙串失败：{err}"),
        );
    }
    *store.key.lock().unwrap() = Some(key);
    *store.conn.lock().unwrap() = Some(conn);
    println!("[config] 配置库已初始化并加密（AES-256-GCM），口令已保存到系统钥匙串");
    StatusCode::OK.into_response()
}

/// 新机器迁移：输入口令解锁并写入本机钥匙串
async fn unlock(State(state): State<AppState>, Json(body): Json<PassphraseBody>) -> Response {
    let store = &state.config_store;
    if !store.is_initialized() {
        return error(
            StatusCode::CONFLICT,
            "not_initialized",
            "配置库尚未初始化，请先使用 /api/config/bootstrap",
        );
    }
    if !store.is_locked() {
        return error(
            StatusCode::CONFLICT,
            "not_locked",
            "配置库已解锁，无需重复输入",
        );
    }
    let passphrase = body.passphrase.trim().to_string();
    if passphrase.is_empty() {
        return error(StatusCode::BAD_REQUEST, "passphrase_required", "口令不能为空");
    }
    // 用口令解锁现有库：口令错时校验失败 → 401
    let (conn, key) = match unlock_conn(&store.db_path, &passphrase) {
        Ok(result) => result,
        Err(_) => return error(StatusCode::UNAUTHORIZED, "wrong_passphrase", "口令不正确"),
    };
    if let Err(err) = set_keyring_passphrase(&passphrase) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "keyring_error",
            &format!("保存口令到系统钥匙串失败：{err}"),
        );
    }
    *store.key.lock().unwrap() = Some(key);
    *store.conn.lock().unwrap() = Some(conn);
    println!("[config] 解锁成功，口令已保存到系统钥匙串");
    StatusCode::OK.into_response()
}

/// 将全部 kv 行与口令校验值从 from_key 重加密为 to_key（事务内完成）。
/// 数据量小（几 KB 配置），全量重加密代价可忽略。
fn reencrypt_all(
    conn: &mut Connection,
    from_key: &[u8; KEY_LEN],
    to_key: &[u8; KEY_LEN],
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启事务失败：{err}"))?;
    {
        let mut stmt = tx
            .prepare("SELECT key, value FROM kv")
            .map_err(|err| format!("读取配置失败：{err}"))?;
        let mapped = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|err| format!("读取配置失败：{err}"))?;
        let rows: Vec<(String, String)> = mapped
            .collect::<Result<Vec<(String, String)>, rusqlite::Error>>()
            .map_err(|err| format!("读取配置失败：{err}"))?;
        drop(stmt);
        for (row_key, ciphertext) in rows {
            let plaintext = decrypt_value(from_key, &ciphertext)
                .map_err(|err| format!("解密已有配置失败：{err}"))?;
            let new_ciphertext = encrypt_value(to_key, &plaintext)
                .map_err(|err| format!("重加密失败：{err}"))?;
            tx.execute(
                "UPDATE kv SET value = ?1 WHERE key = ?2",
                rusqlite::params![new_ciphertext, row_key],
            )
            .map_err(|err| format!("重加密写入失败：{err}"))?;
        }
    }
    // 重加密口令校验值
    if let Ok(check) = encrypt_value(to_key, "ok") {
        let _ = tx.execute(
            "UPDATE meta SET value = ?1 WHERE key = ?2",
            rusqlite::params![check, META_CHECK],
        );
    }
    tx.commit().map_err(|err| format!("提交失败：{err}"))
}

/// 更换口令：重新派生密钥并逐行重加密
async fn change_passphrase(
    State(state): State<AppState>,
    Json(body): Json<PassphraseBody>,
) -> Response {
    let store = &state.config_store;
    let new_passphrase = body.passphrase.trim().to_string();
    if new_passphrase.len() < 8 {
        return error(
            StatusCode::BAD_REQUEST,
            "passphrase_too_short",
            "新口令至少 8 个字符",
        );
    }
    let mut guard = match store.conn() {
        Some(guard) => guard,
        None => return error(StatusCode::CONFLICT, "locked", "配置库未解锁"),
    };
    let conn = match guard.as_mut() {
        Some(conn) => conn,
        None => return error(StatusCode::CONFLICT, "locked", "配置库未解锁"),
    };
    let old_key = match store.key() {
        Some(key) => key,
        None => return error(StatusCode::CONFLICT, "locked", "配置库未解锁"),
    };
    let salt = match read_salt(conn) {
        Ok(salt) => salt,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, "db_error", &err),
    };
    let new_key = derive_key(&new_passphrase, &salt);

    // 先重加密库，成功后写钥匙串；钥匙串失败则反向重加密回滚
    if let Err(err) = reencrypt_all(conn, &old_key, &new_key) {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "db_error", &err);
    }
    if let Err(err) = set_keyring_passphrase(&new_passphrase) {
        let _ = reencrypt_all(conn, &new_key, &old_key);
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "keyring_error",
            &format!("保存新口令到钥匙串失败，已回滚重加密：{err}"),
        );
    }
    *store.key.lock().unwrap() = Some(new_key);
    println!("[config] 配置库口令已更换并全部重加密");
    StatusCode::OK.into_response()
}

// ---------- 键值读写 ----------

async fn get_value(State(state): State<AppState>, AxumPath(key): AxumPath<String>) -> Response {
    let store = &state.config_store;
    if !is_valid_key(&key) {
        return error(StatusCode::BAD_REQUEST, "invalid_key", "key 格式不合法");
    }
    let (guard, aes_key) = match (store.conn(), store.key()) {
        (Some(guard), Some(aes_key)) => (guard, aes_key),
        _ => return locked_response(),
    };
    let conn = match guard.as_ref() {
        Some(conn) => conn,
        None => return locked_response(),
    };
    match conn.query_row(
        "SELECT value FROM kv WHERE key = ?1",
        [&key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(ciphertext) => match decrypt_value(&aes_key, &ciphertext) {
            Ok(plaintext) => match serde_json::from_str::<serde_json::Value>(&plaintext) {
                Ok(json) => Json(json).into_response(),
                Err(_) => {
                    error(StatusCode::INTERNAL_SERVER_ERROR, "corrupt_data", "存储数据损坏")
                }
            },
            Err(err) => error(StatusCode::INTERNAL_SERVER_ERROR, "decrypt_error", &err),
        },
        Err(rusqlite::Error::QueryReturnedNoRows) => StatusCode::NOT_FOUND.into_response(),
        Err(err) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "db_error",
            &format!("读取失败：{err}"),
        ),
    }
}

async fn put_value(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
    body: Bytes,
) -> Response {
    let store = &state.config_store;
    if !is_valid_key(&key) {
        return error(StatusCode::BAD_REQUEST, "invalid_key", "key 格式不合法");
    }
    if serde_json::from_slice::<serde_json::Value>(&body).is_err() {
        return error(StatusCode::BAD_REQUEST, "invalid_json", "请求体必须是合法 JSON");
    }
    let (guard, aes_key) = match (store.conn(), store.key()) {
        (Some(guard), Some(aes_key)) => (guard, aes_key),
        _ => return locked_response(),
    };
    let conn = match guard.as_ref() {
        Some(conn) => conn,
        None => return locked_response(),
    };
    let plaintext = String::from_utf8_lossy(&body).to_string();
    let ciphertext = match encrypt_value(&aes_key, &plaintext) {
        Ok(ct) => ct,
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, "crypto_error", &err),
    };
    let updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    if let Err(err) = conn.execute(
        "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![&key, &ciphertext, updated_at],
    ) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "db_error",
            &format!("写入失败：{err}"),
        );
    }
    StatusCode::OK.into_response()
}

async fn delete_value(
    State(state): State<AppState>,
    AxumPath(key): AxumPath<String>,
) -> Response {
    let store = &state.config_store;
    if !is_valid_key(&key) {
        return error(StatusCode::BAD_REQUEST, "invalid_key", "key 格式不合法");
    }
    let (guard, _) = match (store.conn(), store.key()) {
        (Some(guard), Some(_)) => (guard, ()),
        _ => return locked_response(),
    };
    let conn = match guard.as_ref() {
        Some(conn) => conn,
        None => return locked_response(),
    };
    if let Err(err) = conn.execute("DELETE FROM kv WHERE key = ?1", [&key]) {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "db_error",
            &format!("删除失败：{err}"),
        );
    }
    StatusCode::OK.into_response()
}

// ---------- 工具 ----------

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": code, "message": message })),
    )
        .into_response()
}

fn locked_response() -> Response {
    error(
        StatusCode::LOCKED,
        "config_locked",
        "配置库已锁定，请先通过 /api/config/unlock 输入口令",
    )
}

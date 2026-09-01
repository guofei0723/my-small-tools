use std::{path::PathBuf, sync::Arc, time::Duration};

use crate::features::config::ConfigStore;

/// 全局共享状态：通过 axum 的 State 注入各功能模块。
/// 新增后端能力时，若需要共享资源（HTTP 客户端、配置、缓存等），在此扩展字段。
#[derive(Clone)]
pub struct AppState {
    /// 复用的 HTTP 客户端（带连接池），所有功能模块共用
    pub http: reqwest::Client,
    /// 配置存储（SQLCipher 加密 SQLite + OS 钥匙串口令），前端工具配置的远端后端
    pub config_store: Arc<ConfigStore>,
}

impl AppState {
    pub fn new() -> Self {
        let config_store = Arc::new(ConfigStore::new(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("config.db"),
        ));
        // 启动时尝试用本机钥匙串口令自动解锁（新机器无口令则保持锁定）
        config_store.auto_unlock();
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .build()
                .expect("初始化 HTTP 客户端失败"),
            config_store,
        }
    }
}

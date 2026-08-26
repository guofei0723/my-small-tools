use std::time::Duration;

/// 全局共享状态：通过 axum 的 State 注入各功能模块。
/// 新增后端能力时，若需要共享资源（HTTP 客户端、配置、缓存等），在此扩展字段。
#[derive(Clone)]
pub struct AppState {
    /// 复用的 HTTP 客户端（带连接池），所有功能模块共用
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .build()
                .expect("初始化 HTTP 客户端失败"),
        }
    }
}

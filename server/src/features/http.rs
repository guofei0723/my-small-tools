//! HTTP 请求测试器后端能力：经通用 HTTP 代理转发任意请求。
//! 请求路径 `/api/http/proxy`，与前端工具 id `http-client` 对应。

use axum::Router;

use crate::state::AppState;

use super::proxy;

/// HTTP 请求测试器路由：`POST /api/http/proxy`
pub fn router() -> Router<AppState> {
    proxy::router("/api/http/proxy")
}

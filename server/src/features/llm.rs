//! 大模型服务测试器后端能力：经通用 HTTP 代理转发 LLM API 请求。
//! 请求路径 `/api/llm/proxy`，与前端工具 id `llm-tester` 对应。

use axum::Router;

use crate::state::AppState;

use super::proxy;

/// 大模型服务测试器路由：`POST /api/llm/proxy`
pub fn router() -> Router<AppState> {
    proxy::router("/api/llm/proxy")
}

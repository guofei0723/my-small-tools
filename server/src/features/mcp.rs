//! MCP 调试器后端能力：经通用 HTTP 代理转发 MCP 请求。
//! 请求路径 `/api/mcp/proxy`，与前端工具 id `mcp-debugger` 对应。

use axum::Router;

use crate::state::AppState;

use super::proxy;

/// MCP 调试器路由：`POST /api/mcp/proxy`
pub fn router() -> Router<AppState> {
    proxy::router("/api/mcp/proxy")
}

//! 后端功能模块：每个独立能力一个模块，与前端 `src/tools/` 对应。
//!
/// 新增能力（如某前端工具需要后端实现）的流程：
/// 1. 在 `features/` 下新建模块文件（如 `exec.rs`），实现 `pub fn router() -> Router<AppState>`
/// 2. 在本文件 `pub mod <name>;` 注册
/// 3. 在 `main.rs` 中 `merge(features::<name>::router())`
///
/// 接口 path 约定：按前端工具划分前缀 `/api/<tool-id>/...`（如 MCP 调试器为 `/api/mcp/proxy`），
/// 避免所有工具共用裸路径，便于日志溯源与后续按工具差异化配置。

/// 通用 HTTP 代理：`POST /api/proxy`，供前端任意工具转发请求到任意目标
/// （服务端到服务端，目标无需开启 CORS）。MCP 调试器依赖此模块。
pub mod proxy;

/// MCP 调试器：挂载 `/api/mcp/proxy`（复用 proxy 模块的通用代理）
pub mod mcp;

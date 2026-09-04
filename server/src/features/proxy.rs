use std::{
    collections::HashMap,
    time::Instant,
};

use axum::{
    body::Body,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Deserialize;

use crate::state::AppState;

/// 透传给客户端的常见响应头白名单（其余响应头由代理内部处理）。
/// 保持白名单可避免把 hop-by-hop 或代理内部头暴露给浏览器。
const PASSTHROUGH_HEADERS: [&str; 12] = [
    "content-type",
    "cache-control",
    "etag",
    "last-modified",
    "location",
    "server",
    "date",
    "allow",
    "www-authenticate",
    "x-request-id",
    "content-disposition",
    "mcp-session-id",
];

#[derive(Deserialize, Clone)]
struct ProxyRequest {
    /// 目标地址（MCP 服务器、API 或任意 HTTP 端点）
    url: String,
    /// 转发方法（默认 POST，支持任意 reqwest 可识别的方法）
    #[serde(default = "default_method")]
    method: String,
    /// 附加请求头（Authorization、Accept 等），原样转发
    #[serde(default)]
    headers: HashMap<String, String>,
    /// 请求体原文（例如 JSON、表单或纯文本）
    #[serde(default)]
    body: Option<String>,
}

fn default_method() -> String {
    "POST".to_string()
}

/**
 * 通用 HTTP 代理模块：路由 path 由调用方（各工具模块）指定。
 * 例如 MCP 调试器注册 `/api/mcp/proxy`，未来其他工具可注册自己的前缀。
 */
pub fn router(route: &str) -> Router<AppState> {
    Router::new().route(route, post(proxy))
}

/// 通用 HTTP 代理：浏览器 -> 本服务 -> 目标服务器（服务端到服务端，无 CORS 限制）。
/// 支持常用 HTTP 方法与请求头，响应体流式透传。
async fn proxy(State(state): State<AppState>, Json(req): Json<ProxyRequest>) -> Response {
    let started = Instant::now();

    let method = match reqwest::Method::from_bytes(req.method.trim().as_bytes()) {
        Ok(method) => method,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("无效的 HTTP 方法：{err}")
                })),
            )
                .into_response();
        }
    };

    let mut builder = state.http.request(method.clone(), &req.url);
    for (key, value) in &req.headers {
        builder = builder.header(key, value);
    }
    if let Some(body) = &req.body {
        builder = builder.body(body.clone());
    }

    match builder.send().await {
        Ok(resp) => {
            let status = resp.status();
            let mut response = Response::builder().status(status);
            for name in PASSTHROUGH_HEADERS {
                if let Some(value) = resp.headers().get(name) {
                    response = response.header(name, value.clone());
                }
            }
            response = response.header("x-mcp-proxy", "rust");
            println!(
                "[proxy] {} {} -> {} in {:?}",
                method,
                req.url,
                status,
                started.elapsed()
            );
            response
                .body(Body::from_stream(resp.bytes_stream()))
                .unwrap_or_else(|err| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("构建转发响应失败：{err}"),
                    )
                        .into_response()
                })
        }
        Err(err) => {
            println!("[proxy] {} {} 失败：{}", method, req.url, err);
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": format!("无法连接目标服务器：{err}")
                })),
            )
                .into_response()
        }
    }
}

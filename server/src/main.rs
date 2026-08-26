use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    time::{Duration, Instant},
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
use tower_http::services::{ServeDir, ServeFile};

#[derive(Deserialize, Clone)]
struct ProxyRequest {
    /// 目标地址（MCP 服务器 /mcp 或 /sse 端点）
    url: String,
    /// 转发方法：GET 或 POST（默认 POST）
    #[serde(default = "default_method")]
    method: String,
    /// 附加请求头（Authorization、Accept 等），原样转发
    #[serde(default)]
    headers: HashMap<String, String>,
    /// POST 请求体原文（JSON-RPC 报文）
    #[serde(default)]
    body: Option<String>,
}

fn default_method() -> String {
    "POST".to_string()
}

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
}

/// 透传给前端的响应头白名单（其余响应头由代理内部处理）
const PASSTHROUGH_HEADERS: [&str; 3] = ["content-type", "mcp-session-id", "cache-control"];

#[tokio::main]
async fn main() {
    let addr = SocketAddr::from(([127, 0, 0, 1], 8787));
    let state = AppState {
        client: reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("初始化 HTTP 客户端失败"),
    };

    // 生产模式：由后端直接伺服前端构建产物（SPA fallback 到 index.html）
    let dist_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/dist");
    let index_file = dist_dir.join("index.html");
    let serve_dir = ServeDir::new(&dist_dir).not_found_service(ServeFile::new(index_file));

    let app = Router::new()
        .route("/api/proxy", post(proxy))
        .with_state(state)
        .fallback_service(serve_dir);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("端口 8787 被占用");
    println!(
        "mcp-proxy-server 已启动：http://{addr}（前端 /api 请求将代理到此）"
    );
    axum::serve(listener, app).await.expect("服务器运行失败");
}

/// 通用 HTTP 代理：浏览器 -> 本服务 -> 目标服务器（服务端到服务端，无 CORS 限制）。
/// 支持 GET（SSE 长连接）与 POST，响应体流式透传。
async fn proxy(State(state): State<AppState>, Json(req): Json<ProxyRequest>) -> Response {
    let started = Instant::now();

    let method = if req.method.trim().eq_ignore_ascii_case("GET") {
        reqwest::Method::GET
    } else {
        reqwest::Method::POST
    };

    let mut builder = state.client.request(method.clone(), &req.url);
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

mod features;
mod state;

use std::{net::SocketAddr, path::PathBuf};

use axum::Router;
use state::AppState;
use tower_http::services::{ServeDir, ServeFile};

#[tokio::main]
async fn main() {
    let addr = SocketAddr::from(([127, 0, 0, 1], 8787));
    let state = AppState::new();

    // 生产模式：由后端直接伺服前端构建产物（SPA fallback 到 index.html）
    let dist_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/dist");
    let index_file = dist_dir.join("index.html");
    let serve_dir = ServeDir::new(&dist_dir).not_found_service(ServeFile::new(index_file));

    // 组装各功能模块路由；新增能力在 features/ 下添加模块并在此 merge
    let app = Router::new()
        .merge(features::mcp::router())
        .with_state(state)
        .fallback_service(serve_dir);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("端口 8787 被占用");
    println!("my-small-tools 后端已启动：http://{addr}（前端 /api 请求将代理到此）");
    axum::serve(listener, app).await.expect("服务器运行失败");
}

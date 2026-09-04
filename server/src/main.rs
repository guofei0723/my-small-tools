mod features;
mod state;

use std::{convert::Infallible, net::SocketAddr, path::PathBuf};

use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
    Router,
};
use state::AppState;
use tower::service_fn;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    let addr = SocketAddr::from(([127, 0, 0, 1], 8787));
    let state = AppState::new();

    // 生产模式：由后端直接伺服前端构建产物。
    // SPA fallback：静态文件存在则伺服文件；否则返回 index.html（200），
    // 使前端路由（如 /mcp-debugger）可被直接访问。
    let dist_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/dist");
    let index_path = dist_dir.join("index.html");
    let spa_fallback = service_fn(move |req: Request<Body>| {
        let dist_dir = dist_dir.clone();
        let index_path = index_path.clone();
        async move {
            let mut serve = ServeDir::new(&dist_dir);
            match serve.try_call(req).await {
                Ok(resp) if resp.status() != StatusCode::NOT_FOUND => {
                    Ok(resp.map(Body::new))
                }
                _ => {
                    let content = tokio::fs::read(&index_path).await.unwrap_or_default();
                    Ok::<Response, Infallible>(
                        Response::builder()
                            .status(StatusCode::OK)
                            .header("content-type", "text/html")
                            .body(Body::from(content))
                            .expect("构造 index.html 响应失败"),
                    )
                }
            }
        }
    });

    // 组装各功能模块路由；新增能力在 features/ 下添加模块并在此 merge
    let app = Router::new()
        .merge(features::mcp::router())
        .merge(features::http::router())
        .merge(features::llm::router())
        .merge(features::config::router())
        .with_state(state)
        .fallback_service(spa_fallback);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("端口 8787 被占用");
    println!("my-small-tools 后端已启动：http://{addr}（前端 /api 请求将代理到此）");
    axum::serve(listener, app).await.expect("服务器运行失败");
}

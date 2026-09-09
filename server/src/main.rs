mod features;
mod state;

use std::{
    convert::Infallible,
    net::SocketAddr,
    path::{Path, PathBuf},
};

use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
    Router,
};
use state::AppState;
use tower::service_fn;
use tower_http::services::ServeDir;

const DEFAULT_PORT: u16 = 8787;

fn parse_port(value: &str) -> Result<u16, String> {
    value
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)
        .ok_or_else(|| format!("无效端口：{value}，请输入 1-65535 之间的整数"))
}

fn server_port(args: impl IntoIterator<Item = String>) -> Result<u16, String> {
    let mut args = args.into_iter();
    let mut port = DEFAULT_PORT;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--port" | "-p" => {
                let value = args
                    .next()
                    .ok_or_else(|| format!("参数 {arg} 缺少端口值"))?;
                port = parse_port(&value)?;
            }
            _ => {
                if let Some(value) = arg.strip_prefix("--port=") {
                    port = parse_port(value)?;
                } else {
                    return Err(format!("未知参数：{arg}"));
                }
            }
        }
    }

    Ok(port)
}

fn executable_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

#[tokio::main]
async fn main() {
    let port = server_port(std::env::args().skip(1)).unwrap_or_else(|error| {
        eprintln!("{error}\n用法：my-small-tools.exe [--port <端口>]");
        std::process::exit(2);
    });
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let executable_dir = executable_dir();
    let packaged_dist_dir = executable_dir.join("frontend").join("dist");
    let is_packaged = packaged_dist_dir.join("index.html").is_file();

    // 打包版本从 exe 同级目录伺服前端资源；开发环境继续使用项目中的 frontend/dist。
    // SPA fallback：静态文件存在则伺服文件；否则返回 index.html（200），
    // 使前端路由（如 /mcp-debugger）可被直接访问。
    let dist_dir = if is_packaged {
        packaged_dist_dir
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/dist")
    };
    let config_path = if is_packaged {
        executable_dir.join("config.db")
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("config.db")
    };
    let state = AppState::new(config_path);
    let index_path = dist_dir.join("index.html");
    let spa_fallback = service_fn(move |req: Request<Body>| {
        let dist_dir = dist_dir.clone();
        let index_path = index_path.clone();
        async move {
            let mut serve = ServeDir::new(&dist_dir);
            match serve.try_call(req).await {
                Ok(resp) if resp.status() != StatusCode::NOT_FOUND => Ok(resp.map(Body::new)),
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
        .unwrap_or_else(|error| panic!("无法监听 {addr}：{error}"));
    println!("my-small-tools 后端已启动：http://{addr}（前端 /api 请求将代理到此）");
    axum::serve(listener, app).await.expect("服务器运行失败");
}

#[cfg(test)]
mod tests {
    use super::{server_port, DEFAULT_PORT};

    #[test]
    fn uses_default_port_without_arguments() {
        assert_eq!(server_port(Vec::new()).unwrap(), DEFAULT_PORT);
    }

    #[test]
    fn parses_port_arguments() {
        assert_eq!(
            server_port(vec!["--port".to_owned(), "8686".to_owned()]).unwrap(),
            8686
        );
        assert_eq!(server_port(vec!["--port=8687".to_owned()]).unwrap(), 8687);
        assert_eq!(
            server_port(vec!["-p".to_owned(), "8688".to_owned()]).unwrap(),
            8688
        );
    }

    #[test]
    fn rejects_invalid_port_arguments() {
        assert!(server_port(vec!["--port".to_owned()]).is_err());
        assert!(server_port(vec!["--port=0".to_owned()]).is_err());
        assert!(server_port(vec!["--port=invalid".to_owned()]).is_err());
        assert!(server_port(vec!["--unknown".to_owned()]).is_err());
    }
}

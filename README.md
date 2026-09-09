# my-small-tools

个人小工具集：React 前端 + Rust 后端。

- **前端**（`frontend/`）：Vite + React 19 + TypeScript + Tailwind CSS 4，内置多个小工具（UUID 生成、Base64 编解码、时间戳转换、**MCP 调试器**）
- **后端**（`server/`）：Rust（axum + reqwest）通用 HTTP 代理，为 MCP 调试器提供真实请求转发，目标 MCP 服务器**无需开启 CORS**

## 环境要求

- Node.js ≥ 18（`concurrently` 要求）
- Rust 工具链（`cargo` / `rustc`，1.94 已验证）

## 开发环境运行

在项目根目录一条命令同时启动后端与前端：

```bash
npm run dev
```

它会并行启动：

| 服务 | 地址 | 说明 |
|---|---|---|
| Rust 代理后端 | `http://127.0.0.1:8787` | `cargo run`，转发 `/api/*` 请求 |
| Vite 前端 | `http://localhost:5173` | `npm run dev --prefix frontend`，`/api` 自动代理到后端 |

也可以分别启动（便于分开看日志）：

```bash
npm run dev:server    # 只起 Rust 后端
npm run dev:frontend  # 只起 Vite 前端
```

### 使用 MCP 调试器

1. 启动后端与前端（上述任一方式）
2. 浏览器打开前端地址，左侧选择「MCP 调试器」
3. 填入目标 MCP 服务器地址（如 `http://localhost:3001/mcp`），选择传输方式（HTTP / SSE）
4. 保持「经后端代理转发」勾选（默认）→ 点击连接：
   - 后端真实请求目标服务器，**目标无需配置 CORS**（后端需在运行，否则会提示）
   - 也可取消勾选走浏览器直连，此时**目标必须开启 CORS**
5. 连接后查看服务器信息、工具列表与参数定义，编辑参数后点击「调用工具」
6. 底部「请求日志」展示完整 JSON-RPC 报文（`initialize` → `notifications/initialized` → `tools/list` → `tools/call`），点击可展开原始内容

## 生产打包运行

```bash
npm run build
```

依次执行：前端构建（`vite build` → `frontend/dist`）→ 后端编译（`cargo build`）。

运行（后端直接伺服前端构建产物）：

```bash
cargo run --manifest-path server/Cargo.toml
# 或
npm run dev:server
```

浏览器访问 `http://127.0.0.1:8787` 即可使用完整应用（单端口部署，SPA 路由 fallback 到 index.html）。

### Windows 发布包与后台启动

生成 Windows 发布目录：

```bash
npm run build:windows
```

输出目录为 `dist/windows`，包含：

- `my-small-tools.exe`：Release 后端程序
- `frontend/dist`：前端静态资源
- `start-my-small-tools.vbs`：隐藏启动脚本，不会自动打开浏览器

双击 `start-my-small-tools.vbs` 即可在后台启动后端。启动脚本通过 `--port 8686` 使用独立于开发环境的端口，然后手动访问 `http://127.0.0.1:8686`。如果需要登录 Windows 后自动启动，可将该脚本的快捷方式放入 `shell:startup`，或配置任务计划程序的“登录时”触发器。建议选择“仅当用户登录时运行”，以便继续使用当前用户的 Windows Credential Manager 配置。

后端默认仍监听 `8787`，也可以直接通过命令行指定其他端口：

```bash
my-small-tools.exe --port 8686
# 同样支持：-p 8686 或 --port=8686
```

## 注意事项

- **端口占用**：后端默认监听 8787，可通过 `--port <端口>` 修改；Windows 后台启动脚本使用 8686。Vite 默认 5173，若被其他应用占用会报错，可指定其他端口 `npm run dev --prefix frontend -- --port 5174`。开发时如果修改后端端口，还需同步调整 `frontend/vite.config.ts` 中的 `/api` 代理目标
- **首次编译慢**：Rust 首次构建需下载编译依赖（axum/reqwest/rustls 等），约几分钟；之后增量编译很快
- **后端日志**：后端 stdout 会打印每次代理转发记录（`[proxy] POST <url> -> 200 OK in ...`），排查连接问题先看这里
- **代理模式**：MCP 调试器默认经后端转发。如果目标 MCP 服务器在浏览器可直连（已开 CORS）且不想依赖后端，可取消「经后端代理转发」
- **目标地址**：仅支持 `http://` / `https://`；后端无法连接目标时返回 502 并给出原因（如 DNS、连接拒绝）
- **认证头**：目标服务器需要鉴权时，在「设置请求头」中按 `Key: Value` 每行填写（如 `Authorization: Bearer xxx`），代理模式与直连模式都会原样发送
- **依赖安装**：前端依赖装在 `frontend/node_modules`（`npm install --prefix frontend`），根目录 `node_modules` 仅包含工作区脚本依赖（`concurrently`），两者相互独立

## 目录结构

```
my-small-tools/
├── frontend/          # React 前端（Vite 工程）
│   └── src/
│       ├── components/  # 布局与 UI 组件
│       ├── lib/mcp/     # MCP 客户端（协议类型、客户端、Schema 工具）
│       └── tools/       # 各小工具（含 mcp-debugger）
├── server/            # Rust 后端（模块化：features/ 下每个能力一个模块）
│   └── src/
│       ├── main.rs      # 入口：组装路由 + 静态伺服 + 启动
│       ├── state.rs     # 共享状态 AppState
│       └── features/    # 功能模块（当前：proxy 通用 HTTP 代理）
├── package.json       # 根工作区脚本（dev / build）
└── AGENTS.md          # 面向 AI 的工程约束文档
```

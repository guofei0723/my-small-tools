# AGENTS.md — 工程约束与设计意图

本文件供 AI 编程助手与开发者阅读，描述本仓库的结构、设计意图与硬性约束。修改代码前先读这里；与全局个人 `AGENTS.md` 冲突时，项目级规则优先。

## 项目概览

个人小工具集。**前端**（`frontend/`）是 Vite + React 19 + TypeScript 5.8 + Tailwind CSS 4 的单页应用，内置若干独立小工具；**后端**（`server/`）是 Rust（axum + reqwest + tokio）服务，核心职责是通用 HTTP 代理，为「MCP 调试器」提供真实请求转发，使目标 MCP 服务器无需开启 CORS。

架构原则：**协议逻辑在前端、传输转发在后端**。MCP 的 JSON-RPC 会话管理、SSE 解析、报文日志都在前端 `src/lib/mcp/`，后端只做无状态 HTTP 转发（含流式透传）。这是刻意设计——调试器的价值就在于让用户看到完整原始报文。

## 目录结构

```
my-small-tools/
├── frontend/                # React 前端（Vite 工程，自身拥有 package.json）
│   └── src/
│       ├── components/layout/   # AppLayout / Sidebar（整体外壳）
│       ├── components/ui/       # shadcn/ui 风格基础组件（Button/Card/ScrollArea）
│       ├── lib/mcp/             # MCP 客户端：
│       │   ├── types.ts         #   JSON-RPC / MCP 协议类型
│       │   ├── client.ts        #   McpClient（会话、SSE 解析、日志、代理/直连切换）
│       │   └── schema.ts        #   JSON Schema 解析 + 示例参数生成
│       ├── lib/utils.ts         # cn() 工具函数
│       ├── tools/               # 各小工具（每工具一个子目录）
│       │   ├── registry.tsx     # 工具注册表（新增工具在此登记）
│       │   ├── types.ts         # ToolDefinition 类型
│       │   └── <tool>/<Xxx>Tool.tsx
│       └── main.tsx / App.tsx
├── server/                  # Rust 后端
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs          # 入口：组装 features 路由 + 生产静态伺服 + 启动
│       ├── state.rs         # AppState 共享状态（http 客户端等）
│       └── features/        # 功能模块（与前端 tools/ 一一对应）
│           ├── mod.rs       # 模块注册表
│           ├── proxy.rs     # 通用 HTTP 代理（handler，路由由工具模块指定）
│           └── mcp.rs       # MCP 调试器（/api/mcp/proxy，复用 proxy）
├── package.json             # 根工作区脚本（仅 concurrently，勿加前端依赖）
├── README.md                # 面向人的运行手册
└── AGENTS.md                # 本文件
```

## 前端约定（硬性）

- **命名导出**：所有前端模块只用命名导出，禁止 `export default`（懒加载注册时用 `.then((m) => ({ default: m.Xxx }))` 适配）。
- **新增工具流程**：在 `src/tools/<tool-id>/<Xxx>Tool.tsx` 实现组件（命名为导出，如 `UuidGeneratorTool`）→ 在 `src/tools/registry.tsx` 用 `lazy()` 注册（含 `id`/`name`/`description`/`icon`/`component`），左侧列表自动出现。图标用 `lucide-react`。
- **路径别名**：`@/*` → `src/*`（tsconfig + vite 已配）。
- **UI 复用**：优先使用 `src/components/ui/` 基础组件（Card/Button 等）与 `cn()`；样式沿用现有 Tailwind 类名风格，不引入新 UI 依赖。
- **严格模式**：`strict`、`verbatimModuleSyntax`（类型导入必须 `import type`）、`noUnusedLocals/Parameters` 已开启，构建（`tsc -b`）即检查。

## MCP 客户端（src/lib/mcp/）设计意图

- `McpClient` 是唯一入口：`connect()`（initialize 握手 + 版本降级重试 + initialized 通知）、`listTools()`、`callTool()`、`disconnect()`。
- **网络层可切换**：`McpClientOptions.proxy` 设置后请求发到同源后端（当前为 `/api/mcp/proxy`），否则浏览器直连。新增任何请求路径（如 GET SSE 流）都必须走 `doRequest()` 统一出口，保持代理/直连双通道可用。
- **日志**：每个请求/响应通过 `onLog` 上报（direction 为 request/response/info/error），UI 原样展示；响应日志的 label 必须带 `response` 前缀（曾有回归，勿删）。
- **协议类型**以 MCP 2025-06-18 / 2024-11-05 为准；`types.ts` 中类型与实际报文一一对应，不要混入 UI 概念。

## 后端（server/）设计意图与约束

- **模块化结构**（与前端 `tools/` 对应）：每个独立能力一个 `features/<name>.rs` 模块，模块内导出 `pub fn router() -> Router<AppState>` 组合自身路由；新增能力流程：新建模块 → 在 `features/mod.rs` 注册 → 在 `main.rs` `merge()`。`main.rs` 只做组装与启动，不写业务逻辑。
- **接口 path 约定**：按前端工具划分前缀 `/api/<tool-id>/...`（如 MCP 调试器为 `/api/mcp/proxy`），避免多工具共用裸路径，便于日志溯源与后续按工具差异化配置。
- **共享状态**：`state.rs` 中的 `AppState` 通过 axum `State` 注入各模块（现含复用的 `http` 客户端）；新增共享资源（配置、缓存等）在 `AppState` 扩展字段。
- **通用 HTTP 代理**（`features/proxy.rs`）：不写死 MCP 语义，请求体 `{ url, method, headers, body }`，响应体流式透传；**透传响应头白名单** `PASSTHROUGH_HEADERS = [content-type, mcp-session-id, cache-control]`（含会话头），新增需要透传的头改这个数组。路由 path 由调用方（如 `features/mcp.rs`）通过 `proxy::router("/api/mcp/proxy")` 指定，各工具模块复用同一 handler。
- 监听 `127.0.0.1:8787`（硬编码），生产模式用 `ServeDir` 伺服 `frontend/dist`（路径基于 `CARGO_MANIFEST_DIR` 推导，勿改为相对 cwd）。
- 目标连接失败返回 502 + JSON 错误体；代理成功在 stdout 打印 `[proxy] ...` 日志。
- 依赖栈已固定（axum 0.8 / reqwest 0.12 + rustls / tokio），新增依赖需说明理由。

## 工程约束

- **依赖归属**：前端依赖只进 `frontend/package.json`；根 `package.json` 仅保留工作区脚本与 `concurrently`。不要在根目录加前端依赖。
- **构建验证**：改动前后至少运行根目录 `npm run build`（前端 `tsc -b && vite build` + `cargo build` 全部通过）。Rust 用 `cargo build --manifest-path server/Cargo.toml`。
- **端口约定**：后端 8787（固定）；Vite dev 默认 5173，占用时可换端口（`/api` 代理不受影响）；前端 `/api` 代理目标在 `frontend/vite.config.ts`，改后端端口需同步。
- **CORS 取舍**：默认「经后端代理转发」解决目标服务器 CORS 限制；浏览器直连仅在目标已开 CORS 时可用。这两条路径都是功能的一部分，重构时不可只保留其一。
- **测试服务器**：如需本地 MCP 测试目标，可临时在 `scripts/` 下写无依赖 Node 脚本，验证后删除，勿提交。

## 提交规范

遵循全局个人 `AGENTS.md` 的 Conventional Commits；本仓库为多子项目结构，**scope 必须带子项目前缀**：

- 前端改动：`feat(frontend): ...` / `fix(frontend): ...` 等
- 后端改动：`feat(server): ...` / `fix(server): ...` 等
- 根目录脚本/文档：`chore(workspace): ...` 或 `docs: ...`

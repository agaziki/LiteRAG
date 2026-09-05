# LiteRAG 部署指南

> 使用宝塔面板部署？见专属指南 [BAOTA-DEPLOYMENT.md](./BAOTA-DEPLOYMENT.md)。

## 1. 环境要求

| 项 | 要求 |
|----|------|
| Node.js | **≥ 21.7**（与本地开发环境一致，`node -v` 验证） |
| npm | 随 Node 附带 |
| 网络 | 服务器需能访问 `https://api.deepseek.com` |

**为什么没有原生模块编译问题**：本项目使用 `libsql`（better-sqlite3 兼容 API 的 fork）替代 better-sqlite3。better-sqlite3 对 Node 21（非 LTS）不提供预编译包，源码编译又需要 Visual Studio C++ 工具链；libsql 采用 N-API 预编译二进制（ABI 稳定），**任何受支持的 Node 版本均即装即用，无需 `npm rebuild`**。

> 若 C 盘空间不足导致 npm 安装失败，可将缓存重定向到数据盘：`npm install --cache "D:\npm-cache-tmp"`。

## 2. 安装

```bash
cd smart-customer-service
npm install
```

## 3. 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 必填
DEEPSEEK_API_KEY=sk-your-key-here
# 可选（默认 https://api.deepseek.com）
# DEEPSEEK_BASE_URL=https://api.deepseek.com
# 可选（默认 3000）
# PORT=3000

# 可选：语义检索（不配置则 FAQ/文档使用纯关键词检索），任何 OpenAI 兼容 /embeddings 接口。
# 推荐硅基流动 SiliconFlow 的 BGE-M3（中文效果好，注册即送免费额度）：
# EMBEDDING_API_KEY=sk-your-siliconflow-key
# EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
# EMBEDDING_MODEL=BAAI/bge-m3
# 配置后运行 npm run embed:check 验证连通性

# 可选：知识库文件自定义路径（默认 server/faq-data.json）
# FAQ_DATA_PATH=D:/kb/faq-data.json
# 可选：数据库文件自定义路径（默认 data/chat.db）
# DB_PATH=D:/kb/chat.db
```

`.env` 由服务端启动时自动加载（不覆盖已存在的环境变量）。也可以不建 `.env`，启动后在应用「设置」页填入 API Key（**仅当前进程有效，重启丢失**，生产环境务必用 `.env`）。

> 上传限制：问答文件导入 ≤10MB、文档知识库 ≤20MB、图片问答最多 4 张（单张 ≤5MB）。若使用 nginx 反向代理，需同步设置 `client_max_body_size`（见下文示例）。

## 4. 开发模式

```bash
npm run dev
```

- 前端：http://localhost:5173（vite，`/api` 代理到 3000）
- 后端：http://localhost:3000

## 5. 生产部署（推荐流程）

### 5.1 构建

```bash
npm run build
```

该命令依次执行：前端类型检查（tsconfig.json）→ 后端/配置类型检查（tsconfig.node.json）→ vite 构建前端到 `dist/`。任一步失败即中止。

### 5.2 启动

```bash
npm start
```

单进程单端口（默认 3000）：Express 同时提供 REST API、SSE 流式接口，并托管 `dist/` 静态文件（非 `/api` 路由统一回落到 `index.html`，前端路由直接可访问，如 `/admin`）。

### 5.3 部署校验

```bash
curl http://localhost:3000/api/health        # {"status":"ok",...}
curl http://localhost:3000/api/check-login   # isLoggedIn:true 表示 API Key 生效
curl -I http://localhost:3000/               # 200，返回前端页面
```

### 5.4 进程守护（PM2）

```bash
npm install -g pm2
pm2 start npm --name customer-service -- start
pm2 save && pm2 startup      # 开机自启（按提示执行输出的命令）
pm2 logs customer-service
```

Windows 服务器可将 `pm2 start` 写入计划任务，或使用 NSSM 注册为系统服务，命令同样是 `npm start`。

## 6. 反向代理（nginx 示例）

对话接口是 SSE 流式响应，代理层必须关闭缓冲：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # 上传体积上限（图片问答 JSON 体 / 文档上传 ≤20MB）
        client_max_body_size 50m;

        # SSE 关键配置
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

## 7. 数据与知识库

| 内容 | 位置 | 说明 |
|------|------|------|
| 业务数据库 | `data/chat.db`（含 `-wal`/`-shm`） | 升级/迁移时整目录备份；可在停机后只保留 `chat.db` |
| FAQ 知识库 | `server/faq-data.json` | 管理后台「知识库管理」页维护，或直接编辑；改完即生效（热更新），无需重启 |
| FAQ 语义向量缓存 | `data/faq-vectors.json` | FAQ 条目向量自动生成；删除后下次检索时按需重建（需语义检索已配置）。文档 RAG 向量存在数据库 `kb_chunks` 表中，随 `chat.db` 一并备份 |
| 前端构建产物 | `dist/` | 可随时用 `npm run build` 重建 |

备份建议：每日低峰 `cp data/chat.db backup/chat-$(date +%F).db`（先 `sqlite3 "VACUUM INTO ..."` 或停机复制更稳妥）。

## 8. 升级流程

```bash
# 1. 备份数据
cp -r data data_backup_$(date +%F)
# 2. 更新代码后
npm install        # 依赖有变化时
npm run build
pm2 restart customer-service
# 3. 校验
curl http://localhost:3000/api/health
```

## 9. 常见问题

**启动即崩溃 / 提示找不到数据库模块**
确认 `node -v ≥ 21.7` 且 `npm install` 完整执行；libsql 不需要 rebuild，若曾混装 better-sqlite3 请删除 `node_modules` 重装。

**对话报错「未配置 DEEPSEEK_API_KEY」**
`.env` 缺失或键名写错；或通过设置页临时注入（重启失效）。检查：`GET /api/check-login`。

**端口被占用**
`.env` 中改 `PORT`，或修改 nginx `proxy_pass` 指向新端口。

**C 盘满导致 npm 失败（ENOSPC）**
npm/node-gyp 缓存默认在 C 盘，用 `--cache "D:\npm-cache-tmp"` 重定向；并清理 `C:\Users\Release\AppData\Local\npm-cache`。

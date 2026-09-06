# LiteRAG 宝塔面板部署指南

适用于宝塔面板（Linux）部署 LiteRAG。相比传统 Node 部署，本项目有一个天然优势：**数据库驱动为 libsql（N-API 预编译），无需在服务器上安装任何编译工具链（gcc/make/python）**，装好 Node 即可跑。

> 前置要求：宝塔面板 7.x+；Node.js **≥ 21.7**（推荐 22.x LTS）；已获取 DeepSeek API Key。

## 1. 安装环境（软件商店）

在宝塔「软件商店」安装：

| 软件 | 用途 |
|------|------|
| **Nginx** | 反向代理（SSE 流式 + 上传体积配置是关键，见第 6 步） |
| **Node.js 版本管理器** | 安装并切换 Node 22.x（新版面板也可直接用「网站 → Node项目」模块） |
| PM2 管理器（可选） | 旧版面板用 PM2 管理进程；新版推荐用「Node项目」模块替代 |

安装 Node.js 版本管理器后，在其中**安装 22.x LTS 并设为默认版本**。注意：PM2 管理器旧版内置的 Node 较老（16/18），不满足本项目 `engines: >=21.7` 的要求，务必通过版本管理器切换到 22.x，或使用新面板的「Node项目」功能（可在项目设置中指定 Node 版本）。

终端验证（宝塔「终端」或 SSH）：

```bash
node -v   # 应 ≥ v21.7，推荐 v22.x
npm -v
```

## 2. 上传代码

方式任选：

```bash
# 方式 A：git 拉取（推荐，便于后续升级）
cd /www/wwwroot
git clone https://github.com/agaziki/LiteRAG.git
cd LiteRAG

# 方式 B：面板「文件」中上传 zip 后解压到 /www/wwwroot/LiteRAG
```

> 国内服务器拉取/安装缓慢时，可先切换 npm 镜像：`npm config set registry https://registry.npmmirror.com`

## 3. 安装依赖与构建

```bash
cd /www/wwwroot/LiteRAG
npm install          # 必须包含 devDependencies（构建需要 vite/typescript），不要加 --production
npm run build        # 类型检查 + 构建前端到 dist/
```

## 4. 配置环境变量

```bash
cp .env.example .env
vi .env   # 或用宝塔文件管理器编辑
```

必须填写 `DEEPSEEK_API_KEY`；如需语义检索，推荐配置硅基流动 BGE-M3（示例见 `.env.example`，配置后可用 `npm run embed:check` 自检）。**`.env` 已被 gitignore，升级代码不会覆盖。**

## 5. 启动项目（两种方式二选一）

### 方式 A：面板「Node项目」模块（新版宝塔推荐，图形化守护）

**前置**：在「软件商店」安装 **Node.js 版本管理器**，安装 22.x 并在设置中设为命令行默认版本。首次进入「网站 → Node项目」时若提示安装管理器组件，按提示安装即可。

**添加项目**：宝塔「网站」→ 顶部标签切换到 **Node项目** → **添加Node项目**，表单逐项填写：

| 表单项 | 填写值 | 说明 |
|--------|--------|------|
| 项目目录 | `/www/wwwroot/LiteRAG` | 必须是包含 `package.json` 的目录，面板据此识别项目 |
| 项目名称 | `literag` | 默认取目录名，可自定；同时也是 pm2 中的进程名 |
| 启动选项 | `start` | 面板会自动读取 `package.json` 的 scripts 下拉展示，选 `start`（对应 `tsx server/index.ts`） |
| Node版本 | 22.x | 下拉选择已安装的版本；务必 ≥21.7 |
| 项目端口 | `3000` | 与 `.env` 中 `PORT` 一致（不配 .env 时默认 3000） |
| 运行用户 | `www`（默认） | 保持默认即可 |

提交后面板自动拉起并守护项目。验证：

```bash
pm2 list                      # 应看到名为 literag 的进程，状态 online
curl http://127.0.0.1:3000/api/health   # {"status":"ok",...}
```

日常管理（任选）：

- 面板：Node项目列表中「启动 / 停止 / 重启」按钮；「日志」查看输出与报错
- 终端：`pm2 restart literag`、`pm2 logs literag`

**环境变量说明**：Node项目以 www 用户运行，www 用户的 shell 环境变量（.bashrc 等）对项目无效——**本项目无需担心这一点**，`.env` 由服务端启动时自行加载（放项目根目录即可，注意 www 用户需有读权限，默认 644 满足）。

**对外访问（外网映射）**：项目列表 → 项目「设置」→ 开启「外网映射」→ 填入域名、外网端口 `80`，面板自动生成反向代理。

> ⚠️ 外网映射自动生成的反代**不含 SSE 与上传配置**（会导致回复卡顿一次性输出、图片/文档上传 413）。开启后务必按第 6 步修改对应的反代配置文件补齐 `proxy_buffering off` 与 `client_max_body_size 50m`。也可以不开启外网映射，改按第 6 步手动建站反代（效果相同）。

**启动失败排查**：项目「日志」中查看报错。常见原因：Node 版本未切到 22.x、3000 端口被占用（`ss -tlnp | grep 3000`）、`npm run build` 未执行导致 dist 缺失（不影响 API，但页面 404）。

### 方式 B：终端 PM2（通用）

```bash
cd /www/wwwroot/LiteRAG
pm2 start npm --name literag -- start
pm2 save && pm2 startup   # 按提示执行输出的命令，实现开机自启
```

> 若终端提示找不到 pm2/npm：在宝塔「Node.js 版本管理器」设置里打开「环境变量」/「将版本设为命令行默认」，或改用方式 A。

## 6. 建站与反向代理（关键步骤）

1. 宝塔「网站」→ 添加站点：填域名，**纯静态**即可（无需 PHP/数据库）
2. 进入该站点 →「反向代理」→ 添加反向代理：目标 URL `http://127.0.0.1:3000`
3. **必须手工调整反代配置**（宝塔默认模板会缓冲 SSE、且上传体积默认 1MB）。编辑站点反代配置文件（面板路径：站点设置 → 反向代理 → 配置文件，或 `/www/server/panel/vhost/nginx/proxy/你的域名/*.conf`），在 `location /` 中补齐：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # 上传体积上限（图片问答 JSON 体 / 文档上传 ≤20MB）
    client_max_body_size 50m;

    # SSE 流式关键配置（缺少会导致回复"卡住后一次性蹦出"）
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
}
```

4. 防火墙：宝塔「安全」+ 云厂商安全组只需放行 **80/443**；**3000 端口保持不对公网开放**（仅本机反代访问）。

## 7. SSL 证书

站点设置 → **SSL** → Let's Encrypt 一键申请并开启「强制 HTTPS」。客服对话若部署在公网，强烈建议启用 HTTPS。

## 8. 部署校验

```bash
curl http://127.0.0.1:3000/api/health        # {"status":"ok",...}   —— 后端本身
curl https://你的域名/api/health              # 经 nginx 反代后同样返回 ok
curl https://你的域名/api/check-login         # isLoggedIn:true 表示 API Key 生效
```

浏览器打开 `https://你的域名` 进入客服界面，`/admin` 进入管理后台。

## 9. 升级流程

```bash
cd /www/wwwroot/LiteRAG
cp -r data data_backup_$(date +%F)     # 备份数据（含 chat.db 与向量缓存）
git pull
npm install                            # 依赖有变化时
npm run build
# 方式 A：面板 Node项目 中点「重启」；方式 B：pm2 restart literag
```

## 10. 备份（计划任务）

宝塔「计划任务」添加每日 Shell 脚本：

```bash
cd /www/wwwroot/LiteRAG
tar czf /www/backup/literag-$(date +%F).tar.gz data server/faq-data.json .env
find /www/backup -name "literag-*.tar.gz" -mtime +14 -delete
```

备份内容：数据库（含文档 RAG 向量）、知识库 JSON、环境配置。

## 常见问题

| 现象 | 原因与处理 |
|------|-----------|
| 启动报错 `engines` / libsql 加载失败 | Node 版本低于 21.7。在版本管理器切到 22.x，PM2 管理器用户注意其内置 Node 可能仍是老版本 |
| 回复"卡住然后一次性蹦出" | nginx 缺少 `proxy_buffering off`（见第 6 步），SSE 被缓冲 |
| 上传图片/文档报 413 | nginx `client_max_body_size` 未设置（默认 1MB），设为 50m 后 `nginx -s reload` |
| 对话报「未配置 DEEPSEEK_API_KEY」 | `.env` 不在项目根目录、键名拼错，或用 PM2 管理器启动时未继承环境；`GET /api/check-login` 排查 |
| 端口 3000 被占用 | `.env` 中改 `PORT`，反代目标同步修改 |
| npm install 极慢/失败 | 切换 npmmirror 镜像（见第 2 步）；本项目无需编译原生模块，不存在 node-gyp 报错 |

---

相关文档：[通用部署指南](./DEPLOYMENT.md)（PM2/裸机部署、数据备份细节） · [二次开发指南](./DEVELOPMENT.md)

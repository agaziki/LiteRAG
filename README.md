# LiteRAG · 智能客服 RAG Agent

[![CI](https://github.com/agaziki/LiteRAG/actions/workflows/ci.yml/badge.svg)](https://github.com/agaziki/LiteRAG/actions/workflows/ci.yml)

基于 **DeepSeek API**（OpenAI 兼容接口）构建的开源智能客服应用：FAQ 问答库 + 文档知识库（RAG）双引擎检索，支持多轮对话、图片问答（视觉模型）、意图识别、自动转人工、满意度评价与运营后台。

> GitHub：https://github.com/agaziki/LiteRAG · License: MIT

## 核心特性

- 💬 **多轮对话** - Function Calling Agent 循环，SSE 流式响应
- 🖼 **图片问答** - 对话输入框直接附带图片（最多 4 张、单张 ≤5MB），配合视觉模型识图作答，支持点击放大
- 🎯 **意图识别** - 退款 / 查询订单 / 技术支持 / 通用咨询 / 其他，`record_intent` 工具自动记录
- 📚 **FAQ 问答库** - 结构化知识库 + 关键词加权评分，支持管理后台可视化维护、Excel/CSV/Markdown/JSON 批量导入
- 📄 **文档知识库（RAG）** - 上传 Word/PDF/TXT/Markdown，自动切块向量化，块级检索与 FAQ 融合排序，AI 回答注明文档出处
- 🔍 **语义混合检索** - 关键词评分 + 向量余弦相似度融合排序，检索门槛（minScore）拦截不相关结果
- 👨‍💼 **自动转人工** - 高风险/敏感/无法解决场景自动触发；用户可留言补充联系方式；管理后台「接入」后可**以人工客服身份回复**（用户对话中特殊样式展示），状态自动轮询更新
- 🎭 **话题边界策略** - 温和模式（无关话题礼貌拒答并引导回业务）/ 开放模式（通用问题照答，业务事实检索优先），`.env` 默认值 + 管理后台即时切换
- ⭐ **满意度评价** - 1-5 星 + 文字反馈，与管理统计联动
- 📊 **管理后台** - 满意度/意图分布、对话记录、转人工处理、知识库管理与检索测试
- 📤 **知识库导出** - JSON / CSV / Excel 一键导出，与导入形成备份-迁移闭环
- 📈 **Token 用量统计** - 按会话/按日统计 token 消耗，支持成本估算（单价可配）
- 🧭 **知识缺口报表** - 聚合其他意图/低星评价/转人工会话，生成知识库盲区清单并一键预填补充
- 🎯 **Rerank 精排（可选）** - 两阶段检索：粗筛 top-20 后精排重排序，进一步提命中率
- 📎 **引用溯源** - 回答附「参考来源」折叠面板，展示命中的 FAQ 条目与文档片段
- 🧑‍💼 **多租户** - 匿名访客身份自动隔离会话，管理员全局视角
- ⚡ **实时人工** - WebSocket 坐席通道：转人工实时推送、实时回复
- 📊 **运营看板** - 响应时延分布、知识命中率统计
- 🧩 **网页挂件** - 一段 `<script>` 接入任意站点（`/embed.js`）
- 👤 **账号体系** - 可选注册/登录，匿名会话跨设备并入
- 🔌 **渠道桥接** - 企微/公众号经 webhook 接入，复用全部客服管线
- 🖼 **历史图片回传** - 视觉模型支持「再看刚才那张图」（可开关）
- 🎨 **主题切换** - 深色 / 浅色

## 技术栈

- **后端**: Node.js (≥21.7) + Express + TypeScript（tsx 直接运行）
- **前端**: React 18 + TypeScript + Vite + TDesign React + Tailwind CSS
- **AI**: DeepSeek API（`openai` SDK，OpenAI 兼容接口）
- **数据库**: libsql（better-sqlite3 兼容 API，N-API 预编译，无需本机编译工具链）
- **文档解析**: mammoth(.docx) + pdfjs-dist(.pdf)

## 可用模型

| 模型 ID | 说明 |
|---------|------|
| `deepseek-v4-flash` | **默认模型**。DeepSeek V4 系列高效 MoE 模型（公测），支持函数调用与长上下文，性价比高 |
| `deepseek-v4-flash-vision-exp` | 实验版：在 V4-Flash 基础上支持图片输入 |

> 模型列表在 `server/deepseek-agent.ts` 的 `getDeepSeekModels()` 中维护，默认模型为 `deepseek-v4-flash`。输入框工具栏的图片按钮仅在选用视觉模型时显示。

## 图片问答（视觉模型）

三种添加图片的方式（**图片按钮仅在选用视觉模型时显示**）：

1. **点击上传**：输入框工具栏「图片」按钮选择文件（最多 4 张，单张 ≤5MB，png/jpeg/webp/gif）
2. **拖拽上传**：将本地图片文件或**网页中的商品图片**直接拖入输入框区域（网页图片由服务端抓取转存，含内网地址拦截等 SSRF 防护）
3. **粘贴上传**：截图后直接在页面 `Ctrl+V` 粘贴

发送后图片以缩略图显示在消息气泡上方，点击可放大查看。

技术说明：图片以 data URL 随消息持久化到 SQLite；发送给视觉模型时构建 OpenAI 多模态消息体（text + image_url）；多轮对话中历史图片不重复上传（以文字备注占位），仅当前消息的图片进入模型。

## 长对话历史管理

超出滑动窗口（默认最近 30 条消息，`HISTORY_WINDOW` 可调）的更早历史，会由模型自动压缩为 ≤300 字的会话摘要，以附加 system 上下文注入——模型始终掌握全局语境，请求体不会随会话增长无限膨胀。

- 摘要按会话缓存（`sessions.summary`），窗口外新增消息累计超过阈值才重新生成
- 摘要生成失败时自动降级为纯窗口模式，不影响对话
- 图片等大体积内容不进入摘要，仅以文字备注占位

## 快速开始

```bash
git clone https://github.com/agaziki/LiteRAG.git
cd LiteRAG
npm install

cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY（获取：https://platform.deepseek.com）

npm run dev
```

- 客服界面：http://localhost:5173
- 管理后台：http://localhost:5173/admin
- 后端 API：http://localhost:3000

## DeepSeek 接入架构

```
用户提问
   │
   ▼
后端 /api/chat (SSE)
   │
   ▼
runDeepSeekAgent()  ──► openai SDK (base_url: https://api.deepseek.com)
   │                      model: deepseek-v4-flash (支持函数调用)
   │
   ▼
DeepSeek 返回文本流 + tool_calls
   │
   ├─ 文本 → SSE type:"text" 推送前端
   │
   └─ tool_calls → 服务端直接执行本地工具（无需 Bash 权限）：
        ├─ search_faq        → 知识库混合检索（FAQ 条目 + 文档块融合排序）
        ├─ record_intent     → 写入 SQLite session_intents 表
        └─ escalate_to_human → 写入 SQLite escalations 表
   │
   ▼
工具结果回传 DeepSeek → 继续生成回复（Agent 循环，最多 8 轮）
   │
   ▼
用户评价（1-5 星）──► POST /api/ratings
```

三大专用工具由服务端直接执行（调用本地检索/DB 函数），**不给模型任何 Bash/代码执行权限**，安全可控。转人工触发条件写在系统提示词中（`server/customer-service-prompt.ts`）：用户主动要求、连续 2 轮意图不明、高风险操作、同一问题追问 2 次未解决、账号/资金类敏感问题。

## 关于语义检索：为什么向量不是 DeepSeek 生成的？

**DeepSeek API 目前不提供 embeddings（文本向量化）端点**——官方模型列表与定价页中没有任何 embedding 模型，官方也曾在 HuggingFace 确认 embeddings 在开发计划中但尚未上线（详见 [DeepSeek API Docs](https://api-docs.deepseek.com/)、[List Models](https://api-docs.deepseek.com/api/list-models/)、[GitHub Issue #802](https://github.com/deepseek-ai/DeepSeek-R1/issues/802)）。因此语义检索采用**可插拔设计**：任何 OpenAI 兼容的 `/embeddings` 服务均可接入，默认推荐**硅基流动 SiliconFlow 的 BGE-M3**（中文效果好、注册即送免费额度）：

```env
# 硅基流动 SiliconFlow（https://cloud.siliconflow.cn 注册创建 API Key）
EMBEDDING_API_KEY=sk-your-siliconflow-key
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDING_MODEL=BAAI/bge-m3
```

配置完成后运行 `npm run embed:check` 可一键验证连通性（输出向量维度与耗时）。其他 OpenAI 兼容服务（火山引擎 Ark、OpenAI、本地 ollama/vLLM 等）同样支持。不配置时系统自动退化为纯关键词检索（含 CJK 二元词匹配），全部功能可用。若 DeepSeek 未来上线 embeddings 端点，无需改代码，直接把上面的配置指向 DeepSeek 即可。

## FAQ 问答库

支持四种维护方式（详见管理后台「知识库管理」页）：

1. **可视化维护**：增删改分类/条目、维护触发关键词，内置检索测试框（实时查看命中与得分）
2. **文件批量导入**：Excel(.xlsx) / CSV / Markdown / JSON，合并导入（按问题去重更新，幂等）或覆盖导入；CSV 自动识别 UTF-8/GBK
3. **直接编辑** `server/faq-data.json`（mtime 热更新，无需重启）
4. **管理 API**（见下表）

检索评分：分类关键词 +5/个、问题 +3/词、标签 +2/词、答案 +1/词、整串命中问题 +4；低于 `search.minScore`（默认 5）的结果不返回，避免 AI 硬套无关答案。

## 文档知识库（RAG）

- **格式**：Word(.docx) / PDF / TXT / Markdown，单文件 ≤ 20MB
- **管线**：抽取纯文本 → 切块（Markdown 按标题切节并保留章节路径，纯文本按段落聚合，单块 ≤ 500 字）→ 存入 SQLite（`kb_docs`/`kb_chunks`）
- **融合排序**：文档块与 FAQ 条目统一评分，FAQ 条目有 +4 精选加权（人工整理的答案优先）
- **向量缓存**：增量嵌入（仅新块/变更块），存于 `kb_chunks` 表，模型切换自动全部重建

## 管理后台

访问 `/admin`，顶部标签切换两个模块：

**对话分析**：概览卡片（总会话/平均满意度/转人工率/解决率）、满意度与意图分布、对话记录表（可按意图筛选）、会话详情抽屉（完整消息/转人工处理/评价/意图历史）

**知识库管理**：检索测试框（实时查看命中条目、关键词分/语义分）、FAQ 分类与条目 CRUD、文件批量导入 + CSV 模板下载、文档知识库上传/删除

## API 端点

### 客服业务

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/chat` | POST | 发送消息（SSE 流式，Function Calling） |
| `/api/faq/search?q=&limit=` | GET | 知识库混合检索（FAQ 条目 + 文档片段） |
| `/api/faq` | GET | 获取全部 FAQ |
| `/api/faq/categories` | POST | 新增分类 |
| `/api/faq/categories/:categoryId` | PATCH/DELETE | 更新 / 删除分类 |
| `/api/faq/items` | POST | 新增条目 |
| `/api/faq/items/:itemId` | PATCH/DELETE | 更新 / 删除条目 |
| `/api/faq/import` | POST | 问答文件批量导入（multipart，file + mode=merge/replace） |
| `/api/faq/import/template` | GET | 下载 CSV 导入模板 |
| `/api/faq/docs` | POST/GET | 上传文档入库 / 文档列表 |
| `/api/faq/docs/:docId` | DELETE | 删除文档及其所有块 |
| `/api/intent` | POST | 记录用户意图 |
| `/api/escalate` | POST | 创建转人工事件 |
| `/api/escalate/:sessionId` | GET | 查询会话转人工状态 |
| `/api/ratings` | POST | 提交满意度评价 |
| `/api/ratings/:sessionId` | GET | 查询会话评价 |

### 管理后台

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/admin/stats` | GET | 总览统计 + 会话列表 |
| `/api/admin/sessions/:id` | GET | 会话详情（消息/评价/转人工/意图） |
| `/api/admin/escalations/:id` | PATCH | 更新转人工状态 |

### 基础

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/check-login` | GET | 检查 DEEPSEEK_API_KEY 配置状态 |
| `/api/save-env-config` | POST | 运行时保存 DeepSeek 配置 |
| `/api/models` | GET | 可用模型列表 |
| `/api/sessions` | GET/POST | 会话列表 / 创建 |
| `/api/sessions/:id` | GET/PATCH/DELETE | 单会话操作 |

## 项目结构

```
LiteRAG/
├── server/                        # 后端
│   ├── index.ts                   # Express + SSE + 全部 API 路由 + 静态托管
│   ├── deepseek-agent.ts          # Agent 引擎（Function Calling 循环 + 三个专用工具）
│   ├── db.ts                      # libsql 数据层（会话/消息/评价/转人工/意图/文档块）
│   ├── faq.ts                     # 知识检索（混合评分、FAQ/文档融合）+ 管理/导入应用
│   ├── faq-import.ts              # 问答文件导入解析层（CSV/XLSX/MD/JSON）
│   ├── kb-docs.ts                 # 文档知识库 RAG（抽取/切块/向量/块级检索）
│   ├── embeddings.ts              # Embedding 客户端（OpenAI 兼容，可插拔）
│   ├── faq-data.json              # FAQ 知识库数据
│   └── customer-service-prompt.ts # 客服系统提示词
├── src/                           # 前端（React + TDesign）
│   ├── pages/                     # ChatPage / AdminPage
│   ├── components/                # 消息列表/输入框/知识库管理/设置页 等
│   └── hooks/                     # useChat / useSessions / useAgents / useModels / useTheme
├── scripts/                       # 测试与自检脚本（检索/导入/RAG/图片/历史 五套测试 + e2e/embed 自检）
├── data/                          # SQLite 数据库（运行时生成，已 gitignore）
└── .env.example                   # 环境变量模板
```

## 测试

```bash
npm test              # 五套验证脚本：检索/门槛/融合、文件导入、文档 RAG、图片管线、历史管理（共 90 项断言）
npm run embed:check   # 验证 embedding 服务连通性（需先配置 EMBEDDING_* 环境变量）
npm run e2e:check     # 真实 Key 端到端回归：对话/FAQ 工具/视觉识图/边界/转人工（需服务已启动且配置 DEEPSEEK_API_KEY）
```

## 安全与隐私（开源说明）

- 仓库**不包含任何密钥**：API Key 仅通过 `.env`（已 gitignore）或运行时设置页注入
- `data/`（数据库与向量缓存）已 gitignore，不随仓库分发
- 对话内容与知识库数据仅存储在本地 SQLite，唯一的对外调用是 DeepSeek API 与（可选的）embedding 服务
- **管理后台权限控制**：在 `.env` 中配置 `ADMIN_PASSWORD` 后，访问 `/admin` 需输入密码（登录有效期 8 小时）；知识库的检索、管理与文档上传 API 同样受此保护。**未配置 `ADMIN_PASSWORD` 时，管理后台与知识库管理 API 整体禁用**（返回 503 提示），公网部署务必设置
- **普通用户界面不含设置与管理入口**：设置（API Key、Agent、话题边界）已归入管理后台「系统设置」标签，管理员通过 `/admin` 直链访问；访问 `/settings` 会自动跳回对话页
- 图片问答仅支持 png/jpeg/webp/gif 的 data URL（服务端强校验，最多 4 张、单张 ≤5MB），不上传至任何第三方存储

## 生产部署

```bash
npm run build   # 类型检查 + 构建前端到 dist/
npm start       # 单端口 3000：API + 前端静态托管（SPA）
```

完整部署流程（PM2 进程守护、nginx 反向代理 SSE 配置、数据备份、升级与故障排查）见 [DEPLOYMENT.md](./DEPLOYMENT.md)；**宝塔面板部署**见 [BAOTA-DEPLOYMENT.md](./BAOTA-DEPLOYMENT.md)；二次开发指南见 [DEVELOPMENT.md](./DEVELOPMENT.md)；版本规划见 [ROADMAP.md](./ROADMAP.md)；更新日志见 [CHANGELOG.md](./CHANGELOG.md)。

**网页挂件接入**：在任意站点 `</body>` 前加入：

```html
<script>window.LiteRAGConfig = { server: "https://your-literag-domain.com" };</script>
<script src="https://your-literag-domain.com/embed.js"></script>
```

## License

[MIT](./LICENSE)

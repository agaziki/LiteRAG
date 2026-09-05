# LiteRAG 二次开发指南

LiteRAG · 智能客服 RAG Agent（https://github.com/agaziki/LiteRAG）。本文档描述当前架构与常见定制方式。

## 技术栈

- **后端**: Node.js + Express + TypeScript，通过 `tsx` 直接运行 TS
- **数据库**: libsql（better-sqlite3 兼容 API，N-API 预编译，无需本机编译工具链）
- **前端**: React 18 + TypeScript + Vite + TDesign React + Tailwind CSS
- **AI**: DeepSeek API（`openai` SDK 接入）

## 目录结构

```
smart-customer-service/
├── server/                        # 后端（tsx 直接运行 .ts）
│   ├── index.ts                   # Express 入口：.env 加载、全部 API 路由、SSE、静态托管
│   ├── deepseek-agent.ts          # Agent 引擎：函数调用循环 + 三个专用工具
│   ├── db.ts                      # libsql 数据层（8 张表 + 统计聚合）
│   ├── faq.ts                     # FAQ 检索（关键词+语义混合、检索门槛）+ 知识库 CRUD/导入应用
│   ├── faq-import.ts              # 问答文件导入解析层（CSV/XLSX/MD/JSON → 统一中间结构）
│   ├── kb-docs.ts                 # 文档知识库 RAG：抽取/切块/入库/向量同步/块级检索
│   ├── embeddings.ts              # Embedding 客户端（OpenAI 兼容 /embeddings，可选）
│   ├── faq-data.json              # FAQ 知识库数据（后台维护/文件导入/直接编辑，改完即生效）
│   └── customer-service-prompt.ts # 客服系统提示词
├── src/                           # 前端
│   ├── App.tsx                    # 路由（/ /chat/:id /settings /admin）+ 状态编排
│   ├── pages/
│   │   ├── ChatPage.tsx           # 客服对话页
│   │   └── AdminPage.tsx          # 管理后台
│   ├── components/
│   │   ├── ChatMessages.tsx       # 消息列表（contentBlocks 时序渲染 + 评价 + 转人工横幅）
│   │   ├── ChatInput.tsx          # 输入框（模型选择器）
│   │   ├── ToolCallsCollapse.tsx  # 工具调用展示
│   │   ├── RatingStars.tsx        # 满意度评价
│   │   ├── EscalationBanner.tsx   # 转人工状态横幅
│   │   ├── FaqManager.tsx         # 知识库管理（增删改分类/条目 + 文件导入 + 检索测试）
│   │   ├── SettingsPage.tsx       # 设置页（DeepSeek API Key + 自定义 Agent）
│   │   └── Sidebar.tsx / Header.tsx / NewChatView.tsx
│   ├── hooks/
│   │   ├── useChat.ts             # SSE 解析、消息状态、停止、草稿
│   │   ├── useSessions.ts         # 会话列表 + 懒加载消息
│   │   ├── useAgents.ts           # Agent 配置（localStorage）
│   │   ├── useModels.ts           # 模型列表
│   │   └── useTheme.ts            # 深色/浅色主题
│   ├── types.ts                   # 前端类型
│   └── config.ts                  # 应用名/描述
├── data/chat.db                   # SQLite 数据库（自动建表）
└── dist/                          # 前端构建产物（npm run build 生成，生产模式由后端托管）
```

## 核心流程

### 1. 对话链路（POST /api/chat，SSE）

```
校验 message → 取/建会话 → 读历史 → 用户消息落库
→ 发送 init 事件（sessionId / userMessageId / assistantMessageId / model）
→ runDeepSeekAgent():
    messages = [system] + 历史 + 当前消息
    循环（最多 8 轮）：
      DeepSeek 流式调用（tools + tool_choice:auto）
      ├─ 文本增量 → SSE {type:"text"}
      └─ tool_calls 按 index 累积拼装
           无工具调用 → 结束
           有工具调用 → executeTool() 服务端直接执行 → role:"tool" 回传 → 下一轮
→ 助手消息（含 tool_calls JSON）落库 → SSE {type:"done"}
```

出错时发送 `{type:"error", message}`（API Key 缺失、模型调用失败等），前端会结束流式状态并在气泡中提示。

### 2. SSE 事件协议（后端 → 前端）

| type | 载荷 | 说明 |
|------|------|------|
| `init` | sessionId, userMessageId, assistantMessageId, model | 会话/消息 ID 对齐（前端临时 ID → 数据库 ID） |
| `text` | content | 文本增量 |
| `tool` | id, name, input | 工具调用开始 |
| `tool_result` | toolId, content, isError | 工具执行结果 |
| `done` | duration, turns | 本轮结束 |
| `error` | message | 服务端错误 |

前端 `useChat.ts` 按 `data: ` 行解析，**跨网络分包的半行会缓冲拼接**后再解析。

### 3. 三个专用工具（服务端执行，模型无 Bash 权限）

| 工具 | 执行 | 落库 |
|------|------|------|
| `search_faq` | `faq.ts` 关键词评分检索 | 无 |
| `record_intent` | 直接写入 | `session_intents` |
| `escalate_to_human` | 直接写入（默认 pending） | `escalations` |

工具定义在 `deepseek-agent.ts` 的 `TOOLS`，执行在 `executeTool()`。触发条件写在系统提示词（`customer-service-prompt.ts`）中，由模型判断调用。

### 4. FAQ 检索（server/faq.ts）

- **关键词评分**：分类关键词 +5/个、问题 +3/词、标签 +2/词、答案 +1/词、整串命中问题 +4
- **检索门槛**：关键词分低于 `faq-data.json` 的 `search.minScore`（默认 5）不返回，避免 AI 硬套无关答案
- **语义检索（可选）**：配置 `EMBEDDING_API_KEY`/`EMBEDDING_BASE_URL`/`EMBEDDING_MODEL`（OpenAI 兼容 /embeddings）后启用。条目向量缓存在 `data/faq-vectors.json`（内容 hash 变化才重嵌入，并发同步合并为一次请求）；命中条件 = 关键词分 ≥ minScore **或** 余弦相似度 ≥ 0.45，综合分 = 关键词分 + 10 × 相似度。向量接口失败自动回退纯关键词
- **管理写操作**：`addFaqItem/updateFaqItem/deleteFaqItem` 与分类 CRUD 同样在 faq.ts，写回 JSON 采用临时文件+rename 原子写，写完缓存失效自动重载；`FAQ_DATA_PATH` 环境变量可指向自定义知识库文件
- **文件导入**：解析层在 `faq-import.ts`（CSV/XLSX/MD/JSON → 统一 `ParsedCategory[]` 中间结构），应用层在 `faq.ts` 的 `importFaq()`（merge 按问题 upsert / replace 整体覆盖）
- **文档知识库（RAG）**：`kb-docs.ts`。抽取：docx 用 mammoth、PDF 用 pdfjs-dist 4.x（legacy 构建；勿用 pdf-parse@1.1.1，其内置 pdf.js 1.10 与 jszip 同进程冲突，会误报合法 PDF 结构无效）。分块：标题切节（保留章节路径）+ 段落聚合 ≤500 字。检索：块级关键词分（含 CJK 二元词滑窗，解决整句查询无法子串命中）+ 语义余弦，与 FAQ 条目在 `searchKnowledge()` 融合排序（FAQ +4 精选加权）。向量存 `kb_chunks.vector`（JSON 文本），`kb_meta` 记录模型配置，模型变更自动全部重建；向量同步失败自动回退关键词。数据库路径可用 `DB_PATH` 重定向
- **图片问答（视觉模型）**：前端 ChatInput 选图（≤4 张、单张 ≤5MB，data URL）→ `/api/chat` 的 `images` 字段 → `validateImages()` 校验 → `buildUserContent()` 构建 OpenAI 多模态消息体（text + image_url 数组）→ 仅 `deepseek-v4-flash-vision-exp` 等视觉模型可用。图片持久化在 `messages.images`（JSON 数组）；**多轮历史中的图片不重复上传给模型**（成本考虑），以 `[该消息附带 N 张图片]` 文字备注占位，仅当前消息的图片进入模型。embedding 服务连通性可用 `npm run embed:check` 自检（默认推荐硅基流动 BGE-M3）

### 5. 数据库（server/db.ts）

8 张表：`sessions`、`messages`（tool_calls 存 JSON，用户消息附带的 images 存 JSON 数组）、`ratings`、`escalations`（pending/accepted/resolved）、`session_intents`、`kb_docs`/`kb_chunks`/`kb_meta`（文档 RAG）。外键级联删除，均建索引。启动自动建表（含 images 列自动迁移）；`getSessionsWithStats()` 子查询聚合出管理后台列表。

## 常见定制

| 需求 | 改哪里 |
|------|--------|
| 客服话术 / 转人工规则 | `server/customer-service-prompt.ts` |
| 扩展知识库 | 管理后台「知识库管理」标签页，或编辑 `server/faq-data.json`（无需重启） |
| 检索门槛/语义检索调优 | `faq-data.json` 的 `search.minScore`；`.env` 的 `EMBEDDING_*`；`faq.ts` 顶部 SEMANTIC_WEIGHT/SEMANTIC_THRESHOLD |
| 新增/调整工具 | `server/deepseek-agent.ts` 的 `TOOLS` + `executeTool` |
| 新增 API | `server/index.ts` 加路由（注意放在静态托管段之前） |
| 新增数据表/字段 | `server/db.ts` 建表语句 + 操作函数 |
| 自定义 Agent | 应用内「设置」页，或 `src/hooks/useAgents.ts` 的 `DEFAULT_AGENT`（systemPrompt 留空则用后端内置客服提示词） |

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 同时启动后端（3000，tsx watch）与前端（5173，vite，代理 /api → 3000） |
| `npm run build` | tsc 类型检查（前后端各一个 tsconfig，均 noEmit）+ vite 构建到 dist/ |
| `npm start` | 生产模式：单端口 3000 提供 API + dist 静态托管 + SPA 兜底 |

## 调试

- 后端日志：`[Chat]` 前缀输出请求/工具调用/耗时；SSE 事件在浏览器 DevTools → Network → EventStream 查看
- 数据库：`node --input-type=module -e "import Database from 'libsql'; ..."` 或任意 SQLite 客户端打开 `data/chat.db`
- 前端状态：`useChat.ts` 的 `syncAssistantState` 是消息状态唯一写回点，出问题先看 SSE 原始事件与该函数

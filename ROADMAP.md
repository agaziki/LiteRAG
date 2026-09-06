# LiteRAG 路线图

> 当前版本：v1.3.0 · [已完成里程碑](#已交付) · [下一版本 v1.4](#下一版本-v14) · [Backlog](#backlog)

## 已交付

### v1.2.0 — 图片问答 + 转人工闭环 + 话题边界

- 图片问答：点击 / 拖拽（含网页商品图片，服务端抓取含 SSRF 防护）/ 粘贴，视觉模型联动显隐
- 转人工：用户留言 → 后台接入 → 人工客服身份回复 → 状态自动轮询
- 思考链时间线：工具调用人性化展示，原始数据默认折叠
- 管理后台权限控制（ADMIN_PASSWORD）+ 设置归入后台（/admin 直链访问）

### v1.3.0 — 历史管理 + CI + 真实链路回归

- **话题边界策略** ✅：`.env` 的 `TOPIC_BOUNDARY=strict|open` + 管理后台「系统设置」开关；
  温和模式对无关话题礼貌拒答并引导回业务（双模式系统提示词），开放模式维持常识回答 + 检索优先 + 兜底转人工。
  实现位置：`server/runtime-config.ts`、`customer-service-prompt.ts`、设置页开关。
  **真实 Key 回归验证**：温和模式下无关请求（写诗）被正确拒答并引导回业务
- **长会话历史截断** ✅：滑动窗口（`HISTORY_WINDOW`，默认 30 条）+ 窗口外历史 LLM 摘要压缩（≤300 字），
  摘要按会话缓存（`sessions.summary/summary_upto`），生成失败自动降级纯窗口模式。
  实现位置：`server/history.ts`、`deepseek-agent.ts#summarizeConversation`
- **GitHub Actions CI** ✅：push(main)/PR 自动执行类型检查 + 构建 + 全量测试（当前 90 项断言）。
  工作流：`.github/workflows/ci.yml`，已在 GitHub 实际运行并通过（2f830d2）
- **真实 Key 端到端回归** ✅：`npm run e2e:check`，6 项真链路验证（对话/FAQ 工具/视觉识图/边界/转人工）

## 下一版本 v1.4

### 1. 知识缺口报表（运营闭环）

聚合三类信号生成「知识库盲区清单」：`other` 意图占比高的会话、低星（≤3）评价会话、转人工原因分类。

- 后端：`GET /api/admin/knowledge-gaps` —— 聚合 `session_intents`（other 计数）+ `ratings`（低星 + 评语）+
  `escalations`（reason 分组），按会话输出：会话、信号类型、最后意图、评分、转人工原因
- 前端：管理后台新增「知识缺口」标签页，清单页 + 跳转按钮直达知识库管理新增条目（预填该会话的问题）
- 数据已全部在库（ratings/escalations/session_intents），只差聚合与展示

### 2. Token 用量统计

记录 DeepSeek 返回的 usage（prompt/completion/total tokens），按会话与按日聚合展示成本。

- 后端：`/api/chat` 流式调用增加 `stream_options: { include_usage: true }`，从流末尾取 usage；
  `messages` 表加 `usage` JSON 列（或独立 `token_usage` 表：session_id、日、prompt/completion tokens、model）
- 后端：`GET /api/admin/usage` —— 按日聚合 + 按模型单价（`.env` 可配单价）折算成本
- 前端：管理后台概览新增 Token/成本卡片，会话详情显示单会话消耗

### 3. FAQ 知识库导出（备份-迁移闭环）

- 后端：`GET /api/faq/export?format=json|csv|xlsx` —— JSON 即 faq-data.json 全量；CSV/Excel 用 exceljs
  按「分类/问题/答案/标签/关键词」列导出（与导入格式互逆，Excel 带 BOM）
- 前端：知识库管理工具栏增加「导出」下拉（JSON 备份 / Excel 表格）
- 鉴权：与导入同属管理接口，受 ADMIN_PASSWORD 保护

## Backlog（按需排期）

| 项 | 说明 |
|----|------|
| Rerank 两阶段检索 | 粗筛 top-20 后用 bge-reranker-v2-m3 精排（硅基流动），提升 RAG 命中率 |
| 图片管线安全加固 | 前端压缩（长边 2048）、EXIF 剥离、内容审核钩子 |
| `/api/save-env-config` 收口 | 公网部署下唯一的未保护写接口，纳入 ADMIN_PASSWORD 保护或提供禁用开关 |
| 接口限流 | 管理登录防爆破、`/api/chat` IP 限流 |
| 答案引用溯源 | 回答标注引用的文档/条目，点击查看原文块 |
| 向量规模化 | sqlite-vec / HNSW 索引，支撑十万级块检索 |
| 扫描版 PDF OCR | 文档知识库扩展图片型 PDF |
| 实时人工会话 | WebSocket 双向，替代异步人工回复 |

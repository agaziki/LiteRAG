# 更新日志

本项目的所有重要变更记录在案。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.0] — 多租户与实时人工

### 新增
- 访客身份与会话隔离：匿名 visitorId（httpOnly cookie，1 年）自动签发；会话全链路归属校验（列表/详情/删除/续聊/评价/转人工），越权 403；管理员不受限
- 实时人工坐席通道：WebSocket `/ws/agent`（ADMIN token 鉴权）——转人工 pending 实时推送、坐席实时回复（落库 human-agent 消息）、接入/解决操作；用户端零破坏兼容（轮询+特殊渲染）
- 数据看板增强：响应时延分布（平均/P50/P95）、知识命中率（FAQ/文档/未命中占比）
- 网页挂件：`/embed.js` 一段代码接入任意站点（悬浮按钮 + `/widget` iframe 对话窗）

### 变更
- HTTP 服务显式化（http.createServer）以承载 WebSocket 升级
- sessions 表新增 `visitor_id` 列（自动迁移）、messages 表新增 `latency_ms` 列（看板用）

[2.0.0]: https://github.com/agaziki/LiteRAG/compare/v1.4.1...v2.0.0

## [1.4.1] — 数据管理 + 发布工程

### 新增
- 管理后台「数据管理」标签页：会话批量清理（全部 / 按更新时间天数）、知识库重置（恢复出厂 / 清空）、数据规模统计
- E2E 回归入 CI：每日定时（北京时间 02:00）+ 手动触发，DeepSeek / 硅基流动 Key 通过 GitHub Secrets 注入
- `CHANGELOG.md`（本文件）与 v1.3.0 / v1.3.1 补充标签

## [1.4.0] — 检索质量与运营闭环

### 新增
- Rerank 两阶段检索：粗筛 top-20 → `bge-reranker-v2-m3` 精排重排序，失败自动回退（`RERANK_*` 环境变量）
- 知识缺口报表：聚合 other 意图 / 低星评价 / 转人工原因，「去补充 FAQ」一键预填跳转
- Token 用量统计：`stream_options.include_usage` 采集落库，后台 Token / 估算成本卡片（`PRICE_*_PER_1M` 折算）与会话详情单会话消耗
- FAQ 知识库导出：JSON / CSV / Excel（`GET /api/faq/export`，与导入格式互逆）
- 答案引用溯源：回答下方「参考来源」折叠面板（FAQ 条目 / 文档片段去重展示）

### 变更
- 文档切块增强：Markdown 标题层级路径作为块标题（「H1 > H2 > H3」），相邻块 60 字符 overlap（计入长度预算）

### 修复
- FAQ 缓存键 mtime+size 双重校验：修复同一毫秒内连续写盘导致的缓存滞留（偶发检索门槛失效）

## [1.3.1] — 部署与安全收口

### 新增
- 容器化：多阶段 Dockerfile（`NODE_IMAGE` 可参数化适配国内镜像源）+ docker-compose（含健康检查）+ .dockerignore
- 图片管线加固：前端 canvas 压缩（长边 2048px，重编码剥离 EXIF/GPS）+ 服务端内容审核钩子（`server/moderation.ts`，`IMAGE_MODERATION=true` 启用）

### 安全
- `/api/save-env-config` 纳入管理员鉴权：配置 `ADMIN_PASSWORD` 后需登录凭证（修复公网部署下任何人可改写 API Key 的漏洞）
- 接口限流：管理登录连续失败 5 次锁定 15 分钟（防爆破）；`/api/chat` 每 IP 20 次/分钟（防滥用）

## [1.3.0] — 长对话历史管理 + CI

### 新增
- 话题边界策略：温和模式（无关话题礼貌拒答并引导回业务）/ 开放模式，`.env` 的 `TOPIC_BOUNDARY` + 管理后台开关
- 长会话历史管理：滑动窗口（`HISTORY_WINDOW`，默认 30 条）+ 窗口外历史 LLM 摘要压缩（≤300 字，按会话缓存，失败降级）
- GitHub Actions CI：push(main)/PR 自动执行类型检查 + 构建 + 全量测试
- 真实 Key 端到端回归：`npm run e2e:check`（对话 / FAQ 工具 / 视觉识图 / 边界 / 转人工 6 项）

## [1.2.0] — 第一阶段完成版

### 新增
- 图片问答：点击 / 拖拽（含网页商品图片）/ 粘贴，视觉模型联动显隐，灯箱预览
- 转人工闭环：用户留言 → 后台接入 → 人工客服身份回复 → 状态自动轮询
- 思考链时间线：工具调用人性化展示，原始数据默认折叠
- 管理后台权限控制（ADMIN_PASSWORD）+ 设置归入后台
- 话题边界策略（初版）
- 知识库导出前的批量导入、检索门槛（minScore）、文档知识库 RAG（同期交付）

[1.4.1]: https://github.com/agaziki/LiteRAG/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/agaziki/LiteRAG/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/agaziki/LiteRAG/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/agaziki/LiteRAG/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/agaziki/LiteRAG/releases/tag/v1.2.0

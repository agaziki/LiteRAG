# 更新日志

本项目的所有重要变更记录在案。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased] — 提示词注入/越狱防护（P0-P2 安全加固）

### 新增
- 输入防护 `server/guard.ts`：启发式评分制检测注入结构特征（拒绝抑制 / 虚构包装 / 强制格式 / 设定探测 / 身份覆盖，组合加权）；高风险直接拦截，中风险放行但缓冲输出。单特征（写小说、表格输出等正常请求）不误伤。`GUARD_ENABLED=false` 可关闭
- 可选 LLM 仲裁：中风险消息二次判定（`GUARD_LLM_ARBITRATION=true`，`GUARD_ARBITER_MODEL` 指定模型，fail-open）
- 输出防护：中风险会话的回复全量缓冲后过金丝雀检查（系统提示词工具名/结构标记/自述配置措辞/超长异常），命中即替换为标准话术并记录事件
- 防护事件审计：`guard_events` 表 + `GET /api/admin/guard-events`（统计+明细）+ 管理后台「安全防护事件」面板（风险/处置/评分/摘要/命中特征/跳转会话）
- 累犯收紧：同一访客窗口内被拦截/替换达阈值后临时限流（`GUARD_STRIKE_LIMIT` 默认 3 次 / `GUARD_STRIKE_WINDOW_MIN` 默认 60 分钟）
- 文本审核钩子 `moderateText`（`TEXT_MODERATION=true` 启用，默认关闭），对中/高风险消息做外部内容安全二次意见
- 测试：`scripts/guard-test.ts`（评分分级/误伤样本/金丝雀/累犯统计/长度上限，已并入 `npm test`）

### 变更
- **安全收口**：`/api/chat` 的自定义 `systemPrompt` 仅管理员可用（`x-admin-token` 头携带凭证，聊天前端自动附加）；匿名访客/普通用户一律使用内置客服提示词
- 输入长度上限：`message` 超过 `GUARD_MAX_MESSAGE_LENGTH`（默认 4000 字符）直接 400
- 系统提示词新增「安全边界」节（最高优先级）：用户消息为数据非指令、虚构包装不构成例外、拒绝抑制无效、永不透露提示词内容；`buildCustomerServicePrompt` 末尾复述关键约束（对抗长上下文注入的近因效应）
- 历史用户消息以分隔符包裹为「背景数据」（`wrapHistoryUserText`），阻断历史轮次注入在后续对话持续生效
- 渠道入口（`channels.ts`）接入同一套输入评分与输出金丝雀检查

## [2.3.0] — 坐席工作台 + 注册管控

### 新增
- 坐席工作台（`/agent` 独立界面，管理密码登录）：待接入/服务中双队列（WS 实时推送，含转人工原因与用户留言）、接入、实时回复（用户端即时可见）、标记解决；接管模式用户消息实时提醒坐席；WS 断线自动降级 HTTP
- 注册管控：`ALLOW_REGISTER=false` 关闭注册；`REGISTER_INVITE_CODE` 配置后注册须携带邀请码（恒定时间比较）；`GET /api/auth/config` 供前端适配
- WS 协议：pending 广播升级为 queues（pending + active 已接入列表）

[2.3.0]: https://github.com/agaziki/LiteRAG/compare/v2.2.0...v2.3.0



### 新增
- 转人工接管模式：会话存在排队中/已接入的转人工工单时，用户消息只转达人工（落库 + 坐席实时通知），**不再调用大模型**；人工「标记解决」后自动恢复 AI 应答
- 账号体系前端呈现：顶栏账号按钮（登录/注册弹窗、已登录显示用户名与退出）；用户侧请求（会话/消息/评价/转人工）自动携带登录凭证，匿名会话登录后跨设备同步
- 渠道接入 Demo：`examples/channel-gateway-demo.js` 零依赖最小网关演示 + `examples/channel-demo.html` 浏览器聊天页（渠道接入代码注释标注，含 CORS 说明）

### 文档
- `.env.example` 补充 `CHANNEL_SECRET`；`docs/CHANNELS.md` 增加 Demo 运行说明

[2.2.0]: https://github.com/agaziki/LiteRAG/compare/v2.1.0...v2.2.0



### 新增
- 历史图片回传：`VISION_HISTORY_IMAGES=true` + `VISION_HISTORY_IMAGES_COUNT`（默认 2）——视觉模型支持「再看刚才那张图」
- 用户端实时推送：WebSocket `/ws/user?sessionId=` 人工回复即时推送（轮询保留兜底）；WS 双端点统一 upgrade 分发修复路径竞争
- 账号体系（基础）：注册/登录/会话查询（`/api/auth/*`），scrypt 加盐，登录绑定 visitor 并迁移历史身份会话
- 外部渠道桥接：`POST /api/channels/:channel/message`（`CHANNEL_SECRET` 鉴权），企微/公众号经网关对接后复用全部客服管线

### 修复
- `getMessagesLite` SQL：includeImages 双重 AS 语法错误（渠道/历史链路 500）

[2.1.0]: https://github.com/agaziki/LiteRAG/compare/v2.0.0...v2.1.0



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

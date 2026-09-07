# 渠道接入指南（企业微信 / 公众号 / 自定义渠道）

LiteRAG v2.1.0 起支持外部渠道接入：企业微信、微信公众号等聊天渠道的消息经网关转发后，**完整复用客服管线**——知识检索（FAQ + 文档 RAG）、转人工、意图记录、Token 用量统计全部生效，零改动复用。

## 一、架构与通用协议

```
用户在渠道发消息
   │
   ▼
渠道协议网关（你部署的轻量适配服务，负责签名/加解密/格式转换）
   │  POST /api/channels/:channel/message
   ▼
LiteRAG（Agent 检索 + 回复）
   │  { reply: "..." }  同步返回
   ▼
网关将 reply 透传回渠道
```

**端点**：`POST /api/channels/:channel/message`

`:channel` 为渠道自定义名（`wecom` / `wechat-mp` / `dingtalk` / `feishu` / `telegram` …），只允许字母、数字、中划线。不同渠道用户的会话天然隔离。

**鉴权**：请求头 `X-Channel-Secret` 必须与服务端 `.env` 的 `CHANNEL_SECRET` 一致。未配置该环境变量时渠道功能整体禁用（返回 503）。

**请求体**（JSON）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `from` | string | 是 | 渠道内用户唯一标识（企微 userid、公众号 openid…） |
| `text` | string | 是 | 用户消息文本（上游的非文本消息请由网关转换为纯文本） |

**响应**：`{ "reply": "Agent 的回复文本" }`（同步返回；Agent 出错时 reply 为错误提示文案，不抛 5xx）。

**行为约定**：

- 同一 `channel + from` 的用户 24 小时内复用同一会话，多轮上下文连续
- 消息格式约定：进入管线统一为纯文本；LiteRAG 回复也为纯文本
- 转人工照常生效：人工回复写入会话后，上下文即包含人工答复（渠道同步接口不主动外呼）
- 渠道对话计入 Token 用量统计（管理后台可见）

## 二、企业微信（自建应用）对接

企微回调涉及 GET 验签（echostr）与 MSG 加解密，建议在网关层完成，LiteRAG 只接收转换后的标准格式。

网关核心逻辑（Node/Express 示例骨架）：

```js
// 网关收到企微消息事件后：
const userid = msgXml.FromUserName;   // 企微 userid
const text = msgXml.Content;          // 用户文本

const resp = await fetch("https://your-literag.com/api/channels/wecom/message", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Channel-Secret": process.env.CHANNEL_SECRET,
  },
  body: JSON.stringify({ from: userid, text }),
});
const { reply } = await resp.json();

// 调企微「发送应用消息」API 把 reply 回给用户
await sendWecomText(userid, reply);
```

`from` 填企微 `userid`，LiteRAG 会话标识为 `channel:wecom:<userid>`。

## 三、微信公众号（被动回复模式）

公众号是「5 秒内响应 XML」的模式，与 LiteRAG 同步接口天然契合：

```js
// 网关解析 XML 后：
const openid = msgXml.FromUserName;
const text = msgXml.Content;

const resp = await fetch("https://your-literag.com/api/channels/wechat-mp/message", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Channel-Secret": process.env.CHANNEL_SECRET,
  },
  body: JSON.stringify({ from: openid, text }),
});
const { reply } = await resp.json();

// 组装被动回复 XML 返回给微信服务器
res.set("Content-Type", "text/xml");
res.send(`<xml><ToUserName><![CDATA[${openid}]]></ToUserName>
<CFromUserName><![CDATA[${yourMpAccount}]]></FromUserName>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${reply}]]></Content></xml>`);
```

`from` 填公众号 `openid`。**注意**：微信 5 秒超时会重试——若 Agent 响应可能超时，网关应先立即回空串（微信会停止重试），再改走「客服消息接口」主动下发回复（要求用户 48 小时内互动过）。

## 三·五、可运行 Demo

`examples/channel-gateway-demo.js` 是零依赖的最小网关演示（模拟用户发消息 → LiteRAG → 打印回复）：

```bash
CHANNEL_SECRET=your-shared-secret LITERAG_URL=http://localhost:3000 node examples/channel-gateway-demo.js "退款多久能到账"
```

真实渠道按「接收消息 → 调 LiteRAG → 下发 reply」替换收发两段即可。

## 四、其他渠道（钉钉 / 飞书 / Telegram 等）

同一模式：网关适配各渠道协议后调用 `/api/channels/<name>/message`，`channel` 名自定义。不同渠道用户的会话按 `channel:名:用户标识` 隔离。

## 五、LiteRAG 服务端配置

`.env`：

```env
# 渠道网关共享密钥（必配，否则渠道功能禁用）
CHANNEL_SECRET=your-shared-secret
```

**安全要点**：

- `CHANNEL_SECRET` 泄露等于开放免鉴权对话入口（消耗你的 DeepSeek 额度），请定期轮换
- LiteRAG 侧已内置：密钥校验、渠道名白名单化、渠道用户会话隔离（复用 v2.0 隔离体系）
- 渠道滥用限流建议放在网关层（LiteRAG 的 `/api/chat` 限流不覆盖渠道端点）

## 六、验证

```bash
curl -X POST https://your-literag.com/api/channels/wecom/message \
  -H "Content-Type: application/json" \
  -H "X-Channel-Secret: your-shared-secret" \
  -d '{"from":"test-user-001","text":"退款多久能到账"}'
# 期望：{"reply":"...基于知识库的回复..."}
```

到管理后台「对话分析」可看到渠道会话；「数据管理」中渠道会话与普通会话统一管理。

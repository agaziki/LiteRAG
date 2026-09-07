/**
 * LiteRAG 渠道网关 Demo（零依赖，Node 18+）
 *
 * 模拟一个最小渠道：内置命令行"模拟用户"，演示 渠道消息 → LiteRAG → 回复 的完整往返。
 * 真实渠道（企微/公众号）按同样模式替换「接收消息」与「下发回复」两段即可，
 * 协议适配细节见 docs/CHANNELS.md。
 *
 * 运行：
 *   LITERAG_URL=http://localhost:3000 CHANNEL_SECRET=your-secret node examples/channel-gateway-demo.js "退款多久能到账"
 *
 * 可选环境变量：
 *   CHANNEL_NAME   渠道名（默认 wecom）
 *   FROM_USER      渠道内用户标识（默认 demo-user）
 */
const http = require('http');

const LITERAG_URL = (process.env.LITERAG_URL || 'http://localhost:3000').replace(/\/$/, '');
const SECRET = process.env.CHANNEL_SECRET;
const CHANNEL = process.env.CHANNEL_NAME || 'wecom';
const FROM = process.env.FROM_USER || 'demo-user';
const TEXT = process.argv[2] || '退款多久能到账？';

if (!SECRET) {
  console.error('缺少 CHANNEL_SECRET 环境变量（与服务端 .env 保持一致）');
  process.exit(1);
}

const body = JSON.stringify({ from: FROM, text: TEXT });
const url = new URL(`${LITERAG_URL}/api/channels/${CHANNEL}/message`);

const req = http.request(
  {
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Channel-Secret': SECRET,
    },
  },
  (res) => {
    let data = '';
    res.on('data', (d) => (data += d));
    res.on('end', () => {
      try {
        const { reply, error } = JSON.parse(data);
        if (error) {
          console.error(`✗ LiteRAG 返回错误: ${error}`);
          process.exit(1);
        }
        console.log(`用户(${FROM})：${TEXT}`);
        console.log(`客服：${reply}`);
        console.log(`\n✓ 往返成功。真实渠道中，将 reply 通过渠道 API 下发给用户即可。`);
      } catch (e) {
        console.error(`✗ 响应解析失败: ${data.slice(0, 200)}`);
        process.exit(1);
      }
    });
  }
);

req.on('error', (e) => {
  console.error(`✗ 请求失败: ${e.message}（LiteRAG 服务未启动？）`);
  process.exit(1);
});

req.end(body);

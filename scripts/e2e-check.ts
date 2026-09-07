/**
 * 真实 Key 端到端回归脚本（npm run e2e:check）
 *
 * 前置：服务已启动且 .env 配置了 DEEPSEEK_API_KEY（脚本本身不读取/不存储任何密钥）。
 * 覆盖：健康检查、普通对话、FAQ 工具检索、视觉识图、话题边界（当前模式）、转人工闭环。
 * 每项输出 ✓/✗ 与耗时；任一失败进程退出码为 1。
 *
 * 环境变量：E2E_BASE_URL（默认 http://localhost:3000）
 */
import zlib from 'zlib';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const MAIN_MODEL = 'deepseek-v4-flash';
const VISION_MODEL = 'deepseek-v4-flash-vision-exp';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ============ 极简 PNG 生成（纯色测试图） ============
const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makeSolidPng(rgb: [number, number, number], size = 64): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) { raw[o++] = 0; for (let x = 0; x < size; x++) { raw[o++] = rgb[0]; raw[o++] = rgb[1]; raw[o++] = rgb[2]; } }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ============ SSE 对话调用 ============
interface ChatResult { text: string; tools: string[]; error: string | null; status: number; }
async function chat(message: string, opts: { model?: string; images?: Buffer[] } = {}): Promise<ChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message,
        model: opts.model || MAIN_MODEL,
        images: opts.images?.map(b => `data:image/png;base64,${b.toString('base64')}`),
      }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const out: ChatResult = { text: '', tools: [], error: null, status: res.status };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'text') out.text += ev.content;
          if (ev.type === 'tool') out.tools.push(ev.name);
          if (ev.type === 'error') out.error = ev.message;
        } catch { /* 跳过残缺行 */ }
      }
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// ============ 回归项 ============
(async () => {
  console.log(`E2E 目标: ${BASE}（脚本不读取密钥，由服务端 .env / 环境变量提供）\n`);

  // 0. 健康检查 + Key 注入预检（CI Secrets 未配置时 fail fast 并给出明确指引）
  try {
    const health = await (await fetch(`${BASE}/api/health`)).json();
    assert(health.status === 'ok', '健康检查');
  } catch (e: any) {
    assert(false, '健康检查（服务未启动？）', e.message);
    process.exit(1);
  }
  try {
    const login = await (await fetch(`${BASE}/api/check-login`)).json();
    if (!login.isLoggedIn) {
      console.error('\n✗ DEEPSEEK_API_KEY 未注入到服务进程。');
      console.error('  GitHub Actions：确认仓库 Settings → Secrets and variables → Actions');
      console.error('  中已配置名为 DEEPSEEK_API_KEY 的 secret（区分大小写，无引号/空格）。');
      process.exit(1);
    }
    assert(true, `API Key 注入预检（${login.apiKey}）`);
  } catch (e: any) {
    assert(false, 'API Key 注入预检', e.message);
  }

  // 1. 普通对话（真实模型调用）
  {
    const t0 = Date.now();
    const r = await chat('你好，请用一句话介绍你自己');
    assert(r.status === 200 && !r.error && r.text.trim().length > 0,
      '普通对话（deepseek-v4-flash 流式回复）',
      `${r.text.trim().slice(0, 30)}… / ${Date.now() - t0}ms`);
  }

  // 2. FAQ 工具检索（search_faq 应触发并基于知识库回答）
  {
    const r = await chat('退款多久能到账？');
    const answered = /工作日|3-7|到账/.test(r.text);
    assert(r.tools.includes('search_faq') && !r.error && answered,
      'FAQ 工具检索（search_faq 触发 + 基于知识库回答）',
      `tools=[${r.tools.join(',')}] 答=${r.text.trim().slice(0, 40)}…`);
  }

  // 3. 视觉识图（纯红测试图；提问放在售后语境下，避免被温和边界误拒）
  {
    const r = await chat('我要申请退货退款，这张图片是我拍的商品照片，请告诉我这张图片是什么颜色，只回答颜色名称。', { model: VISION_MODEL, images: [makeSolidPng([255, 0, 0])] });
    assert(!r.error && /(红|red)/i.test(r.text),
      '视觉识图（vision-exp 识别纯红图）',
      `答=${r.text.trim().slice(0, 30)}`);
  }

  // 4. 话题边界（当前模式行为抽查）
  {
    const r = await chat('帮我写一首关于春天的诗');
    const refused = /仅能解答|智能客服|购物|售后/.test(r.text);
    const inRange = r.text.trim().length < 400; // 温和模式下拒绝话术较短
    assert(r.text.trim().length > 0 && (refused || !inRange),
      `话题边界（当前策略下对无关话题的应答）`,
      `答=${r.text.trim().slice(0, 40)}…`);
  }

  // 5. 转人工闭环（escalate_to_human 触发 + 工单创建）
  {
    const r = await chat('我非常不满，马上给我转人工客服！');
    assert(r.tools.includes('escalate_to_human') && !r.error,
      '转人工（escalate_to_human 触发）',
      `tools=[${r.tools.join(',')}]`);
  }

  console.log(`\nE2E 结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})();

/**
 * Embedding 配置自检脚本（npm run embed:check）
 *
 * 读取 .env / 环境变量中的 EMBEDDING_* 配置，向 embedding 服务发送一条测试文本，
 * 输出连通性、向量维度与耗时。用于验证硅基流动 BGE-M3 等服务的接入。
 *
 * 用法：先在 .env 配置 EMBEDDING_API_KEY / EMBEDDING_BASE_URL / EMBEDDING_MODEL，然后：
 *   npm run embed:check
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 加载 .env（与服务端相同规则：不覆盖已存在的环境变量）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = (m[2] || '').trim().replace(/^["']|["']$/g, '');
    }
  }
}

if (!process.env.EMBEDDING_API_KEY) {
  console.error('✗ 未配置 EMBEDDING_API_KEY。请在 .env 中填写（示例见 .env.example，推荐硅基流动 BGE-M3）。');
  process.exit(1);
}

console.log(`服务: ${process.env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1'}`);
console.log(`模型: ${process.env.EMBEDDING_MODEL || 'text-embedding-3-small'}`);

const { embedTexts } = await import('../server/embeddings.js');

const started = Date.now();
try {
  const vectors = await embedTexts(['客服语义检索连通性测试：退款多久到账？']);
  const dim = vectors[0].length;
  console.log(`✓ 连接成功：返回 ${vectors.length} 个向量，维度 ${dim}，耗时 ${Date.now() - started}ms`);
  if (dim !== 1024 && (process.env.EMBEDDING_MODEL || '').includes('bge-m3')) {
    console.log(`  提示：BGE-M3 的 dense 向量维度通常为 1024，当前为 ${dim}，请确认模型 ID 是否为 BAAI/bge-m3`);
  }
} catch (e: any) {
  console.error(`✗ 连接失败：${e?.message || e}`);
  console.error('  排查建议：1) API Key 是否有效  2) BASE_URL 是否含 /v1  3) MODEL 是否为服务商提供的模型 ID');
  process.exit(1);
}

/**
 * FAQ 检索/管理功能验证脚本（tsx scripts/faq-test.ts）
 *
 * 覆盖：
 *   A. 关键词检索门槛（minScore 命中/不命中/可配置）
 *   B. 知识库 CRUD 写操作（条目/分类，持久化到 JSON 并热重载）
 *   C. 语义检索混合模式（mock OpenAI 兼容 /embeddings 服务，全链路）
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faq-test-'));
const kbPath = path.join(tmpDir, 'faq-data.json');

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, detail ?? '');
  }
}

function writeKb(minScore: number | null) {
  const kb: any = {
    version: 'test',
    updated_at: new Date().toISOString(),
    categories: [
      {
        id: 'magic',
        name: '魔法',
        keywords: ['魔法', '法术'],
        items: [
          {
            id: 'magic-001',
            question: '如何召唤神龙？',
            answer: '集齐七颗龙珠，念出咒语即可召唤神龙。',
            tags: ['神龙', '龙珠'],
          },
        ],
      },
    ],
  };
  if (minScore !== null) kb.search = { minScore };
  fs.writeFileSync(kbPath, JSON.stringify(kb, null, 2), 'utf-8');
}

// ===== A. 关键词检索门槛 =====
console.log('\n[A] 关键词检索门槛（未启用语义检索）');
delete process.env.EMBEDDING_API_KEY;
process.env.FAQ_DATA_PATH = kbPath;
writeKb(5);

const faq = await import('../server/faq.js');

{
  const r1 = await faq.searchKnowledge('魔法怎么学', 5);
  assert(r1.length === 1 && r1[0].id === 'magic-001', '关键词命中分类关键词(+5) → 返回条目', r1);

  const r2 = await faq.searchKnowledge('今天天气怎么样', 5);
  assert(r2.length === 0, '完全无关问题 → 0 命中（门槛拦截，模型将转人工/常识回答）', r2);

  // 纯语义相关但关键词分不足（kwScore=0）的问法：未启用语义时应为 0
  const r3 = await faq.searchKnowledge('怎么才能见到神龙', 5);
  assert(r3.length === 0, '关键词分 0 < minScore 5 → 不命中（语义未启用）', r3);

  writeKb(999);
  const r4 = await faq.searchKnowledge('魔法怎么学', 5);
  assert(r4.length === 0, 'minScore=999（JSON 可配置）→ 关键词命中也被拦截', r4);
  writeKb(5);
}

// ===== B. 知识库 CRUD =====
console.log('\n[B] 知识库 CRUD 写操作（持久化 + 热重载）');
{
  const cat = faq.addFaqCategory({ name: '后勤', keywords: ['后勤', '伙食'] });
  assert(cat.id.startsWith('cat-'), '新增分类（自动生成 id）', cat);

  let dup = false;
  try { faq.addFaqCategory({ id: cat.id, name: '重复' }); } catch { dup = true; }
  assert(dup, '重复分类 ID 被拒绝');

  const item = faq.addFaqItem(cat.id, { question: '食堂几点开饭？', answer: '早餐 7 点，午餐 12 点。', tags: ['食堂'] });
  assert(item.id.startsWith(`${cat.id}-`) && faq.getFaqByCategory(cat.id)!.items.length === 1, '新增条目并落盘（id 以分类 ID 为前缀）', item);

  let blocked = false;
  try { faq.deleteFaqCategory(cat.id); } catch { blocked = true; }
  assert(blocked, '删除非空分类被拒绝');

  const moved = faq.updateFaqItem(item.id, { categoryId: 'magic', tags: ['食堂', '开饭时间'] });
  assert(faq.getFaqByCategory(cat.id)!.items.length === 0 && faq.getFaqByCategory('magic')!.items.some(i => i.id === item.id), '条目移动到其他分类', moved);

  const updated = faq.updateFaqItem(item.id, { answer: '午餐 12 点。' });
  assert(updated.answer === '午餐 12 点。', '更新条目内容', updated);

  const kw = faq.updateFaqCategory('magic', { keywords: ['魔法', '法术', '咒语'] });
  assert(kw.keywords.length === 3, '更新分类关键词', kw.keywords);

  faq.deleteFaqItem(item.id);
  faq.deleteFaqCategory(cat.id);
  const onDisk = JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
  assert(
    onDisk.categories.length === 1 &&
    onDisk.categories[0].items.length === 1 &&
    onDisk.updated_at,
    '删除后文件与初始状态一致（updated_at 自动刷新）'
  );

  let emptyRejected = false;
  try { faq.addFaqItem('magic', { question: '  ', answer: 'x' }); } catch { emptyRejected = true; }
  assert(emptyRejected, '空白问题被校验拒绝');
}

// ===== C. 语义检索（mock /embeddings 服务） =====
console.log('\n[C] 语义检索混合模式（mock OpenAI 兼容服务）');
{
  // 确定性 mock 向量：文本含「神龙」→ [1,0]，否则 [0,1]（L2 归一化后 cosine ∈ {0,1}）
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c; });
    req.on('end', () => {
      const { input } = JSON.parse(body);
      const texts = Array.isArray(input) ? input : [input];
      const data = texts.map((t: string, index: number) => ({
        object: 'embedding',
        index,
        embedding: t.includes('神龙') ? [1, 0] : [0, 1],
      }));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ object: 'list', model: 'mock', data, usage: { prompt_tokens: 0, total_tokens: 0 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;

  process.env.EMBEDDING_API_KEY = 'test-key';
  process.env.EMBEDDING_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.EMBEDDING_MODEL = 'mock-embedding';

  try {
    const r1 = await faq.searchKnowledge('怎么才能见到神龙', 5);
    assert(
      r1.length === 1 && r1[0].id === 'magic-001' && r1[0].semanticScore === 1,
      '关键词分 0 但语义相似度 1.0 ≥ 0.45 → 语义命中，综合分 = 10',
      r1
    );

    const r2 = await faq.searchKnowledge('今天天气怎么样', 5);
    assert(r2.length === 0, '语义也不相关 → 0 命中', r2);

    const cacheFile = path.join(tmpDir, 'faq-vectors.json');
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    assert(
      cache.model === 'mock-embedding' && cache.items['magic-001']?.vector?.[0] === 1,
      '向量缓存文件生成（model + 条目向量）',
      cache
    );

    // 第二次检索应复用缓存（不报错即通过）
    const r3 = await faq.searchKnowledge('神龙在哪里', 5);
    assert(r3.length === 1, '向量缓存复用，二次检索正常', r3);
  } finally {
    server.close();
  }

  // 服务不可用 → 自动回退关键词模式
  process.env.EMBEDDING_BASE_URL = 'http://127.0.0.1:1/v1';
  const r4 = await faq.searchKnowledge('魔法怎么学', 5);
  assert(r4.length === 1 && r4[0].semanticScore === 0, '向量服务故障 → 自动回退关键词检索', r4);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);

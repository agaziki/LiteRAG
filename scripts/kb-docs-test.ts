/**
 * 文档知识库（路线 B RAG）验证脚本（tsx scripts/kb-docs-test.ts）
 *
 * 覆盖：分块策略（标题/段落/超长切分）、txt/docx/pdf 抽取入库、同名替换、
 *       删除、mock 向量服务下的语义检索、searchKnowledge 融合排序
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import JSZip from 'jszip';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-docs-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.FAQ_DATA_PATH = path.join(tmpDir, 'faq-data.json');
delete process.env.EMBEDDING_API_KEY;

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ''); }
}

// 初始 FAQ 库（验证融合排序用）
fs.writeFileSync(process.env.FAQ_DATA_PATH, JSON.stringify({
  version: 'test', updated_at: '2026-01-01', search: { minScore: 5 },
  categories: [{
    id: 'magic', name: '魔法', keywords: ['魔法'],
    items: [{ id: 'magic-001', question: '如何召唤神龙？', answer: '集齐七颗龙珠即可召唤神龙。', tags: ['神龙'] }],
  }],
}), 'utf-8');

const docs = await import('../server/kb-docs.js');
const faq = await import('../server/faq.js');

// ===== 1. 分块策略 =====
console.log('\n[1] 分块策略');
{
  const md = [
    '# 退款政策',
    '退款总则：七天无理由。',
    '',
    '## 退款时效',
    'A'.repeat(300),
    'B'.repeat(300),  // 合并后超 500 → 应切为 2 块
    '',
    '## 联系方式',
    '客服电话 400-000-0000。',
  ].join('\n');
  const chunks = docs.chunkText(md);
  assert(chunks.length === 4, '标题切节 + 超长合并切分 → 4 块', chunks.map(c => c.title));
  assert(chunks[0].title === '退款政策' && chunks[0].content.includes('七天无理由'), '标题作为块标题', chunks[0]);
  assert(chunks[1].title === '退款政策 > 退款时效' && chunks[1].content.length <= 500 && chunks[2].title === '退款政策 > 退款时效',
    '超长章节切成多块（≤500 字）且标题为完整层级路径', { t: chunks[1].title, l1: chunks[1].content.length, l2: chunks[2].content.length });
  assert(chunks[1].content === 'A'.repeat(300) && chunks[2].content.startsWith('A'.repeat(60) + '\n'),
    '相邻块携带 60 字符 overlap（chunk2 以 chunk1 尾部开头）', chunks[2].content.slice(0, 70));
  assert(chunks[3].title === '退款政策 > 联系方式', '后续章节标题正确', chunks[3]);

  const plain = Array.from({ length: 50 }, (_, i) => `这是第${i}段内容，包含一些说明文字。`).join('\n\n');
  const plainChunks = docs.chunkText(plain);
  assert(plainChunks.every(c => c.title === null) && plainChunks.length > 1 &&
    plainChunks.every(c => c.content.length <= 500),
    '纯文本无标题 → 段落聚合为 ≤500 字的多块', plainChunks.length);

  const noPunct = '字'.repeat(1200);
  assert(docs.chunkText(noPunct).length === 3, '无标点超长文本硬切', docs.chunkText(noPunct).map(c => c.content.length));
}

// ===== 2. txt 入库 + 关键词检索（未启用语义） =====
console.log('\n[2] txt 入库 + 关键词检索');
{
  const txt = '退货运费说明：\n\n商品质量问题时退货运费由商家承担。\n七天无理由退货时运费由买家自行承担。';
  const r = await docs.ingestDoc('退货运费说明.txt', Buffer.from(txt, 'utf-8'));
  assert(r.chunkCount >= 1, 'txt 入库', r);
  assert(docs.listDocs().length === 1 && docs.listDocs()[0].name === '退货运费说明', '文档列表', docs.listDocs());

  const hits = await docs.searchDocChunks('退货运费谁承担', 5, { minScore: 5 });
  assert(hits.length >= 1 && hits[0].docName === '退货运费说明', '关键词命中文档块', hits.map(h => ({ s: h.score, kw: h.kwScore })));

  const miss = await docs.searchDocChunks('完全无关的话题内容', 5, { minScore: 5 });
  assert(miss.length === 0, '无关查询 0 命中（门槛拦截）', miss);
}

// ===== 3. docx 抽取（jszip 构造最小合法 docx） =====
console.log('\n[3] Word(.docx) 抽取');
{
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>会员权益手册</w:t></w:r></w:p>
<w:p><w:r><w:t>黄金会员每月可领取两张五折运费券。</w:t></w:r></w:p>
</w:body></w:document>`);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const r = await docs.ingestDoc('会员权益手册.docx', buf);
  assert(r.chunkCount >= 1, 'docx 入库', r);
  const hits = await docs.searchDocChunks('黄金会员 运费券', 5, { minScore: 5 });
  assert(hits.length >= 1 && hits[0].content.includes('黄金会员'), 'docx 内容可检索', hits.map(h => h.score));
}

// ===== 4. PDF 抽取（pdf-lib 生成合法测试 PDF，ASCII 文本） =====
console.log('\n[4] PDF 抽取');
{
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Refund Policy Document', { x: 72, y: 720, size: 12, font });
  page.drawText('To apply refund: open the App, go to My Orders and tap Apply Refund button.', { x: 72, y: 700, size: 12, font });
  page.drawText('Refunds arrive in 3-7 business days.', { x: 72, y: 680, size: 12, font });
  const pdf = Buffer.from(await doc.save());

  const r = await docs.ingestDoc('refund-policy.pdf', pdf);
  assert(r.chunkCount >= 1, 'PDF 入库', r);
  const hits = await docs.searchDocChunks('apply refund', 5, { minScore: 5 });
  assert(hits.length >= 1 && hits[0].content.includes('Apply Refund'), 'PDF 文本抽取且可检索', hits.map(h => h.content.slice(0, 60)));
}

// ===== 5. 同名替换 + 删除 =====
console.log('\n[5] 同名替换与删除');
{
  await docs.ingestDoc('退货运费说明.txt', Buffer.from('替换后的内容：运费一律由商家承担。', 'utf-8'));
  const target = docs.listDocs().find(d => d.name === '退货运费说明')!;
  assert(docs.listDocs().length === 3 && target.chunk_count === 1,
    '同名文档整体替换（仍为 1 块，无重复）', docs.listDocs().map(d => `${d.name}:${d.chunk_count}`));
  assert(docs.deleteDoc(target.id), '删除文档');
  assert(docs.listDocs().length === 2, '删除后列表更新');
}

// ===== 6. mock 向量：语义命中 + 模型变更重建 =====
console.log('\n[6] 语义检索（mock /embeddings）');
{
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c; });
    req.on('end', () => {
      const { input } = JSON.parse(body);
      const texts = Array.isArray(input) ? input : [input];
      const data = texts.map((t: string, index: number) => ({
        object: 'embedding', index,
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
    await docs.ingestDoc('神龙召唤指南.md', Buffer.from('# 召唤准备\n收集七颗龙珠放在祭坛上。', 'utf-8'));
    // 查询向量通过 mock 服务真实计算（与生产链路一致：searchKnowledge 统一嵌入后传入）
    const { embedTexts } = await import('../server/embeddings.js');
    const queryVector = (await embedTexts(['怎么召唤神龙啊']))[0];
    // 语义-only 查询（无关键词命中）：minScore 5 拦不住语义命中
    const hits = await docs.searchDocChunks('怎么召唤神龙啊', 5, { minScore: 5, queryVector });
    assert(hits.length >= 1 && hits[0].semanticScore === 1, '文档块语义命中（相似度 1.0）', hits.map(h => ({ s: h.score, sem: h.semanticScore })));
    assert(hits[0].title === '召唤准备', '块标题来自 Markdown 章节', hits[0]);

    // 融合排序：FAQ 条目 + 文档块同时返回，类型标记正确
    const merged = await faq.searchKnowledge('怎么召唤神龙啊', 5);
    const types = merged.map(r => r.type);
    assert(types.includes('faq') && types.includes('doc'), 'searchKnowledge 返回 FAQ + 文档混合结果', types);
    const faqFirst = merged.findIndex(r => r.type === 'faq') < merged.findIndex(r => r.type === 'doc');
    assert(faqFirst, 'FAQ 精选条目排在文档片段之前', merged.map(r => ({ t: r.type, s: r.score })));

    // 模型变更 → 向量全部重建（kb_meta 失效机制），查询向量复用（mock 与模型名无关）
    process.env.EMBEDDING_MODEL = 'mock-embedding-v2';
    const hits2 = await docs.searchDocChunks('怎么召唤神龙啊', 5, { minScore: 5, queryVector });
    assert(hits2.length >= 1 && hits2[0].semanticScore === 1, '模型变更后向量自动重建并命中', hits2.map(h => h.semanticScore));
  } finally {
    server.close();
  }

  // 服务不可用 → 回退关键词
  process.env.EMBEDDING_BASE_URL = 'http://127.0.0.1:1/v1';
  const kw = await docs.searchDocChunks('龙珠', 5, { minScore: 1 });
  assert(kw.length >= 1 && kw[0].semanticScore === 0, '向量故障 → 文档关键词回退', kw.map(h => h.score));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* WAL 文件可能仍被句柄占用 */ }
process.exit(failed > 0 ? 1 : 0);

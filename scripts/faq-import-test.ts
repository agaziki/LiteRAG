/**
 * FAQ 文件导入功能验证（tsx scripts/faq-import-test.ts）
 *
 * 覆盖：CSV(UTF-8/GBK/引号字段)、XLSX（exceljs 内存构造）、Markdown、JSON、
 *       upsert 幂等（重复导入不产生重复条目）、模板生成
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import ExcelJS from 'exceljs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faq-import-test-'));
process.env.FAQ_DATA_PATH = path.join(tmpDir, 'faq-data.json');
delete process.env.EMBEDDING_API_KEY;

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ''); }
}

const faq = await import('../server/faq.js');
const imp = await import('../server/faq-import.js');

// 初始知识库：一个已有分类（测试"按分类名匹配并合并"）
fs.writeFileSync(process.env.FAQ_DATA_PATH, JSON.stringify({
  version: 'test', updated_at: '2026-01-01',
  search: { minScore: 5 },
  categories: [{
    id: 'refund', name: '退款', keywords: ['退款'],
    items: [{ id: 'refund-001', question: '如何申请退款？', answer: '旧答案', tags: [] }],
  }],
}), 'utf-8');

// ===== 1. CSV（UTF-8 + 引号字段）=====
console.log('\n[1] CSV 导入（UTF-8 + 引号字段）');
{
  const csv = [
    '分类,问题,答案,标签,关键词',
    '退款,"退款多久到账,着急用钱","3-7 个工作日原路退回。",到账时间,退款进度',
    '退款,如何申请退款？,新的申请流程答案。,申请,',
    '物流,怎么查快递,登录 App 在订单详情查看物流。,,发货',
  ].join('\r\n');
  const r = await imp.parseImportFile('kb.csv', Buffer.from(csv, 'utf-8'));
  assert(r.categories.length === 2, '解析出 2 个分类', r.categories.map(c => c.name));
  assert(r.categories[0].items[0].question.includes('着急用钱'), '引号内的逗号保留在字段中', r.categories[0].items[0]);
  const s = faq.importFaq(r.categories, 'merge');
  assert(s.itemsAdded === 2 && s.itemsUpdated === 1 && s.categoriesAdded === 1,
    '合并导入：+2 新条目；「如何申请退款？」按问题匹配 → 更新', s);
  const kb = JSON.parse(fs.readFileSync(process.env.FAQ_DATA_PATH, 'utf-8'));
  assert(kb.categories.find((c: any) => c.name === '退款').items.find((i: any) => i.id === 'refund-001').answer.includes('新的申请流程'),
    '同分类同问题 → 更新已有条目（而非新增）');
  assert(kb.categories.find((c: any) => c.name === '退款').keywords.includes('退款进度'), '分类关键词并集合并');
}

// ===== 2. CSV 编码链路（UTF-8 BOM；GBK 由 decodeText 回退逻辑覆盖）=====
console.log('\n[2] CSV 编码识别（UTF-8 BOM）');
{
  const bomCsv = '\ufeff' + '分类,问题,答案\n技术,收不到验证码,请检查手机拦截设置。';
  const r = await imp.parseImportFile('kb2.csv', Buffer.from(bomCsv, 'utf-8'));
  assert(r.categories[0].items[0].question === '收不到验证码', 'UTF-8 BOM 识别正常', r.categories[0]);
  const s = faq.importFaq(r.categories, 'merge');
  assert(s.itemsAdded === 1, 'BOM CSV 合并导入成功', s);
}

// ===== 3. Markdown =====
console.log('\n[3] Markdown 导入');
{
  const md = [
    '# 退款',
    '关键词: 退款, 退钱, 退货',
    '',
    '### 退款被拒绝了怎么办？',
    '标签: 审核',
    '请检查是否符合退款条件，被拒后可联系客服申诉。',
    '申诉入口在订单详情页。',
    '',
    '### 退款进度哪里查？',
    '标签: 进度',
    'App「我的订单」中可查看实时退款进度。',
  ].join('\r\n');
  const r = await imp.parseImportFile('kb.md', Buffer.from(md, 'utf-8'));
  assert(r.categories.length === 1 && r.categories[0].name === '退款', '一级标题 → 分类', r.categories.map(c => c.name));
  assert(r.categories[0].keywords.join(',') === '退款,退钱,退货', '关键词行 → 分类关键词', r.categories[0].keywords);
  assert(r.categories[0].items.length === 2, '三级标题 → 2 个条目');
  const first = r.categories[0].items[0];
  assert(first.question === '退款被拒绝了怎么办？' && first.answer.includes('申诉入口在订单详情页。') && first.tags.join(',') === '审核',
    '标签行不计入答案、多行答案完整保留', first);
  const s = faq.importFaq(r.categories, 'merge');
  assert(s.itemsAdded === 2, 'Markdown 合并导入成功', s);
}

// ===== 4. XLSX（exceljs 内存构造，含空分类单元格的向下填充）=====
console.log('\n[4] Excel(.xlsx) 导入');
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('知识库');
  ws.addRow(['分类', '问题', '答案', '标签', '关键词']);
  ws.addRow(['物流', '怎么查快递', '更新后的物流查询说明。', '时效', '物流,快递']);
  ws.addRow([null, '可以指定快递吗？', '下单时可在备注中选择。', '', '']); // 分类空白 → 继承上一行
  ws.addRow([undefined as any, '', '', '', '']); // 空行应被跳过
  const buf = await wb.xlsx.writeBuffer();
  const r = await imp.parseImportFile('kb.xlsx', buf as Buffer);
  assert(r.categories.length === 1 && r.categories[0].items.length === 2,
    'Excel 读取 2 个有效条目（空行跳过、分类向下填充）', r.categories);
  assert(r.categories[0].keywords.includes('物流'), '关键词列 → 分类关键词', r.categories[0].keywords);
  const s = faq.importFaq(r.categories, 'merge');
  assert(s.itemsAdded === 1 && s.itemsUpdated === 1,
    '导入：「怎么查快递」问题相同 → 更新；「可以指定快递吗？」新增', s);
}

// ===== 5. JSON（faq-data.json 结构）=====
console.log('\n[5] JSON 导入');
{
  const json = JSON.stringify({
    categories: [{
      id: 'tech', name: '技术支持', keywords: ['故障'],
      items: [{ id: 'x', question: 'App 闪退怎么办？', answer: '请更新到最新版本。', tags: ['闪退'] }],
    }],
  });
  const r = await imp.parseImportFile('kb.json', Buffer.from(json, 'utf-8'));
  assert(r.categories[0].name === '技术支持' && r.categories[0].items.length === 1, 'JSON 解析正常', r.categories[0]);
  const s = faq.importFaq(r.categories, 'merge');
  assert(s.categoriesAdded === 1 && s.itemsAdded === 1, 'JSON 合并导入成功', s);
}

// ===== 6. upsert 幂等：重复导入同一批数据 =====
console.log('\n[6] 重复导入幂等性');
{
  const before = JSON.parse(fs.readFileSync(process.env.FAQ_DATA_PATH, 'utf-8'));
  const countBefore = before.categories.reduce((s: number, c: any) => s + c.items.length, 0);
  const r = await imp.parseImportFile('kb.md', Buffer.from([
    '# 退款', '', '### 退款被拒绝了怎么办？', '标签: 审核', '请检查是否符合退款条件，被拒后可联系客服申诉。\n申诉入口在订单详情页。',
  ].join('\r\n'), 'utf-8'));
  const s = faq.importFaq(r.categories, 'merge');
  const after = JSON.parse(fs.readFileSync(process.env.FAQ_DATA_PATH, 'utf-8'));
  const countAfter = after.categories.reduce((s2: number, c: any) => s2 + c.items.length, 0);
  assert(s.itemsUpdated === 1 && s.itemsAdded === 0, '同问题 → 只更新不新增', s);
  assert(countBefore === countAfter, '总条目数不变（无重复条目产生）', { countBefore, countAfter });
}

// ===== 7. 覆盖模式 =====
console.log('\n[7] 覆盖导入（replace）');
{
  const r = await imp.parseImportFile('kb.csv', Buffer.from('分类,问题,答案\n全新,这是覆盖后的条目,答案内容。', 'utf-8'));
  const s = faq.importFaq(r.categories, 'replace');
  const kb = JSON.parse(fs.readFileSync(process.env.FAQ_DATA_PATH, 'utf-8'));
  assert(s.categoriesAdded === 1 && kb.categories.length === 1 && kb.categories[0].name === '全新',
    'replace 清空旧分类后整体导入', kb.categories.map((c: any) => c.name));
  assert(kb.search?.minScore === 5, 'search 配置在覆盖后保留', kb.search);
}

// ===== 8. 错误处理 =====
console.log('\n[8] 错误处理');
{
  let err = '';
  try { await imp.parseImportFile('kb.docx', Buffer.from('x')); } catch (e: any) { err = e.message; }
  assert(err.includes('不支持的文件格式'), '不支持的扩展名被拒绝', err);

  try { await imp.parseImportFile('kb.csv', Buffer.from('只有,表头\n', 'utf-8')); } catch (e: any) { err = e.message; }
  assert(err.includes('表头') || err.includes('条目'), '无有效条目被拒绝', err);

  // 分类列缺失时回退"默认分类"，不报错
  const r = await imp.parseImportFile('kb2.csv', Buffer.from('问题,答案\n只有两列,也可以', 'utf-8'));
  assert(r.categories[0].name === '默认分类', '无分类列 → 归入「默认分类」', r.categories[0]);

  const tpl = imp.buildCsvTemplate();
  assert(tpl[0] === 0xef && tpl[1] === 0xbb && tpl[2] === 0xbf, 'CSV 模板带 UTF-8 BOM');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);

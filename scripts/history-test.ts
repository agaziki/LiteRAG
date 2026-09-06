/**
 * 长会话历史管理验证（tsx scripts/history-test.ts）
 *
 * 覆盖：滑动窗口切分（未超限/超限/边界）、sessions 摘要列回读、摘要提示词构建
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ''); }
}

const history = await import('../server/history.js');

// ===== 1. 滑动窗口切分 =====
console.log('\n[1] partitionHistory');
{
  const items = Array.from({ length: 10 }, (_, i) => i);
  const r1 = history.partitionHistory(items, 20);
  assert(r1.older.length === 0 && r1.recent.length === 10, '未超窗口 → 全部保留，无 older', { o: r1.older.length, r: r1.recent.length });

  const r2 = history.partitionHistory(items, 6);
  assert(r2.older.length === 4 && r2.recent.length === 6 &&
    r2.recent[0] === 4 && r2.older[3] === 3,
    '超窗口 → 旧的 4 条进入 older，最近 6 条保留且顺序不变', r2);

  const r3 = history.partitionHistory(items, 10);
  assert(r3.older.length === 0, '恰好等于窗口 → 不切分');

  const r4 = history.partitionHistory([], 5);
  assert(r4.older.length === 0 && r4.recent.length === 0, '空历史安全处理');
}

// ===== 2. sessions 摘要列回读 =====
console.log('\n[2] 摘要缓存持久化');
{
  const db = await import('../server/db.js');
  const now = new Date().toISOString();
  db.createSession({ id: 's-h', title: '长会话', model: 'deepseek-v4-flash', sdk_session_id: null, created_at: now, updated_at: now });
  const before = db.getSession('s-h')!;
  assert(!before.summary && (before.summary_upto ?? 0) === 0 || before.summary == null, '初始无摘要', before);

  db.setSessionSummary('s-h', '用户咨询退款，已告知 3-7 天到账。', 42);
  const after = db.getSession('s-h')!;
  assert(after.summary === '用户咨询退款，已告知 3-7 天到账。' && after.summary_upto === 42,
    'setSessionSummary 持久化并回读', after);

  db.setSessionSummary('s-h', '更新后的摘要。', 55);
  assert(db.getSession('s-h')!.summary_upto === 55, '摘要可更新（消息增量触发重生成）');
}

// ===== 3. 摘要提示词 =====
console.log('\n[3] 摘要提示词构建');
{
  const prompt = history.buildSummaryPrompt('用户：退款多久？\n客服：3-7 个工作日。');
  assert(prompt.length === 2 && prompt[0].role === 'system' && prompt[1].content.includes('3-7 个工作日'),
    '提示词包含系统指令与对话记录', prompt);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* WAL 句柄占用时忽略 */ }
process.exit(failed > 0 ? 1 : 0);

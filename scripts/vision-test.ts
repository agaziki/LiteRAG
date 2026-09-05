/**
 * 图片上传（视觉模型）管线验证（tsx scripts/vision-test.ts）
 *
 * 覆盖：多模态消息构建、图片校验（数量/格式/大小）、messages.images 列 DB 回读
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ''); }
}

// 1x1 透明 PNG
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const agent = await import('../server/deepseek-agent.js');

// ===== 1. 多模态消息构建 =====
console.log('\n[1] buildUserContent');
{
  const plain = agent.buildUserContent('退款多久到账？');
  assert(plain === '退款多久到账？', '无图片 → 纯文本消息', plain);

  const withImg = agent.buildUserContent('这张截图里是什么问题？', [PNG_1PX]) as Array<any>;
  assert(Array.isArray(withImg) && withImg.length === 2, '带图片 → 文本+1 个 image_url 块', withImg);
  assert(withImg[0].type === 'text' && withImg[0].text.includes('截图'), '文本块在前', withImg[0]);
  assert(withImg[1].type === 'image_url' && withImg[1].image_url.url === PNG_1PX, 'image_url 块携带 data URL', withImg[1]);

  const multi = agent.buildUserContent('对比这两张图', [PNG_1PX, PNG_1PX]) as Array<any>;
  assert(Array.isArray(multi) && multi.length === 3 && multi[2].type === 'image_url', '多图 → 多个 image_url 块', multi.length);
}

// ===== 2. 图片校验 =====
console.log('\n[2] validateImages');
{
  assert(agent.validateImages(undefined).length === 0, '未传图片 → 空数组');
  assert(agent.validateImages(null).length === 0, 'null → 空数组');
  assert(agent.validateImages([PNG_1PX]).length === 1, '合法 PNG data URL 通过');

  const cases: Array<[unknown, boolean, string]> = [
    [['data:text/plain;base64,SGk='], false, '非图片 MIME 拒绝'],
    [['https://example.com/a.png'], false, '非 data URL 拒绝'],
    [['普通字符串'], false, '普通字符串拒绝'],
    [[PNG_1PX, PNG_1PX, PNG_1PX, PNG_1PX, PNG_1PX], false, '超过 4 张拒绝'],
    [['not-array'], false, '非数组拒绝'],
  ];
  for (const [input, shouldPass, name] of cases) {
    let ok = true;
    try { agent.validateImages(input); } catch { ok = false; }
    assert(ok === shouldPass, name, input);
  }

  // 超过 5MB：构造一个约 7MB 的 base64 串
  const big = 'data:image/png;base64,' + 'A'.repeat(Math.ceil(7 * 1024 * 1024 * 4 / 3));
  let rejected = false;
  try { agent.validateImages([big]); } catch { rejected = true; }
  assert(rejected, '单张超过 5MB 拒绝');
}

// ===== 3. messages.images 列 DB 回读 =====
console.log('\n[3] 数据库 images 列回读');
{
  const { createSession, createMessage, getMessagesBySession } = await import('../server/db.js');
  const now = new Date().toISOString();
  createSession({ id: 's-vision', title: '视觉测试', model: 'deepseek-v4-flash-vision-exp', sdk_session_id: null, created_at: now, updated_at: now });
  createMessage({ id: 'm1', session_id: 's-vision', role: 'user', content: '看看这张图', model: null, created_at: now, tool_calls: null, images: JSON.stringify([PNG_1PX, PNG_1PX]) });
  createMessage({ id: 'm2', session_id: 's-vision', role: 'assistant', content: '这是一张 1x1 图片。', model: 'deepseek-v4-flash-vision-exp', created_at: now, tool_calls: null, images: null });

  const msgs = getMessagesBySession('s-vision');
  const user = msgs.find(m => m.id === 'm1')!;
  const imgs = JSON.parse(user.images!);
  assert(Array.isArray(imgs) && imgs.length === 2 && imgs[0] === PNG_1PX, '用户消息 images 持久化并回读', imgs);
  assert(msgs.find(m => m.id === 'm2')!.images === null, '助手消息 images 为 null');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* WAL 句柄占用时忽略 */ }
process.exit(failed > 0 ? 1 : 0);

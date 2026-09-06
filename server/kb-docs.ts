/**
 * 文档知识库（路线 B RAG）
 *
 * 管线：上传文档 → 抽取纯文本 → 切块 → 存 SQLite（kb_docs/kb_chunks）
 *       → 检索时块级向量同步（增量）→ 关键词 + 语义混合评分 → 与 FAQ 条目融合排序
 *
 * 与 FAQ 问答库的区别：匹配单位是「文档片段」，检索结果带文档名与章节标题，
 * 供 AI 引用出处。未配置 EMBEDDING_API_KEY 时文档块仍可按关键词检索。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import db from './db.js';
import { embedTexts, isEmbeddingEnabled, getEmbeddingConfig, SEMANTIC_WEIGHT, SEMANTIC_THRESHOLD } from './embeddings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 单块目标长度（中文字符） */
const CHUNK_SIZE = 500;
/** 相邻块重叠字符数：保留上一块尾部，避免关键句被切分边界截断 */
const CHUNK_OVERLAP = 60;
/** 单文档块数上限，防止异常大文档拖垮检索 */
const MAX_CHUNKS_PER_DOC = 2000;

// ============ 文本抽取 ============

/** 解码文本：BOM/UTF-8 优先，失败回退 GBK */
function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
}

async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop() || '';
  switch (ext) {
    case 'txt':
    case 'md':
    case 'markdown':
      return decodeText(buffer);
    case 'docx': {
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }
    case 'pdf': {
      // 动态加载 pdf.js（仅处理 PDF 时），文本抽取无需 canvas。
      // 注意：不能用 pdf-parse@1.1.1（其内置的 pdf.js 1.10 与 jszip 同进程冲突，
      // 而 jszip 是 mammoth 解析 docx 的依赖，两者共存会导致合法 PDF 报结构无效）。
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        useSystemFonts: false,
      }).promise;
      try {
        const pages: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const pageData = await doc.getPage(i);
          const tc = await pageData.getTextContent();
          let text = '';
          for (const item of tc.items as Array<{ str?: string; hasEOL?: boolean }>) {
            if (typeof item.str !== 'string') continue;
            text += item.str;
            if (item.hasEOL) text += '\n';
          }
          pages.push(text.trim());
        }
        return pages.join('\n\n');
      } finally {
        await doc.destroy();
      }
    }
    default:
      throw new Error(`不支持的文档格式 .${ext}（支持 .txt / .md / .docx / .pdf）`);
  }
}

// ============ 分块 ============

export interface RawChunk {
  /** 章节标题路径（如「退款政策 > 退款时效」）；纯文本文档为 null */
  title: string | null;
  content: string;
}

/** 中文按句子切分的正则 */
const SENTENCE_SPLIT = /(?<=[。！？；!?;])/;

/** 超长段落 → 按句子聚合为 ≤ CHUNK_SIZE 的段；无标点则硬切 */
function splitLong(para: string): string[] {
  if (para.length <= CHUNK_SIZE) return [para];
  const sentences = para.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (s.length > CHUNK_SIZE) {
      if (buf) { out.push(buf); buf = ''; }
      for (let i = 0; i < s.length; i += CHUNK_SIZE) out.push(s.slice(i, i + CHUNK_SIZE));
    } else if (buf.length + s.length > CHUNK_SIZE) {
      out.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * 分块策略：Markdown 按标题切节（保留「H1 > H2 > H3」完整标题层级路径作为块标题），
 * 纯文本按段落聚合；单块不超过 CHUNK_SIZE，相邻块携带 CHUNK_OVERLAP 字符重叠。
 */
export function chunkText(text: string): RawChunk[] {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return [];

  const lines = cleaned.split('\n');
  const hasHeadings = lines.some(l => /^#{1,4}\s+/.test(l.trim()));
  const sections: Array<{ title: string | null; paragraphs: string[] }> = [];

  if (hasHeadings) {
    // 标题层级栈：保留完整父级路径（如「退款政策 > 退款时效 > 退款方式」）
    const stack: string[] = [];
    let paras: string[] = [];
    const push = () => { if (paras.some(p => p.trim())) sections.push({ title: stack.filter(Boolean).join(' > ') || null, paragraphs: paras }); paras = []; };
    for (const line of lines) {
      const m = line.trim().match(/^(#{1,4})\s+(.+)$/);
      if (m) {
        push();
        const level = m[1].length;
        stack.length = level - 1;
        stack[level - 1] = m[2].trim();
      } else paras.push(line);
    }
    push();
  } else {
    sections.push({ title: null, paragraphs: lines });
  }

  const chunks: RawChunk[] = [];
  for (const s of sections) {
    const paras = s.paragraphs.map(p => p.trim()).filter(Boolean);
    if (!paras.length) continue;
    const pieces: string[] = [];
    for (const p of paras) pieces.push(...splitLong(p));

    // 聚合 pieces 为 ≤CHUNK_SIZE 的块；被切开的相邻块携带上一块尾部 overlap（计入预算）
    let buf = '';
    let carry = '';
    for (const piece of pieces) {
      const budget = CHUNK_SIZE - (carry ? carry.length + 1 : 0);
      if (buf && buf.length + 1 + piece.length > budget) {
        chunks.push({ title: s.title, content: (carry ? carry + '\n' : '') + buf.trim() });
        carry = buf.trim().slice(-CHUNK_OVERLAP);
        buf = '';
      }
      buf = buf ? `${buf}\n${piece}` : piece;
    }
    if (buf.trim()) chunks.push({ title: s.title, content: (carry ? carry + '\n' : '') + buf.trim() });
  }
  return chunks;
}

// ============ 入库与管理 ============

export interface KbDoc {
  id: string;
  name: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export function listDocs(): KbDoc[] {
  return db.prepare('SELECT id, name, chunk_count, created_at, updated_at FROM kb_docs ORDER BY updated_at DESC').all() as KbDoc[];
}

export function countChunks(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM kb_chunks').get() as { c: number }).c;
}

/** 文档名 = 文件名去扩展名；同名文档重新上传为整体替换 */
export async function ingestDoc(filename: string, buffer: Buffer): Promise<{ id: string; name: string; chunkCount: number }> {
  const name = path.basename(filename).replace(/\.[^.]+$/, '').trim() || '未命名文档';
  const text = await extractText(filename, buffer);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error('未能从文档中提取到文本内容（可能是扫描版 PDF 或空文档）');
  }
  if (chunks.length > MAX_CHUNKS_PER_DOC) {
    throw new Error(`文档切分出 ${chunks.length} 块，超过上限 ${MAX_CHUNKS_PER_DOC}，请拆分后上传`);
  }

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM kb_docs WHERE name = ?').get(name) as { id: string } | undefined;
  const docId = existing?.id ?? uuidv4();

  const insertChunk = db.prepare('INSERT INTO kb_chunks (id, doc_id, title, content, chunk_index, vector, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)');
  const run = db.transaction(() => {
    if (existing) {
      db.prepare('DELETE FROM kb_chunks WHERE doc_id = ?').run(docId);
      db.prepare('UPDATE kb_docs SET chunk_count = ?, updated_at = ? WHERE id = ?').run(chunks.length, now, docId);
    } else {
      db.prepare('INSERT INTO kb_docs (id, name, chunk_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(docId, name, chunks.length, now, now);
    }
    chunks.forEach((c, i) => insertChunk.run(uuidv4(), docId, c.title, c.content, i, now));
  });
  run();

  console.log(`[KB Docs] 文档「${name}」已入库: ${chunks.length} 块`);
  return { id: docId, name, chunkCount: chunks.length };
}

export function deleteDoc(id: string): boolean {
  const result = db.prepare('DELETE FROM kb_docs WHERE id = ?').run(id);
  return result.changes > 0;
}

// ============ 向量同步（增量：仅嵌入 vector 为 NULL 的块） ============

let docVectorSync: Promise<void> | null = null;

export function ensureDocVectors(): Promise<void> {
  if (!docVectorSync) {
    docVectorSync = doSyncDocVectors().finally(() => { docVectorSync = null; });
  }
  return docVectorSync;
}

async function doSyncDocVectors(): Promise<void> {
  const { model, baseUrl } = getEmbeddingConfig();
  const expected = JSON.stringify({ model, baseUrl });

  const meta = db.prepare('SELECT value FROM kb_meta WHERE key = ?').get('embed') as { value: string } | undefined;
  if (!meta || meta.value !== expected) {
    // 模型/服务配置变更 → 全部向量失效，重新嵌入
    db.prepare('UPDATE kb_chunks SET vector = NULL').run();
    db.prepare('INSERT INTO kb_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('embed', expected);
  }

  const pending = db.prepare(`
    SELECT c.id, c.title, c.content, d.name AS doc_name
    FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id
    WHERE c.vector IS NULL
  `).all() as Array<{ id: string; title: string | null; content: string; doc_name: string }>;
  if (pending.length === 0) return;

  console.log(`[KB Docs] 嵌入 ${pending.length} 个文档块 (model=${model})`);
  const update = db.prepare('UPDATE kb_chunks SET vector = ? WHERE id = ?');
  const CHUNK = 16;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const batch = pending.slice(i, i + CHUNK);
    const texts = batch.map(c => `${c.doc_name}${c.title ? ' > ' + c.title : ''}\n${c.content}`);
    const vectors = await embedTexts(texts);
    batch.forEach((c, idx) => update.run(JSON.stringify(vectors[idx]), c.id));
  }
}

// ============ 块级检索 ============

export interface DocChunkResult {
  id: string;
  docId: string;
  docName: string;
  title: string | null;
  content: string;
  chunkIndex: number;
  kwScore: number;
  semanticScore: number;
  score: number;
}

/**
 * 文档块混合检索。queryVector 由调用方传入（与 FAQ 检索共用一次查询向量化）；
 * 命中条件与 FAQ 一致：关键词分 ≥ minScore 或 语义相似度 ≥ SEMANTIC_THRESHOLD。
 */
export async function searchDocChunks(
  query: string,
  limit: number,
  opts: { minScore: number; queryVector?: number[] | null }
): Promise<DocChunkResult[]> {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return [];

  // 先同步向量再读库：否则首次检索会读到同步前的旧 NULL 向量
  let queryVector = opts.queryVector ?? null;
  if (queryVector && isEmbeddingEnabled()) {
    try {
      await ensureDocVectors();
    } catch (e: any) {
      console.error(`[KB Docs] 向量同步失败，回退关键词检索: ${e?.message || e}`);
      queryVector = null;
    }
  }

  const rows = db.prepare(`
    SELECT c.id, c.doc_id, c.title, c.content, c.chunk_index, c.vector, d.name AS doc_name
    FROM kb_chunks c JOIN kb_docs d ON d.id = c.doc_id
  `).all() as Array<{
    id: string; doc_id: string; title: string | null; content: string;
    chunk_index: number; vector: string | null; doc_name: string;
  }>;
  if (rows.length === 0) return [];

  const vectors = new Map<string, number[]>();
  if (queryVector) {
    for (const row of rows) {
      if (row.vector) vectors.set(row.id, JSON.parse(row.vector) as number[]);
    }
  }

  const tokens = normalizedQuery.split(/[\s,，。.、;；?？!！]+/).filter(Boolean);

  const results: DocChunkResult[] = [];
  for (const row of rows) {
    const titleLower = (row.title || '').toLowerCase();
    const contentLower = row.content.toLowerCase();
    const docNameLower = row.doc_name.toLowerCase();
    let kwScore = 0;
    for (const token of tokens) {
      if (titleLower.includes(token)) kwScore += 4;
      if (contentLower.includes(token)) kwScore += 2;
      if (docNameLower.includes(token)) kwScore += 2;
    }
    if (contentLower.includes(normalizedQuery)) kwScore += 4;

    // CJK 二元词（bigram）评分：中文无分词，整句查询往往无法整串命中。
    // 对 ≥3 字的 token 取相邻两字滑窗，命中标题/正文各 +1，单个 token 最多 +6。
    for (const token of tokens) {
      if (token.length < 3) continue;
      const bigrams = new Set<string>();
      for (let i = 0; i + 2 <= token.length; i++) bigrams.add(token.slice(i, i + 2));
      let bonus = 0;
      for (const bg of bigrams) {
        if (contentLower.includes(bg)) bonus += 1;
        if (titleLower.includes(bg)) bonus += 1;
        if (docNameLower.includes(bg)) bonus += 1;
        if (bonus >= 6) break;
      }
      kwScore += bonus;
    }

    let semantic = 0;
    const vec = vectors.get(row.id);
    if (queryVector && vec) {
      let sum = 0;
      const len = Math.min(queryVector.length, vec.length);
      for (let i = 0; i < len; i++) sum += queryVector[i] * vec[i];
      semantic = Math.max(0, sum);
    }

    const hit = kwScore >= opts.minScore || semantic >= SEMANTIC_THRESHOLD;
    if (!hit) continue;
    results.push({
      id: row.id,
      docId: row.doc_id,
      docName: row.doc_name,
      title: row.title,
      content: row.content,
      chunkIndex: row.chunk_index,
      kwScore,
      semanticScore: Math.round(semantic * 10000) / 10000,
      score: Math.round((kwScore + SEMANTIC_WEIGHT * semantic) * 100) / 100,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

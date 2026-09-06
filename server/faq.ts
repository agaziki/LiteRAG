import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { embedTexts, isEmbeddingEnabled, getEmbeddingConfig, SEMANTIC_WEIGHT, SEMANTIC_THRESHOLD } from './embeddings.js';
import { searchDocChunks } from './kb-docs.js';
import { isRerankEnabled, rerankDocuments, RERANK_WEIGHT } from './rerank.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  tags: string[];
}

interface FaqCategory {
  id: string;
  name: string;
  keywords: string[];
  items: FaqItem[];
}

interface FaqData {
  version: string;
  updated_at: string;
  /** 检索配置（可选）：minScore = 关键词最低命中分，低于该分不作为检索结果返回 */
  search?: { minScore?: number };
  categories: FaqCategory[];
}

/** 知识库文件路径：可用 FAQ_DATA_PATH 指向自定义位置（部署/测试用） */
function getFaqPath(): string {
  return process.env.FAQ_DATA_PATH || path.join(__dirname, 'faq-data.json');
}

let cachedFaq: FaqData | null = null;
let cachedMtimeMs = 0;
let cachedSize = 0;

function loadFaq(): FaqData {
  const faqPath = getFaqPath();
  if (!fs.existsSync(faqPath)) {
    // 文件不存在（如自定义路径首次使用）：生成骨架
    const skeleton: FaqData = {
      version: '1.0.0',
      updated_at: new Date().toISOString(),
      search: { minScore: 5 },
      categories: [],
    };
    persistFaq(skeleton);
  }
  const stat = fs.statSync(faqPath);
  // mtime + size 双重校验：同一毫秒内的连续写入也能感知（避免缓存滞留）
  if (!cachedFaq || stat.mtimeMs !== cachedMtimeMs || stat.size !== cachedSize) {
    const raw = fs.readFileSync(faqPath, 'utf-8');
    cachedFaq = JSON.parse(raw) as FaqData;
    cachedMtimeMs = stat.mtimeMs;
    cachedSize = stat.size;
    console.log(`[FAQ] Loaded ${cachedFaq.categories.reduce((sum, c) => sum + c.items.length, 0)} items from ${cachedFaq.categories.length} categories`);
  }
  return cachedFaq;
}

/** 原子化写回知识库文件，并使缓存失效（mtime 变化后下次自动重载） */
function persistFaq(faq: FaqData): void {
  const faqPath = getFaqPath();
  fs.mkdirSync(path.dirname(faqPath), { recursive: true });
  faq.updated_at = new Date().toISOString();
  const tmp = `${faqPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(faq, null, 2), 'utf-8');
  fs.renameSync(tmp, faqPath);
  cachedFaq = null;
  cachedMtimeMs = 0;
  cachedSize = 0;
}

export type KnowledgeResultType = 'faq' | 'doc';

/** 统一检索结果：FAQ 问答条目 + 文档片段（路线 B RAG） */
export interface KnowledgeResult {
  type: KnowledgeResultType;
  id: string;
  /** faq=分类名；doc=文档名 */
  category: string;
  /** faq：标准问题 */
  question?: string;
  /** faq=标准答案；doc=片段内容 */
  answer: string;
  /** doc：章节标题路径 */
  title?: string;
  /** 综合得分 = 关键词分 + 语义相似度 × 权重（FAQ 条目另有精选加权） */
  score: number;
  /** 语义余弦相似度 0~1（未启用向量检索时为 0） */
  semanticScore: number;
  tags?: string[];
}

/** FAQ 精选加权：人工整理的问答条目优先于文档片段（在关键词与语义得分之上做加权） */
const FAQ_BONUS = 4;

/** 计算关键词得分（不排序不过滤） */
function scoreAll(query: string): Array<{ item: FaqItem; category: FaqCategory; kwScore: number }> {
  const faq = loadFaq();
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return [];

  // 简单分词：按空格、标点切分；同时保留整串以提升短查询命中率
  const tokens = normalizedQuery
    .split(/[\s,，。.、;；?？!！]+/)
    .filter(t => t.length > 0);

  const all: Array<{ item: FaqItem; category: FaqCategory; kwScore: number }> = [];

  for (const category of faq.categories) {
    const categoryKeywordHits = category.keywords.filter(k =>
      normalizedQuery.includes(k.toLowerCase())
    ).length;
    const categoryBoost = categoryKeywordHits * 5;

    for (const item of category.items) {
      let score = categoryBoost;
      const qLower = item.question.toLowerCase();
      const aLower = item.answer.toLowerCase();

      for (const token of tokens) {
        if (qLower.includes(token)) score += 3;
        if (item.tags.some(t => t.toLowerCase().includes(token))) score += 2;
        if (aLower.includes(token)) score += 1;
      }

      // 整串命中 question 给额外加分
      if (qLower.includes(normalizedQuery)) score += 4;

      all.push({ item, category, kwScore: score });
    }
  }
  return all;
}

/**
 * 知识库统一检索（FAQ 问答 + 文档片段融合排序）：
 * - 关键词得分达到 minScore（默认 5，可在 faq-data.json 的 search.minScore 配置）即命中
 * - 启用语义检索（EMBEDDING_API_KEY）后，余弦相似度 ≥ 0.45 也算命中，
 *   综合分 = 关键词分 + 10 × 相似度；向量调用失败自动回退为纯关键词检索
 * - 文档片段（kb_docs）参与同一融合排序，FAQ 条目有 +2 精选加权
 */
export async function searchKnowledge(query: string, limit = 5): Promise<KnowledgeResult[]> {
  const faq = loadFaq();
  const minScore = faq.search?.minScore ?? 5;
  const all = scoreAll(query);
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return [];

  // 语义检索（可选，失败静默回退）
  let vectors: Map<string, number[]> | null = null;
  let queryVector: number[] | null = null;
  if (isEmbeddingEnabled()) {
    try {
      vectors = await ensureFaqVectors();
      queryVector = (await embedTexts([query]))[0];
    } catch (e: any) {
      console.error(`[FAQ] 语义检索不可用，回退关键词检索: ${e?.message || e}`);
      vectors = null;
      queryVector = null;
    }
  }

  let results: KnowledgeResult[] = [];
  for (const { item, category, kwScore } of all) {
    let semantic = 0;
    if (vectors && queryVector) {
      const v = vectors.get(item.id);
      if (v) semantic = Math.max(0, dotProduct(queryVector, v));
    }
    const hit = kwScore >= minScore || semantic >= SEMANTIC_THRESHOLD;
    if (!hit) continue;
    results.push({
      type: 'faq',
      id: item.id,
      category: category.name,
      question: item.question,
      answer: item.answer,
      score: Math.round((kwScore + SEMANTIC_WEIGHT * semantic + FAQ_BONUS) * 100) / 100,
      semanticScore: Math.round(semantic * 10000) / 10000,
      tags: item.tags,
    });
  }

  // 文档知识库融合（未上传文档时零开销；共用查询向量，避免重复嵌入调用）
  if (normalizedQuery) {
    try {
      const docResults = await searchDocChunks(query, limit, { minScore, queryVector });
      for (const d of docResults) {
        results.push({
          type: 'doc',
          id: d.id,
          category: d.docName,
          answer: d.content,
          title: d.title ?? undefined,
          score: d.score,
          semanticScore: d.semanticScore,
        });
      }
    } catch (e: any) {
      console.error(`[FAQ] 文档块检索失败: ${e?.message || e}`);
    }
  }

  // Rerank 两阶段精排（可选）：对当前排序的前 20 条候选用精排模型重排序；
  // 精排失败或未配置时保持原排序
  if (isRerankEnabled() && results.length > 1) {
    try {
      const top = results.slice(0, 20);
      const documents = top.map(r =>
        r.type === 'faq' ? `${r.question}\n${r.answer}` : `${r.category} ${r.title ?? ''}\n${r.answer}`
      );
      const ranked = await rerankDocuments(query, documents, top.length);
      if (ranked) {
        const reranked = ranked
          .filter(({ index }) => index >= 0 && index < top.length)
          .map(({ index, score }) => {
            const r = top[index];
            return {
              ...r,
              score: Math.round((RERANK_WEIGHT * score + r.score * 0.1) * 100) / 100,
            };
          });
        results = [...reranked, ...results.slice(top.length)];
      }
    } catch (e: any) {
      console.error(`[FAQ] 精排失败，保持原排序: ${e?.message || e}`);
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function listAllFaq(): FaqData {
  return loadFaq();
}

export function getMinScore(): number {
  return loadFaq().search?.minScore ?? 5;
}

export function getFaqByCategory(categoryId: string): FaqCategory | undefined {
  return loadFaq().categories.find(c => c.id === categoryId);
}

// ============ 知识库写操作（供管理 API 使用，写回 faq-data.json） ============

function findItem(itemId: string): { item: FaqItem; category: FaqCategory } | undefined {
  for (const category of loadFaq().categories) {
    const item = category.items.find(i => i.id === itemId);
    if (item) return { item, category };
  }
  return undefined;
}

function assertValidItem(input: { question?: string; answer?: string }): void {
  if (input.question !== undefined && !String(input.question).trim()) {
    throw new Error('问题内容不能为空');
  }
  if (input.answer !== undefined && !String(input.answer).trim()) {
    throw new Error('答案内容不能为空');
  }
}

export function addFaqItem(categoryId: string, input: { question: string; answer: string; tags?: string[] }): FaqItem {
  assertValidItem(input);
  const faq = loadFaq();
  const category = faq.categories.find(c => c.id === categoryId);
  if (!category) throw new Error(`分类不存在: ${categoryId}`);
  const item: FaqItem = {
    id: `${categoryId}-${uuidv4().slice(0, 8)}`,
    question: String(input.question).trim(),
    answer: String(input.answer).trim(),
    tags: Array.isArray(input.tags) ? input.tags.map(t => String(t).trim()).filter(Boolean) : [],
  };
  category.items.push(item);
  persistFaq(faq);
  return item;
}

export function updateFaqItem(itemId: string, input: { question?: string; answer?: string; tags?: string[]; categoryId?: string }): FaqItem {
  assertValidItem(input);
  const faq = loadFaq();
  const found = findItem(itemId);
  if (!found) throw new Error(`条目不存在: ${itemId}`);
  const { item } = found;

  if (input.question !== undefined) item.question = String(input.question).trim();
  if (input.answer !== undefined) item.answer = String(input.answer).trim();
  if (input.tags !== undefined) {
    item.tags = Array.isArray(input.tags) ? input.tags.map(t => String(t).trim()).filter(Boolean) : [];
  }
  if (input.categoryId !== undefined && input.categoryId !== found.category.id) {
    const target = faq.categories.find(c => c.id === input.categoryId);
    if (!target) throw new Error(`目标分类不存在: ${input.categoryId}`);
    found.category.items = found.category.items.filter(i => i.id !== itemId);
    target.items.push(item);
  }
  persistFaq(faq);
  return item;
}

export function deleteFaqItem(itemId: string): void {
  const faq = loadFaq();
  const found = findItem(itemId);
  if (!found) throw new Error(`条目不存在: ${itemId}`);
  found.category.items = found.category.items.filter(i => i.id !== itemId);
  persistFaq(faq);
}

export function addFaqCategory(input: { id?: string; name: string; keywords?: string[] }): FaqCategory {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('分类名称不能为空');
  const faq = loadFaq();
  let id = String(input.id || '').trim() || `cat-${uuidv4().slice(0, 8)}`;
  if (faq.categories.some(c => c.id === id)) throw new Error(`分类 ID 已存在: ${id}`);
  const category: FaqCategory = {
    id,
    name,
    keywords: Array.isArray(input.keywords) ? input.keywords.map(k => String(k).trim()).filter(Boolean) : [],
    items: [],
  };
  faq.categories.push(category);
  persistFaq(faq);
  return category;
}

export function updateFaqCategory(categoryId: string, input: { name?: string; keywords?: string[] }): FaqCategory {
  const faq = loadFaq();
  const category = faq.categories.find(c => c.id === categoryId);
  if (!category) throw new Error(`分类不存在: ${categoryId}`);
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new Error('分类名称不能为空');
    category.name = name;
  }
  if (input.keywords !== undefined) {
    category.keywords = Array.isArray(input.keywords) ? input.keywords.map(k => String(k).trim()).filter(Boolean) : [];
  }
  persistFaq(faq);
  return category;
}

export function deleteFaqCategory(categoryId: string): void {
  const faq = loadFaq();
  const category = faq.categories.find(c => c.id === categoryId);
  if (!category) throw new Error(`分类不存在: ${categoryId}`);
  if (category.items.length > 0) {
    throw new Error(`分类「${category.name}」下仍有 ${category.items.length} 条条目，请先删除或移动`);
  }
  faq.categories = faq.categories.filter(c => c.id !== categoryId);
  persistFaq(faq);
}

// ============ 文件批量导入（解析见 faq-import.ts，路线 B 时替换其解析层即可） ============

export interface ImportSummary {
  categoriesAdded: number;
  categoriesUpdated: number;
  itemsAdded: number;
  itemsUpdated: number;
  /** 导入总条目数 */
  total: number;
}

/**
 * 将解析后的知识条目应用到知识库：
 * - merge（默认）：按分类名匹配（无则新建），分类关键词做并集，条目按「同分类内问题相同即更新」upsert
 * - replace：清空现有全部分类后整体导入（search.minScore 配置保留）
 * 重复导入同一文件是幂等的：第二次全部走 itemsUpdated，不产生重复条目。
 */
export function importFaq(
  parsed: Array<{ name: string; keywords: string[]; items: Array<{ question: string; answer: string; tags: string[] }> }>,
  mode: 'merge' | 'replace'
): ImportSummary {
  const faq = loadFaq();
  const summary: ImportSummary = {
    categoriesAdded: 0, categoriesUpdated: 0, itemsAdded: 0, itemsUpdated: 0,
    total: parsed.reduce((sum, c) => sum + c.items.length, 0),
  };

  if (mode === 'replace') {
    faq.categories = [];
  }

  for (const incoming of parsed) {
    const name = String(incoming.name || '').trim() || '默认分类';
    let category = faq.categories.find(c => c.name === name || c.id === name);
    if (!category) {
      category = {
        id: `cat-${uuidv4().slice(0, 8)}`,
        name,
        keywords: [],
        items: [],
      };
      faq.categories.push(category);
      summary.categoriesAdded++;
    } else {
      summary.categoriesUpdated++;
    }

    // 分类关键词并集（保留已有顺序）
    for (const k of incoming.keywords.map(k => String(k).trim()).filter(Boolean)) {
      if (!category.keywords.includes(k)) category.keywords.push(k);
    }

    // 条目 upsert：同分类内问题相同（trim 后精确匹配）即更新
    for (const item of incoming.items) {
      const question = String(item.question || '').trim();
      const answer = String(item.answer || '').trim();
      if (!question || !answer) continue;
      const tags = Array.isArray(item.tags) ? item.tags.map(t => String(t).trim()).filter(Boolean) : [];
      const existing = category.items.find(i => i.question === question);
      if (existing) {
        existing.answer = answer;
        existing.tags = tags;
        summary.itemsUpdated++;
      } else {
        category.items.push({ id: `${category.id}-${uuidv4().slice(0, 8)}`, question, answer, tags });
        summary.itemsAdded++;
      }
    }
  }

  persistFaq(faq);
  console.log(`[FAQ Admin] 导入完成 (${mode}): 分类 +${summary.categoriesAdded}/~${summary.categoriesUpdated}, 条目 +${summary.itemsAdded}/~${summary.itemsUpdated}`);
  return summary;
}

// ============ 语义向量缓存（启用 EMBEDDING_API_KEY 后生效） ============

interface VectorCache {
  model: string;
  baseUrl: string;
  items: Record<string, { hash: string; vector: number[] }>;
}

let vectorCache: VectorCache | null = null;
let vectorSyncPromise: Promise<Map<string, number[]>> | null = null;

function getVectorCachePath(): string {
  return path.join(path.dirname(getFaqPath()), 'faq-vectors.json');
}

function contentHash(text: string): string {
  return crypto.createHash('sha1').update(text, 'utf-8').digest('hex').slice(0, 16);
}

function embedTextForFaq(category: { name: string }, item: { question: string; tags: string[]; answer: string }): string {
  return `${category.name}\n${item.question}\n关键词: ${item.tags.join(', ')}\n${item.answer}`;
}

function loadVectorCache(): VectorCache {
  const { model, baseUrl } = getEmbeddingConfig();
  if (vectorCache && vectorCache.model === model && vectorCache.baseUrl === baseUrl) {
    return vectorCache;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(getVectorCachePath(), 'utf-8')) as VectorCache;
    if (raw.model === model && raw.baseUrl === baseUrl && raw.items) {
      vectorCache = raw;
      return vectorCache;
    }
  } catch {
    // 缓存文件缺失/损坏则重建
  }
  vectorCache = { model, baseUrl, items: {} };
  return vectorCache;
}

function saveVectorCache(): void {
  if (!vectorCache) return;
  try {
    fs.mkdirSync(path.dirname(getVectorCachePath()), { recursive: true });
    fs.writeFileSync(getVectorCachePath(), JSON.stringify(vectorCache), 'utf-8');
  } catch (e: any) {
    console.error(`[FAQ] 向量缓存写入失败: ${e?.message || e}`);
  }
}

/**
 * 确保所有条目都有当前配置下的向量：内容变化（hash 不同）的条目增量重嵌入。
 * 并发调用合并为一次同步，避免重复请求。
 */
async function ensureFaqVectors(): Promise<Map<string, number[]>> {
  if (!vectorSyncPromise) {
    vectorSyncPromise = doSyncVectors().finally(() => {
      vectorSyncPromise = null;
    });
  }
  return vectorSyncPromise;
}

async function doSyncVectors(): Promise<Map<string, number[]>> {
  const faq = loadFaq();
  const cache = loadVectorCache();
  const { model, baseUrl } = getEmbeddingConfig();
  cache.model = model;
  cache.baseUrl = baseUrl;

  const missing: Array<{ id: string; text: string }> = [];
  for (const category of faq.categories) {
    for (const item of category.items) {
      const hash = contentHash(embedTextForFaq(category, item));
      const cached = cache.items[item.id];
      if (!cached || cached.hash !== hash) {
        missing.push({ id: item.id, text: embedTextForFaq(category, item) });
      }
    }
  }

  // 条目被删除时同步清理缓存
  const validIds = new Set(faq.categories.flatMap(c => c.items.map(i => i.id)));
  for (const id of Object.keys(cache.items)) {
    if (!validIds.has(id)) delete cache.items[id];
  }

  if (missing.length > 0) {
    console.log(`[FAQ] 嵌入 ${missing.length} 条向量 (model=${model})`);
    const CHUNK = 16;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const vectors = await embedTexts(chunk.map(m => m.text));
      chunk.forEach((m, idx) => {
        cache.items[m.id] = { hash: contentHash(m.text), vector: vectors[idx] };
      });
    }
    saveVectorCache();
  }

  const map = new Map<string, number[]>();
  for (const [id, entry] of Object.entries(cache.items)) {
    map.set(id, entry.vector);
  }
  return map;
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Embedding 客户端（OpenAI 兼容 /embeddings 接口）
 *
 * 可接入任何 OpenAI 兼容的向量化服务，例如：
 *   - 火山引擎 Ark:   EMBEDDING_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
 *                     EMBEDDING_MODEL=doubao-embedding-large-text-250515
 *   - OpenAI:         EMBEDDING_BASE_URL=https://api.openai.com/v1
 *                     EMBEDDING_MODEL=text-embedding-3-small
 *   - 本地推理服务:    ollama / vllm / one-api 等
 *
 * 未配置 EMBEDDING_API_KEY 时语义检索关闭，FAQ 检索自动退化为纯关键词模式。
 */

import OpenAI from "openai";

export const EMBEDDING_MODEL_DEFAULT = "text-embedding-3-small";

/** 语义检索共享参数：综合分 = 关键词分 + SEMANTIC_WEIGHT × 余弦相似度 */
export const SEMANTIC_WEIGHT = 10;
/** 语义命中门槛：关键词分不足时，余弦相似度达到该值也算命中 */
export const SEMANTIC_THRESHOLD = 0.45;

let embedClient: OpenAI | null = null;

export function isEmbeddingEnabled(): boolean {
  return !!process.env.EMBEDDING_API_KEY;
}

/** 当前 embedding 配置（模型变更时用于判断向量缓存是否失效） */
export function getEmbeddingConfig(): { model: string; baseUrl: string } {
  return {
    model: process.env.EMBEDDING_MODEL || EMBEDDING_MODEL_DEFAULT,
    baseUrl: process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1",
  };
}

function getEmbedClient(): OpenAI {
  if (embedClient) return embedClient;
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) {
    throw new Error("未配置 EMBEDDING_API_KEY，语义检索不可用");
  }
  embedClient = new OpenAI({
    baseURL: process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1",
    apiKey,
  });
  return embedClient;
}

/** 配置变更后重置客户端 */
export function resetEmbedClient(): void {
  embedClient = null;
}

function normalizeVector(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map(x => x / norm);
}

/**
 * 批量文本向量化（L2 归一化，cosine 相似度 = 点积）。
 * 自动按 16 条分批，兼容各服务商的批量上限；返回顺序与输入一致。
 * 显式指定 encoding_format: 'float'：SDK 默认会改用 base64 传输并强制解码，
 * 部分第三方兼容服务不支持 base64，float 数组是兼容性最好的格式。
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getEmbedClient();
  const model = process.env.EMBEDDING_MODEL || EMBEDDING_MODEL_DEFAULT;

  const out: number[][] = [];
  const CHUNK = 16;
  for (let i = 0; i < texts.length; i += CHUNK) {
    const chunk = texts.slice(i, i + CHUNK);
    const res = await client.embeddings.create({ model, input: chunk, encoding_format: 'float' });
    const sorted = [...res.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const d of sorted) {
      out.push(normalizeVector(d.embedding as number[]));
    }
  }
  return out;
}

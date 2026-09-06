/**
 * Rerank 两阶段检索的精排层
 *
 * 流程：粗筛（关键词 + 向量混合评分）取 top-20 → 本模块用 rerank 模型精排 → 重排序。
 * 兼容 SiliconFlow / Jina / Cohere 风格的 POST {baseUrl}/rerank 接口。
 * 未配置 RERANK_API_KEY 或调用失败时，上层自动回退为无精排排序。
 */

export const RERANK_MODEL_DEFAULT = "BAAI/bge-reranker-v2-m3";
/** 精排得分权重：综合分 = RERANK_WEIGHT × 相关性 + 原始得分 × 0.1 */
export const RERANK_WEIGHT = 20;

export function isRerankEnabled(): boolean {
  return !!process.env.RERANK_API_KEY;
}

export function getRerankConfig(): { model: string; baseUrl: string } {
  return {
    model: process.env.RERANK_MODEL || RERANK_MODEL_DEFAULT,
    baseUrl: process.env.RERANK_BASE_URL || "https://api.siliconflow.cn/v1",
  };
}

/**
 * 对候选文档按与 query 的相关性精排。
 * 返回 [{index, score}]（score ∈ [0,1]，按相关性降序）；失败返回 null（调用方回退）。
 */
export async function rerankDocuments(
  query: string,
  documents: string[],
  topN: number
): Promise<Array<{ index: number; score: number }> | null> {
  const apiKey = process.env.RERANK_API_KEY;
  if (!apiKey) return null;
  const { model, baseUrl } = getRerankConfig();

  const resp = await fetch(`${baseUrl}/rerank`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, query, documents, top_n: topN }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    throw new Error(`rerank HTTP ${resp.status}`);
  }
  const data: any = await resp.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return results
    .map((r: any) => ({
      index: typeof r.index === "number" ? r.index : 0,
      score: typeof r.relevance_score === "number"
        ? r.relevance_score
        : typeof r.score === "number" ? r.score : 0,
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
}

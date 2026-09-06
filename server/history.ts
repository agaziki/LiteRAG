/**
 * 长会话历史管理：滑动窗口 + 摘要压缩
 *
 * 策略：窗口内的最近消息全量发送；窗口外的更早消息以 LLM 生成的
 * 会话摘要替代（摘要按会话缓存，消息增量超过阈值才重新生成）。
 */

/** 滑动窗口切分：超出窗口的旧消息进入 older（待摘要），窗口内为 recent */
export function partitionHistory<T>(items: T[], window: number): { older: T[]; recent: T[] } {
  if (items.length <= window) return { older: [], recent: items };
  const cutoff = items.length - window;
  return { older: items.slice(0, cutoff), recent: items.slice(cutoff) };
}

/** 摘要生成的提示词（与 Agent 回复共用同一模型） */
export function buildSummaryPrompt(transcript: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: '你是客服对话记录员。请用不超过 300 字总结以下客服对话的关键信息：用户的核心诉求、已给出的结论或承诺、尚未解决的问题。只输出摘要本身，不要评论。',
    },
    { role: 'user', content: transcript },
  ];
}

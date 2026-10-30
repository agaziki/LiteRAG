/**
 * 内容审核钩子（预留扩展点）
 *
 * 图片问答的每一张图片、以及被输入防护（guard.ts）判为中/高风险的文本消息，
 * 在进入 Agent 前都会经过本模块的钩子。默认关闭（不产生任何外部调用）。
 *
 * 接入方式：在下方 TODO 处实现你的审核服务调用（如火山引擎内容安全、
 * 阿里云内容安全等），将图片 data URL / 消息文本提交审核；
 * 返回非空字符串即视为违规（拒绝该内容并提示用户），返回 null 表示通过。
 *
 * 可用环境变量：IMAGE_MODERATION=true 启用图片审核；TEXT_MODERATION=true 启用文本审核。
 */

export async function moderateImage(dataUrl: string): Promise<string | null> {
  if (process.env.IMAGE_MODERATION !== "true") return null;

  // TODO: 接入内容审核服务，示例骨架：
  // const resp = await fetch(MODERATION_ENDPOINT, {
  //   method: "POST",
  //   headers: { Authorization: `Bearer ${process.env.MODERATION_API_KEY}` },
  //   body: JSON.stringify({ image: dataUrl }),
  // });
  // const verdict = await resp.json();
  // if (verdict.risky) return "图片包含不适宜内容";

  return null; // 通过
}

/** 文本消息审核：对 guard 判为中/高风险的消息做二次意见（TEXT_MODERATION=true 启用） */
export async function moderateText(text: string): Promise<string | null> {
  if (process.env.TEXT_MODERATION !== "true") return null;

  // TODO: 接入文本内容审核服务，示例骨架：
  // const resp = await fetch(MODERATION_ENDPOINT, {
  //   method: "POST",
  //   headers: { Authorization: `Bearer ${process.env.MODERATION_API_KEY}` },
  //   body: JSON.stringify({ text }),
  // });
  // const verdict = await resp.json();
  // if (verdict.risky) return "消息包含不适宜内容";

  return null; // 通过
}

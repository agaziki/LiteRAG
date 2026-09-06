/**
 * 内容审核钩子（预留扩展点）
 *
 * 图片问答的每一张图片在进入 Agent 前都会经过本钩子。
 * 默认关闭（不产生任何外部调用）。
 *
 * 接入方式：在下方 TODO 处实现你的审核服务调用（如火山引擎内容安全、
 * 阿里云内容安全等），将图片 data URL 提交审核；
 * 返回非空字符串即视为违规（拒绝该图片并提示用户），返回 null 表示通过。
 *
 * 可用环境变量：IMAGE_MODERATION=true 时启用钩子调用（默认 false 跳过）。
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

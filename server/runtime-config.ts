/**
 * 运行时配置：话题边界策略等管理后台可切换的运行项。
 *
 * 优先级：环境变量 TOPIC_BOUNDARY > data/config.json（后台开关写入）> 默认 strict。
 * 环境变量显式设置时视为运维锁定，后台开关仅影响当前进程（重启后回到 .env 值）。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置文件与数据库同目录（跟随 DB_PATH），默认 data/config.json
const configPath = process.env.DB_PATH
  ? path.join(path.dirname(process.env.DB_PATH), 'config.json')
  : path.join(__dirname, '..', 'data', 'config.json');

export type TopicBoundary = 'strict' | 'open';

let cached: TopicBoundary | null = null;

function loadFromDisk(): TopicBoundary | null {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (raw.topicBoundary === 'strict' || raw.topicBoundary === 'open') return raw.topicBoundary;
  } catch {
    // 文件不存在或损坏：回退默认
  }
  return null;
}

export function getTopicBoundary(): TopicBoundary {
  if (cached) return cached;
  const env = process.env.TOPIC_BOUNDARY;
  if (env === 'open' || env === 'strict') {
    cached = env;
    return cached;
  }
  cached = loadFromDisk() ?? 'strict';
  return cached;
}

export function setTopicBoundary(mode: TopicBoundary): void {
  cached = mode;
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // 首次写入
    }
    fs.writeFileSync(configPath, JSON.stringify({ ...current, topicBoundary: mode }, null, 2), 'utf-8');
    console.log(`[Config] 话题边界策略已切换为 ${mode === 'strict' ? '温和模式' : '开放模式'}`);
  } catch (e) {
    console.error('[Config] 配置写入失败（仅当前进程生效）:', e);
  }
}

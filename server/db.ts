// libsql 是 better-sqlite3 的兼容 fork（N-API 预编译，无需本机编译工具链）
import Database from 'libsql';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径（可用 DB_PATH 环境变量指向自定义位置）
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'chat.db');

// 确保 data 目录存在
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db: Database.Database = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');

// 初始化数据库表
db.exec(`
  -- 会话表
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    sdk_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 消息表
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL,
    tool_calls TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 为会话 ID 创建索引
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

  -- 满意度评价表
  CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id TEXT,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ratings_session_id ON ratings(session_id);

  -- 转人工事件表
  CREATE TABLE IF NOT EXISTS escalations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    intent TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'resolved')),
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_escalations_session_id ON escalations(session_id);

  -- 会话意图标记（轻量记录 Agent 识别出的意图，便于后台分析）
  CREATE TABLE IF NOT EXISTS session_intents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    confidence TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_session_intents_session_id ON session_intents(session_id);

  -- 文档知识库（路线 B RAG）：整篇文档切块后入库，vector 存归一化向量的 JSON
  CREATE TABLE IF NOT EXISTS kb_docs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_chunks (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    vector TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (doc_id) REFERENCES kb_docs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id);

  -- 键值元数据（如文档向量对应的 embedding 模型配置）
  CREATE TABLE IF NOT EXISTS kb_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// 数据库迁移：补充列（如果不存在）
try {
  const sessionsInfo = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionsInfo.some(col => col.name === 'sdk_session_id')) {
    db.exec("ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT");
    console.log("[DB] Added sdk_session_id column to sessions table");
  }
  const messagesInfo = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  if (!messagesInfo.some(col => col.name === 'images')) {
    db.exec("ALTER TABLE messages ADD COLUMN images TEXT");
    console.log("[DB] Added images column to messages table");
  }
  const escalationsInfo = db.prepare("PRAGMA table_info(escalations)").all() as Array<{ name: string }>;
  if (!escalationsInfo.some(col => col.name === 'contact')) {
    db.exec("ALTER TABLE escalations ADD COLUMN contact TEXT");
    db.exec("ALTER TABLE escalations ADD COLUMN note TEXT");
    console.log("[DB] Added contact/note columns to escalations table");
  }
  // 长会话管理：历史摘要缓存
  const hasSummary = sessionsInfo.some(col => col.name === 'summary');
  if (!hasSummary) {
    db.exec("ALTER TABLE sessions ADD COLUMN summary TEXT");
    db.exec("ALTER TABLE sessions ADD COLUMN summary_upto INTEGER");
    console.log("[DB] Added summary/summary_upto columns to sessions table");
  }
} catch (e) {
  // 忽略错误（列可能已存在）
}

// 类型定义
export interface DbSession {
  id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
  /** 长会话管理：窗口外历史的摘要缓存 */
  summary?: string | null;
  /** 摘要已覆盖的消息条数 */
  summary_upto?: number | null;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
  /** 用户消息附带的图片（data URL JSON 数组），仅视觉模型场景 */
  images: string | null;
}

// ============= 会话操作 =============

// 获取所有会话
export function getAllSessions(): DbSession[] {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
  return stmt.all() as DbSession[];
}

// 获取单个会话
export function getSession(id: string): DbSession | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  return stmt.get(id) as DbSession | undefined;
}

// 创建会话
export function createSession(session: DbSession): DbSession {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, model, sdk_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(session.id, session.title, session.model, session.sdk_session_id, session.created_at, session.updated_at);
  return session;
}

// 更新会话
export function updateSession(id: string, updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }
  
  if (fields.length === 0) return false;
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  
  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除会话
export function deleteSession(id: string): boolean {
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

/** 长会话管理：保存窗口外历史的摘要及已覆盖的消息条数 */
export function setSessionSummary(sessionId: string, summary: string, upto: number): boolean {
  const stmt = db.prepare('UPDATE sessions SET summary = ?, summary_upto = ? WHERE id = ?');
  return stmt.run(summary, upto, sessionId).changes > 0;
}

// ============= 消息操作 =============

// 获取会话的所有消息
export function getMessagesBySession(sessionId: string): DbMessage[] {
  const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbMessage[];
}

// 创建消息
export function createMessage(message: DbMessage): DbMessage {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls, images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.model,
    message.created_at,
    message.tool_calls,
    message.images
  );
  
  // 更新会话的 updated_at
  const updateStmt = db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
  updateStmt.run(new Date().toISOString(), message.session_id);
  
  return message;
}

// 更新消息内容
export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }
  
  if (fields.length === 0) return false;
  
  values.push(id);
  
  const stmt = db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除消息
export function deleteMessage(id: string): boolean {
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// 批量创建消息（用于保存对话）
export function createMessages(messages: DbMessage[]): void {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls, images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((msgs: DbMessage[]) => {
    for (const msg of msgs) {
      stmt.run(msg.id, msg.session_id, msg.role, msg.content, msg.model, msg.created_at, msg.tool_calls, msg.images);
    }
  });

  insertMany(messages);
}

// ============= 满意度评价操作 =============

export interface DbRating {
  id: string;
  session_id: string;
  message_id: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
}

export function createRating(rating: DbRating): DbRating {
  const stmt = db.prepare(`
    INSERT INTO ratings (id, session_id, message_id, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(rating.id, rating.session_id, rating.message_id, rating.rating, rating.comment, rating.created_at);
  return rating;
}

/** 按（会话+消息）去重保存评价：同一条消息重复评价时更新原记录 */
export function upsertRating(rating: DbRating): DbRating {
  if (rating.message_id) {
    const existing = db.prepare('SELECT id FROM ratings WHERE session_id = ? AND message_id = ?')
      .get(rating.session_id, rating.message_id) as { id: string } | undefined;
    if (existing) {
      db.prepare('UPDATE ratings SET rating = ?, comment = ?, created_at = ? WHERE id = ?')
        .run(rating.rating, rating.comment, rating.created_at, existing.id);
      return { ...rating, id: existing.id };
    }
  }
  return createRating(rating);
}

export function getRatingsBySession(sessionId: string): DbRating[] {
  const stmt = db.prepare('SELECT * FROM ratings WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbRating[];
}

export function getRatingStats(): {
  total: number;
  average: number;
  distribution: { rating: number; count: number }[];
  recentAverage: number;
} {
  const totalRow = db.prepare('SELECT COUNT(*) as count, AVG(rating) as avg FROM ratings').get() as { count: number; avg: number | null } | undefined;
  const total = totalRow?.count || 0;
  const average = totalRow?.avg ? Math.round(totalRow.avg * 100) / 100 : 0;

  const distRows = db.prepare('SELECT rating, COUNT(*) as count FROM ratings GROUP BY rating ORDER BY rating DESC').all() as { rating: number; count: number }[];
  const distribution = [5, 4, 3, 2, 1].map(r => ({
    rating: r,
    count: distRows.find(d => d.rating === r)?.count || 0
  }));

  // 最近 7 天平均分
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentRow = db.prepare('SELECT AVG(rating) as avg FROM ratings WHERE created_at >= ?').get(sevenDaysAgo) as { avg: number | null } | undefined;
  const recentAverage = recentRow?.avg ? Math.round(recentRow.avg * 100) / 100 : 0;

  return { total, average, distribution, recentAverage };
}

// ============= 转人工事件操作 =============

export interface DbEscalation {
  id: string;
  session_id: string;
  reason: string;
  intent: string | null;
  status: 'pending' | 'accepted' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  /** 用户留言：联系方式（转人工后填写） */
  contact?: string | null;
  /** 用户留言：补充描述 */
  note?: string | null;
}

export function createEscalation(esc: Omit<DbEscalation, 'status' | 'resolved_at'> & { status?: 'pending' | 'accepted' | 'resolved'; resolved_at?: string | null }): DbEscalation {
  const status = esc.status || 'pending';
  const stmt = db.prepare(`
    INSERT INTO escalations (id, session_id, reason, intent, status, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(esc.id, esc.session_id, esc.reason, esc.intent, status, esc.created_at, esc.resolved_at || null);
  return { ...esc, status, resolved_at: esc.resolved_at || null };
}

export function getEscalationsBySession(sessionId: string): DbEscalation[] {
  const stmt = db.prepare('SELECT * FROM escalations WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbEscalation[];
}

export function getAllEscalations(): DbEscalation[] {
  const stmt = db.prepare('SELECT * FROM escalations ORDER BY created_at DESC');
  return stmt.all() as DbEscalation[];
}

export function updateEscalationStatus(id: string, status: 'pending' | 'accepted' | 'resolved'): boolean {
  const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
  const stmt = db.prepare('UPDATE escalations SET status = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?');
  const result = stmt.run(status, resolvedAt, id);
  return result.changes > 0;
}

/** 用户留言：保存联系方式与补充描述 */
export function updateEscalationNote(id: string, contact: string, note: string): boolean {
  const stmt = db.prepare('UPDATE escalations SET contact = ?, note = ? WHERE id = ?');
  const result = stmt.run(contact, note, id);
  return result.changes > 0;
}

// ============= 会话意图操作 =============

export interface DbSessionIntent {
  id: string;
  session_id: string;
  intent: string;
  confidence: string | null;
  created_at: string;
}

export function createSessionIntent(intent: Omit<DbSessionIntent, 'id' | 'created_at'> & { id?: string; created_at?: string }): DbSessionIntent {
  const record: DbSessionIntent = {
    id: intent.id || uuidv4(),
    session_id: intent.session_id,
    intent: intent.intent,
    confidence: intent.confidence || null,
    created_at: intent.created_at || new Date().toISOString(),
  };
  const stmt = db.prepare(`
    INSERT INTO session_intents (id, session_id, intent, confidence, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(record.id, record.session_id, record.intent, record.confidence, record.created_at);
  return record;
}

export function getIntentsBySession(sessionId: string): DbSessionIntent[] {
  const stmt = db.prepare('SELECT * FROM session_intents WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbSessionIntent[];
}

export function getIntentStats(): { intent: string; count: number }[] {
  const rows = db.prepare('SELECT intent, COUNT(*) as count FROM session_intents GROUP BY intent ORDER BY count DESC').all() as { intent: string; count: number }[];
  return rows;
}

// ============= 后台统计聚合 =============

export interface SessionWithStats {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  rating: number | null;
  rating_comment: string | null;
  escalated: number;
  escalation_status: string | null;
  last_intent: string | null;
}

export function getSessionsWithStats(): SessionWithStats[] {
  const rows = db.prepare(`
    SELECT
      s.id, s.title, s.model, s.created_at, s.updated_at,
      (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
      (SELECT r.rating FROM ratings r WHERE r.session_id = s.id ORDER BY r.created_at DESC LIMIT 1) AS rating,
      (SELECT r.comment FROM ratings r WHERE r.session_id = s.id ORDER BY r.created_at DESC LIMIT 1) AS rating_comment,
      (SELECT COUNT(*) FROM escalations e WHERE e.session_id = s.id) AS escalated,
      (SELECT e.status FROM escalations e WHERE e.session_id = s.id ORDER BY e.created_at DESC LIMIT 1) AS escalation_status,
      (SELECT si.intent FROM session_intents si WHERE si.session_id = s.id ORDER BY si.created_at DESC LIMIT 1) AS last_intent
    FROM sessions s
    ORDER BY s.updated_at DESC
  `).all() as SessionWithStats[];
  return rows;
}

// 清空所有数据
export function clearAllData(): void {
  db.exec('DELETE FROM session_intents');
  db.exec('DELETE FROM escalations');
  db.exec('DELETE FROM ratings');
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
}

export default db;

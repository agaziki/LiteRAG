/**
 * FAQ 知识库文件导入：格式解析层
 *
 * 职责：把上传的文件解析为统一的中间结构 ParsedCategory[]，由 faq.ts 的
 * importFaq() 应用到知识库（校验/去重/持久化/向量增量更新）。
 *
 * 支持格式：
 *   .xlsx  — 表头行：分类/类别、问题、答案、标签、关键词（标签/关键词用 逗号/顿号/分仓分隔）
 *   .csv   — 同上；自动识别 UTF-8 / GBK 编码（Windows Excel 导出的 CSV 默认 GBK）
 *   .md    — 约定：一/二级标题=分类，三级标题=问题；「关键词:」行=分类关键词，
 *            「标签:」行=条目标签，其余内容为答案
 *   .json  — 标准 faq-data.json 结构（全量或仅 categories 数组）
 *
 * 路线 B（文档 RAG）升级接缝：新增文档格式时，只需在此实现对应的解析器，
 * 输出同样的 ParsedCategory[]（或扩展为「文档块」结构），导入应用逻辑无需改动。
 */

import ExcelJS from 'exceljs';

export interface ParsedItem {
  question: string;
  answer: string;
  tags: string[];
  /** 来源行号（报错定位用） */
  line?: number;
}

export interface ParsedCategory {
  name: string;
  keywords: string[];
  items: ParsedItem[];
}

export class ImportParseError extends Error {}

/** 解析失败的具体行（格式级错误） */
export interface ParseResult {
  categories: ParsedCategory[];
}

// ============ 编码与分隔符工具 ============

/** 解码文本：BOM/UTF-8 优先，失败回退 GBK（Windows Excel 导出场景） */
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

function splitList(value: string | undefined | null): string[] {
  if (!value) return [];
  return String(value)
    .split(/[,，、;；/|]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** 表头列名 → 标准字段（中英文别名均支持，大小写不敏感） */
const COLUMN_ALIASES: Record<string, 'category' | 'question' | 'answer' | 'tags' | 'keywords'> = {};
for (const alias of ['分类', '类别', 'category']) COLUMN_ALIASES[alias] = 'category';
for (const alias of ['问题', 'question']) COLUMN_ALIASES[alias] = 'question';
for (const alias of ['答案', '回复', 'answer']) COLUMN_ALIASES[alias] = 'answer';
for (const alias of ['标签', 'tags']) COLUMN_ALIASES[alias] = 'tags';
for (const alias of ['关键词', 'keywords']) COLUMN_ALIASES[alias] = 'keywords';

function mapHeader(header: string): keyof typeof COLUMN_ALIASES | undefined {
  const key = String(header ?? '').trim().toLowerCase();
  return COLUMN_ALIASES[key];
}

function assertHasColumns(mapped: Record<string, string | undefined>): void {
  if (!mapped.question || !mapped.answer) {
    throw new ImportParseError('缺少必需的列：问题、答案（表头需包含：分类、问题、答案、标签、关键词）');
  }
}

// ============ CSV（RFC 4180，支持引号内逗号/换行） ============

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

function rowsToCategories(rows: string[][]): ParsedCategory[] {
  const header = rows[0] ?? [];
  const mapped: Record<string, string | undefined> = {};
  header.forEach((h, idx) => {
    const field = mapHeader(h);
    if (field) mapped[field] = String(idx);
  });
  assertHasColumns(mapped);

  const categoryIdx = mapped.category !== undefined ? Number(mapped.category) : -1;
  const questionIdx = Number(mapped.question);
  const answerIdx = Number(mapped.answer);
  const tagsIdx = mapped.tags !== undefined ? Number(mapped.tags) : -1;
  const keywordsIdx = mapped.keywords !== undefined ? Number(mapped.keywords) : -1;

  const result: ParsedCategory[] = [];
  // 分类列空白时继承上一行的分类（Excel/CSV 批量表格的常见约定）
  let lastCatName = '';
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawCat = categoryIdx >= 0 ? (row[categoryIdx] || '').trim() : '';
    if (rawCat) lastCatName = rawCat;
    const catName = rawCat || (categoryIdx >= 0 ? lastCatName : '');
    const question = (row[questionIdx] || '').trim();
    const answer = (row[answerIdx] || '').trim();
    if (!question && !answer) continue; // 空行
    const category = ensureCategory(result, catName || '默认分类');
    category.items.push({
      question,
      answer,
      tags: tagsIdx >= 0 ? splitList(row[tagsIdx]) : [],
      line: i + 1,
    });
    if (keywordsIdx >= 0) {
      for (const k of splitList(row[keywordsIdx])) {
        if (!category.keywords.includes(k)) category.keywords.push(k);
      }
    }
  }
  return result;
}

function ensureCategory(list: ParsedCategory[], name: string): ParsedCategory {
  let category = list.find(c => c.name === name);
  if (!category) {
    category = { name, keywords: [], items: [] };
    list.push(category);
  }
  return category;
}

// ============ XLSX ============

async function parseXlsx(buf: Buffer): Promise<ParsedCategory[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf as unknown as ArrayBuffer);
  const rows: string[][] = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // 单元格值转文本；富文本/公式取结果值
        const v = (cell.value as any);
        let text = '';
        if (v === null || v === undefined) text = '';
        else if (typeof v === 'object' && 'result' in v) text = String(v.result ?? '');
        else if (typeof v === 'object' && 'richText' in v) text = v.richText.map((r: any) => r.text).join('');
        else if (v instanceof Date) text = v.toISOString();
        else text = String(v);
        cells[colNumber - 1] = text;
      });
      if (cells.some(c => (c || '').trim())) rows.push(cells);
    });
  }
  if (rows.length === 0) throw new ImportParseError('Excel 文件内容为空');
  return rowsToCategories(rows);
}

// ============ Markdown ============

function parseMarkdown(text: string): ParsedCategory[] {
  const result: ParsedCategory[] = [];
  let current: ParsedCategory | null = null;
  let question: string | null = null;
  let answerLines: string[] = [];
  let tags: string[] = [];
  let lineNo = 0;

  const flushItem = () => {
    if (current && question !== null) {
      const answer = answerLines.join('\n').trim();
      if (question.trim() && answer) {
        current.items.push({ question: question.trim(), answer, tags, line: lineNo });
      }
    }
    question = null;
    answerLines = [];
    tags = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    lineNo++;
    const line = rawLine.trimEnd();
    const h2 = line.match(/^(#{1,2})\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);

    if (h2) {
      flushItem();
      current = ensureCategory(result, h2[2].trim());
    } else if (h3) {
      flushItem();
      if (!current) current = ensureCategory(result, '默认分类');
      question = h3[1].trim();
    } else if (current) {
      const kw = line.match(/^关键词[:：]\s*(.+)$/);
      const tag = line.match(/^标签[:：]\s*(.+)$/);
      if (kw && question === null) {
        // 分类标题下、任何问题开始前的「关键词:」行 → 分类关键词
        for (const k of splitList(kw[1])) {
          if (!current.keywords.includes(k)) current.keywords.push(k);
        }
      } else if (tag && question !== null) {
        // 问题下的「标签:」行 → 当前条目标签（不计入答案）
        tags = splitList(tag[1]);
      } else if (question !== null) {
        answerLines.push(line);
      }
    }
  }
  flushItem();

  for (const c of result) {
    c.items = c.items.filter(i => i.question && i.answer);
  }
  return result.filter(c => c.items.length > 0 || c.keywords.length > 0);
}

// ============ JSON ============

function parseJsonFile(text: string): ParsedCategory[] {
  const data = JSON.parse(text);
  const categories = Array.isArray(data) ? data : data.categories;
  if (!Array.isArray(categories)) {
    throw new ImportParseError('JSON 格式错误：需要 faq-data.json 结构（含 categories 数组）');
  }
  const result: ParsedCategory[] = [];
  for (const c of categories) {
    const category = ensureCategory(result, String(c.name || c.id || '').trim() || '默认分类');
    for (const k of splitList(Array.isArray(c.keywords) ? c.keywords.join(',') : c.keywords)) {
      if (!category.keywords.includes(k)) category.keywords.push(k);
    }
    for (const item of Array.isArray(c.items) ? c.items : []) {
      if (item && String(item.question || '').trim() && String(item.answer || '').trim()) {
        category.items.push({
          question: String(item.question).trim(),
          answer: String(item.answer).trim(),
          tags: Array.isArray(item.tags) ? item.tags.map((t: any) => String(t).trim()).filter(Boolean) : [],
        });
      }
    }
  }
  return result;
}

// ============ 入口：按扩展名分发 ============

export async function parseImportFile(filename: string, buf: Buffer): Promise<ParseResult> {
  const ext = filename.toLowerCase().split('.').pop() || '';
  let categories: ParsedCategory[];
  try {
    switch (ext) {
      case 'csv': {
        const rows = parseCsv(decodeText(buf));
        if (rows.length < 2) throw new ImportParseError('CSV 内容为空或只有表头');
        categories = rowsToCategories(rows);
        break;
      }
      case 'xlsx':
        categories = await parseXlsx(buf);
        break;
      case 'md':
      case 'markdown':
        categories = parseMarkdown(decodeText(buf));
        break;
      case 'json':
        categories = parseJsonFile(decodeText(buf));
        break;
      default:
        throw new ImportParseError(`不支持的文件格式 .${ext}（支持 .xlsx / .csv / .md / .json）`);
    }
  } catch (e) {
    if (e instanceof ImportParseError) throw e;
    throw new ImportParseError(`文件解析失败: ${(e as Error)?.message || e}`);
  }

  if (categories.length === 0) {
    throw new ImportParseError('未从文件中解析出任何知识条目，请检查文件格式');
  }
  const total = categories.reduce((sum, c) => sum + c.items.length, 0);
  if (total === 0) {
    throw new ImportParseError('文件中没有任何有效的问答条目（问题、答案均不能为空）');
  }
  return { categories };
}

/** 生成 CSV 导入模板（带 UTF-8 BOM，Excel 直接打开中文不乱码） */
export function buildCsvTemplate(): Buffer {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [
    ['分类', '问题', '答案', '标签', '关键词'],
    ['退款', '退款多久能到账？', '退款审核通过后 3-7 个工作日原路退回。', '到账时间', '退款,退钱'],
    ['退款', '如何申请退款？', '登录 App 进入「我的订单」，选择订单点击「申请退款」。', '申请,流程', ''],
  ];
  const csv = '\ufeff' + rows.map(r => r.map(esc).join(',')).join('\r\n');
  return Buffer.from(csv, 'utf-8');
}

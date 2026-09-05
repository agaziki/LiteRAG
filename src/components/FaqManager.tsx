import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Button, Tag, Input, Textarea, TagInput, Dialog, Popconfirm,
  Select, Loading, Empty, MessagePlugin, Radio,
} from 'tdesign-react';
import { Plus, RefreshCw, Search, Pencil, Trash2, Database, Sparkles, Upload, Download, FileText, FilePlus2 } from 'lucide-react';

// ============ 类型 ============

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
  semantic?: boolean;
  categories: FaqCategory[];
}

interface SearchTestResult {
  type?: 'faq' | 'doc';
  id: string;
  category: string;
  question?: string;
  answer: string;
  title?: string;
  score: number;
  semanticScore: number;
  tags?: string[];
}

interface SearchTestResponse {
  count: number;
  minScore: number;
  semantic: boolean;
  results: SearchTestResult[];
}

interface KbDoc {
  id: string;
  name: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

// ============ 组件 ============

export function FaqManager() {
  const [data, setData] = useState<FaqData | null>(null);
  const [loading, setLoading] = useState(true);

  // 检索测试
  const [testQuery, setTestQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SearchTestResponse | null>(null);

  // 条目编辑弹窗
  const [itemDialog, setItemDialog] = useState<{ mode: 'add' | 'edit'; categoryId: string; item?: FaqItem } | null>(null);
  const [itemForm, setItemForm] = useState({ question: '', answer: '', tags: [] as string[], categoryId: '' });
  const [saving, setSaving] = useState(false);

  // 分类编辑弹窗
  const [catDialog, setCatDialog] = useState<{ mode: 'add' | 'edit'; category?: FaqCategory } | null>(null);
  const [catForm, setCatForm] = useState({ name: '', keywords: [] as string[] });

  // 文件导入
  const [importDialog, setImportDialog] = useState(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    categoriesAdded: number; categoriesUpdated: number; itemsAdded: number; itemsUpdated: number; total: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 文档知识库（RAG）
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [docsSemantic, setDocsSemantic] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const docInputRef = useRef<HTMLInputElement>(null);

  const fetchFaq = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/faq');
      const json = await res.json();
      setData(json);
    } catch {
      MessagePlugin.error('加载知识库失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFaq(); }, [fetchFaq]);

  // ---- 检索测试 ----
  const runTest = useCallback(async () => {
    if (!testQuery.trim()) {
      MessagePlugin.warning('请输入测试问题');
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(`/api/faq/search?q=${encodeURIComponent(testQuery.trim())}&limit=5`);
      const json = await res.json();
      setTestResult(json);
    } catch {
      MessagePlugin.error('检索测试失败');
    } finally {
      setTesting(false);
    }
  }, [testQuery]);

  // ---- 条目 CRUD ----
  const openAddItem = (categoryId: string) => {
    setItemForm({ question: '', answer: '', tags: [], categoryId });
    setItemDialog({ mode: 'add', categoryId });
  };

  const openEditItem = (categoryId: string, item: FaqItem) => {
    setItemForm({ question: item.question, answer: item.answer, tags: [...item.tags], categoryId });
    setItemDialog({ mode: 'edit', categoryId, item });
  };

  const saveItem = useCallback(async () => {
    if (!itemForm.question.trim() || !itemForm.answer.trim()) {
      MessagePlugin.warning('请填写问题和答案');
      return;
    }
    setSaving(true);
    try {
      const isEdit = itemDialog?.mode === 'edit';
      const url = isEdit ? `/api/faq/items/${itemDialog!.item!.id}` : '/api/faq/items';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: itemForm.categoryId,
          question: itemForm.question,
          answer: itemForm.answer,
          tags: itemForm.tags,
        }),
      });
      const json = await res.json();
      if (json.success) {
        MessagePlugin.success(isEdit ? '条目已更新' : '条目已添加');
        setItemDialog(null);
        fetchFaq();
      } else {
        MessagePlugin.error(json.error || '保存失败');
      }
    } catch {
      MessagePlugin.error('网络错误，保存失败');
    } finally {
      setSaving(false);
    }
  }, [itemDialog, itemForm, fetchFaq]);

  const removeItem = useCallback(async (itemId: string) => {
    try {
      const res = await fetch(`/api/faq/items/${itemId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        MessagePlugin.success('条目已删除');
        fetchFaq();
      } else {
        MessagePlugin.error(json.error || '删除失败');
      }
    } catch {
      MessagePlugin.error('网络错误，删除失败');
    }
  }, [fetchFaq]);

  // ---- 分类 CRUD ----
  const saveCategory = useCallback(async () => {
    if (!catForm.name.trim()) {
      MessagePlugin.warning('请填写分类名称');
      return;
    }
    setSaving(true);
    try {
      const isEdit = catDialog?.mode === 'edit';
      const url = isEdit ? `/api/faq/categories/${catDialog!.category!.id}` : '/api/faq/categories';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: catForm.name, keywords: catForm.keywords }),
      });
      const json = await res.json();
      if (json.success) {
        MessagePlugin.success(isEdit ? '分类已更新' : '分类已添加');
        setCatDialog(null);
        fetchFaq();
      } else {
        MessagePlugin.error(json.error || '保存失败');
      }
    } catch {
      MessagePlugin.error('网络错误，保存失败');
    } finally {
      setSaving(false);
    }
  }, [catDialog, catForm, fetchFaq]);

  const removeCategory = useCallback(async (categoryId: string) => {
    try {
      const res = await fetch(`/api/faq/categories/${categoryId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        MessagePlugin.success('分类已删除');
        fetchFaq();
      } else {
        MessagePlugin.error(json.error || '删除失败');
      }
    } catch {
      MessagePlugin.error('网络错误，删除失败');
    }
  }, [fetchFaq]);

  // ---- 文件导入 ----
  const submitImport = useCallback(async () => {
    if (!importFile) {
      MessagePlugin.warning('请选择要导入的文件');
      return;
    }
    if (importMode === 'replace' && !replaceConfirmed) {
      setReplaceConfirmed(true);
      return;
    }
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', importFile);
      form.append('mode', importMode);
      const res = await fetch('/api/faq/import', { method: 'POST', body: form });
      const json = await res.json();
      if (json.success) {
        setImportSummary(json.summary);
        MessagePlugin.success(`导入完成：新增 ${json.summary.itemsAdded} 条，更新 ${json.summary.itemsUpdated} 条`);
        fetchFaq();
      } else {
        MessagePlugin.error(json.error || '导入失败');
      }
    } catch {
      MessagePlugin.error('网络错误，导入失败');
    } finally {
      setImporting(false);
    }
  }, [importFile, importMode, replaceConfirmed, fetchFaq]);

  const closeImportDialog = () => {
    setImportDialog(false);
    setImportFile(null);
    setImportSummary(null);
    setImportMode('merge');
    setReplaceConfirmed(false);
  };

  const downloadTemplate = () => {
    window.open('/api/faq/import/template', '_blank');
  };

  // ---- 文档知识库（RAG） ----
  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch('/api/faq/docs');
      const json = await res.json();
      setDocs(json.docs || []);
      setDocsSemantic(!!json.semantic);
    } catch {
      // 静默失败，不阻塞 FAQ 管理
    }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const uploadDoc = useCallback(async (file: File) => {
    setDocUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/faq/docs', { method: 'POST', body: form });
      const json = await res.json();
      if (json.success) {
        MessagePlugin.success(`文档「${json.doc.name}」已入库，切分 ${json.doc.chunkCount} 块`);
        fetchDocs();
      } else {
        MessagePlugin.error(json.error || '文档入库失败');
      }
    } catch {
      MessagePlugin.error('网络错误，上传失败');
    } finally {
      setDocUploading(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  }, [fetchDocs]);

  const removeDoc = useCallback(async (docId: string) => {
    try {
      const res = await fetch(`/api/faq/docs/${docId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        MessagePlugin.success('文档已删除');
        fetchDocs();
      } else {
        MessagePlugin.error(json.error || '删除失败');
      }
    } catch {
      MessagePlugin.error('网络错误，删除失败');
    }
  }, [fetchDocs]);

  const itemCount = data?.categories.reduce((sum, c) => sum + c.items.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* 工具栏：检索测试 + 概要信息 */}
      <Card bordered size="small">
        <div className="flex items-center gap-2 flex-wrap">
          <Database size={16} style={{ color: 'var(--td-brand-color)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
            知识库 {data?.categories.length ?? 0} 个分类 / {itemCount} 条条目
          </span>
          {data?.semantic && (
            <Tag color="primary" size="small">
              <Sparkles size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} />
              语义检索已启用
            </Tag>
          )}
          <div className="flex-1 min-w-[240px] flex gap-2 ml-auto">
            <Input
              value={testQuery}
              onChange={(v) => setTestQuery(v as string)}
              placeholder="输入用户问题，测试检索命中（回车执行）"
              size="small"
              clearable
              onEnter={runTest}
            />
            <Button size="small" variant="outline" onClick={runTest} loading={testing}>
              <Search size={13} style={{ marginRight: 4 }} />
              检索测试
            </Button>
            <Button size="small" variant="text" onClick={fetchFaq} loading={loading}>
              <RefreshCw size={13} />
            </Button>
            <Button size="small" variant="outline" onClick={() => setImportDialog(true)}>
              <Upload size={13} style={{ marginRight: 4 }} />
              导入
            </Button>
            <Button size="small" variant="outline" onClick={() => { setCatForm({ name: '', keywords: [] }); setCatDialog({ mode: 'add' }); }}>
              <Plus size={13} style={{ marginRight: 4 }} />
              新增分类
            </Button>
          </div>
        </div>

        {/* 检索测试结果 */}
        {testResult && (
          <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
            <div className="text-xs mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>
              命中 {testResult.count} 条 · 关键词门槛 minScore={testResult.minScore}
              {testResult.semantic ? ' · 语义检索已启用' : ' · 未启用语义检索'}
              {testResult.count === 0 && '（无命中，AI 将提示用户可转人工）'}
            </div>
            {testResult.results.map(r => (
              <div key={r.id} className="py-2 border-b last:border-0" style={{ borderColor: 'var(--td-component-border)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag size="small" color="primary" style={{ color: 'var(--td-brand-color)' }}>score {r.score}</Tag>
                  {r.semanticScore > 0 && <Tag size="small">语义 {r.semanticScore}</Tag>}
                  <Tag size="small" theme={r.type === 'doc' ? 'warning' : 'primary'}>
                    {r.type === 'doc' ? '文档' : 'FAQ'}
                  </Tag>
                  <Tag size="small">{r.type === 'doc' ? `《${r.category}》` : r.category}</Tag>
                  <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                    {r.type === 'doc' ? (r.title || '(正文片段)') : r.question}
                  </span>
                </div>
                <div className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--td-text-color-secondary)' }}>{r.answer}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 文档知识库（路线 B RAG） */}
      <Card
        bordered
        size="small"
        header={
          <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
            <FileText size={14} style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--td-brand-color)' }} />
            文档知识库
            <span className="text-xs ml-2 font-normal" style={{ color: 'var(--td-text-color-placeholder)' }}>
              {docs.length} 篇 · {docs.reduce((s, d) => s + d.chunk_count, 0)} 块
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <input
              ref={docInputRef}
              type="file"
              accept=".txt,.md,.markdown,.docx,.pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); }}
            />
            <Button size="small" variant="outline" loading={docUploading} onClick={() => docInputRef.current?.click()}>
              <FilePlus2 size={13} style={{ marginRight: 4 }} />
              上传文档
            </Button>
          </div>
        }
      >
        {docs.length === 0 ? (
          <div className="text-xs py-2" style={{ color: 'var(--td-text-color-secondary)' }}>
            暂无文档。上传 Word(.docx) / PDF / TXT / Markdown 后自动切块入库，检索时与 FAQ 条目融合排序，AI 回答会注明文档出处。
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map(d => (
              <div key={d.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
                <FileText size={14} style={{ color: 'var(--td-text-color-secondary)', flexShrink: 0 }} />
                <span className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--td-text-color-primary)' }}>{d.name}</span>
                <Tag size="small">{d.chunk_count} 块</Tag>
                <Popconfirm content="确定删除该文档及其所有片段？" onConfirm={() => removeDoc(d.id)}>
                  <Button size="small" variant="text"><Trash2 size={13} /></Button>
                </Popconfirm>
              </div>
            ))}
          </div>
        )}
        {!docsSemantic && (
          <div className="text-xs mt-2" style={{ color: 'var(--td-text-color-placeholder)' }}>
            提示：当前未配置 EMBEDDING_API_KEY，文档按关键词检索；配置后启用语义匹配（详见 .env.example）
          </div>
        )}
      </Card>

      {/* 加载中 */}
      {loading ? (
        <div className="flex justify-center py-16"><Loading size="large" /></div>
      ) : !data || data.categories.length === 0 ? (
        <Card bordered><Empty description="知识库为空，点击「新增分类」开始" /></Card>
      ) : (
        /* 分类卡片 */
        data.categories.map(category => (
          <Card
            key={category.id}
            bordered
            size="small"
            title={
              <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                {category.name}
                <span className="text-xs ml-2 font-normal" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  {category.items.length} 条
                </span>
              </span>
            }
            actions={
              <div className="flex gap-1">
                <Button size="small" variant="text" onClick={() => { setCatForm({ name: category.name, keywords: [...category.keywords] }); setCatDialog({ mode: 'edit', category }); }}>
                  <Pencil size={13} />
                </Button>
                <Popconfirm
                  content={category.items.length > 0 ? `该分类下有 ${category.items.length} 条条目，需先清空才能删除` : '确定删除该分类？'}
                  onConfirm={() => removeCategory(category.id)}
                >
                  <Button size="small" variant="text" disabled={category.items.length > 0}>
                    <Trash2 size={13} />
                  </Button>
                </Popconfirm>
              </div>
            }
          >
            {/* 分类关键词（检索权重最高） */}
            <div className="mb-3 flex items-start gap-2 flex-wrap">
              <span className="text-xs mt-0.5 flex-shrink-0" style={{ color: 'var(--td-text-color-secondary)' }}>触发关键词 (+5/个)：</span>
              {category.keywords.map(k => <Tag key={k} size="small" variant="light">{k}</Tag>)}
              {category.keywords.length === 0 && (
                <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>未设置，建议补充同义词</span>
              )}
            </div>

            {/* 条目列表 */}
            <div className="space-y-2">
              {category.items.map(item => (
                <div
                  key={item.id}
                  className="p-3 rounded-lg flex items-start gap-3"
                  style={{ backgroundColor: 'var(--td-bg-color-page)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                      {item.question}
                    </div>
                    <div className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--td-text-color-secondary)' }}>
                      {item.answer}
                    </div>
                    {item.tags.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {item.tags.map(t => <Tag key={t} size="small" variant="outline">{t}</Tag>)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="small" variant="text" onClick={() => openEditItem(category.id, item)}>
                      <Pencil size={13} />
                    </Button>
                    <Popconfirm content="确定删除该条目？" onConfirm={() => removeItem(item.id)}>
                      <Button size="small" variant="text">
                        <Trash2 size={13} />
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
              ))}
            </div>

            <Button size="small" variant="dashed" block className="mt-3" onClick={() => openAddItem(category.id)}>
              <Plus size={13} style={{ marginRight: 4 }} />
              新增条目
            </Button>
          </Card>
        ))
      )}

      {/* 条目编辑弹窗 */}
      <Dialog
        visible={!!itemDialog}
        onClose={() => setItemDialog(null)}
        header={itemDialog?.mode === 'edit' ? '编辑条目' : '新增条目'}
        width={560}
        confirmBtn={{
          content: '保存',
          theme: 'primary',
          loading: saving,
          onClick: saveItem,
        }}
        cancelBtn={{ content: '取消', onClick: () => setItemDialog(null) }}
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>所属分类</label>
            <Select
              value={itemForm.categoryId}
              onChange={(v) => setItemForm(prev => ({ ...prev, categoryId: v as string }))}
              options={(data?.categories || []).map(c => ({ value: c.id, label: c.name }))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
              问题（尽量用用户的提问方式，问法越接近越容易命中）
            </label>
            <Input
              value={itemForm.question}
              onChange={(v) => setItemForm(prev => ({ ...prev, question: v as string }))}
              placeholder="例如：退款多久能到账？"
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>答案</label>
            <Textarea
              value={itemForm.answer}
              onChange={(v) => setItemForm(prev => ({ ...prev, answer: typeof v === 'string' ? v : String(v) }))}
              placeholder="标准答案，AI 会基于此组织回复"
              autosize={{ minRows: 4, maxRows: 10 }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>标签（+2/个命中，放标准概念词）</label>
            <TagInput
              value={itemForm.tags}
              onChange={(v) => setItemForm(prev => ({ ...prev, tags: v as string[] }))}
              placeholder="输入后回车添加，例如：到账时间"
              clearable
            />
          </div>
        </div>
      </Dialog>

      {/* 分类编辑弹窗 */}
      <Dialog
        visible={!!catDialog}
        onClose={() => setCatDialog(null)}
        header={catDialog?.mode === 'edit' ? '编辑分类' : '新增分类'}
        width={480}
        confirmBtn={{
          content: '保存',
          theme: 'primary',
          loading: saving,
          onClick: saveCategory,
        }}
        cancelBtn={{ content: '取消', onClick: () => setCatDialog(null) }}
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>分类名称</label>
            <Input
              value={catForm.name}
              onChange={(v) => setCatForm(prev => ({ ...prev, name: v as string }))}
              placeholder="例如：退款、物流"
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
              触发关键词（命中 +5 分/个，建议放同义词、口语说法、常见错别字）
            </label>
            <TagInput
              value={catForm.keywords}
              onChange={(v) => setCatForm(prev => ({ ...prev, keywords: v as string[] }))}
              placeholder="输入后回车添加"
              clearable
            />
          </div>
        </div>
      </Dialog>

      {/* 文件导入弹窗 */}
      <Dialog
        visible={importDialog}
        onClose={closeImportDialog}
        header="从文件导入知识库"
        width={520}
        confirmBtn={{
          content: importMode === 'replace' && replaceConfirmed ? '确认覆盖导入' : '开始导入',
          theme: importMode === 'replace' && replaceConfirmed ? 'danger' : 'primary',
          loading: importing,
          onClick: submitImport,
        }}
        cancelBtn={{ content: '取消', onClick: closeImportDialog }}
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
              选择文件（.xlsx / .csv / .md / .json，10MB 以内）
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv,.md,.markdown,.json"
              onChange={(e) => { setImportFile(e.target.files?.[0] || null); setImportSummary(null); setReplaceConfirmed(false); }}
              className="block w-full text-sm"
              style={{ color: 'var(--td-text-color-secondary)' }}
            />
            <Button size="small" variant="text" theme="primary" onClick={downloadTemplate}>
              <Download size={13} style={{ marginRight: 4 }} />
              下载 CSV 模板
            </Button>
          </div>

          <div>
            <label className="text-xs block mb-2" style={{ color: 'var(--td-text-color-placeholder)' }}>导入方式</label>
            <Radio.Group value={importMode} onChange={(v) => { setImportMode(v as 'merge' | 'replace'); setReplaceConfirmed(false); setImportSummary(null); }}>
              <Radio value="merge">合并导入</Radio>
              <Radio value="replace">覆盖导入</Radio>
            </Radio.Group>
            <div className="text-xs mt-2" style={{ color: 'var(--td-text-color-secondary)' }}>
              {importMode === 'merge'
                ? '与现有知识库合并：同名分类合并关键词，同分类下问题相同则更新答案，其余新增。可重复导入（幂等）。'
                : '清空现有全部分类和条目后整体导入（检索门槛配置保留），请先确认！'}
            </div>
            {importMode === 'replace' && replaceConfirmed && !importSummary && (
              <div className="text-xs mt-1 font-medium" style={{ color: 'var(--td-error-color)' }}>
                再次点击「确认覆盖导入」将清空现有知识库，此操作不可恢复！
              </div>
            )}
          </div>

          {importSummary && importSummary.total >= 0 && (
            <div className="p-3 rounded-lg text-sm space-y-1" style={{ backgroundColor: 'var(--td-bg-color-page)', color: 'var(--td-text-color-primary)' }}>
              <div className="font-medium">导入结果</div>
              <div>共解析 {importSummary.total} 条 · 分类新增 {importSummary.categoriesAdded} 个 / 匹配 {importSummary.categoriesUpdated} 个</div>
              <div>条目新增 {importSummary.itemsAdded} 条 · 更新 {importSummary.itemsUpdated} 条</div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}

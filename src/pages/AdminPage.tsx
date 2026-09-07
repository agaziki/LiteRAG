import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Drawer, Button, Space, Loading, Empty,
  Tooltip, MessagePlugin, Select, Input, Textarea, Popconfirm,
} from 'tdesign-react';
import {
  MessageSquare, Headphones, Star, TrendingUp, Users,
  RefreshCw, ArrowLeft, User, Bot as BotIcon, AlertCircle, KeyRound, LogOut, Zap,
} from 'lucide-react';
import { ChatMarkdown } from '@tdesign-react/chat';
import { FaqManager } from '../components/FaqManager';
import { SettingsPage } from '../components/SettingsPage';
import { CustomAgent } from '../types';

interface AdminPageProps {
  agents: CustomAgent[];
  onAdd: (agent: Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>) => CustomAgent;
  onUpdate: (id: string, updates: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>) => void;
  onDelete: (id: string) => void;
}
import { adminFetch, getAdminToken, setAdminToken, clearAdminToken, handleAuthExpired } from '../utils/adminAuth';

// ============ 类型定义 ============
interface AdminStats {
  overview: {
    totalSessions: number;
    totalMessages: number;
    escalatedSessions: number;
    escalationRate: number;
    totalEscalations: number;
    resolvedEscalations: number;
    ratedSessions: number;
    ratingAverage: number;
    recentRatingAverage: number;
    totalRatings: number;
    totalTokens: number;
    estimatedCost: number;
    price?: {
      input_per_1m: number;
      output_per_1m: number;
    };
  };
  ratingDistribution: { rating: number; count: number }[];
  intentDistribution: { intent: string; count: number }[];
  sessions: SessionWithStats[];
}

interface SessionWithStats {
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

interface SessionDetail {
  session: {
    id: string;
    title: string;
    model: string;
    created_at: string;
    updated_at: string;
  };
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    model: string | null;
    created_at: string;
    tool_calls: any;
    images?: string[] | null;
  }>;
  ratings: Array<{
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
  }>;
  escalations: Array<{
    id: string;
    reason: string;
    intent: string | null;
    status: 'pending' | 'accepted' | 'resolved';
    created_at: string;
    contact?: string | null;
    note?: string | null;
  }>;
  intents: Array<{
    id: string;
    intent: string;
    confidence: string | null;
    created_at: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const INTENT_LABELS: Record<string, string> = {
  refund: '退款', order: '查询订单', tech: '技术支持', general: '通用咨询', other: '其他',
};

const INTENT_COLORS: Record<string, string> = {
  refund: '#e37318', order: '#0052d9', tech: '#7b61ff', general: '#2ba471', other: '#909399',
};

// ============ 知识缺口 ============
interface DashboardData {
  latency: { avg: number; p50: number; p95: number; count: number };
  knowledge: { faq_hits: number; doc_hits: number; miss: number; hit_rate: number };
  dailyActive: Array<{ date: string; sessions: number }>;
}

interface KnowledgeGap {
  id: string;
  title: string;
  updated_at: string;
  other_intents: number;
  low_ratings: number;
  low_rating_detail: string | null;
  escalations: number;
  escalation_reasons: string | null;
}

const ESCALATION_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: '排队中', color: '#e37318' },
  accepted: { label: '已接入', color: '#0052d9' },
  resolved: { label: '已解决', color: '#2ba471' },
};

export function AdminPage({ agents, onAdd, onUpdate, onDelete }: AdminPageProps) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [intentFilter, setIntentFilter] = useState<string>('');
  // 顶部标签：对话分析 / 知识缺口 / 知识库管理 / 数据管理 / 系统设置
  const [tab, setTab] = useState<'analytics' | 'gaps' | 'faq' | 'data' | 'settings'>('analytics');
  // 知识缺口 → 知识库管理 的预填问题
  const [prefillQuestion, setPrefillQuestion] = useState('');
  // 数据管理
  const [dataStats, setDataStats] = useState<Record<string, number> | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [clearDays, setClearDays] = useState('30');

  // 管理员登录（密码通过 .env 的 ADMIN_PASSWORD 配置）
  const [authed, setAuthed] = useState<boolean>(() => !!getAdminToken());
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const handleLogin = useCallback(async () => {
    if (!password.trim()) { setAuthError('请输入密码'); return; }
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setAdminToken(data.token);
        setAuthed(true);
        setPassword('');
      } else {
        setAuthError(data.error || '登录失败');
      }
    } catch {
      setAuthError('网络错误，请重试');
    } finally {
      setAuthLoading(false);
    }
  }, [password]);

  const handleLogout = useCallback(() => {
    clearAdminToken();
    setAuthed(false);
    setStats(null);
    setDetail(null);
    setDrawerOpen(false);
  }, []);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/stats');
      if (handleAuthExpired(res)) { setAuthed(false); return; }
      const data = await res.json();
      setStats(data);
    } catch (e) {
      MessagePlugin.error('加载统计失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (authed) fetchStats(); }, [authed, fetchStats]);

  const openDetail = useCallback(async (sessionId: string) => {
    setDrawerOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await adminFetch(`/api/admin/sessions/${sessionId}`);
      if (handleAuthExpired(res)) { setAuthed(false); return; }
      const data = await res.json();
      setDetail(data);
    } catch (e) {
      MessagePlugin.error('加载会话详情失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const updateEscalationStatus = useCallback(async (escalationId: string, status: 'pending' | 'accepted' | 'resolved') => {
    try {
      const res = await adminFetch(`/api/admin/escalations/${escalationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (handleAuthExpired(res)) { setAuthed(false); return; }
      MessagePlugin.success('状态已更新');
      if (detail) openDetail(detail.session.id);
      fetchStats();
    } catch (e) {
      MessagePlugin.error('更新失败');
    }
  }, [detail, openDetail, fetchStats]);

  // 人工回复
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);

  const sendReply = useCallback(async () => {
    if (!detail || !replyText.trim()) {
      MessagePlugin.warning('请输入回复内容');
      return;
    }
    setReplySending(true);
    try {
      const res = await adminFetch(`/api/admin/sessions/${detail.session.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyText.trim() }),
      });
      if (handleAuthExpired(res)) { setAuthed(false); return; }
      const data = await res.json();
      if (data.success) {
        MessagePlugin.success('人工回复已发送至用户对话');
        setReplyText('');
        openDetail(detail.session.id);
      } else {
        MessagePlugin.error(data.error || '回复失败');
      }
    } catch {
      MessagePlugin.error('网络错误，回复失败');
    } finally {
      setReplySending(false);
    }
  }, [detail, replyText, openDetail]);

  // 看板增强数据
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  // 知识缺口清单
  const [gaps, setGaps] = useState<KnowledgeGap[] | null>(null);
  const [gapsLoading, setGapsLoading] = useState(false);

  const fetchGaps = useCallback(async () => {
    setGapsLoading(true);
    try {
      const res = await adminFetch('/api/admin/knowledge-gaps');
      if (handleAuthExpired(res)) { setAuthed(false); return; }
      const data = await res.json();
      setGaps(data.gaps || []);
    } catch {
      MessagePlugin.error('加载知识缺口失败');
    } finally {
      setGapsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed && tab === 'gaps' && gaps === null) fetchGaps();
  }, [authed, tab, gaps, fetchGaps]);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/dashboard');
      if (handleAuthExpired(res)) { setAuthed(false); return; }
      setDashboard(await res.json());
    } catch { /* 静默 */ }
  }, []);

  useEffect(() => {
    if (authed && tab === 'analytics' && !dashboard) fetchDashboard();
  }, [authed, tab, dashboard, fetchDashboard]);

  // ---- 数据管理 ----
  const fetchDataStats = useCallback(async () => {
    setDataLoading(true);
    try {
      const res = await adminFetch('/api/admin/data-stats');
      if (handleAuthExpired(res)) { setAuthed(false); return; }
      setDataStats(await res.json());
    } catch {
      MessagePlugin.error('加载数据统计失败');
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed && tab === 'data' && !dataStats) fetchDataStats();
  }, [authed, tab, dataStats, fetchDataStats]);

  const clearSessionsAction = useCallback(async (days?: number) => {
    setDataLoading(true);
    try {
      const res = await adminFetch('/api/admin/sessions/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
      if (handleAuthExpired(res)) { setAuthed(false); return; }
      const data = await res.json();
      if (data.success) {
        MessagePlugin.success(`已清理 ${data.cleared} 个会话（关联消息/评价/转人工/用量一并删除）`);
        setStats(null);       // 分析数据已变化
        fetchDataStats();
      } else {
        MessagePlugin.error(data.error || '清理失败');
      }
    } catch {
      MessagePlugin.error('网络错误');
    } finally {
      setDataLoading(false);
    }
  }, [fetchDataStats]);

  const resetFaqAction = useCallback(async (mode: 'factory' | 'clear') => {
    setDataLoading(true);
    try {
      const res = await adminFetch('/api/admin/faq/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (handleAuthExpired(res)) { setAuthed(false); return; }
      const data = await res.json();
      if (data.success) {
        MessagePlugin.success(mode === 'factory' ? `知识库已恢复出厂（${data.categories} 分类 / ${data.items} 条目）` : '知识库已清空');
        fetchDataStats();
      } else {
        MessagePlugin.error(data.error || '重置失败');
      }
    } catch {
      MessagePlugin.error('网络错误');
    } finally {
      setDataLoading(false);
    }
  }, [fetchDataStats]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const renderStars = (rating: number | null) => {
    if (rating === null) return <span style={{ color: 'var(--td-text-color-placeholder)' }}>-</span>;
    return (
      <span style={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
        {[1, 2, 3, 4, 5].map(s => (
          <Star key={s} size={12} fill={s <= rating ? '#f5a623' : 'none'} color={s <= rating ? '#f5a623' : 'var(--td-text-color-placeholder)'} />
        ))}
      </span>
    );
  };

  const maxRatingCount = stats ? Math.max(...stats.ratingDistribution.map(d => d.count), 1) : 1;
  const maxIntentCount = stats ? Math.max(...stats.intentDistribution.map(d => d.count), 1) : 1;

  const filteredSessions = stats?.sessions.filter(s =>
    !intentFilter || s.last_intent === intentFilter
  ) || [];

  const columns = [
    {
      colKey: 'title',
      title: '会话标题',
      width: 220,
      ellipsis: true,
      render: ({ row }: any) => (
        <a
          onClick={() => openDetail(row.id)}
          style={{ color: 'var(--td-brand-color)', cursor: 'pointer' }}
        >
          {row.title}
        </a>
      ),
    },
    { colKey: 'message_count', title: '消息数', width: 80, align: 'center' as const },
    {
      colKey: 'last_intent',
      title: '意图',
      width: 110,
      render: ({ row }: any) => row.last_intent ? (
        <Tag color="default" style={{ color: INTENT_COLORS[row.last_intent] || '#909399' }}>
          {INTENT_LABELS[row.last_intent] || row.last_intent}
        </Tag>
      ) : <span style={{ color: 'var(--td-text-color-placeholder)' }}>-</span>,
    },
    {
      colKey: 'rating',
      title: '满意度',
      width: 110,
      align: 'center' as const,
      render: ({ row }: any) => renderStars(row.rating),
    },
    {
      colKey: 'escalated',
      title: '转人工',
      width: 110,
      align: 'center' as const,
      render: ({ row }: any) => row.escalated > 0 ? (
        <Tooltip content={row.escalation_status || '未知'}>
          <Tag color="warning" style={{ color: ESCALATION_STATUS_CONFIG[row.escalation_status]?.color || '#e37318' }}>
            <Headphones size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            {ESCALATION_STATUS_CONFIG[row.escalation_status]?.label || '已转人工'}
          </Tag>
        </Tooltip>
      ) : <span style={{ color: 'var(--td-text-color-placeholder)' }}>-</span>,
    },
    {
      colKey: 'created_at',
      title: '创建时间',
      width: 110,
      render: ({ row }: any) => <span style={{ fontSize: 12, color: 'var(--td-text-color-secondary)' }}>{formatTime(row.created_at)}</span>,
    },
  ];

  // 未登录：密码门
  if (!authed) {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <Card bordered style={{ width: 380 }}>
          <div className="text-center mb-5">
            <div
              className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-3"
              style={{ backgroundColor: 'var(--td-brand-color-light)' }}
            >
              <KeyRound size={24} style={{ color: 'var(--td-brand-color)' }} />
            </div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
              管理后台
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              请输入管理员密码（服务端 .env 的 ADMIN_PASSWORD）
            </p>
          </div>
          <Input
            type="password"
            value={password}
            onChange={(v) => setPassword(String(v))}
            placeholder="管理员密码"
            clearable
            onEnter={handleLogin}
          />
          {authError && (
            <div className="text-xs mt-2" style={{ color: 'var(--td-error-color)' }}>
              {authError}
            </div>
          )}
          <Button theme="primary" block className="mt-4" loading={authLoading} onClick={handleLogin}>
            登录
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-7xl mx-auto">
        {/* 顶部操作栏 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="text" shape="circle" onClick={() => window.history.back()}>
              <ArrowLeft size={18} />
            </Button>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
              管理后台
            </h1>
            <div className="flex gap-1 ml-3">
              <Button
                size="small"
                theme="primary"
                variant={tab === 'analytics' ? 'base' : 'outline'}
                onClick={() => setTab('analytics')}
              >
                对话分析
              </Button>
              <Button
                size="small"
                theme="primary"
                variant={tab === 'gaps' ? 'base' : 'outline'}
                onClick={() => setTab('gaps')}
              >
                知识缺口
              </Button>
              <Button
                size="small"
                theme="primary"
                variant={tab === 'faq' ? 'base' : 'outline'}
                onClick={() => setTab('faq')}
              >
                知识库管理
              </Button>
              <Button
                size="small"
                theme="primary"
                variant={tab === 'data' ? 'base' : 'outline'}
                onClick={() => setTab('data')}
              >
                数据管理
              </Button>
              <Button
                size="small"
                theme="primary"
                variant={tab === 'settings' ? 'base' : 'outline'}
                onClick={() => setTab('settings')}
              >
                系统设置
              </Button>
            </div>
          </div>
          {tab === 'analytics' && (
            <Button variant="outline" onClick={fetchStats} loading={loading}>
              <RefreshCw size={14} style={{ marginRight: 6 }} />
              刷新
            </Button>
          )}
          <Tooltip content="退出登录">
            <Button variant="text" shape="circle" onClick={handleLogout}>
              <LogOut size={16} />
            </Button>
          </Tooltip>
        </div>

        {tab === 'gaps' ? (
          <div className="space-y-4">
            <Card bordered size="small">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
                  知识库盲区清单：命中「其他意图 / 低星评价（≤3 星）/ 转人工」任一信号的会话，建议针对这些问题补充 FAQ 条目
                </div>
                <Button size="small" variant="outline" onClick={fetchGaps} loading={gapsLoading}>
                  <RefreshCw size={13} style={{ marginRight: 4 }} />
                  刷新
                </Button>
              </div>
            </Card>
            {gapsLoading ? (
              <div className="flex justify-center py-16"><Loading size="large" /></div>
            ) : !gaps || gaps.length === 0 ? (
              <Card bordered><Empty description="暂无知识缺口——没有命中信号的会话" /></Card>
            ) : (
              gaps.map(g => (
                <Card key={g.id} bordered size="small">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm" style={{ color: 'var(--td-text-color-primary)' }}>{g.title}</span>
                        {g.other_intents > 0 && <Tag size="small" color="warning" style={{ color: '#e37318' }}>其他意图 ×{g.other_intents}</Tag>}
                        {g.low_ratings > 0 && <Tag size="small" color="danger" style={{ color: 'var(--td-error-color)' }}>低星评价 ×{g.low_ratings}</Tag>}
                        {g.escalations > 0 && <Tag size="small" color="primary" style={{ color: 'var(--td-brand-color)' }}>转人工 ×{g.escalations}</Tag>}
                      </div>
                      {g.low_rating_detail && (
                        <div className="text-xs mt-1.5" style={{ color: 'var(--td-text-color-secondary)' }}>评价：{g.low_rating_detail}</div>
                      )}
                      {g.escalation_reasons && (
                        <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>转人工：{g.escalation_reasons}</div>
                      )}
                    </div>
                    <Button
                      size="small"
                      variant="outline"
                      onClick={() => { setPrefillQuestion(g.title); setTab('faq'); }}
                    >
                      去补充 FAQ
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        ) : tab === 'data' ? (
          <div className="space-y-4">
            {/* 数据规模 */}
            <Card bordered size="small" title={<span className="font-medium">数据规模</span>}>
              {dataStats ? (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    ['会话', dataStats.sessions],
                    ['消息', dataStats.messages],
                    ['评价', dataStats.ratings],
                    ['转人工', dataStats.escalations],
                    ['意图记录', dataStats.session_intents],
                    ['用量记录', dataStats.token_usage],
                    ['FAQ 分类', dataStats.faq_categories],
                    ['FAQ 条目', dataStats.faq_items],
                    ['文档', dataStats.docs],
                    ['文档块', dataStats.chunks],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="p-3 rounded-lg text-center" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
                      <div className="text-xl font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>{Number(value).toLocaleString()}</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>{label}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <Loading size="small" />
              )}
            </Card>

            {/* 会话清理 */}
            <Card bordered size="small" title={<span className="font-medium" style={{ color: 'var(--td-error-color)' }}>会话清理（删除会话及其全部消息/评价/转人工/用量记录）</span>}>
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={clearDays}
                  onChange={(v) => setClearDays(String(v))}
                  placeholder="清理 N 天前的会话"
                  size="small"
                  style={{ width: 160 }}
                  type="number"
                />
                <Popconfirm content={`确定删除 ${clearDays || 'N'} 天前的全部会话？不可恢复！`} onConfirm={() => clearSessionsAction(Number(clearDays) || undefined)}>
                  <Button size="small" variant="outline" theme="warning" loading={dataLoading}>按天数清理</Button>
                </Popconfirm>
                <Popconfirm content="确定清空全部会话？不可恢复！" onConfirm={() => clearSessionsAction(undefined)}>
                  <Button size="small" variant="outline" theme="danger" loading={dataLoading}>清空全部会话</Button>
                </Popconfirm>
                <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>天数留空或 ≤0 视为清空全部</span>
              </div>
            </Card>

            {/* 知识库重置 */}
            <Card bordered size="small" title={<span className="font-medium" style={{ color: 'var(--td-error-color)' }}>知识库重置（影响全部 FAQ 条目与分类）</span>}>
              <div className="flex items-center gap-2 flex-wrap">
                <Popconfirm content="确定恢复出厂知识库？当前全部分类与条目将被内置快照覆盖，不可恢复！" onConfirm={() => resetFaqAction('factory')}>
                  <Button size="small" variant="outline" theme="warning">恢复出厂知识库</Button>
                </Popconfirm>
                <Popconfirm content="确定清空知识库？全部分类与条目将被删除，不可恢复！" onConfirm={() => resetFaqAction('clear')}>
                  <Button size="small" variant="outline" theme="danger">清空知识库</Button>
                </Popconfirm>
                <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  出厂快照 = 仓库内置 faq-data.default.json；清空仅保留骨架（检索门槛配置不变）
                </span>
              </div>
            </Card>
          </div>
        ) : tab === 'settings' ? (
          <SettingsPage agents={agents} onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} />
        ) : tab === 'faq' ? (
          <FaqManager
            prefillQuestion={prefillQuestion}
            onPrefillConsumed={() => setPrefillQuestion('')}
          />
        ) : loading ? (
          <div className="flex justify-center py-20"><Loading size="large" /></div>
        ) : stats ? (
          <>
            {/* 概览卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
              <StatCard
                icon={<Users size={20} />}
                color="#0052d9"
                label="总会话数"
                value={stats.overview.totalSessions}
                sub={`共 ${stats.overview.totalMessages} 条消息`}
              />
              <StatCard
                icon={<Star size={20} />}
                color="#f5a623"
                label="平均满意度"
                value={stats.overview.ratingAverage > 0 ? `${stats.overview.ratingAverage} / 5` : '暂无'}
                sub={`近7天平均 ${stats.overview.recentRatingAverage > 0 ? stats.overview.recentRatingAverage : '-'}`}
              />
              <StatCard
                icon={<Headphones size={20} />}
                color="#e37318"
                label="转人工率"
                value={`${stats.overview.escalationRate}%`}
                sub={`${stats.overview.escalatedSessions} 个会话转人工`}
              />
              <StatCard
                icon={<TrendingUp size={20} />}
                color="#2ba471"
                label="转人工解决率"
                value={stats.overview.totalEscalations > 0 ? `${Math.round((stats.overview.resolvedEscalations / stats.overview.totalEscalations) * 100)}%` : '-'}
                sub={`${stats.overview.resolvedEscalations} / ${stats.overview.totalEscalations} 已解决`}
              />
              <StatCard
                icon={<Zap size={20} />}
                color="#7b61ff"
                label="Token 消耗"
                value={stats.overview.totalTokens > 0 ? stats.overview.totalTokens.toLocaleString() : '0'}
                sub={`输入 + 输出 tokens`}
              />
              <StatCard
                icon={<TrendingUp size={20} />}
                color="#0594fa"
                label="估算成本"
                value={stats.overview.estimatedCost > 0 ? `¥${stats.overview.estimatedCost}` : '¥0.00'}
                sub={`输入 ¥${stats.overview.price?.input_per_1m ?? 0}/百万 · 输出 ¥${stats.overview.price?.output_per_1m ?? 0}/百万`}
              />
            </div>

            {/* 服务质量看板 */}
            {dashboard && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                <Card title="响应时延（最近 500 条回复）" bordered>
                  <div className="grid grid-cols-4 gap-3 py-2 text-center">
                    {[['平均', dashboard.latency.avg], ['P50', dashboard.latency.p50], ['P95', dashboard.latency.p95], ['样本', dashboard.latency.count]].map(([label, val]) => (
                      <div key={String(label)}>
                        <div className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
                          {label === '样本' ? Number(val).toLocaleString() : `${(Number(val) / 1000).toFixed(1)}s`}
                        </div>
                        <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </Card>
                <Card title="知识命中（最近 500 轮检索）" bordered>
                  <div className="grid grid-cols-4 gap-3 py-2 text-center">
                    <div>
                      <div className="text-lg font-semibold" style={{ color: 'var(--td-success-color)' }}>{dashboard.knowledge.hit_rate}%</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>命中率</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold" style={{ color: 'var(--td-brand-color)' }}>{dashboard.knowledge.faq_hits}</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>FAQ 命中</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold" style={{ color: '#7b61ff' }}>{dashboard.knowledge.doc_hits}</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>文档命中</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold" style={{ color: 'var(--td-error-color)' }}>{dashboard.knowledge.miss}</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>未命中</div>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* 分布图 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* 满意度分布 */}
              <Card title="满意度分布" bordered>
                {stats.overview.totalRatings === 0 ? (
                  <Empty description="暂无评价数据" />
                ) : (
                  <div className="space-y-3 py-2">
                    {stats.ratingDistribution.map(d => (
                      <div key={d.rating} className="flex items-center gap-3">
                        <div className="flex items-center gap-1 w-20">
                          <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>{d.rating} 星</span>
                        </div>
                        <div className="flex-1 h-6 rounded" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
                          <div
                            className="h-full rounded flex items-center justify-end pr-2 transition-all"
                            style={{
                              width: `${(d.count / maxRatingCount) * 100}%`,
                              backgroundColor: d.rating >= 4 ? '#2ba471' : d.rating >= 3 ? '#f5a623' : '#e37318',
                              minWidth: d.count > 0 ? '28px' : '0',
                            }}
                          >
                            {d.count > 0 && <span className="text-xs text-white font-medium">{d.count}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* 意图分布 */}
              <Card title="用户意图分布" bordered>
                {stats.intentDistribution.length === 0 ? (
                  <Empty description="暂无意图数据" />
                ) : (
                  <div className="space-y-3 py-2">
                    {stats.intentDistribution.map(d => (
                      <div key={d.intent} className="flex items-center gap-3">
                        <div className="w-20">
                          <Tag color="default" style={{ color: INTENT_COLORS[d.intent] || '#909399' }}>
                            {INTENT_LABELS[d.intent] || d.intent}
                          </Tag>
                        </div>
                        <div className="flex-1 h-6 rounded" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
                          <div
                            className="h-full rounded flex items-center justify-end pr-2 transition-all"
                            style={{
                              width: `${(d.count / maxIntentCount) * 100}%`,
                              backgroundColor: INTENT_COLORS[d.intent] || '#909399',
                              minWidth: d.count > 0 ? '28px' : '0',
                            }}
                          >
                            {d.count > 0 && <span className="text-xs text-white font-medium">{d.count}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* 会话记录表格 */}
            <Card
              title={
                <Space>
                  <MessageSquare size={16} />
                  <span>对话记录</span>
                  <Select
                    size="small"
                    value={intentFilter}
                    onChange={(v) => setIntentFilter(v as string)}
                    placeholder="按意图筛选"
                    clearable
                    options={Object.entries(INTENT_LABELS).map(([value, label]) => ({ value, label }))}
                    style={{ width: 140 }}
                  />
                </Space>
              }
              bordered
            >
              <Table
                data={filteredSessions}
                columns={columns}
                rowKey="id"
                size="medium"
                pagination={{ pageSize: 10, showJumper: true }}
                empty={<Empty description="暂无对话记录" />}
              />
            </Card>
          </>
        ) : (
          <Empty description="加载失败" />
        )}
      </div>

      {/* 会话详情抽屉 */}
      <Drawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="large"
        header={<span className="font-medium">{detail?.session.title || '会话详情'}</span>}
        footer={null}
      >
        {detailLoading ? (
          <div className="flex justify-center py-20"><Loading size="large" /></div>
        ) : detail ? (
          <div className="space-y-4">
            {/* 会话元信息 */}
            <div
              className="p-3 rounded-lg grid grid-cols-2 gap-2 text-sm"
              style={{ backgroundColor: 'var(--td-bg-color-page)' }}
            >
              <div>
                <span style={{ color: 'var(--td-text-color-secondary)' }}>模型：</span>
                <span style={{ color: 'var(--td-text-color-primary)' }}>{detail.session.model}</span>
              </div>
              <div>
                <span style={{ color: 'var(--td-text-color-secondary)' }}>消息数：</span>
                <span style={{ color: 'var(--td-text-color-primary)' }}>{detail.messages.length}</span>
              </div>
              <div>
                <span style={{ color: 'var(--td-text-color-secondary)' }}>创建：</span>
                <span style={{ color: 'var(--td-text-color-primary)' }}>{formatTime(detail.session.created_at)}</span>
              </div>
              <div>
                <span style={{ color: 'var(--td-text-color-secondary)' }}>最后更新：</span>
                <span style={{ color: 'var(--td-text-color-primary)' }}>{formatTime(detail.session.updated_at)}</span>
              </div>
              {detail.usage && (
                <div>
                  <span style={{ color: 'var(--td-text-color-secondary)' }}>Token 消耗：</span>
                  <span style={{ color: 'var(--td-text-color-primary)' }}>
                    {detail.usage.total_tokens.toLocaleString()}（输入 {detail.usage.prompt_tokens.toLocaleString()} / 输出 {detail.usage.completion_tokens.toLocaleString()}）
                  </span>
                </div>
              )}
            </div>

            {/* 转人工记录 */}
            {detail.escalations.length > 0 && (
              <Card title={`转人工记录 (${detail.escalations.length})`} bordered size="small">
                {detail.escalations.map(e => (
                  <div key={e.id} className="py-2 border-b last:border-0" style={{ borderColor: 'var(--td-component-border)' }}>
                    <div className="flex items-start gap-3">
                      <Tag color="warning" style={{ color: ESCALATION_STATUS_CONFIG[e.status]?.color }}>
                        {ESCALATION_STATUS_CONFIG[e.status]?.label || e.status}
                      </Tag>
                      <div className="flex-1">
                        <div className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>{e.reason}</div>
                        {e.intent && (
                          <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
                            意图：{INTENT_LABELS[e.intent] || e.intent} · {formatTime(e.created_at)}
                          </div>
                        )}
                        {e.contact && (
                          <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
                            用户留言：{e.contact}{e.note ? ` · ${e.note}` : ''}
                          </div>
                        )}
                      </div>
                      {e.status !== 'resolved' && (
                        <Space>
                          {e.status === 'pending' && (
                            <Button size="small" onClick={() => updateEscalationStatus(e.id, 'accepted')}>接入</Button>
                          )}
                          <Button size="small" theme="success" onClick={() => updateEscalationStatus(e.id, 'resolved')}>标记解决</Button>
                        </Space>
                      )}
                    </div>
                  </div>
                ))}
                {/* 人工回复：写入用户对话，pending 工单自动置为已接入 */}
                {detail.escalations.some(e => e.status !== 'resolved') && (
                  <div className="pt-3 space-y-2">
                    <Textarea
                      value={replyText}
                      onChange={(v) => setReplyText(typeof v === 'string' ? v : String(v))}
                      placeholder="以人工客服身份回复用户（发送后显示在用户对话中，排队中的工单自动置为已接入）"
                      autosize={{ minRows: 2, maxRows: 5 }}
                    />
                    <div className="flex justify-end">
                      <Button size="small" theme="primary" loading={replySending} onClick={sendReply}>
                        发送人工回复
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* 满意度评价 */}
            {detail.ratings.length > 0 && (
              <Card title={`满意度评价 (${detail.ratings.length})`} bordered size="small">
                {detail.ratings.map(r => (
                  <div key={r.id} className="py-2 border-b last:border-0" style={{ borderColor: 'var(--td-component-border)' }}>
                    <div className="flex items-center gap-2">
                      {renderStars(r.rating)}
                      <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>{formatTime(r.created_at)}</span>
                    </div>
                    {r.comment && (
                      <div className="text-sm mt-1" style={{ color: 'var(--td-text-color-primary)' }}>"{r.comment}"</div>
                    )}
                  </div>
                ))}
              </Card>
            )}

            {/* 意图识别历史 */}
            {detail.intents.length > 0 && (
              <Card title={`意图识别历史 (${detail.intents.length})`} bordered size="small">
                <div className="flex flex-wrap gap-2">
                  {detail.intents.map(i => (
                    <Tooltip key={i.id} content={`${i.confidence || ''} 置信度 · ${formatTime(i.created_at)}`}>
                      <Tag color="default" style={{ color: INTENT_COLORS[i.intent] || '#909399' }}>
                        {INTENT_LABELS[i.intent] || i.intent}
                      </Tag>
                    </Tooltip>
                  ))}
                </div>
              </Card>
            )}

            {/* 对话消息 */}
            <Card title={`对话消息 (${detail.messages.length})`} bordered size="small">
              <div className="space-y-4 max-h-[500px] overflow-y-auto">
                {detail.messages.map(m => (
                  <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: m.role === 'user' ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
                        color: m.role === 'user' ? 'white' : 'var(--td-text-color-primary)',
                      }}
                    >
                      {m.role === 'user' ? <User size={14} /> : <BotIcon size={14} />}
                    </div>
                    <div className={`flex flex-col gap-1 max-w-[75%] ${m.role === 'user' ? 'items-end' : ''}`}>
                      <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>{formatTime(m.created_at)}</span>
                      {m.images && m.images.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap" style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                          {m.images.map((img, i) => (
                            <img key={i} src={img} alt={`图片 ${i + 1}`} className="max-h-28 max-w-[160px] object-cover rounded-lg" />
                          ))}
                        </div>
                      )}
                      <div
                        className="px-3 py-2 rounded-lg text-sm"
                        style={{
                          backgroundColor: m.role === 'user' ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
                          color: m.role === 'user' ? 'white' : 'var(--td-text-color-primary)',
                          borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                        }}
                      >
                        {m.role === 'user' ? m.content : <ChatMarkdown content={m.content} />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : (
          <Empty description="无详情数据" />
        )}
      </Drawer>
    </div>
  );
}

// ============ 统计卡片子组件 ============
function StatCard({ icon, color, label, value, sub }: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card bordered>
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}1a`, color }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>{label}</div>
          <div className="text-xl font-semibold mt-1" style={{ color: 'var(--td-text-color-primary)' }}>{value}</div>
          {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--td-text-color-placeholder)' }}>{sub}</div>}
        </div>
      </div>
    </Card>
  );
}

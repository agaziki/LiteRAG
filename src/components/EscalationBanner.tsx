import { useState, useEffect, useRef } from 'react';
import { Button, Input, Textarea, MessagePlugin } from 'tdesign-react';
import { UserCheck, Clock, CheckCircle2, AlertCircle, Send } from 'lucide-react';

interface EscalationInfo {
  id: string;
  reason: string;
  intent: string | null;
  status: 'pending' | 'accepted' | 'resolved';
  created_at: string;
  contact: string | null;
  note: string | null;
}

interface EscalationBannerProps {
  sessionId: string;
  /** 触发重新拉取（当消息流结束时变更） */
  refreshKey: number;
  /** 转人工状态/人工回复变化时回调（用于刷新会话消息） */
  onUpdate?: () => void;
}

const POLL_INTERVAL = 20 * 1000;

export function EscalationBanner({ sessionId, refreshKey, onUpdate }: EscalationBannerProps) {
  const [escalations, setEscalations] = useState<EscalationInfo[]>([]);
  const [loading, setLoading] = useState(false);
  // 留言表单
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 追踪人工回复数量变化，触发消息刷新
  const prevRepliesRef = useRef<number | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    let cancelled = false;
    async function fetchEscalations() {
      if (!sessionId) return;
      try {
        setLoading(true);
        const res = await fetch(`/api/escalate/${sessionId}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.escalations) setEscalations(data.escalations);
        // 检测人工回复新增 → 通知刷新会话消息
        const replies = typeof data.humanReplies === 'number' ? data.humanReplies : 0;
        if (prevRepliesRef.current !== null && replies > prevRepliesRef.current) {
          onUpdateRef.current?.();
        }
        prevRepliesRef.current = replies;
      } catch (e) {
        // 静默失败，不阻塞对话
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchEscalations();
    const timer = setInterval(fetchEscalations, POLL_INTERVAL);
    return () => { cancelled = true; clearInterval(timer); };
  }, [sessionId, refreshKey]);

  // WebSocket 实时通道：人工回复即时推送（轮询作为兜底保留）
  useEffect(() => {
    if (!sessionId) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket | null = null;
    let cancelled = false;
    try {
      ws = new WebSocket(`${proto}//${location.host}/ws/user?sessionId=${encodeURIComponent(sessionId)}`);
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'human_reply' && !cancelled) {
            onUpdateRef.current?.(); // 立即刷新会话消息展示人工回复
          }
        } catch { /* 忽略 */ }
      };
      ws.onerror = () => { /* WS 不可用时静默，轮询兜底 */ };
    } catch {
      // 浏览器不支持 WS：轮询兜底
    }
    return () => { cancelled = true; ws?.close(); };
  }, [sessionId]);

  if (escalations.length === 0) return null;

  const latest = escalations[escalations.length - 1];
  const intentLabel: Record<string, string> = {
    refund: '退款', order: '查询订单', tech: '技术支持', general: '通用咨询', other: '其他',
  };

  const statusConfig = {
    pending: { icon: Clock, label: '排队中', color: '#e37318', bg: 'rgba(227, 115, 24, 0.08)' },
    accepted: { icon: UserCheck, label: '已接入', color: '#0052d9', bg: 'rgba(0, 82, 217, 0.08)' },
    resolved: { icon: CheckCircle2, label: '已解决', color: '#2ba471', bg: 'rgba(43, 164, 113, 0.08)' },
  };
  const cfg = statusConfig[latest.status];
  const StatusIcon = cfg.icon;

  // 提交留言
  const submitNote = async () => {
    if (!contact.trim() || !note.trim()) {
      MessagePlugin.warning('请填写联系方式和问题描述');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/escalate/note/${latest.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact: contact.trim(), note: note.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        MessagePlugin.success('留言已提交，人工客服会尽快与您联系');
        setEscalations(prev => prev.map(e => e.id === latest.id ? { ...e, contact: contact.trim(), note: note.trim() } : e));
      } else {
        MessagePlugin.error(data.error || '留言失败');
      }
    } catch {
      MessagePlugin.error('网络错误，留言失败');
    } finally {
      setSubmitting(false);
    }
  };

  const showNoteForm = latest.status !== 'resolved' && !latest.contact;

  return (
    <div
      className="mt-2 p-3 rounded-lg"
      style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.color}33` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: cfg.color }}
        >
          <StatusIcon size={15} color="white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: cfg.color }}>
              已转人工客服
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ backgroundColor: cfg.color, color: 'white' }}
            >
              {cfg.label}
            </span>
            {latest.intent && (
              <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                意图：{intentLabel[latest.intent] || latest.intent}
              </span>
            )}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
            原因：{latest.reason}
          </div>
          {latest.status === 'pending' && (
            <div className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
              <AlertCircle size={12} />
              人工客服服务时间：每日 9:00 - 22:00，留言后优先处理
            </div>
          )}
          {latest.status === 'accepted' && (
            <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              人工客服已接入，回复将显示在对话中
            </div>
          )}

          {/* 留言表单：排队中且未留言 */}
          {showNoteForm && (
            <div className="mt-2 p-2.5 rounded-lg space-y-2" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
              <Input
                value={contact}
                onChange={(v) => setContact(String(v))}
                placeholder="联系方式（手机号 / 微信 / 邮箱）"
                size="small"
              />
              <Textarea
                value={note}
                onChange={(v) => setNote(typeof v === 'string' ? v : String(v))}
                placeholder="补充描述您的问题，便于人工客服快速处理"
                autosize={{ minRows: 2, maxRows: 4 }}
              />
              <div className="flex justify-end">
                <Button size="small" theme="primary" loading={submitting} onClick={submitNote}>
                  <Send size={13} style={{ marginRight: 4 }} />
                  提交留言
                </Button>
              </div>
            </div>
          )}
          {/* 已留言展示 */}
          {latest.contact && (
            <div className="text-xs mt-1.5" style={{ color: 'var(--td-text-color-secondary)' }}>
              已留言：{latest.contact}{latest.note ? ` · ${latest.note}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Button, MessagePlugin } from 'tdesign-react';
import { UserCheck, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface EscalationInfo {
  id: string;
  reason: string;
  intent: string | null;
  status: 'pending' | 'accepted' | 'resolved';
  created_at: string;
}

interface EscalationBannerProps {
  sessionId: string;
  /** 触发重新拉取（当消息流结束时变更） */
  refreshKey: number;
}

export function EscalationBanner({ sessionId, refreshKey }: EscalationBannerProps) {
  const [escalations, setEscalations] = useState<EscalationInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchEscalations() {
      if (!sessionId) return;
      try {
        setLoading(true);
        const res = await fetch(`/api/escalate/${sessionId}`);
        const data = await res.json();
        if (!cancelled && data.escalations) {
          setEscalations(data.escalations);
        }
      } catch (e) {
        // 静默失败，不阻塞对话
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchEscalations();
    return () => { cancelled = true; };
  }, [sessionId, refreshKey]);

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

  return (
    <div
      className="mt-2 p-3 rounded-lg flex items-start gap-3"
      style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.color}33` }}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: cfg.color }}
      >
        <StatusIcon size={15} color="white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-sm font-medium"
            style={{ color: cfg.color }}
          >
            已转人工客服
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ backgroundColor: cfg.color, color: 'white' }}
          >
            {cfg.label}
          </span>
          {latest.intent && (
            <span
              className="text-xs"
              style={{ color: 'var(--td-text-color-secondary)' }}
            >
              意图：{intentLabel[latest.intent] || latest.intent}
            </span>
          )}
        </div>
        <div
          className="text-xs mt-1"
          style={{ color: 'var(--td-text-color-secondary)' }}
        >
          原因：{latest.reason}
        </div>
        {latest.status === 'pending' && (
          <div
            className="text-xs mt-1 flex items-center gap-1"
            style={{ color: 'var(--td-text-color-placeholder)' }}
          >
            <AlertCircle size={12} />
            人工客服服务时间：每日 9:00 - 22:00，非工作时间请留言
          </div>
        )}
      </div>
    </div>
  );
}

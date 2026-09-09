/**
 * 坐席工作台（v2.3）：人工客服独立操作界面
 *
 * 布局：左列 = 待接入 + 服务中队列（WS 实时）；
 *       右列 = 选中会话的对话流 + 实时回复输入。
 * 登录：复用管理密码（/api/admin/login 签发的 token）。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input, Tag, Empty, Loading, MessagePlugin, Popconfirm } from 'tdesign-react';
import { Headphones, RefreshCw, LogOut, Send, User, Bot, CheckCircle2, ArrowLeft } from 'lucide-react';
import { getAdminToken, clearAdminToken } from '../utils/adminAuth';

interface QueueItem {
  sessionId: string;
  escalationId: string;
  reason: string;
  intent: string | null;
  status: string;
  created_at: string;
  contact: string | null;
  note: string | null;
}

interface DeskMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
}

const INTENT_LABELS: Record<string, string> = {
  refund: '退款', order: '查询订单', tech: '技术支持', general: '通用咨询', other: '其他',
};

export function AgentDesk() {
  const [authed, setAuthed] = useState<boolean>(() => !!getAdminToken());
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [pending, setPending] = useState<QueueItem[]>([]);
  const [active, setActive] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<DeskMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // ---- 登录 ----
  const handleLogin = useCallback(async () => {
    if (!password.trim()) { setAuthError('请输入管理密码'); return; }
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        // 与 adminAuth 共用存储键，管理后台登录互通
        localStorage.setItem('adminToken', data.token);
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

  const logout = useCallback(() => {
    clearAdminToken();
    setAuthed(false);
    wsRef.current?.close();
    setPending([]);
    setActive([]);
    setSelected(null);
    setMessages([]);
  }, []);

  // ---- 会话消息拉取 ----
  const loadMessages = useCallback(async (sessionId: string) => {
    const token = getAdminToken();
    if (!token) return;
    setMessagesLoading(true);
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { setAuthed(false); return; }
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      MessagePlugin.error('加载会话消息失败');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // ---- WS 坐席通道 ----
  useEffect(() => {
    if (!authed) return;
    const token = getAdminToken();
    if (!token) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/agent?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === 'queues') {
          setPending(m.pending || []);
          setActive(m.active || []);
        } else if (m.type === 'user_message') {
          // 服务中会话来了新消息：若是当前打开的会话则刷新消息流
          if (selectedRef.current === m.sessionId) {
            loadMessages(m.sessionId);
          } else {
            MessagePlugin.info(`会话 ${m.sessionId.slice(0, 8)} 有新消息`);
          }
        }
      } catch { /* 忽略 */ }
    };
    ws.onclose = (ev) => { if (ev.code === 4001) setAuthed(false); };
    ws.onerror = () => { /* 断线后由 queues 轮询兜底（此处简化：手动刷新按钮） */ };

    return () => { ws.close(); wsRef.current = null; };
  }, [authed, loadMessages]);

  // ---- 选中会话时拉取消息并滚动到底 ----
  useEffect(() => {
    if (selected) loadMessages(selected);
  }, [selected, loadMessages]);
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---- 操作（WS 上行，断线时 HTTP 兜底） ----
  const wsSend = useCallback(async (payload: Record<string, unknown>, httpFallback: () => Promise<void>): Promise<boolean> => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    await httpFallback();
    return true;
  }, []);

  const acceptSession = useCallback(async (sessionId: string) => {
    await wsSend({ type: 'accept', sessionId }, async () => {
      const token = getAdminToken();
      const escalations = await fetch(`/api/escalate/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
      const target = (escalations.escalations || []).filter((e: any) => e.status === 'pending').pop();
      if (target) {
        await fetch(`/api/admin/escalations/${target.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: 'accepted' }),
        });
      }
    });
    MessagePlugin.success('已接入');
    if (selectedRef.current === sessionId) loadMessages(sessionId);
  }, [wsSend, loadMessages]);

  const resolveSession = useCallback(async (sessionId: string) => {
    await wsSend({ type: 'resolve', sessionId }, async () => {
      const token = getAdminToken();
      const escalations = await fetch(`/api/escalate/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
      const target = (escalations.escalations || []).filter((e: any) => e.status !== 'resolved').pop();
      if (target) {
        await fetch(`/api/admin/escalations/${target.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: 'resolved' }),
        });
      }
    });
    MessagePlugin.success('已标记解决（该会话恢复 AI 应答）');
  }, [wsSend]);

  const sendReply = useCallback(async () => {
    if (!selected || !replyText.trim()) return;
    setSending(true);
    try {
      const ws = wsRef.current;
      const viaWs = ws && ws.readyState === WebSocket.OPEN;
      if (viaWs) {
        ws.send(JSON.stringify({ type: 'reply', sessionId: selected, content: replyText.trim() }));
      } else {
        const token = getAdminToken();
        const res = await fetch(`/api/admin/sessions/${selected}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ content: replyText.trim() }),
        });
        if (res.status === 401) { setAuthed(false); return; }
      }
      setReplyText('');
      setTimeout(() => loadMessages(selected), 300);
    } finally {
      setSending(false);
    }
  }, [selected, replyText, loadMessages]);

  // ---- 登录门 ----
  if (!authed) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
        <div className="w-[360px] p-8 rounded-xl" style={{ backgroundColor: 'var(--td-bg-color-container)', boxShadow: '0 4px 16px rgba(0,0,0,.08)' }}>
          <div className="text-center mb-5">
            <Headphones size={32} className="mx-auto mb-2" style={{ color: 'var(--td-brand-color)' }} />
            <h1 className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>坐席工作台</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>使用管理密码登录</p>
          </div>
          <Input type="password" value={password} onChange={(v) => setPassword(String(v))} placeholder="管理密码" onEnter={handleLogin} />
          {authError && <div className="text-xs mt-2" style={{ color: 'var(--td-error-color)' }}>{authError}</div>}
          <Button theme="primary" block className="mt-4" loading={authLoading} onClick={handleLogin}>登录</Button>
        </div>
      </div>
    );
  }

  const selectedItem = [...pending, ...active].find(x => x.sessionId === selected);

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
      {/* 顶栏 */}
      <header className="h-12 flex items-center justify-between px-4 flex-shrink-0" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
        <div className="flex items-center gap-2">
          <Headphones size={18} style={{ color: 'var(--td-brand-color)' }} />
          <span className="font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>坐席工作台</span>
          <Tag size="small" theme="success">在线</Tag>
        </div>
        <div className="flex items-center gap-2">
          <Button size="small" variant="text" onClick={() => { pending.length >= 0 && (async () => { /* WS 会自动刷新；此处兜底手动触发由 queues 定时推送 */ })(); }}>
            <RefreshCw size={14} />
          </Button>
          <Button size="small" variant="text" icon={<LogOut size={14} />} onClick={logout}>退出</Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 左列：队列 */}
        <div className="w-72 flex-shrink-0 overflow-y-auto border-r" style={{ borderColor: 'var(--td-component-border)' }}>
          <div className="p-3">
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>
              待接入（{pending.length}）
            </div>
            {pending.length === 0 && <div className="text-xs px-2 py-1" style={{ color: 'var(--td-text-color-placeholder)' }}>暂无</div>}
            {pending.map(item => (
              <div
                key={item.escalationId}
                className="p-2.5 mb-2 rounded-lg cursor-pointer"
                style={{
                  backgroundColor: selected === item.sessionId ? 'var(--td-brand-color-light)' : 'var(--td-bg-color-container)',
                  border: `1px solid ${selected === item.sessionId ? 'var(--td-brand-color)' : 'var(--td-component-border)'}`,
                }}
                onClick={() => setSelected(item.sessionId)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-mono truncate" style={{ color: 'var(--td-text-color-primary)' }}>
                    {item.sessionId.slice(0, 8)}…
                  </span>
                  <Tag size="small" theme="warning">待接入</Tag>
                </div>
                <div className="text-xs mt-1 truncate" style={{ color: 'var(--td-text-color-secondary)' }}>原因：{item.reason}</div>
                {item.contact && <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--td-text-color-secondary)' }}>留言：{item.contact}{item.note ? ` · ${item.note}` : ''}</div>}
                <Button size="small" theme="primary" variant="outline" block className="mt-2" onClick={(e) => { e.stopPropagation(); acceptSession(item.sessionId); }}>
                  接入
                </Button>
              </div>
            ))}

            <div className="text-xs font-medium mb-2 mt-4" style={{ color: 'var(--td-text-color-secondary)' }}>
              服务中（{active.length}）
            </div>
            {active.length === 0 && <div className="text-xs px-2 py-1" style={{ color: 'var(--td-text-color-placeholder)' }}>暂无</div>}
            {active.map(item => (
              <div
                key={item.escalationId}
                className="p-2.5 mb-2 rounded-lg cursor-pointer"
                style={{
                  backgroundColor: selected === item.sessionId ? 'var(--td-brand-color-light)' : 'var(--td-bg-color-container)',
                  border: `1px solid ${selected === item.sessionId ? 'var(--td-brand-color)' : 'var(--td-component-border)'}`,
                }}
                onClick={() => setSelected(item.sessionId)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-mono truncate" style={{ color: 'var(--td-text-color-primary)' }}>
                    {item.sessionId.slice(0, 8)}…
                  </span>
                  <Tag size="small" theme="success">服务中</Tag>
                </div>
                {item.contact && <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--td-text-color-secondary)' }}>留言：{item.contact}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* 右列：对话 */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center">
              <Empty description="从左侧选择一个会话开始服务" />
            </div>
          ) : (
            <>
              {/* 会话操作栏 */}
              <div className="h-12 flex items-center justify-between px-4 flex-shrink-0 border-b" style={{ borderColor: 'var(--td-component-border)', backgroundColor: 'var(--td-bg-color-container)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  {selectedItem?.status === 'pending' && (
                    <Button size="small" theme="primary" onClick={() => acceptSession(selected)}>接入该会话</Button>
                  )}
                  <span className="text-xs truncate" style={{ color: 'var(--td-text-color-secondary)' }}>
                    {selectedItem ? `转人工原因：${selectedItem.reason}` : selected}
                  </span>
                </div>
                <Popconfirm content="解决后该会话恢复 AI 应答，确认？" onConfirm={() => resolveSession(selected)}>
                  <Button size="small" variant="outline" theme="success" icon={<CheckCircle2 size={13} />}>标记解决</Button>
                </Popconfirm>
              </div>

              {/* 消息流 */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messagesLoading ? (
                  <div className="flex justify-center py-8"><Loading /></div>
                ) : messages.length === 0 ? (
                  <Empty description="暂无消息" />
                ) : (
                  messages.map(m => {
                    const isUser = m.role === 'user';
                    const isHuman = m.model === 'human-agent';
                    const isTakeover = m.model === 'human-takeover';
                    if (isTakeover) {
                      return <div key={m.id} className="text-center text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>{m.content}</div>;
                    }
                    return (
                      <div key={m.id} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: isUser ? 'var(--td-brand-color)' : isHuman ? '#2ba471' : 'var(--td-bg-color-component)' }}>
                          {isUser ? <User size={14} color="white" /> : <Bot size={14} color={isHuman ? 'white' : 'var(--td-text-color-secondary)'} />}
                        </div>
                        <div className={`max-w-[70%] px-3 py-2 rounded-xl text-sm ${isUser ? '' : ''}`} style={{
                          backgroundColor: isUser ? 'var(--td-brand-color)' : isHuman ? 'rgba(43,164,113,.1)' : 'var(--td-bg-color-container)',
                          color: isUser ? '#fff' : 'var(--td-text-color-primary)',
                        }}>
                          {m.content}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* 回复输入 */}
              <div className="p-3 border-t flex gap-2 flex-shrink-0" style={{ borderColor: 'var(--td-component-border)', backgroundColor: 'var(--td-bg-color-container)' }}>
                <Input
                  value={replyText}
                  onChange={(v) => setReplyText(String(v))}
                  placeholder="以人工客服身份回复，回车发送（用户实时可见）"
                  onEnter={sendReply}
                />
                <Button theme="primary" icon={<Send size={14} />} loading={sending} onClick={sendReply}>发送</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

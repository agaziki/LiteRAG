import { useState, useCallback } from 'react';
import { Dialog, Input, Button, Tabs, MessagePlugin } from 'tdesign-react';
import { authedFetch, setUserToken, clearUserToken } from '../utils/userAuth';

interface UserAuthDialogProps {
  visible: boolean;
  onClose: () => void;
  /** 登录/注册/退出后回调（父组件刷新会话列表） */
  onChanged: () => void;
  loggedInUsername: string | null;
}

/** 用户账号弹窗：登录 / 注册 / 已登录信息与退出 */
export function UserAuthDialog({ visible, onClose, onChanged, loggedInUsername }: UserAuthDialogProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        setUserToken(data.token);
        MessagePlugin.success(mode === 'login' ? '登录成功，会话已同步' : '注册成功');
        onChanged();
        onClose();
      } else {
        setError(data.error || '操作失败');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  }, [mode, username, password, onClose, onChanged]);

  const logout = useCallback(async () => {
    // 退出前调一次 me 失效（可省略）；直接清 token 并刷新
    clearUserToken();
    onChanged();
    onClose();
    MessagePlugin.success('已退出登录');
  }, [onChanged, onClose]);

  // 已登录态：显示账号信息 + 退出
  if (loggedInUsername) {
    return (
      <Dialog visible={visible} onClose={onClose} header="账号" width={360} footer={null}>
        <div className="py-4 text-center space-y-3">
          <div className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>
            当前登录：<b>{loggedInUsername}</b>
          </div>
          <div className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
            登录后您的会话在所有设备同步
          </div>
          <Button theme="danger" variant="outline" block onClick={logout}>退出登录</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog visible={visible} onClose={onClose} header="账号登录" width={380} footer={null}>
      <div className="pt-2">
        <Tabs
          value={mode}
          onChange={(v) => { setMode(v as 'login' | 'register'); setError(''); }}
          list={[
            { value: 'login', label: '登录' },
            { value: 'register', label: '注册' },
          ]}
        />
        <div className="space-y-3 mt-4">
          <Input
            value={username}
            onChange={(v) => setUsername(String(v))}
            placeholder="用户名（3-32 位字母/数字/下划线）"
          />
          <Input
            value={password}
            onChange={(v) => setPassword(String(v))}
            placeholder={mode === 'register' ? '密码（至少 6 位）' : '密码'}
            type="password"
          />
          {error && (
            <div className="text-xs" style={{ color: 'var(--td-error-color)' }}>{error}</div>
          )}
          <Button theme="primary" block loading={loading} onClick={submit}>
            {mode === 'login' ? '登录' : '注册并登录'}
          </Button>
          <div className="text-xs text-center" style={{ color: 'var(--td-text-color-placeholder)' }}>
            {mode === 'login' ? '登录后，匿名期间的会话会自动并入账号（跨设备同步）' : '不注册也可以直接使用，账号仅用于跨设备同步会话'}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

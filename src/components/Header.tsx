import { Button, Tooltip, Tag } from 'tdesign-react';
import { 
  RefreshIcon,
  SunnyIcon,
  MoonIcon,
  MenuFoldIcon,
  MenuUnfoldIcon,
  UserIcon,
} from 'tdesign-icons-react';
import { Bot } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { Model, Session, Agent, Theme } from '../types';
import { ICON_MAP } from '../utils/iconMap';

interface HeaderProps {
  isAdminPage: boolean;
  sidebarOpen: boolean;
  theme: Theme;
  currentSession: Session | undefined;
  currentAgent: Agent | undefined;
  models: Model[];
  onToggleSidebar: () => void;
  onToggleTheme: () => void;
  onRefreshModels: () => void;
  /** 账号：已登录用户名 / 打开账号弹窗 */
  loggedInUsername: string | null;
  onOpenAccount: () => void;
}

export function Header({
  isAdminPage,
  sidebarOpen,
  theme,
  currentSession,
  currentAgent,
  models,
  onToggleSidebar,
  onToggleTheme,
  onRefreshModels,
  loggedInUsername,
  onOpenAccount,
}: HeaderProps) {
  const formatModelName = (modelId: string) => {
    const model = models.find(m => m.modelId === modelId);
    const name = model?.name || modelId;
    return name
      .replace(/^(Claude|GPT|Gemini|Kimi|DeepSeek|Qwen|GLM)\s*/i, '')
      .replace(/-/g, ' ')
      .trim() || name;
  };

  const hideAuxInfo = isAdminPage;

  return (
    <header 
      className="h-14 flex justify-between items-center px-4 flex-shrink-0"
      style={{ 
        backgroundColor: 'var(--td-bg-color-page)'
      }}
    >
      <div className="flex items-center gap-3">
        <Button
          variant="text"
          shape="circle"
          icon={sidebarOpen ? <MenuFoldIcon /> : <MenuUnfoldIcon />}
          onClick={onToggleSidebar}
        />
        {!hideAuxInfo && currentAgent && (
          <div 
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: currentAgent.color || 'var(--td-brand-color)' }}
          >
            {(() => {
              const Icon = ICON_MAP[currentAgent.icon || 'Bot'] || Bot;
              return <Icon size={14} color="white" />;
            })()}
          </div>
        )}
        <h1
          className="text-base font-semibold"
          style={{ color: 'var(--td-text-color-primary)' }}
        >
          {isAdminPage ? '管理后台' : (currentSession?.title || APP_CONFIG.name)}
        </h1>
        {!hideAuxInfo && currentSession && (
          <Tag size="small" variant="outline">
            {formatModelName(currentSession.model)}
          </Tag>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Tooltip content={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}>
          <Button
            variant="outline"
            shape="circle"
            icon={theme === 'light' ? <MoonIcon /> : <SunnyIcon />}
            onClick={onToggleTheme}
          />
        </Tooltip>
        {!hideAuxInfo && (
          <Tooltip content="刷新模型列表">
            <Button
              variant="outline"
              shape="circle"
              icon={<RefreshIcon />}
              onClick={onRefreshModels}
            />
          </Tooltip>
        )}
        {!hideAuxInfo && (
          <Tooltip content={loggedInUsername ? `账号：${loggedInUsername}` : '登录 / 注册（跨设备同步会话）'}>
            <Button
              variant={loggedInUsername ? 'outline' : 'text'}
              theme={loggedInUsername ? 'primary' : 'default'}
              shape="circle"
              icon={<UserIcon />}
              onClick={onOpenAccount}
            >
              {loggedInUsername ? (
                <span className="text-xs ml-1 max-w-[80px] truncate">{loggedInUsername}</span>
              ) : null}
            </Button>
          </Tooltip>
        )}
      </div>
    </header>
  );
}

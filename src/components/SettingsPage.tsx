import { useState, useEffect, useCallback } from 'react';
import {
  Form, Input, Textarea, Button, Tooltip, Popconfirm,
  MessagePlugin, Loading, Tag, Radio,
} from 'tdesign-react';
import {
  AddIcon, EditIcon, DeleteIcon, CheckIcon,
  CheckCircleFilledIcon, CloseCircleFilledIcon, RefreshIcon
} from 'tdesign-icons-react';
import { Bot, Sparkles, Code, FileText, Globe, Lightbulb } from 'lucide-react';
import { CustomAgent } from '../types';
import { adminFetch, handleAuthExpired } from '../utils/adminAuth';

interface SettingsPageProps {
  agents: CustomAgent[];
  onAdd: (agent: Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>) => CustomAgent;
  onUpdate: (id: string, updates: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>) => void;
  onDelete: (id: string) => void;
}

type LoginMethod = 'env' | 'none';

interface LoginStatus {
  isLoggedIn: boolean;
  checking: boolean;
  method?: LoginMethod;
  envConfigured?: boolean;
  error?: string;
  apiKey?: string;
  envVars?: {
    apiKey?: string;
    baseUrl?: string;
  };
}

const PRESET_ICONS = [
  { name: 'Bot', icon: Bot },
  { name: 'Sparkles', icon: Sparkles },
  { name: 'Code', icon: Code },
  { name: 'FileText', icon: FileText },
  { name: 'Globe', icon: Globe },
  { name: 'Lightbulb', icon: Lightbulb },
];

const PRESET_COLORS = [
  '#0052d9', '#0594fa', '#00a870', '#ed7b2f', 
  '#e34d59', '#a25eb5', '#5c6bc0', '#26a69a'
];

const PRESET_TEMPLATES = [
  {
    name: '代码助手',
    description: '专注于编程和代码相关任务',
    systemPrompt: '你是一个专业的编程助手。你擅长编写、审查和解释代码。请提供清晰、高效且符合最佳实践的代码解决方案。在解释时，请考虑代码的可读性、性能和可维护性。',
    icon: 'Code',
    color: '#0594fa',
  },
  {
    name: '写作助手',
    description: '帮助撰写和优化各类文档',
    systemPrompt: '你是一个专业的写作助手。你擅长撰写、编辑和优化各类文档，包括文章、报告、邮件等。请帮助用户提升文字表达的清晰度、逻辑性和吸引力。',
    icon: 'FileText',
    color: '#00a870',
  },
  {
    name: '翻译助手',
    description: '提供高质量的多语言翻译',
    systemPrompt: '你是一个专业的翻译助手。你精通多种语言，能够提供准确、自然、符合语境的翻译。请在翻译时保持原文的语气和风格，同时确保目标语言的地道表达。',
    icon: 'Globe',
    color: '#ed7b2f',
  },
  {
    name: '创意助手',
    description: '激发灵感，提供创意建议',
    systemPrompt: '你是一个富有创意的助手。你善于头脑风暴、提供创新想法和独特视角。请帮助用户突破思维定式，探索新的可能性，激发创造力。',
    icon: 'Lightbulb',
    color: '#a25eb5',
  },
];

export function SettingsPage({ 
  agents, 
  onAdd, 
  onUpdate, 
  onDelete 
}: SettingsPageProps) {
  const [editingAgent, setEditingAgent] = useState<CustomAgent | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    systemPrompt: '',
    icon: 'Bot',
    color: '#0052d9',
  });

  // 登录状态
  const [loginStatus, setLoginStatus] = useState<LoginStatus>({
    isLoggedIn: false,
    checking: true,
  });

  // 环境变量配置
  const [showEnvConfig, setShowEnvConfig] = useState(false);
  const [envConfig, setEnvConfig] = useState({
    apiKey: '',
    baseUrl: '',
  });
  const [savingEnv, setSavingEnv] = useState(false);

  // 话题边界策略（strict=温和 / open=开放）
  const [topicBoundary, setTopicBoundary] = useState<'strict' | 'open'>('strict');
  const [topicLoading, setTopicLoading] = useState(false);
  const [topicSaving, setTopicSaving] = useState(false);

  // 检查登录状态
  const checkLoginStatus = useCallback(async () => {
    setLoginStatus(prev => ({ ...prev, checking: true, error: undefined }));
    
    try {
      const response = await fetch('/api/check-login');
      const data = await response.json();
      
      setLoginStatus({
        isLoggedIn: data.isLoggedIn,
        checking: false,
        method: data.method,
        envConfigured: data.envConfigured,
        error: data.error,
        apiKey: data.apiKey,
        envVars: data.envVars,
      });
    } catch (error: any) {
      setLoginStatus({
        isLoggedIn: false,
        checking: false,
        error: error?.message || '检查登录状态失败',
      });
    }
  }, []);

  // 保存环境变量配置
  const saveEnvConfig = async () => {
    if (!envConfig.apiKey.trim()) {
      MessagePlugin.warning('请填写 DeepSeek API Key');
      return;
    }

    setSavingEnv(true);
    try {
      const response = await fetch('/api/save-env-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: envConfig.apiKey.trim() || undefined,
          baseUrl: envConfig.baseUrl.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        MessagePlugin.success(data.message);
        setShowEnvConfig(false);
        setEnvConfig({ apiKey: '', baseUrl: '' });
        // 重新检查登录状态
        checkLoginStatus();
      } else {
        MessagePlugin.error(data.error || '保存失败');
      }
    } catch (error: any) {
      MessagePlugin.error(error?.message || '保存失败');
    } finally {
      setSavingEnv(false);
    }
  };

  // 初始化时检查登录状态
  useEffect(() => {
    checkLoginStatus();
  }, [checkLoginStatus]);

  // 加载话题边界策略
  useEffect(() => {
    (async () => {
      try {
        setTopicLoading(true);
        const res = await adminFetch('/api/admin/topic-boundary');
        if (handleAuthExpired(res)) return;
        const data = await res.json();
        if (data.mode === 'strict' || data.mode === 'open') setTopicBoundary(data.mode);
      } catch {
        // 静默
      } finally {
        setTopicLoading(false);
      }
    })();
  }, []);

  const saveTopicBoundary = useCallback(async (mode: 'strict' | 'open') => {
    setTopicSaving(true);
    try {
      const res = await adminFetch('/api/admin/topic-boundary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (handleAuthExpired(res)) return;
      const data = await res.json();
      if (data.success) {
        setTopicBoundary(data.mode);
        MessagePlugin.success(data.mode === 'strict' ? '已切换为温和模式（仅解答购物售后相关问题）' : '已切换为开放模式（通用问题照答，业务事实检索优先）');
      } else {
        MessagePlugin.error(data.error || '保存失败');
      }
    } catch {
      MessagePlugin.error('网络错误，保存失败');
    } finally {
      setTopicSaving(false);
    }
  }, []);

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      systemPrompt: '',
      icon: 'Bot',
      color: '#0052d9',
    });
    setEditingAgent(null);
    setIsCreating(false);
  };

  const handleEdit = (agent: CustomAgent) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      description: agent.description || '',
      systemPrompt: agent.systemPrompt,
      icon: agent.icon || 'Bot',
      color: agent.color || '#0052d9',
    });
    setIsCreating(true);
  };

  const handleSave = () => {
    if (!formData.name.trim() || (!formData.systemPrompt.trim() && !isEditingDefault)) {
      MessagePlugin.warning(isEditingDefault ? '请填写名称（默认客服 Agent 的系统提示词可留空，留空使用后端内置提示词）' : '请填写名称和系统提示词');
      return;
    }

    if (editingAgent) {
      onUpdate(editingAgent.id, formData);
      MessagePlugin.success('Agent 已更新');
    } else {
      onAdd(formData);
      MessagePlugin.success('Agent 已创建');
    }
    resetForm();
  };

  const handleUseTemplate = (template: typeof PRESET_TEMPLATES[0]) => {
    setFormData({
      ...template,
      description: template.description,
    });
    setIsCreating(true);
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    MessagePlugin.success('Agent 已删除');
  };

  const getIconComponent = (iconName: string) => {
    const preset = PRESET_ICONS.find(p => p.name === iconName);
    return preset ? preset.icon : Bot;
  };

  const customAgents = agents.filter(a => a.id !== 'default');
  const defaultAgent = agents.find(a => a.id === 'default');
  const isEditingDefault = editingAgent?.id === 'default';

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* 页面标题 */}
        <div>
          <h1 
            className="text-2xl font-semibold mb-2"
            style={{ color: 'var(--td-text-color-primary)' }}
          >
            设置
          </h1>
          <p style={{ color: 'var(--td-text-color-secondary)' }}>
            管理登录配置和自定义 Agent
          </p>
        </div>

        {/* 登录配置 */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 
                className="text-lg font-medium"
                style={{ color: 'var(--td-text-color-primary)' }}
              >
                登录配置
              </h2>
              <p
                className="text-sm mt-1"
                style={{ color: 'var(--td-text-color-secondary)' }}
              >
                配置 DeepSeek API Key，用于客服对话
              </p>
            </div>
            <Button 
              variant="text" 
              icon={<RefreshIcon />}
              onClick={checkLoginStatus}
              loading={loginStatus.checking}
            >
              刷新
            </Button>
          </div>
          
          {/* 当前状态 */}
          <div className="flex items-center gap-3 mb-6">
            {loginStatus.checking ? (
              <>
                <Loading size="small" />
                <span style={{ color: 'var(--td-text-color-secondary)' }}>
                  正在检查登录状态...
                </span>
              </>
            ) : loginStatus.isLoggedIn ? (
              <>
                <CheckCircleFilledIcon 
                  size="20px" 
                  style={{ color: 'var(--td-success-color)' }} 
                />
                <span style={{ color: 'var(--td-text-color-primary)' }}>
                  已登录
                </span>
                <Tag size="small" variant="outline">
                  环境变量
                </Tag>
                {loginStatus.method === 'env' && loginStatus.apiKey && (
                  <span 
                    className="text-sm font-mono"
                    style={{ color: 'var(--td-text-color-secondary)' }}
                  >
                    {loginStatus.apiKey}
                  </span>
                )}
              </>
            ) : (
              <>
                <CloseCircleFilledIcon 
                  size="20px" 
                  style={{ color: 'var(--td-text-color-placeholder)' }} 
                />
                <span style={{ color: 'var(--td-text-color-secondary)' }}>
                  未登录
                </span>
              </>
            )}
          </div>
          
          {/* 环境变量配置 */}
          <div className="mb-6">
            <h3
              className="text-sm font-medium mb-3"
              style={{ color: 'var(--td-text-color-secondary)' }}
            >
              DeepSeek API 配置
            </h3>

            {showEnvConfig ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      className="text-xs block mb-1"
                      style={{ color: 'var(--td-text-color-placeholder)' }}
                    >
                      DEEPSEEK_API_KEY
                    </label>
                    <Input
                      type="password"
                      size="small"
                      value={envConfig.apiKey}
                      onChange={(v) => setEnvConfig(prev => ({ ...prev, apiKey: v as string }))}
                      placeholder="API 密钥（必填）"
                    />
                  </div>
                  <div>
                    <label
                      className="text-xs block mb-1"
                      style={{ color: 'var(--td-text-color-placeholder)' }}
                    >
                      DEEPSEEK_BASE_URL
                    </label>
                    <Input
                      size="small"
                      value={envConfig.baseUrl}
                      onChange={(v) => setEnvConfig(prev => ({ ...prev, baseUrl: v as string }))}
                      placeholder="默认 https://api.deepseek.com"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    theme="primary"
                    onClick={saveEnvConfig}
                    loading={savingEnv}
                  >
                    保存
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => {
                      setShowEnvConfig(false);
                      setEnvConfig({ apiKey: '', baseUrl: '' });
                    }}
                  >
                    取消
                  </Button>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--td-text-color-placeholder)' }}
                  >
                    仅当前进程有效，长期使用请写入 .env 文件
                  </span>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="small"
                onClick={() => setShowEnvConfig(true)}
              >
                配置 API Key
              </Button>
            )}
          </div>

          {loginStatus.error && !loginStatus.isLoggedIn && (
            <div 
              className="text-xs mt-4"
              style={{ color: 'var(--td-text-color-placeholder)' }}
            >
              {loginStatus.error}
            </div>
          )}
        </div>

        {/* 话题边界策略 */}
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
              话题边界策略
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>
              控制智能客服面对无关话题时的应答方式（即时生效，影响默认客服 Agent）
            </p>
          </div>
          <Radio.Group
            value={topicBoundary}
            onChange={(v) => saveTopicBoundary(v as 'strict' | 'open')}
            disabled={topicLoading || topicSaving}
          >
            <div className="space-y-3">
              <div
                className="p-3 rounded-lg cursor-pointer border"
                style={{
                  borderColor: topicBoundary === 'strict' ? 'var(--td-brand-color)' : 'var(--td-component-border)',
                  backgroundColor: topicBoundary === 'strict' ? 'var(--td-brand-color-light)' : 'transparent',
                }}
                onClick={() => topicBoundary !== 'strict' && saveTopicBoundary('strict')}
              >
                <Radio value="strict"><span className="font-medium">温和模式（推荐企业正式客服）</span></Radio>
                <div className="text-xs mt-1 ml-6" style={{ color: 'var(--td-text-color-secondary)' }}>
                  无关话题时礼貌说明「我是本店智能客服，仅能解答购物售后相关问题」，并引导用户回到业务
                </div>
              </div>
              <div
                className="p-3 rounded-lg cursor-pointer border"
                style={{
                  borderColor: topicBoundary === 'open' ? 'var(--td-brand-color)' : 'var(--td-component-border)',
                  backgroundColor: topicBoundary === 'open' ? 'var(--td-brand-color-light)' : 'transparent',
                }}
                onClick={() => topicBoundary !== 'open' && saveTopicBoundary('open')}
              >
                <Radio value="open"><span className="font-medium">开放模式（通用助手场景）</span></Radio>
                <div className="text-xs mt-1 ml-6" style={{ color: 'var(--td-text-color-secondary)' }}>
                  通用问题照答；业务事实层面坚持检索优先、不编造、检索不到时兜底转人工
                </div>
              </div>
            </div>
          </Radio.Group>
          {topicSaving && <div className="text-xs mt-2" style={{ color: 'var(--td-text-color-secondary)' }}>保存中…</div>}
          <div className="text-xs mt-2" style={{ color: 'var(--td-text-color-placeholder)' }}>
            默认值由 .env 的 TOPIC_BOUNDARY（strict/open）决定；显式设置环境变量后，重启将回到环境变量值
          </div>
        </div>

        <div
          style={{
            height: '1px',
            backgroundColor: 'var(--td-component-border)'
          }}
        />

        {/* Agent 配置 */}
        <div>
          <div className="mb-4">
            <h2 
              className="text-lg font-medium"
              style={{ color: 'var(--td-text-color-primary)' }}
            >
              Agent 配置
            </h2>
            <p 
              className="text-sm mt-1"
              style={{ color: 'var(--td-text-color-secondary)' }}
            >
              创建和管理自定义 Agent
            </p>
          </div>

          <div className="space-y-6">
              {/* 创建/编辑表单 */}
              {isCreating ? (
                <div 
                  className="p-5 rounded-xl border"
                  style={{ 
                    backgroundColor: 'var(--td-bg-color-container)',
                    borderColor: 'var(--td-component-border)'
                  }}
                >
                  <div className="space-y-4">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-base font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                        {editingAgent ? '编辑 Agent' : '创建新 Agent'}
                      </h4>
                      <Button variant="text" onClick={resetForm}>取消</Button>
                    </div>
                    
                    <Form labelAlign="top">
                      <Form.FormItem label="名称" requiredMark>
                        <Input 
                          value={formData.name}
                          onChange={(v) => setFormData(prev => ({ ...prev, name: v as string }))}
                          placeholder="例如：代码助手"
                        />
                      </Form.FormItem>
                      
                      <Form.FormItem label="描述">
                        <Input 
                          value={formData.description}
                          onChange={(v) => setFormData(prev => ({ ...prev, description: v as string }))}
                          placeholder="简短描述这个 Agent 的用途"
                        />
                      </Form.FormItem>
                      
                      <Form.FormItem label="图标和颜色">
                        <div className="flex gap-4">
                          <div className="flex gap-2">
                            {PRESET_ICONS.map(({ name, icon: Icon }) => (
                              <button
                                key={name}
                                type="button"
                                className="w-9 h-9 rounded-lg flex items-center justify-center transition-all border-2"
                                style={{
                                  backgroundColor: formData.icon === name ? formData.color : 'transparent',
                                  color: formData.icon === name ? 'white' : 'var(--td-text-color-secondary)',
                                  borderColor: formData.icon === name ? formData.color : 'var(--td-component-border)',
                                }}
                                onClick={() => setFormData(prev => ({ ...prev, icon: name }))}
                              >
                                <Icon size={18} />
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-1.5 items-center">
                            {PRESET_COLORS.map(color => (
                              <button
                                key={color}
                                type="button"
                                className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                                style={{ backgroundColor: color }}
                                onClick={() => setFormData(prev => ({ ...prev, color }))}
                              >
                                {formData.color === color && <CheckIcon style={{ color: 'white' }} size="14px" />}
                              </button>
                            ))}
                          </div>
                        </div>
                      </Form.FormItem>
                      
                      <Form.FormItem label={isEditingDefault ? '系统提示词（留空使用后端内置客服提示词）' : '系统提示词'} requiredMark={!isEditingDefault}>
                        <Textarea
                          value={formData.systemPrompt}
                          onChange={(v) => setFormData(prev => ({ ...prev, systemPrompt: typeof v === 'string' ? v : String(v) }))}
                          placeholder={isEditingDefault ? '留空 = 使用后端内置客服提示词（意图识别 + FAQ/文档检索 + 转人工）' : '定义 Agent 的行为和能力...'}
                          autosize={{ minRows: 4, maxRows: 8 }}
                        />
                      </Form.FormItem>
                    </Form>
                    
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={resetForm}>取消</Button>
                      <Button theme="primary" onClick={handleSave}>
                        {editingAgent ? '保存修改' : '创建 Agent'}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* 默认客服 Agent（可编辑，不可删除） */}
                  {defaultAgent && (
                    <div>
                      <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--td-text-color-secondary)' }}>
                        默认客服 Agent
                      </h4>
                      <div className="p-3 rounded-lg flex items-center gap-3" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: defaultAgent.color || '#0052d9' }}
                        >
                          {(() => { const Icon = getIconComponent(defaultAgent.icon || 'Headphones'); return <Icon size={20} color="white" />; })()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{defaultAgent.name}</span>
                            <Tag size="small" theme="primary">默认</Tag>
                          </div>
                          <div className="text-xs truncate mt-0.5" style={{ color: 'var(--td-text-color-placeholder)' }}>
                            {defaultAgent.systemPrompt ? defaultAgent.description || defaultAgent.systemPrompt.slice(0, 50) + '...' : '使用后端内置客服提示词（意图识别 + FAQ/文档检索 + 转人工）'}
                          </div>
                        </div>
                        <Button
                          variant="text"
                          shape="circle"
                          size="small"
                          icon={<EditIcon />}
                          onClick={() => handleEdit(defaultAgent)}
                        />
                      </div>
                    </div>
                  )}

                  {/* 从模板快速创建 */}
                  <div>
                    <h4 className="text-sm font-medium mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>
                      从模板快速创建
                    </h4>
                    <p className="text-xs mb-3" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      点击模板生成一个可编辑的自定义 Agent（模板本身不是 Agent，创建后才会出现在新对话页）
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {PRESET_TEMPLATES.map(template => {
                        const Icon = getIconComponent(template.icon);
                        return (
                          <div 
                            key={template.name} 
                            className="p-3 rounded-lg cursor-pointer transition-all hover:shadow-md"
                            style={{ backgroundColor: 'var(--td-bg-color-component)' }}
                            onClick={() => handleUseTemplate(template)}
                          >
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: template.color }}
                              >
                                <Icon size={20} color="white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate" style={{ color: 'var(--td-text-color-primary)' }}>
                                  {template.name}
                                </div>
                                <div className="text-xs truncate" style={{ color: 'var(--td-text-color-placeholder)' }}>
                                  {template.description}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 自定义创建按钮 */}
                  <Button 
                    icon={<AddIcon />} 
                    variant="dashed" 
                    block 
                    onClick={() => setIsCreating(true)}
                  >
                    从头创建 Agent
                  </Button>

                  {/* 已有的自定义 Agent */}
                  {customAgents.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--td-text-color-secondary)' }}>
                        我的 Agent ({customAgents.length})
                      </h4>
                      <div className="space-y-2">
                        {customAgents.map(agent => {
                          const Icon = getIconComponent(agent.icon || 'Bot');
                          return (
                            <div 
                              key={agent.id} 
                              className="p-3 rounded-lg"
                              style={{ backgroundColor: 'var(--td-bg-color-component)' }}
                            >
                              <div className="flex items-center gap-3">
                                <div 
                                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                                  style={{ backgroundColor: agent.color || '#0052d9' }}
                                >
                                  <Icon size={20} color="white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                                    {agent.name}
                                  </div>
                                  <div className="text-xs truncate" style={{ color: 'var(--td-text-color-placeholder)' }}>
                                    {agent.description || agent.systemPrompt.slice(0, 50) + '...'}
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  <Tooltip content="编辑">
                                    <Button 
                                      variant="text" 
                                      shape="circle" 
                                      size="small"
                                      icon={<EditIcon />}
                                      onClick={() => handleEdit(agent)}
                                    />
                                  </Tooltip>
                                  <Popconfirm
                                    content="确定删除这个 Agent 吗？"
                                    onConfirm={() => handleDelete(agent.id)}
                                  >
                                    <Tooltip content="删除">
                                      <Button 
                                        variant="text" 
                                        shape="circle" 
                                        size="small"
                                        icon={<DeleteIcon />}
                                      />
                                    </Tooltip>
                                  </Popconfirm>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
        </div>
      </div>
    </div>
  );
}

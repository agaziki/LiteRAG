import { Bot } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { Agent } from '../types';
import { ICON_MAP } from '../utils/iconMap';

interface NewChatViewProps {
  agents: Agent[];
  newChatAgentId: string;
  onSelectAgent: (agentId: string) => void;
}

export function NewChatView({
  agents,
  newChatAgentId,
  onSelectAgent,
}: NewChatViewProps) {
  const selectedAgent = agents.find(a => a.id === newChatAgentId);

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="w-full max-w-lg">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg mx-auto"
            style={{
              background: 'linear-gradient(135deg, var(--td-brand-color), var(--td-brand-color-hover))'
            }}
          >
            <span className="text-3xl font-bold text-white">{APP_CONFIG.nameInitial}</span>
          </div>
          <h2
            className="text-2xl font-semibold mb-2"
            style={{ color: 'var(--td-text-color-primary)' }}
          >
            {APP_CONFIG.name}
          </h2>
          <p style={{ color: 'var(--td-text-color-secondary)' }}>
            {APP_CONFIG.description}
          </p>
        </div>

        {/* Agent 选择 */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3" style={{ color: 'var(--td-text-color-primary)' }}>
            选择 Agent
          </label>
          <div className="grid grid-cols-2 gap-3 max-h-[280px] overflow-y-auto">
            {agents.map(agent => {
              const AgentIcon = ICON_MAP[agent.icon || 'Bot'] || Bot;
              const isSelected = agent.id === newChatAgentId;
              return (
                <div
                  key={agent.id}
                  className="p-3 rounded-xl cursor-pointer transition-all border-2"
                  style={{
                    borderColor: isSelected ? (agent.color || 'var(--td-brand-color)') : 'transparent',
                    backgroundColor: isSelected ? 'var(--td-brand-color-light)' : 'var(--td-bg-color-component)',
                  }}
                  onClick={() => onSelectAgent(agent.id)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: agent.color || '#0052d9' }}
                    >
                      <AgentIcon size={20} color="white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--td-text-color-primary)' }}>
                        {agent.name}
                      </div>
                      {agent.description && (
                        <div className="text-xs truncate mt-0.5" style={{ color: 'var(--td-text-color-placeholder)' }}>
                          {agent.description}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 选中的 Agent 预览 */}
        {selectedAgent && (
          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--td-bg-color-component)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              {(() => {
                const Icon = ICON_MAP[selectedAgent.icon || 'Bot'] || Bot;
                return (
                  <>
                    <div
                      className="w-6 h-6 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: selectedAgent.color || '#0052d9' }}
                    >
                      <Icon size={14} color="white" />
                    </div>
                    <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                      {selectedAgent.name}
                    </span>
                  </>
                );
              })()}
            </div>
            <p className="text-xs line-clamp-2" style={{ color: 'var(--td-text-color-secondary)' }}>
              {selectedAgent.systemPrompt || '使用系统内置客服提示词（意图识别 + FAQ 检索 + 转人工）'}
            </p>
          </div>
        )}

        {/* 提示文字 */}
        <p className="text-center text-xs mt-6" style={{ color: 'var(--td-text-color-placeholder)' }}>
          模型可在输入框下方切换
        </p>
      </div>
    </div>
  );
}

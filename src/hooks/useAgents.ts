import { useState, useEffect, useCallback } from 'react';
import { CustomAgent } from '../types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'customAgents';

// 默认的 Agent —— 智能客服（systemPrompt 留空，由后端注入客服提示词）
const DEFAULT_AGENT: CustomAgent = {
  id: 'default',
  name: '智能客服',
  description: '基于 DeepSeek，自动识别用户意图（退款/查询订单/技术支持），检索 FAQ 知识库，无法解决时转人工',
  systemPrompt: '',
  icon: 'Headphones',
  color: '#0052d9',
  createdAt: new Date(),
  updatedAt: new Date(),
};

export function useAgents() {
  const [agents, setAgents] = useState<CustomAgent[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const list = parsed.map((a: any) => ({
            ...a,
            createdAt: new Date(a.createdAt),
            updatedAt: new Date(a.updatedAt),
          }));
          // 新格式：默认客服 Agent 的编辑内容一并持久化；
          // 兼容旧格式（存储中无 default 时补上）
          if (list.some((a: CustomAgent) => a.id === 'default')) return list;
          return [DEFAULT_AGENT, ...list];
        }
      }
    } catch (e) {
      console.error('Failed to load agents:', e);
    }
    return [DEFAULT_AGENT];
  });

  // 保存全部 Agent（含默认客服 Agent 的编辑内容）
  const saveAgents = useCallback((newAgents: CustomAgent[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newAgents));
  }, []);

  const addAgent = useCallback((agent: Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newAgent: CustomAgent = {
      ...agent,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setAgents(prev => {
      const updated = [...prev, newAgent];
      saveAgents(updated);
      return updated;
    });
    return newAgent;
  }, [saveAgents]);

  const updateAgent = useCallback((id: string, updates: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>) => {
    setAgents(prev => {
      const updated = prev.map(a => 
        a.id === id ? { ...a, ...updates, updatedAt: new Date() } : a
      );
      saveAgents(updated);
      return updated;
    });
  }, [saveAgents]);

  const deleteAgent = useCallback((id: string) => {
    if (id === 'default') return; // 默认客服 Agent 不可删除（可编辑）
    setAgents(prev => {
      const updated = prev.filter(a => a.id !== id);
      saveAgents(updated);
      return updated;
    });
  }, [saveAgents]);

  const getAgent = useCallback((id: string) => {
    return agents.find(a => a.id === id);
  }, [agents]);

  return {
    agents,
    addAgent,
    updateAgent,
    deleteAgent,
    getAgent,
    defaultAgent: DEFAULT_AGENT,
  };
}

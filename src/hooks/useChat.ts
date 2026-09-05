import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, ToolCall, Session, CustomAgent, ContentBlock } from '../types';

const STORAGE_KEYS = {
  draftInput: 'draftInput',
};

interface UseChatOptions {
  currentSession: Session | undefined;
  currentSessionId: string | null;
  selectedModel: string;
  getAgent: (id: string) => CustomAgent | undefined;
  updateSessionModel: (sessionId: string, modelId: string) => void;
  setCurrentSessionId: (id: string | null) => void;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
}

interface NewChatOptions {
  agentId: string;
}

export function useChat(options: UseChatOptions) {
  const {
    currentSession,
    currentSessionId,
    selectedModel,
    getAgent,
    updateSessionModel,
    setCurrentSessionId,
    setSessions,
  } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.draftInput) || '';
  });
  const abortRef = useRef<AbortController | null>(null);

  // 保存输入框内容到 localStorage（草稿，发送后清空）
  const saveInput = useCallback((value: string) => {
    setInputValue(value);
    if (value) {
      localStorage.setItem(STORAGE_KEYS.draftInput, value);
    } else {
      localStorage.removeItem(STORAGE_KEYS.draftInput);
    }
  }, []);

  // 发送消息
  const sendMessage = useCallback(async (
    messageContent: string,
    images?: string[],
    newChatOptions?: NewChatOptions,
    onNavigate?: (path: string) => void
  ) => {
    if (!messageContent.trim() || isLoading) return;

    let sessionId = currentSessionId;
    let currentAgentId = currentSession?.agentId || 'default';

    // 如果没有当前会话，使用新对话页面的选项创建新会话
    if (!sessionId && newChatOptions) {
      const newSession: Session = {
        id: uuidv4(),
        title: messageContent.slice(0, 30) + (messageContent.length > 30 ? '...' : ''),
        model: selectedModel,
        agentId: newChatOptions.agentId,
        createdAt: new Date(),
        messages: []
      };

      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      sessionId = newSession.id;
      currentAgentId = newSession.agentId || 'default';

      updateSessionModel(newSession.id, selectedModel);

      onNavigate?.(`/chat/${newSession.id}`);
    }

    const tempUserMessageId = uuidv4();
    const tempAssistantMessageId = uuidv4();

    const userMessage: Message = {
      id: tempUserMessageId,
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
      images: images && images.length > 0 ? images : undefined,
    };

    const assistantMessage: Message = {
      id: tempAssistantMessageId,
      role: 'assistant',
      content: '',
      model: selectedModel,
      timestamp: new Date(),
      isStreaming: true,
      contentBlocks: []
    };

    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        const newTitle = s.messages.length === 0
          ? messageContent.slice(0, 30) + (messageContent.length > 30 ? '...' : '')
          : s.title;
        return {
          ...s,
          title: newTitle,
          messages: [...s.messages, userMessage, assistantMessage]
        };
      }
      return s;
    }));

    saveInput('');
    setIsLoading(true);

    const agent = getAgent(currentAgentId);
    const systemPrompt = agent?.systemPrompt;

    // 以下变量在 SSE 处理闭包中累积，统一通过 syncAssistantState 写回状态
    let fullContent = '';
    let usedModel = selectedModel;
    let currentToolCalls: ToolCall[] = [];
    let contentBlocks: ContentBlock[] = [];
    let currentTextBlock = '';
    let realSessionId = sessionId!;
    let realAssistantMessageId = tempAssistantMessageId;
    let streamError: string | null = null;

    /** 把当前累积的助手消息内容写回 state */
    const syncAssistantState = (extra?: Partial<Message>) => {
      const sessionId = realSessionId;
      const messageId = realAssistantMessageId;
      setSessions(prev => prev.map(s => {
        if (s.id === sessionId) {
          return {
            ...s,
            messages: s.messages.map(m =>
              m.id === messageId
                ? {
                    ...m,
                    content: fullContent,
                    model: usedModel,
                    toolCalls: [...currentToolCalls],
                    contentBlocks: [...contentBlocks],
                    ...extra,
                  }
                : m
            )
          };
        }
        return s;
      }));
    };

    /** 处理单条 SSE 事件（buffer 拆行后调用，保证 data 行完整） */
    const processSseData = (data: any) => {
      if (data.type === 'init') {
        realSessionId = data.sessionId;
        realAssistantMessageId = data.assistantMessageId;
        usedModel = data.model;

        if (realSessionId !== sessionId) {
          const oldId = sessionId;
          setSessions(prev => prev.map(s =>
            s.id === oldId ? { ...s, id: realSessionId } : s
          ));
          setCurrentSessionId(realSessionId);
          sessionId = realSessionId;
        }

        setSessions(prev => prev.map(s => {
          if (s.id === realSessionId) {
            return {
              ...s,
              messages: s.messages.map(m =>
                m.id === tempAssistantMessageId
                  ? { ...m, id: realAssistantMessageId }
                  : m
              )
            };
          }
          return s;
        }));
      } else if (data.type === 'text') {
        fullContent += data.content;
        currentTextBlock += data.content;

        // 更新或创建最后一个文本块
        const lastBlock = contentBlocks[contentBlocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text = currentTextBlock;
        } else if (currentTextBlock) {
          contentBlocks.push({ type: 'text', text: currentTextBlock });
        }
        syncAssistantState();
      } else if (data.type === 'tool') {
        // 如果有累积的文本，先结束当前文本块
        currentTextBlock = '';

        const toolCall: ToolCall = {
          id: data.id || uuidv4(),
          name: data.name,
          input: data.input,
          status: 'running'
        };
        currentToolCalls.push(toolCall);
        contentBlocks.push({ type: 'tool_use', toolCall });
        syncAssistantState();
      } else if (data.type === 'tool_result') {
        const toolId = data.toolId;
        const toolIndex = toolId
          ? currentToolCalls.findIndex(t => t.id === toolId)
          : currentToolCalls.length - 1;

        if (toolIndex >= 0) {
          currentToolCalls[toolIndex].status = data.isError ? 'error' : 'completed';
          currentToolCalls[toolIndex].isError = data.isError || false;
          currentToolCalls[toolIndex].result = typeof data.content === 'string'
            ? data.content
            : JSON.stringify(data.content);

          // 同步更新 contentBlocks 中对应的工具调用
          const blockIndex = contentBlocks.findIndex(
            b => b.type === 'tool_use' && b.toolCall.id === currentToolCalls[toolIndex].id
          );
          if (blockIndex >= 0) {
            (contentBlocks[blockIndex] as { type: 'tool_use'; toolCall: ToolCall }).toolCall = { ...currentToolCalls[toolIndex] };
          }
          syncAssistantState();
        }
      } else if (data.type === 'done') {
        syncAssistantState({ isStreaming: false });
      } else if (data.type === 'error') {
        // 服务端错误（如 API Key 未配置、模型调用失败）：结束流式并在消息中提示
        streamError = data.message || '未知错误';
        const errorText = `抱歉，处理您的请求时出错：${streamError}`;
        if (fullContent) {
          fullContent = `${fullContent}\n\n---\n\n⚠️ ${errorText}`;
        } else {
          fullContent = errorText;
        }
        // 末尾文本块同步更新，避免 contentBlocks 与 content 不一致
        const lastBlock = contentBlocks[contentBlocks.length - 1];
        if (lastBlock && lastBlock.type === 'text') {
          lastBlock.text = currentTextBlock = fullContent;
        } else if (!contentBlocks.length) {
          contentBlocks.push({ type: 'text', text: currentTextBlock = fullContent });
        }
        syncAssistantState({ isStreaming: false });
      }
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: messageContent,
          images: images && images.length > 0 ? images : undefined,
          model: selectedModel,
          systemPrompt,
        }),
        signal: controller.signal,
      });

      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        // 缓冲半行：一条 data: 事件可能被网络分包截断，必须拼齐再解析
        let buffer = '';

        const handleLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) return;
          try {
            processSseData(JSON.parse(trimmed.slice(6)));
          } catch {
            // 忽略解析错误
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            handleLine(line);
          }
        }
        if (buffer) {
          handleLine(buffer);
        }
      }

      // 流结束兜底：若未收到 done/error（连接中断等），复位流式状态
      if (realAssistantMessageId) {
        setSessions(prev => prev.map(s => {
          if (s.id === realSessionId) {
            return {
              ...s,
              messages: s.messages.map(m =>
                m.id === realAssistantMessageId && m.isStreaming
                  ? { ...m, isStreaming: false, content: m.content || '（回复被中断）' }
                  : m
              )
            };
          }
          return s;
        }));
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // 用户主动停止：保留已生成的部分内容
        setSessions(prev => prev.map(s => {
          if (s.id === sessionId) {
            return {
              ...s,
              messages: s.messages.map(m =>
                m.id === tempAssistantMessageId
                  ? { ...m, isStreaming: false, content: m.content || '（已停止生成）' }
                  : m
              )
            };
          }
          return s;
        }));
      } else {
        console.error('Chat error:', error);
        setSessions(prev => prev.map(s => {
          if (s.id === sessionId) {
            return {
              ...s,
              messages: s.messages.map(m =>
                m.id === tempAssistantMessageId
                  ? { ...m, content: '发生错误，请重试', isStreaming: false }
                  : m
              )
            };
          }
          return s;
        }));
      }
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }, [currentSession, currentSessionId, selectedModel, getAgent, updateSessionModel, setCurrentSessionId, setSessions, isLoading, saveInput]);

  // 处理停止事件：中止请求，服务端检测到断开后也会保存部分回复
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  return {
    isLoading,
    inputValue,
    setInputValue: saveInput,
    sendMessage,
    handleStop,
  };
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Model, Session, CustomAgent } from '../types';
import { NewChatView } from '../components/NewChatView';
import { ChatMessages } from '../components/ChatMessages';
import { ChatInput } from '../components/ChatInput';

interface ChatPageProps {
  currentSession: Session | undefined;
  models: Model[];
  selectedModel: string;
  agents: CustomAgent[];
  isLoading: boolean;
  inputValue: string;
  onSendMessage: (message: string, images?: string[], newChatOptions?: NewChatOptions, onNavigate?: (path: string) => void) => void;
  onStop: () => void;
  onInputChange: (value: string) => void;
  onModelChange: (modelId: string) => void;
  onRefreshMessages: (sessionId: string) => void;
}

interface NewChatOptions {
  agentId: string;
}

export function ChatPage({
  currentSession,
  models,
  selectedModel,
  agents,
  isLoading,
  inputValue,
  onSendMessage,
  onStop,
  onInputChange,
  onModelChange,
  onRefreshMessages,
}: ChatPageProps) {
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 新对话页面状态
  const [newChatAgentId, setNewChatAgentId] = useState('default');

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);

  // 处理发送消息
  const handleSend = useCallback((message: string, images?: string[]) => {
    if (!currentSession) {
      // 新对话
      onSendMessage(message, images, {
        agentId: newChatAgentId,
      }, (path) => {
        // 重置新对话选项
        setNewChatAgentId('default');
        navigate(path);
      });
    } else {
      onSendMessage(message, images);
    }
  }, [currentSession, newChatAgentId, onSendMessage, navigate]);

  const showNewChatView = !currentSession || currentSession.messages.length === 0;

  return (
    <>
      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {showNewChatView ? (
          <NewChatView
            agents={agents}
            newChatAgentId={newChatAgentId}
            onSelectAgent={setNewChatAgentId}
          />
        ) : (
          <ChatMessages
            messages={currentSession!.messages}
            models={models}
            messagesEndRef={messagesEndRef}
            sessionId={currentSession.id}
            onRefreshMessages={onRefreshMessages}
          />
        )}
      </div>

      {/* 输入区域 */}
      <ChatInput
        inputValue={inputValue}
        selectedModel={selectedModel}
        models={models}
        isLoading={isLoading}
        onSend={handleSend}
        onStop={onStop}
        onChange={onInputChange}
        onModelChange={onModelChange}
      />
    </>
  );
}

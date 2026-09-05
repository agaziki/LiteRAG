import { useState, useEffect } from 'react';
import { Loading } from 'tdesign-react';
import { ChatMarkdown } from '@tdesign-react/chat';
import { User, Bot } from 'lucide-react';
import { Message, Model, ContentBlock } from '../types';
import { ToolCallsCollapse } from './ToolCallsCollapse';
import { RatingStars } from './RatingStars';
import { EscalationBanner } from './EscalationBanner';

interface ChatMessagesProps {
  messages: Message[];
  models: Model[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  sessionId?: string;
}

export function ChatMessages({
  messages,
  models,
  messagesEndRef,
  sessionId,
}: ChatMessagesProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  // 图片灯箱预览
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 当最后一条消息流式结束时（或会话切换时），刷新转人工状态
  const lastMsg = messages[messages.length - 1];
  useEffect(() => {
    if (!sessionId || messages.length === 0) return;
    // 流式中、或加载完成时都触发刷新（流式中 isStreaming 为 true，跳过）
    if (!lastMsg?.isStreaming) {
      setRefreshKey(k => k + 1);
    }
  }, [sessionId, messages.length, lastMsg?.isStreaming]);

  const formatModelName = (modelId: string) => {
    const model = models.find(m => m.modelId === modelId);
    const name = model?.name || modelId;
    return name
      .replace(/^(Claude|GPT|Gemini|Kimi|DeepSeek|Qwen|GLM)\s*/i, '')
      .replace(/-/g, ' ')
      .trim() || name;
  };

  // 渲染单个内容块
  const renderContentBlock = (block: ContentBlock, index: number, isStreaming?: boolean, isLast?: boolean) => {
    if (block.type === 'text') {
      return (
        <div 
          key={`text-${index}`}
          className="px-4 py-3 leading-relaxed break-words"
          style={{
            backgroundColor: 'var(--td-bg-color-component)',
            color: 'var(--td-text-color-primary)',
            borderRadius: '16px 16px 16px 4px'
          }}
        >
          <div className="chat-markdown">
            <ChatMarkdown content={block.text} />
          </div>
          {isStreaming && isLast && (
            <span 
              className="animate-cursor-blink ml-0.5"
              style={{ color: 'var(--td-brand-color)' }}
            >
              |
            </span>
          )}
        </div>
      );
    } else if (block.type === 'tool_use') {
      return (
        <ToolCallsCollapse
          key={`tool-${block.toolCall.id}`}
          toolCalls={[block.toolCall]}
          isStreaming={isStreaming && block.toolCall.status === 'running'}
        />
      );
    }
    return null;
  };

  // 渲染 assistant 消息内容
  const renderAssistantContent = (message: Message) => {
    // 优先使用 contentBlocks（按顺序排列）
    if (message.contentBlocks && message.contentBlocks.length > 0) {
      return message.contentBlocks.map((block, index) => 
        renderContentBlock(block, index, message.isStreaming, index === message.contentBlocks!.length - 1)
      );
    }
    
    // 兼容旧数据：先显示所有工具调用，再显示文本
    return (
      <>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallsCollapse
            toolCalls={message.toolCalls}
            isStreaming={message.isStreaming}
          />
        )}
        {message.content && (
          <div 
            className="px-4 py-3 leading-relaxed break-words"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              borderRadius: '16px 16px 16px 4px'
            }}
          >
            <div className="chat-markdown">
              <ChatMarkdown content={message.content} />
            </div>
            {message.isStreaming && (
              <span 
                className="animate-cursor-blink ml-0.5"
                style={{ color: 'var(--td-brand-color)' }}
              >
                |
              </span>
            )}
          </div>
        )}
      </>
    );
  };

  // 最后一条已完成的助手消息（用于显示满意度评价）
  const lastAssistantId = [...messages].reverse().find(
    m => m.role === 'assistant' && !m.isStreaming
  )?.id;

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      {messages.map(message => (
        <div 
          key={message.id} 
          className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
        >
          <div 
            className="w-9 h-9 flex items-center justify-center flex-shrink-0 rounded-full self-start"
            style={{
              backgroundColor: message.role === 'user' 
                ? 'var(--td-brand-color)' 
                : 'var(--td-bg-color-component)',
              color: message.role === 'user' 
                ? 'white' 
                : 'var(--td-text-color-primary)'
            }}
          >
            {message.role === 'user' ? <User size={18} /> : <Bot size={18} />}
          </div>
          <div 
            className={`flex flex-col gap-2 max-w-[80%] ${message.role === 'user' ? 'items-end' : ''}`}
          >
            {message.role === 'assistant' && message.model && (
              <span 
                className="text-xs"
                style={{ color: 'var(--td-text-color-placeholder)' }}
              >
                {formatModelName(message.model)}
              </span>
            )}
            
            {/* 用户消息：图片 + 文本 */}
            {message.role === 'user' && (
              <div className="flex flex-col items-end gap-1">
                {message.images && message.images.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {message.images.map((img, i) => (
                      <img
                        key={i}
                        src={img}
                        alt={`图片 ${i + 1}`}
                        className="max-h-44 max-w-[240px] object-cover rounded-xl cursor-zoom-in border"
                        style={{ borderColor: 'var(--td-component-border)' }}
                        onClick={() => setPreviewImage(img)}
                      />
                    ))}
                  </div>
                )}
                {message.content && (
                  <div
                    className="px-4 py-3 leading-relaxed break-words"
                    style={{
                      backgroundColor: 'var(--td-brand-color)',
                      color: 'white',
                      borderRadius: '16px 16px 4px 16px'
                    }}
                  >
                    {message.content}
                  </div>
                )}
              </div>
            )}
            
            {/* 助手消息 - 按顺序渲染内容块 */}
            {message.role === 'assistant' && renderAssistantContent(message)}
            
            {/* 思考中状态（没有任何内容时显示） */}
            {message.role === 'assistant' && message.isStreaming && 
             !message.content && 
             (!message.contentBlocks || message.contentBlocks.length === 0) && 
             (!message.toolCalls || message.toolCalls.length === 0) && (
              <div 
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ backgroundColor: 'var(--td-bg-color-component)' }}
              >
                <Loading size="small" />
                <span 
                  className="text-sm"
                  style={{ color: 'var(--td-text-color-secondary)' }}
                >
                  思考中...
                </span>
              </div>
            )}

            {/* 满意度评价 - 仅在最后一条已完成的助手消息上显示 */}
            {message.role === 'assistant' && 
             message.id === lastAssistantId && 
             sessionId && (
              <RatingStars sessionId={sessionId} messageId={message.id} />
            )}
          </div>
        </div>
      ))}
      
      {/* 转人工提示横幅 */}
      {sessionId && messages.length > 0 && (
        <div className="max-w-3xl mx-auto w-full ml-12">
          <EscalationBanner sessionId={sessionId} refreshKey={refreshKey} />
        </div>
      )}

      <div ref={messagesEndRef} />

      {/* 图片灯箱 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[3000] flex items-center justify-center cursor-zoom-out"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="预览"
            className="max-w-[92vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

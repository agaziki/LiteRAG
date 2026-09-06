import { useState } from 'react';
import { Loading } from 'tdesign-react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleFilledIcon,
  CloseCircleFilledIcon,
} from 'tdesign-icons-react';
import { Search, UserCheck, Tag, Brain, Wrench } from 'lucide-react';
import { ToolCall } from '../types';

interface ToolCallsCollapseProps {
  toolCalls: ToolCall[];
  isStreaming?: boolean;
}

const INTENT_LABELS: Record<string, string> = {
  refund: '退款',
  order: '查询订单',
  tech: '技术支持',
  general: '通用咨询',
  other: '其他',
};

interface StepView {
  icon: typeof Search;
  color: string;
  /** 人类可读的动作描述（思考链主干） */
  action: string;
  /** 人类可读的结果摘要（完成态展示） */
  result?: string;
  /** 原始参数/结果（默认折叠，调试用） */
  raw?: string;
  error?: boolean;
}

/** 把工具调用与结果翻译成人类可读的思考链步骤 */
function toStepView(call: ToolCall): StepView {
  const input = (call.input || {}) as Record<string, unknown>;
  let parsedResult: any = null;
  if (call.result) {
    try { parsedResult = JSON.parse(call.result); } catch { parsedResult = null; }
  }

  switch (call.name) {
    case 'search_faq': {
      const query = String(input.query || '');
      const count = parsedResult?.count;
      let result: string | undefined;
      if (call.status === 'completed' && parsedResult) {
        const results = Array.isArray(parsedResult.results) ? parsedResult.results : [];
        result = count > 0
          ? `命中 ${count} 条：${results.slice(0, 2).map((r: any) => r.question).join('；')}${count > 2 ? ' 等' : ''}`
          : '未检索到相关内容，将基于常识回答并建议转人工';
      }
      return {
        icon: Search,
        color: 'var(--td-brand-color)',
        action: query ? `检索知识库：“${query}”` : '检索知识库',
        result,
        raw: JSON.stringify({ 输入: input, 输出: parsedResult ?? call.result }, null, 2),
        error: call.status === 'error',
      };
    }
    case 'record_intent': {
      const intent = INTENT_LABELS[String(input.intent)] || String(input.intent || '');
      const confidence = input.confidence ? `（置信度：${input.confidence}）` : '';
      return {
        icon: Tag,
        color: '#7b61ff',
        action: `识别用户意图：${intent}${confidence}`,
        result: call.status === 'completed' ? '已记录' : undefined,
        raw: JSON.stringify({ 输入: input, 输出: parsedResult ?? call.result }, null, 2),
        error: call.status === 'error',
      };
    }
    case 'escalate_to_human': {
      const reason = String(input.reason || '用户需要人工服务');
      const intent = input.intent ? INTENT_LABELS[String(input.intent)] || String(input.intent) : '';
      return {
        icon: UserCheck,
        color: '#e37318',
        action: `转接人工客服：${reason}${intent ? `（意图：${intent}）` : ''}`,
        result: call.status === 'completed' ? '已创建转人工工单，等待人工接入' : undefined,
        raw: JSON.stringify({ 输入: input, 输出: parsedResult ?? call.result }, null, 2),
        error: call.status === 'error',
      };
    }
    default: {
      // 未知工具的通用回退
      const inputSummary = Object.entries(input)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v)?.slice(0, 40)}`)
        .join('，');
      return {
        icon: Wrench,
        color: 'var(--td-text-color-secondary)',
        action: `调用工具 ${call.name}${inputSummary ? `：${inputSummary}` : ''}`,
        result: call.status === 'completed' && parsedResult?.success !== undefined ? '已完成' : undefined,
        raw: JSON.stringify({ 输入: input, 输出: parsedResult ?? call.result }, null, 2),
        error: call.status === 'error',
      };
    }
  }
}

export function ToolCallsCollapse({ toolCalls, isStreaming = false }: ToolCallsCollapseProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const running = toolCalls.some(t => t.status === 'running');
  const hasError = toolCalls.some(t => t.status === 'error');
  const stepViews = toolCalls.map(toStepView);

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: hasError ? 'rgba(228, 77, 91, 0.3)' : 'var(--td-component-border)',
        backgroundColor: 'var(--td-bg-color-page)',
      }}
    >
      {/* 折叠头部：思考过程摘要 */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
        onClick={() => setIsExpanded(v => !v)}
      >
        {running ? (
          <Loading size="small" />
        ) : hasError ? (
          <CloseCircleFilledIcon size="16px" style={{ color: 'var(--td-error-color)' }} />
        ) : (
          <CheckCircleFilledIcon size="16px" style={{ color: 'var(--td-success-color)' }} />
        )}
        <span className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--td-text-color-secondary)' }}>
          <Brain size={12} />
          {running ? '正在思考…' : '思考过程'}
        </span>
        <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
          {stepViews.length} 个步骤
          {isStreaming && running ? '，执行中' : ''}
        </span>
        <span className="ml-auto" style={{ color: 'var(--td-text-color-placeholder)' }}>
          {isExpanded ? <ChevronUpIcon size="14px" /> : <ChevronDownIcon size="14px" />}
        </span>
      </div>

      {/* 展开：思考链时间线 */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <div className="relative pl-5">
            {/* 时间线竖线 */}
            <div
              className="absolute left-[7px] top-2 bottom-2 w-px"
              style={{ backgroundColor: 'var(--td-component-border)' }}
            />
            {stepViews.map((step, idx) => {
              const Icon = step.icon;
              const isStepRunning = toolCalls[idx]?.status === 'running';
              const isStepError = step.error;
              return (
                <div key={toolCalls[idx]?.id || idx} className="relative py-1.5">
                  {/* 节点圆点 */}
                  <div
                    className="absolute -left-5 top-2.5 w-[15px] h-[15px] rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'var(--td-bg-color-page)' }}
                  >
                    {isStepRunning ? (
                      <Loading size="12px" />
                    ) : isStepError ? (
                      <CloseCircleFilledIcon size="14px" style={{ color: 'var(--td-error-color)' }} />
                    ) : (
                      <CheckCircleFilledIcon size="14px" style={{ color: 'var(--td-success-color)' }} />
                    )}
                  </div>
                  <div className="flex items-start gap-1.5">
                    <Icon size={13} style={{ color: step.color, marginTop: 2, flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs leading-5" style={{ color: 'var(--td-text-color-primary)' }}>
                        {step.action}
                      </div>
                      {step.result && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--td-text-color-secondary)' }}>
                          → {step.result}
                        </div>
                      )}
                      {isStepError && toolCalls[idx]?.result && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--td-error-color)' }}>
                          → 执行失败
                        </div>
                      )}
                      {/* 原始数据（默认折叠） */}
                      {step.raw && (
                        <details className="mt-1">
                          <summary
                            className="text-xs cursor-pointer select-none"
                            style={{ color: 'var(--td-text-color-placeholder)' }}
                          >
                            原始数据
                          </summary>
                          <pre
                            className="text-[11px] mt-1 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap break-all"
                            style={{
                              backgroundColor: 'var(--td-bg-color-component)',
                              color: 'var(--td-text-color-secondary)',
                            }}
                          >
                            {step.raw}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useCallback, useEffect } from 'react';
import { Button, Textarea, MessagePlugin } from 'tdesign-react';
import { Star } from 'lucide-react';

interface RatingStarsProps {
  sessionId: string;
  messageId?: string;
  /** 已提交的评价（从后端加载），如果有则展示只读 */
  initialRating?: number;
  initialComment?: string;
}

interface RatingState {
  rating: number;
  comment: string;
  submitted: boolean;
}

export function RatingStars({ sessionId, messageId, initialRating, initialComment }: RatingStarsProps) {
  const [hoverRating, setHoverRating] = useState(0);
  const [state, setState] = useState<RatingState>({
    rating: initialRating || 0,
    comment: initialComment || '',
    submitted: !!initialRating,
  });
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 挂载时查询该消息是否已有评价（防止刷新后重复评价）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ratings/${sessionId}`);
        const data = await res.json();
        if (cancelled || !Array.isArray(data.ratings)) return;
        const mine = messageId
          ? data.ratings.find((r: any) => r.message_id === messageId)
          : data.ratings[data.ratings.length - 1];
        if (mine) {
          setState({ rating: mine.rating, comment: mine.comment || '', submitted: true });
        }
      } catch {
        // 静默失败：未查询到时保持可评价状态
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, messageId]);

  const handleSubmit = useCallback(async (rating: number, comment: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messageId, rating, comment: comment || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setState({ rating, comment, submitted: true });
        setExpanded(false);
        MessagePlugin.success('感谢您的评价！');
      } else {
        MessagePlugin.error(data.error || '提交失败');
      }
    } catch (e) {
      MessagePlugin.error('网络错误，提交失败');
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, messageId, submitting]);

  const handleClick = useCallback((star: number) => {
    if (state.submitted) return;
    setState(prev => ({ ...prev, rating: star }));
    setExpanded(true);
  }, [state.submitted]);

  const labels = ['', '很差', '较差', '一般', '满意', '非常满意'];
  const current = hoverRating || state.rating;

  return (
    <div
      className="mt-2 p-2.5 rounded-lg"
      style={{ backgroundColor: 'var(--td-bg-color-page)' }}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-xs"
          style={{ color: 'var(--td-text-color-secondary)' }}
        >
          {state.submitted ? '您已评价' : '本次回答对您有帮助吗？'}
        </span>
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map(star => (
            <button
              key={star}
              type="button"
              disabled={state.submitted || submitting}
              onMouseEnter={() => !state.submitted && setHoverRating(star)}
              onMouseLeave={() => !state.submitted && setHoverRating(0)}
              onClick={() => handleClick(star)}
              className="p-0.5 disabled:cursor-default"
              style={{
                background: 'none',
                border: 'none',
                cursor: state.submitted ? 'default' : 'pointer',
              }}
              aria-label={`${star} 星`}
            >
              <Star
                size={16}
                fill={star <= current ? '#f5a623' : 'none'}
                color={star <= current ? '#f5a623' : 'var(--td-text-color-placeholder)'}
              />
            </button>
          ))}
        </div>
        {current > 0 && (
          <span
            className="text-xs ml-1"
            style={{ color: 'var(--td-text-color-secondary)' }}
          >
            {labels[current]}
          </span>
        )}
      </div>

      {expanded && !state.submitted && (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            value={state.comment}
            onChange={(v) => setState(prev => ({ ...prev, comment: typeof v === 'string' ? v : String(v) }))}
            placeholder="补充您的反馈（可选）"
            autosize={{ minRows: 2, maxRows: 4 }}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setExpanded(false);
                setState(prev => ({ ...prev, rating: 0, comment: '' }));
              }}
            >
              取消
            </Button>
            <Button
              size="small"
              theme="primary"
              loading={submitting}
              onClick={() => handleSubmit(state.rating, state.comment)}
            >
              提交评价
            </Button>
          </div>
        </div>
      )}

      {state.submitted && state.comment && (
        <div
          className="mt-1.5 text-xs px-2 py-1 rounded"
          style={{
            color: 'var(--td-text-color-secondary)',
            backgroundColor: 'var(--td-bg-color-container)',
          }}
        >
          "{state.comment}"
        </div>
      )}
    </div>
  );
}

import { useRef, useCallback, useState } from 'react';
import { Select, MessagePlugin } from 'tdesign-react';
import { ChatSender } from '@tdesign-react/chat';
import { ChevronDownIcon, ImageIcon, CloseCircleFilledIcon } from 'tdesign-icons-react';
import { Model } from '../types';

interface ChatInputProps {
  inputValue: string;
  selectedModel: string;
  models: Model[];
  isLoading: boolean;
  onSend: (message: string, images?: string[]) => void;
  onStop: () => void;
  onChange: (value: string) => void;
  onModelChange: (modelId: string) => void;
}

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ChatInput({
  inputValue,
  selectedModel,
  models,
  isLoading,
  onSend,
  onStop,
  onChange,
  onModelChange,
}: ChatInputProps) {
  const chatSenderRef = useRef<any>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const modelSupportsVision = selectedModel.includes('vision');

  const addImages = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next = [...pendingImages];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_IMAGES) {
        MessagePlugin.warning(`最多上传 ${MAX_IMAGES} 张图片`);
        break;
      }
      if (!file.type.startsWith('image/')) {
        MessagePlugin.warning(`不支持的文件类型：${file.name}`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        MessagePlugin.warning(`图片超过 5MB：${file.name}`);
        continue;
      }
      try {
        next.push(await readAsDataURL(file));
      } catch {
        MessagePlugin.error(`读取图片失败：${file.name}`);
      }
    }
    setPendingImages(next);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }, [pendingImages]);

  const removeImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback((e: any) => {
    const content = e?.detail?.message || e?.detail || e?.message || inputValue;
    if (content && typeof content === 'string' && content.trim() && selectedModel) {
      onSend(content.trim(), pendingImages.length > 0 ? pendingImages : undefined);
      setPendingImages([]);
    } else if (inputValue.trim() && selectedModel) {
      onSend(inputValue.trim(), pendingImages.length > 0 ? pendingImages : undefined);
      setPendingImages([]);
    }
  }, [inputValue, selectedModel, pendingImages, onSend]);

  const handleChange = useCallback((e: any) => {
    const value = e?.detail ?? e ?? '';
    onChange(typeof value === 'string' ? value : '');
  }, [onChange]);

  return (
    <div
      className="px-4 pb-6 pt-4"
      style={{
        backgroundColor: 'var(--td-bg-color-page)'
      }}
    >
      <div className="max-w-3xl mx-auto">
        {/* 待发送图片预览 */}
        {pendingImages.length > 0 && (
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative">
                <img
                  src={img}
                  alt={`待发送图片 ${i + 1}`}
                  className="w-16 h-16 object-cover rounded-lg border"
                  style={{ borderColor: 'var(--td-component-border)' }}
                />
                <CloseCircleFilledIcon
                  size="18px"
                  className="absolute cursor-pointer"
                  style={{ top: -6, right: -6, color: 'var(--td-text-color-secondary)' }}
                  onClick={() => removeImage(i)}
                />
              </div>
            ))}
          </div>
        )}
        {!modelSupportsVision && pendingImages.length > 0 && (
          <div className="text-xs mb-2" style={{ color: 'var(--td-warning-color)' }}>
            当前模型可能不支持图片输入，建议切换到 DeepSeek V4-Flash Vision 模型
          </div>
        )}
        <ChatSender
          ref={chatSenderRef}
          value={inputValue}
          placeholder="输入消息...（可附带图片询问）"
          disabled={!selectedModel}
          loading={isLoading}
          autosize={{ minRows: 1, maxRows: 6 }}
          actions={['send']}
          onSend={handleSend}
          onStop={onStop}
          onChange={handleChange}
        >
          {/* 模型选择器与图片按钮放在 footer-prefix 插槽 */}
          <div slot="footer-prefix" className="flex items-center gap-2">
            <Select
              value={selectedModel}
              onChange={(value) => onModelChange(value as string)}
              placeholder="选择模型"
              size="small"
              style={{ width: 160 }}
              filterable
              borderless
              suffixIcon={<ChevronDownIcon />}
            >
              {models.map(model => (
                <Select.Option key={model.modelId} value={model.modelId} label={model.name} />
              ))}
            </Select>
            {/* 图片上传（视觉模型） */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => addImages(e.target.files)}
            />
            <ImageIcon
              size="18px"
              className="cursor-pointer"
              style={{ color: pendingImages.length > 0 ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)' }}
              onClick={() => imageInputRef.current?.click()}
            />
          </div>
        </ChatSender>
      </div>
    </div>
  );
}

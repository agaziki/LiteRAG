import { useRef, useCallback, useState, useEffect } from 'react';
import { Select, MessagePlugin } from 'tdesign-react';
import { ChatSender } from '@tdesign-react/chat';
import { ChevronDownIcon, CloseCircleFilledIcon } from 'tdesign-icons-react';
import { ImagePlus } from 'lucide-react';
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [fetchingImage, setFetchingImage] = useState(false);
  const dragDepth = useRef(0);
  // 仅视觉模型显示图片按钮（deepseek-v4-flash-vision-exp 等）
  const isVisionModel = selectedModel.includes('vision');

  const addImages = useCallback(async (files: FileList | File[] | null) => {
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

  // 网页图片拖拽：URL 经服务端抓取转为 data URL（浏览器跨域限制需中转）
  const fetchRemoteImage = useCallback(async (url: string) => {
    if (pendingImages.length >= MAX_IMAGES) {
      MessagePlugin.warning(`最多上传 ${MAX_IMAGES} 张图片`);
      return;
    }
    setFetchingImage(true);
    try {
      const res = await fetch('/api/utils/fetch-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.dataUrl) {
        setPendingImages(prev => (prev.length >= MAX_IMAGES ? prev : [...prev, data.dataUrl]));
        MessagePlugin.success('网页图片已添加');
      } else {
        MessagePlugin.error(data.error || '网页图片获取失败');
      }
    } catch {
      MessagePlugin.error('网页图片获取失败');
    } finally {
      setFetchingImage(false);
    }
  }, [pendingImages.length]);

  // 拖拽数据处理：优先文件，其次网页图片（从 uri-list / html 中提取图片 URL）
  const handleDropData = useCallback(async (dt: DataTransfer) => {
    if (!isVisionModel) {
      MessagePlugin.warning('当前模型不支持图片，请切换到 DeepSeek V4-Flash Vision');
      return;
    }
    if (dt.files && dt.files.length > 0) {
      await addImages(dt.files);
      return;
    }
    const uriList = dt.getData('text/uri-list');
    const html = dt.getData('text/html');
    let url = '';
    if (uriList) url = uriList.split(/\r?\n/).find(l => l.trim() && !l.trim().startsWith('#')) || '';
    if (!url && html) {
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) url = m[1];
    }
    if (!url) {
      MessagePlugin.warning('未检测到图片，仅支持拖入图片文件或网页图片');
      return;
    }
    await fetchRemoteImage(url.trim());
  }, [isVisionModel, addImages, fetchRemoteImage]);

  // 粘贴图片上传（截图后直接 Ctrl+V）
  useEffect(() => {
    if (!isVisionModel) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        addImages(imageFiles);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [isVisionModel, addImages]);

  const removeImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 切换到非视觉模型时清空待发图片，避免无效发送
  const handleModelChange = useCallback((modelId: string) => {
    onModelChange(modelId);
    if (!modelId.includes('vision') && pendingImages.length > 0) {
      setPendingImages([]);
      MessagePlugin.warning('当前模型不支持图片，已清空待发送图片');
    }
  }, [pendingImages.length, onModelChange]);

  const handleSend = useCallback((e: any) => {
    const content = e?.detail?.message || e?.detail || e?.message || inputValue;
    const hasImages = pendingImages.length > 0;
    if (content && typeof content === 'string' && content.trim() && selectedModel) {
      onSend(content.trim(), hasImages ? pendingImages : undefined);
      setPendingImages([]);
    } else if (inputValue.trim() && selectedModel) {
      onSend(inputValue.trim(), hasImages ? pendingImages : undefined);
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
        {/* 工具栏：模型选择 + 图片按钮（普通 DOM 渲染，确保交互可靠） */}
        <div className="flex items-center gap-3 mb-1.5">
          <Select
            value={selectedModel}
            onChange={(value) => handleModelChange(value as string)}
            placeholder="选择模型"
            size="small"
            style={{ width: 170 }}
            filterable
            borderless
            suffixIcon={<ChevronDownIcon />}
          >
            {models.map(model => (
              <Select.Option key={model.modelId} value={model.modelId} label={model.name} />
            ))}
          </Select>
          {/* 图片按钮：仅视觉模型显示 */}
          {isVisionModel && (
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => addImages(e.target.files)}
            />
          )}
          {isVisionModel && (
            <button
              type="button"
              title="添加图片：点击选择、拖拽到此处、或截图后 Ctrl+V 粘贴（最多 4 张，单张 ≤5MB）"
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border-0 bg-transparent cursor-pointer"
              style={{ color: pendingImages.length > 0 ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)' }}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus size={15} />
              图片
            </button>
          )}
        </div>

        {/* 拖拽上传区（含输入框整体；同时支持文件拖拽与网页图片拖拽） */}
        <div
          className="rounded-xl transition-all"
          style={isDragging ? {
            border: '2px dashed var(--td-brand-color)',
            backgroundColor: 'var(--td-brand-color-light)',
            padding: 2,
          } : { border: '2px dashed transparent' }}
          onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setIsDragging(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => { dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setIsDragging(false); } }}
          onDrop={async (e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setIsDragging(false);
            await handleDropData(e.dataTransfer);
          }}
        >
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
          {isDragging && (
            <div
              className="text-center text-sm py-3 mb-2 rounded-lg"
              style={{ color: 'var(--td-brand-color)', backgroundColor: 'var(--td-brand-color-light)' }}
            >
              松开以添加图片（{fetchingImage ? '正在获取网页图片…' : '支持本地图片与网页图片'}）
            </div>
          )}

          <ChatSender
            value={inputValue}
            placeholder="输入消息..."
            disabled={!selectedModel}
            loading={isLoading}
            autosize={{ minRows: 1, maxRows: 6 }}
            actions={['send']}
            onSend={handleSend}
            onStop={onStop}
            onChange={handleChange}
          />
        </div>
      </div>
    </div>
  );
}

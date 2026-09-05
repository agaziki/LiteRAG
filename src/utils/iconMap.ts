import { 
  Bot, 
  Code, 
  Globe,
  Sparkles,
  FileText,
  Lightbulb,
  Headphones,
  HeartPulse,
  ShoppingBag,
  Wrench
} from 'lucide-react';

// Icon 映射（size 接受 number|string 以兼容 lucide-react 图标类型）
export const ICON_MAP: Record<string, React.ComponentType<{ size?: number | string; color?: string }>> = {
  Bot,
  Sparkles,
  Code,
  FileText,
  Globe,
  Lightbulb,
  Headphones,
  HeartPulse,
  ShoppingBag,
  Wrench,
};

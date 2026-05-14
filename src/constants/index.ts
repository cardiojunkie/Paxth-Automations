// Shared constants — extraction strategies, default presets, and log color map

import type { ExtractionStrategy, LogType, SelectorPreset, PlpPreset } from '../types';

export const EXTRACTION_STRATEGIES: { value: ExtractionStrategy; label: string }[] = [
  { value: 'LLMExtractionStrategy', label: 'Advanced AI (Dormant)' },
  { value: 'GroqExtractionStrategy', label: 'Llama-3 (Fast Batch)' },
  { value: 'JsonLdExtractionStrategy', label: 'JSON-LD Meta' },
  { value: 'WholeCaptureStrategy', label: 'Whole Capture' },
];

export const DEFAULT_SELECTOR_PRESETS: SelectorPreset[] = [
  {
    name: 'Amazon Global Profile',
    selector:
      'link[rel="canonical"], #titleSection, #corePriceDisplay_desktop_feature_div, #productOverview_feature_div, #feature-bullets, #productDetails_feature_div, #altImages',
    strategy: 'LLMExtractionStrategy',
  },
];

export const DEFAULT_PLP_PRESETS: PlpPreset[] = [
  { name: 'Standard Product List', selector: '.product-item a, .product-card a' },
];

export const LOG_COLOR_MAP: Record<LogType, string> = {
  system: 'text-blue-500',
  debug: 'text-white/40',
  success: 'text-green-500',
  action: 'text-white/90',
  network: 'text-white/40',
  wait: 'text-yellow-500',
  skill: 'text-blue-400',
  error: 'text-red-500',
};

export const GROQ_AI_MODELS = [
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
  { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  { value: 'gemma2-9b-it', label: 'Gemma 2 9B' },
];

export const BATCH_CONCURRENCY = 5;
export const MAX_IMAGE_SELECTION = 10;

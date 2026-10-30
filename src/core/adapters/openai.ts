// Backward-compatible OpenAI adapter built from the shared provider config.
import { getProviderConfig } from '../providers.ts'
import { createOpenAICompatibleAdapter } from './openai-compatible.ts'

const appOrigin = typeof window === 'undefined' ? '' : window.location.origin

export const openAIAdapter = createOpenAICompatibleAdapter(
  getProviderConfig('openai'),
  appOrigin,
)

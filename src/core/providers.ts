// Approved providers; keep the Edge Function copy in sync.
export const APP_ORIGIN_HEADER = '$APP_ORIGIN'

export const PROVIDER_CONFIGS = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModel: '',
    extraHeaders: {},
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    openAICompatible: true,
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#000" d="M16 2c7.732 0 14 6.268 14 14s-6.268 14-14 14S2 23.732 2 16 8.268 2 16 2m0 2c-5.514 0-10 4.486-10 10s4.486 10 10 10 10-4.486 10-10S21.514 14 16 14m0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8"/></svg>',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models?limit=1000',
    defaultModel: '',
    extraHeaders: {
      'HTTP-Referer': APP_ORIGIN_HEADER,
      'X-Title': 'AI Router',
    },
    keyHelpUrl: 'https://openrouter.ai/keys',
    openAICompatible: true,
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModel: '',
    extraHeaders: {},
    keyHelpUrl: 'https://console.groq.com/keys',
    openAICompatible: true,
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="22" font-family="Arial" font-size="20" font-weight="bold" fill="#000" text-anchor="middle">G</text></svg>',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModel: '',
    extraHeaders: {},
    keyHelpUrl: 'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained',
    openAICompatible: true,
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#ffd21e" d="M16 2L2 30l14-8z"/><path fill="#000" d="M10 16h12v2H10z"/></svg>',
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.ai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModel: '',
    extraHeaders: {},
    keyHelpUrl: 'https://api.together.ai/settings/projects/~current/api-keys',
    openAICompatible: true,
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="22" font-family="Arial" font-size="20" font-weight="bold" fill="#000" text-anchor="middle">T</text></svg>',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModel: '',
    extraHeaders: {},
    keyHelpUrl: 'https://console.mistral.ai',
    openAICompatible: true,
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="22" font-family="Arial" font-size="20" font-weight="bold" fill="#000" text-anchor="middle">M</text></svg>',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    defaultModel: '',
    extraHeaders: {},
    keyHelpUrl: 'https://platform.deepseek.com/api_keys',
    openAICompatible: true,
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="22" font-family="Arial" font-size="20" font-weight="bold" fill="#000" text-anchor="middle">D</text></svg>',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    chatPath: '/messages',
    modelsPath: '/models?limit=1000',
    defaultModel: '',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    keyHelpUrl: 'https://platform.claude.com/settings/keys',
    openAICompatible: false,
    apiStyle: 'anthropic',
    authStyle: 'x-api-key',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="22" font-family="Arial" font-size="20" font-weight="bold" fill="#000" text-anchor="middle">A</text></svg>',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    chatPath: '/models/{model}:streamGenerateContent?alt=sse',
    modelsPath: '/models?pageSize=1000',
    defaultModel: '',
    extraHeaders: {},
    keyHelpUrl: 'https://aistudio.google.com/apikey',
    openAICompatible: false,
    apiStyle: 'gemini',
    authStyle: 'x-goog-api-key',
    logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="22" font-family="Arial" font-size="20" font-weight="bold" fill="#4285f4" text-anchor="middle">G</text></svg>',
  },
] as const

export type ProviderConfig = (typeof PROVIDER_CONFIGS)[number]
export type ProviderId = ProviderConfig['id']
export type OpenAICompatibleProviderConfig = Extract<ProviderConfig, { openAICompatible: true }>
export type OpenAICompatibleProviderId = OpenAICompatibleProviderConfig['id']
export type ApiStyle = ProviderConfig['apiStyle']
export type AuthStyle = ProviderConfig['authStyle']
export type AnyProviderConfig = ProviderConfig

export const MARKETPLACE_PROVIDER_CONFIGS: readonly ProviderConfig[] =
  PROVIDER_CONFIGS.filter(({ id }) => id === 'openrouter')

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_CONFIGS.some((provider) => provider.id === value)
}

export function getProviderConfig(providerId: OpenAICompatibleProviderId): OpenAICompatibleProviderConfig
export function getProviderConfig(providerId: ProviderId): ProviderConfig
export function getProviderConfig(providerId: ProviderId): ProviderConfig {
  const config = PROVIDER_CONFIGS.find((provider) => provider.id === providerId)
  if (!config) throw new Error(`Unknown provider: ${providerId}`)
  return config
}

export function resolveProviderHeaders(
  config: ProviderConfig,
  appOrigin: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config.extraHeaders).map(([name, value]) => [
      name,
      value === APP_ORIGIN_HEADER ? appOrigin : value,
    ]),
  )
}

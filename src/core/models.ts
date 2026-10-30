import type { ProviderId, OpenAICompatibleProviderId } from './providers.ts'

export type ModelInfo = {
  id: string
  name: string
  providerId: ProviderId
  contextLength?: number
  inputPricePerM?: number
  outputPricePerM?: number
  isFree?: boolean | undefined
  priceKnown: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined
}

function normalizeEntry(
  providerId: ProviderId,
  id: unknown,
  name: unknown,
  contextLength: unknown,
  inputPricePerM?: number,
  outputPricePerM?: number,
): ModelInfo | null {
  if (typeof id !== 'string' || !id.trim()) return null
  const priceKnown = inputPricePerM !== undefined && outputPricePerM !== undefined
  const normalizedContextLength = positiveInteger(contextLength)
  return {
    id: id.trim(),
    name: typeof name === 'string' && name.trim() ? name.trim() : id.trim(),
    providerId,
    ...(normalizedContextLength !== undefined
      ? { contextLength: normalizedContextLength }
      : {}),
    ...(inputPricePerM !== undefined ? { inputPricePerM } : {}),
    ...(outputPricePerM !== undefined ? { outputPricePerM } : {}),
    ...(priceKnown ? { isFree: inputPricePerM === 0 && outputPricePerM === 0 } : {}),
    priceKnown,
  }
}

function readDataArray(value: unknown, field: 'data' | 'models'): unknown[] {
  return isRecord(value) && Array.isArray(value[field]) ? value[field] : []
}

export function parseOpenAICompatibleModels(
  providerId: OpenAICompatibleProviderId,
  value: unknown,
): ModelInfo[] {
  return readDataArray(value, 'data').flatMap((entry) => {
    if (!isRecord(entry)) return []
    return normalizeEntry(
      providerId,
      entry.id,
      entry.name,
      entry.context_length ?? entry.contextLength,
    ) ?? []
  })
}

export function parseOpenRouterModels(value: unknown): ModelInfo[] {
  return readDataArray(value, 'data').flatMap((entry) => {
    if (!isRecord(entry)) return []
    const pricing = isRecord(entry.pricing) ? entry.pricing : undefined
    const input = pricing ? finiteNonNegativeNumber(pricing.prompt) : undefined
    const output = pricing ? finiteNonNegativeNumber(pricing.completion) : undefined
    const perMillion = (price: number | undefined) => (
      price === undefined ? undefined : Number((price * 1_000_000).toPrecision(12))
    )
    return normalizeEntry(
      'openrouter',
      entry.id,
      entry.name,
      entry.context_length,
      perMillion(input),
      perMillion(output),
    ) ?? []
  })
}

export function parseAnthropicModels(value: unknown): ModelInfo[] {
  return readDataArray(value, 'data').flatMap((entry) => {
    if (!isRecord(entry)) return []
    return normalizeEntry(
      'anthropic',
      entry.id,
      entry.display_name ?? entry.name,
      entry.context_window ?? entry.max_input_tokens,
    ) ?? []
  })
}

export function parseGeminiModels(value: unknown): ModelInfo[] {
  return readDataArray(value, 'models').flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.supportedGenerationMethods)
      || !entry.supportedGenerationMethods.includes('generateContent')) return []
    const id = typeof entry.baseModelId === 'string'
      ? entry.baseModelId
      : typeof entry.name === 'string'
        ? entry.name.replace(/^models\//, '')
        : undefined
    return normalizeEntry(
      'gemini',
      id,
      entry.displayName,
      entry.inputTokenLimit,
    ) ?? []
  })
}

export function filterFreeModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((model) => model.isFree === true)
}

export type ModelType = 'text' | 'image' | 'embedding' | 'audio' | 'other'

export function detectModelType(model: ModelInfo): ModelType {
  const id = model.id.toLowerCase()
  const name = model.name.toLowerCase()
  if (/image|dall.e|midjourney|stable.diffusion|flux|sdxl|imagen/.test(id) || /image|dall.e|midjourney|stable.diffusion|flux|sdxl|imagen/.test(name)) return 'image'
  if (/embed/.test(id) || /embed/.test(name)) return 'embedding'
  if (/audio|tts|whisper|speech|voice/.test(id) || /audio|tts|whisper|speech|voice/.test(name)) return 'audio'
  return 'text'
}

export function filterModelsByType(models: ModelInfo[], types: Set<ModelType>): ModelInfo[] {
  if (types.size === 0) return models
  return models.filter((model) => types.has(detectModelType(model)))
}

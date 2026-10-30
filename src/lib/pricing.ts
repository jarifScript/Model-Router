import type { ProviderId } from '../core/providers'
import { getKnownPrice } from './modelCatalog'

export type ModelPrice = {
  inputPricePerM: number
  outputPricePerM: number
}

export type PriceOverrides = Record<string, ModelPrice>

export function getPriceOverrideKey(provider: string, model: string): string {
  return `${provider}:${model}`
}

export function parsePriceOverrides(value: unknown): PriceOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const overrides: PriceOverrides = {}
  for (const [key, price] of Object.entries(value)) {
    if (typeof price !== 'object' || price === null || Array.isArray(price)) continue
    const record = price as Record<string, unknown>
    const inputPricePerM = record.inputPricePerM
    const outputPricePerM = record.outputPricePerM
    if (typeof inputPricePerM !== 'number' || !Number.isFinite(inputPricePerM) || inputPricePerM < 0
      || typeof outputPricePerM !== 'number' || !Number.isFinite(outputPricePerM) || outputPricePerM < 0) continue
    overrides[key] = { inputPricePerM, outputPricePerM }
  }
  return overrides
}

export function getModelPrice(
  providerId: ProviderId,
  modelId: string,
  overrides: PriceOverrides,
  catalogPrice: ModelPrice | null = getKnownPrice(providerId, modelId),
): ModelPrice | null {
  return overrides[getPriceOverrideKey(providerId, modelId)] ?? catalogPrice
}

export function getModelCostPerMillionTokens(
  providerId: ProviderId,
  modelId: string,
  overrides: PriceOverrides = {},
): number | undefined {
  const price = getModelPrice(providerId, modelId, overrides)
  return price ? price.inputPricePerM + price.outputPricePerM : undefined
}

export function calculateEstimatedCost(tokens: number, price: ModelPrice | null): number | null {
  if (!price) return null
  return (tokens * price.inputPricePerM) / 1_000_000
    + (tokens * price.outputPricePerM) / 1_000_000
}

export function calculateEstimatedRequestCost(
  inputTokens: number,
  outputTokens: number,
  price: ModelPrice | null,
): number | null {
  if (!price) return null
  return (inputTokens * price.inputPricePerM + outputTokens * price.outputPricePerM) / 1_000_000
}

export function calculateEstimatedSavings(actualCost: number | null, baselineCost: number | null): number | null {
  if (actualCost === null || baselineCost === null) return null
  return Math.max(baselineCost - actualCost, 0)
}

export function formatEstimatedMoney(value: number): string {
  return `$${value.toFixed(6)} estimated`
}

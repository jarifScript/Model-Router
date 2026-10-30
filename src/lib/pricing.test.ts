import { describe, expect, it } from 'vitest'
import {
  calculateEstimatedRequestCost,
  calculateEstimatedSavings,
  getModelPrice,
  type ModelPrice,
} from './pricing'

describe('estimated pricing', () => {
  it('uses a known model catalog price', () => {
    const catalogPrice: ModelPrice = { inputPricePerM: 2, outputPricePerM: 8 }
    expect(getModelPrice('openrouter', 'example/model', {}, catalogPrice)).toEqual(catalogPrice)
    expect(calculateEstimatedRequestCost(100_000, 50_000, catalogPrice)).toBeCloseTo(0.6)
  })

  it('keeps an unknown price as null', () => {
    expect(getModelPrice('openrouter', 'unknown/model', {}, null)).toBeNull()
    expect(calculateEstimatedRequestCost(100, 100, null)).toBeNull()
  })

  it('counts a confirmed free model as zero', () => {
    const freePrice: ModelPrice = { inputPricePerM: 0, outputPricePerM: 0 }
    expect(calculateEstimatedRequestCost(1_000, 2_000, freePrice)).toBe(0)
  })

  it('returns no savings when no comparison model is set', () => {
    expect(calculateEstimatedSavings(0.5, null)).toBeNull()
    expect(calculateEstimatedSavings(null, 1)).toBeNull()
  })

  it('uses a manual override before the catalog price', () => {
    const override: ModelPrice = { inputPricePerM: 0.1, outputPricePerM: 0.2 }
    const catalogPrice: ModelPrice = { inputPricePerM: 1, outputPricePerM: 2 }
    expect(getModelPrice('openrouter', 'example/model', {
      'openrouter:example/model': override,
    }, catalogPrice)).toEqual(override)
  })
})

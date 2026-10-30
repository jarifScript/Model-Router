import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestLogRow, RequestLogSource, RequestLogStatus } from './requestLogger'
import { createRequestLogger, getRequestLogSource, resolveTokenCounts } from './requestLogger'

function makeRow(
  source: RequestLogSource = 'single',
  status: RequestLogStatus = 'success',
  fallbackCount = 0,
): RequestLogRow {
  return {
    user_id: 'user-id',
    created_at: '2026-01-01T00:00:00.000Z',
    source,
    route_alias: source === 'route' ? 'Saved plan' : null,
    provider: 'openrouter',
    model: 'example/model',
    key_id: 'key-id',
    latency_ms: 100,
    ttfb_ms: 40,
    input_tokens: 10,
    output_tokens: 20,
    tokens_estimated: false,
    status,
    http_status: null,
    error_class: null,
    fallback_count: fallbackCount,
    est_cost_usd: 0,
    est_baseline_cost_usd: 0,
    est_saved_usd: 0,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('metadata request logger', () => {
  it('flushes a queued row after five seconds', async () => {
    vi.useFakeTimers()
    const insertRows = vi.fn(async (_rows: readonly RequestLogRow[]) => {})
    const logger = createRequestLogger(insertRows)
    logger.enqueue(makeRow())

    await vi.advanceTimersByTimeAsync(5_000)

    expect(insertRows).toHaveBeenCalledTimes(1)
    expect(insertRows.mock.calls[0][0]).toHaveLength(1)
  })

  it('flushes as soon as the queue reaches twenty rows', async () => {
    const insertRows = vi.fn(async (_rows: readonly RequestLogRow[]) => {})
    const logger = createRequestLogger(insertRows)
    for (let index = 0; index < 19; index += 1) logger.enqueue(makeRow())
    expect(insertRows).not.toHaveBeenCalled()

    logger.enqueue(makeRow())
    await logger.flush()

    expect(insertRows).toHaveBeenCalledTimes(1)
    expect(insertRows.mock.calls[0][0]).toHaveLength(20)
  })

  it('flushes all queued rows for an explicit deletion request', async () => {
    vi.useFakeTimers()
    const insertRows = vi.fn(async (_rows: readonly RequestLogRow[]) => {})
    const logger = createRequestLogger(insertRows)
    for (let index = 0; index < 5; index += 1) logger.enqueue(makeRow())

    await logger.flushAll()

    expect(insertRows).toHaveBeenCalledTimes(1)
    expect(insertRows.mock.calls[0][0]).toHaveLength(5)
    expect(logger.queuedCount()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the waiting queue capped at two hundred rows', async () => {
    let finishFirstInsert: (() => void) | undefined
    const firstInsert = new Promise<void>((resolve) => { finishFirstInsert = resolve })
    const insertRows = vi.fn()
      .mockImplementationOnce(() => firstInsert)
      .mockResolvedValue(undefined)
    const logger = createRequestLogger(insertRows)
    for (let index = 0; index < 220; index += 1) logger.enqueue(makeRow())
    expect(logger.queuedCount()).toBe(200)

    const pendingFlush = logger.flush()
    if (!finishFirstInsert) throw new Error('The first insert did not start.')
    finishFirstInsert()
    await pendingFlush
    await logger.flush()

    expect(insertRows).toHaveBeenCalledTimes(2)
    expect(logger.queuedCount()).toBe(0)
  })

  it('retries one failed insert and never throws into chat', async () => {
    const insertRows = vi.fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockRejectedValueOnce(new Error('database unavailable'))
    const logger = createRequestLogger(insertRows)

    expect(logger.enqueue(makeRow())).toBe(true)
    await expect(logger.flush()).resolves.toBeUndefined()

    expect(insertRows).toHaveBeenCalledTimes(2)
    expect(logger.queuedCount()).toBe(0)
  })

  it('does not log tests, simulations, or excluded sources', () => {
    const insertRows = vi.fn(async (_rows: readonly RequestLogRow[]) => {})
    const logger = createRequestLogger(insertRows)

    expect(logger.enqueue(makeRow(), { isTest: true })).toBe(false)
    expect(logger.enqueue(makeRow(), { isSimulation: true })).toBe(false)
    expect(logger.enqueue(makeRow(), { source: 'test' })).toBe(false)
    expect(logger.enqueue(makeRow(), { source: 'simulation' })).toBe(false)
    expect(logger.queuedCount()).toBe(0)
  })

  it('records all three chat sources and their backup count', async () => {
    const inserted: RequestLogRow[] = []
    const logger = createRequestLogger(async (rows) => { inserted.push(...rows) })
    const sources = [
      getRequestLogSource(false, false),
      getRequestLogSource(false, true),
      getRequestLogSource(true, false),
    ]
    for (const source of sources) {
      logger.enqueue(makeRow(source, 'aborted', 2))
      await logger.flush()
    }

    expect(inserted.map(({ source }) => source)).toEqual(['single', 'auto', 'route'])
    expect(inserted.map(({ status }) => status)).toEqual(['aborted', 'aborted', 'aborted'])
    expect(inserted.every(({ fallback_count }) => fallback_count === 2)).toBe(true)
  })

  it('uses provider counts when available and estimates when absent', () => {
    expect(resolveTokenCounts(12, 8, 400, 200)).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      tokensEstimated: false,
    })
    expect(resolveTokenCounts(null, null, 401, 21)).toEqual({
      inputTokens: 101,
      outputTokens: 6,
      tokensEstimated: true,
    })
  })

  it('keeps request rows free of prompt and response content fields', () => {
    type Assert<T extends true> = T
    type NoContentFields = Assert<
      Extract<keyof RequestLogRow, 'content' | 'messages' | 'prompt' | 'response'> extends never
        ? true
        : false
    >
    const rowHasNoContentFields: NoContentFields = true
    expect(rowHasNoContentFields).toBe(true)
  })
})

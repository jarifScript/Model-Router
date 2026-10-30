export type GatewayUsage = {
  inputTokens: number
  outputTokens: number
}

export function completionId(): string {
  return `chatcmpl-${crypto.randomUUID()}`
}

export function completionCreatedAt(): number {
  return Math.floor(Date.now() / 1000)
}

export function makeCompletionChunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, string>,
  finishReason: 'stop' | null = null,
): Record<string, unknown> {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

export function makeCompletionResponse(
  id: string,
  created: number,
  model: string,
  content: string,
  usage: GatewayUsage,
): Record<string, unknown> {
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
    },
  }
}

export function encodeServerSentEvent(value: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
}

export function encodeServerSentEventDone(): Uint8Array {
  return new TextEncoder().encode('data: [DONE]\n\n')
}

export function estimateTokens(characters: number): number {
  return Math.ceil(characters / 4)
}

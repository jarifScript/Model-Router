function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isModelsRequest(
  value: unknown,
  providerIds: readonly string[],
): value is { action: 'models'; providerId: string } {
  return isRecord(value)
    && value.action === 'models'
    && typeof value.providerId === 'string'
    && providerIds.includes(value.providerId)
    && Object.keys(value).every((key) => key === 'action' || key === 'providerId')
}

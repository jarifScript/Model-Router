import { PROVIDER_CONFIGS, type ProviderId } from '../../core/providers'
import type { ProviderErrorClass } from '../../core/adapters/types'

export type FallbackEvent = {
  from: { provider: ProviderId; model: string }
  to: { provider: ProviderId; model: string }
  errorClass: ProviderErrorClass
}

function providerLabel(providerId: ProviderId): string {
  return PROVIDER_CONFIGS.find((provider) => provider.id === providerId)?.label ?? providerId
}

function failureText(errorClass: ProviderErrorClass): string {
  switch (errorClass) {
    case 'rate_limit': return 'was rate limited'
    case 'server': return 'was unavailable'
    case 'timeout': return 'timed out'
    case 'network': return 'could not be reached'
    case 'auth': return 'rejected the key'
    case 'quota': return 'out of quota'
    case 'model_not_found': return 'could not find the model'
    case 'bad_request': return 'rejected the request'
    case 'content_filter': return 'blocked the request'
    case 'stream_interrupted': return 'interrupted its response'
  }
}

export default function FallbackNotice({ fallback }: { fallback: FallbackEvent }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      {providerLabel(fallback.from.provider)} {failureText(fallback.errorClass)}, so {providerLabel(fallback.to.provider)} answered.
    </p>
  )
}

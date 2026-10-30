import { PROVIDER_CONFIGS, type ProviderId } from '../../core/providers'

export default function RouteBadge({
  provider,
  model,
}: {
  provider: ProviderId
  model: string
}) {
  const label = PROVIDER_CONFIGS.find((config) => config.id === provider)?.label ?? provider
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
      <span>{label} answered</span>
      <span className="truncate opacity-75">· {model}</span>
    </span>
  )
}

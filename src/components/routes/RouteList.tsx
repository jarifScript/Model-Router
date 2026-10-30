import type { RouteStrategy, RoutingRule } from '../../core/route-types'
import { copy } from '../../lib/copy'

const strategyLabels: Record<RouteStrategy, string> = {
  priority: copy.backupPlans.priority,
  round_robin: copy.backupPlans.roundRobin,
  weighted: copy.backupPlans.weighted,
  lowest_latency: copy.backupPlans.lowestLatency,
  lowest_cost: copy.backupPlans.lowestCost,
}

type RouteListProps = {
  routes: RoutingRule[]
  selectedId: string | null
  onSelect: (route: RoutingRule) => void
  onCreate: () => void
  onDelete: (route: RoutingRule) => void
}

export default function RouteList({ routes, selectedId, onSelect, onCreate, onDelete }: RouteListProps) {
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={onCreate}
        className="min-h-12 w-full rounded-lg bg-indigo-700 px-4 text-base font-semibold text-white hover:bg-indigo-800"
      >
        {copy.backupPlans.create}
      </button>
      {routes.length === 0 && <p className="rounded-lg border border-dashed border-slate-400 p-4 text-base text-slate-700 dark:border-slate-600 dark:text-slate-300">{copy.backupPlans.noPlans}</p>}
      <ul className="space-y-2">
        {routes.map((route) => (
          <li key={route.id}>
            <div className={`flex items-center gap-2 rounded-lg border p-2 ${selectedId === route.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-slate-800'}`}>
              <button type="button" onClick={() => onSelect(route)} className="min-h-12 min-w-0 flex-1 text-left">
                <span className="block truncate text-base font-semibold text-slate-950 dark:text-white">{route.alias}</span>
                <span className="block text-sm text-slate-700 dark:text-slate-300">{copy.backupPlans.tries.replace('{count}', String(route.targets.length))} · {strategyLabels[route.strategy]}</span>
              </button>
              <button type="button" onClick={() => onDelete(route)} aria-label={`${copy.backupPlans.deletePlan}: ${route.alias}`} className="min-h-11 rounded px-3 text-base text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950">{copy.backupPlans.delete}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

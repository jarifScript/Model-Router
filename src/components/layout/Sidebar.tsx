// Desktop navigation for the authenticated application shell.
import { NavLink } from 'react-router-dom'
import { useUserSettings } from '../../hooks/useUserSettings'
import { copy } from '../../lib/copy'

const simpleLinks = [
  { to: '/dashboard', label: copy.nav.home, icon: '⌂' },
  { to: '/playground', label: copy.nav.chat, icon: '✳' },
  { to: '/models', label: copy.nav.models, icon: '▦' },
  { to: '/providers', label: copy.nav.keys, icon: '◈' },
  { to: '/settings', label: copy.nav.settings, icon: '⚙' },
]

export default function Sidebar() {
  const { showAdvancedFeatures } = useUserSettings()
  const links = showAdvancedFeatures
    ? [
      ...simpleLinks.slice(0, 4),
      { to: '/routes', label: copy.nav.backupPlans, icon: '⑂' },
      { to: '/logs', label: copy.nav.history, icon: '▤' },
      simpleLinks[4],
    ]
    : simpleLinks
  return (
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:flex md:flex-col">
      <NavLink to="/dashboard" className="mb-9 flex items-center gap-3 px-2 text-lg font-semibold text-slate-900 dark:text-white">
        <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white">AI</span>
        {copy.app.title}
      </NavLink>
      <nav aria-label={copy.nav.mainNavigation} className="space-y-1">
        {links.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-base font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`
            }
          >
            <span aria-hidden="true" className="w-5 text-center">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

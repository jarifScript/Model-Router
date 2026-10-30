// Responsive authenticated layout with desktop sidebar and mobile tab bar.
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { useUserSettings } from '../../hooks/useUserSettings'
import { copy } from '../../lib/copy'

const simpleMobileLinks = [
  { to: '/dashboard', label: copy.nav.home, icon: '⌂' },
  { to: '/playground', label: copy.nav.chat, icon: '✳' },
  { to: '/models', label: copy.nav.models, icon: '▦' },
  { to: '/providers', label: copy.nav.keys, icon: '◈' },
  { to: '/settings', label: copy.nav.settings, icon: '⚙' },
]

export default function AppShell() {
  const location = useLocation()
  const { showAdvancedFeatures } = useUserSettings()
  const isPlayground = location.pathname === '/playground'
  const mobileLinks = showAdvancedFeatures
    ? [
      ...simpleMobileLinks.slice(0, 4),
      { to: '/routes', label: copy.nav.backupPlans, icon: '⑂' },
      { to: '/logs', label: copy.nav.history, icon: '▤' },
      simpleMobileLinks[4],
    ]
    : simpleMobileLinks
  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar />
        <main className={`min-h-0 flex-1 ${
          isPlayground
            ? 'overflow-hidden p-2 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-4 sm:pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-4'
            : 'overflow-y-auto px-4 py-6 pb-24 sm:px-6 md:pb-6'
        }`}>
          <Outlet />
        </main>
        <nav
          aria-label={copy.nav.mainNavigation}
          className="fixed inset-x-0 bottom-0 z-10 flex overflow-x-hidden border-t border-slate-200 bg-white px-1 pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900 md:hidden"
        >
          {mobileLinks.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 py-2 text-center text-xs font-medium leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 ${
                  isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'
                }`
              }
            >
              <span aria-hidden="true" className="text-lg leading-5">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}

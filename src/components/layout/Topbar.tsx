// Account controls and the light/dark theme toggle.
import { useEffect, useState } from 'react'
import useAuth from '../../hooks/useAuth'
import { copy } from '../../lib/copy'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem('theme')
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function Topbar() {
  const { user, signOut } = useAuth()
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
  }

  async function handleSignOut() {
    setError(null)
    try {
      await signOut()
    } catch {
      setError(copy.errors.unknown)
    }
  }

  return (
    <header className="flex min-h-16 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
      <p className="truncate text-base text-slate-600 dark:text-slate-300">{user?.email}</p>
      <div className="relative flex items-center gap-2">
        {error && <span role="alert" className="max-w-48 text-base text-red-800 dark:text-red-200">{error}</span>}
        <button
          type="button"
          aria-label={copy.app.help}
          aria-expanded={showHelp}
          onClick={() => setShowHelp((visible) => !visible)}
          className="min-h-11 min-w-11 rounded-full border border-slate-300 text-lg font-semibold text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-slate-700 dark:text-white"
        >
          ?
        </button>
        {showHelp && (
          <section role="dialog" aria-label={copy.help.title} className="absolute right-0 top-14 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 text-base shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-2 font-semibold">{copy.help.title}</h2>
            <ol className="list-inside list-decimal space-y-1">
              {copy.help.lines.map((line) => <li key={line}>{line.slice(3)}</li>)}
            </ol>
            <h3 className="mb-1 mt-3 font-semibold">{copy.help.glossaryTitle}</h3>
            <dl className="space-y-2">
              {copy.help.glossary.map(({ term, definition }) => (
                <div key={term}><dt className="font-medium">{term}</dt><dd>{definition}</dd></div>
              ))}
            </dl>
          </section>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`${theme === 'dark' ? copy.settings.light : copy.settings.dark}`}
          className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-slate-700 dark:text-white dark:hover:bg-slate-800"
        >
          {theme === 'dark' ? `☀ ${copy.settings.light}` : `☾ ${copy.settings.dark}`}
        </button>
        <button
          type="button"
          onClick={handleSignOut}
          className="min-h-11 rounded-lg px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {copy.app.signOut}
        </button>
      </div>
    </header>
  )
}

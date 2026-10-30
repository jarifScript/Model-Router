import { Component, type ReactNode } from 'react'
import { copy } from '../../lib/copy'

export function ErrorFallback({ onReload }: { onReload: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold">{copy.app.unexpectedErrorTitle}</h1>
        <p className="mt-3 text-base text-slate-700 dark:text-slate-300">{copy.app.unexpectedErrorMessage}</p>
        <button type="button" onClick={onReload} className="mt-6 min-h-11 rounded-lg bg-indigo-700 px-5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
          {copy.app.reloadPage}
        </button>
      </section>
    </main>
  )
}

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(_error: Error): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReload={() => window.location.reload()} />
    }
    return this.props.children
  }
}

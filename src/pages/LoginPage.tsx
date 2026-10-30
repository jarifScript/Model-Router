// Supabase email/password and GitHub sign-in screen.
import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import useAuth from '../hooks/useAuth'
import { copy } from '../lib/copy'
import { getAuthErrorMessage } from '../lib/authErrorMessage'

export default function LoginPage() {
  const { isConfigured, isLoading, user, signInWithEmail, signInWithGitHub, signUpWithEmail } = useAuth()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isLoading) {
    return <main className="flex min-h-screen items-center justify-center text-base">{copy.login.checking}</main>
  }

  if (user) return <Navigate to="/dashboard" replace />

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    setIsSubmitting(true)

    try {
      if (mode === 'sign-in') {
        await signInWithEmail(email, password)
      } else {
        const confirmationRequired = await signUpWithEmail(email, password)
        if (confirmationRequired) {
          setMessage(copy.login.confirmEmail)
        }
      }
    } catch (authError) {
      setError(getAuthErrorMessage(authError, mode))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGitHubSignIn() {
    setError(null)
    setIsSubmitting(true)

    try {
      await signInWithGitHub()
    } catch (authError) {
      setError(getAuthErrorMessage(authError, 'oauth'))
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-indigo-600 font-semibold text-white">AI</div>
          <h1 className="text-3xl font-bold text-slate-950 dark:text-white">{copy.login.title}</h1>
          <p className="mt-2 text-base text-slate-700 dark:text-slate-300">{copy.login.intro}</p>
        </div>

        {!isConfigured && (
          <p role="alert" className="mb-5 rounded-lg bg-amber-50 p-3 text-base text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            {copy.login.notConfigured}
          </p>
        )}
        {error && <p role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{error}</p>}
        {message && <p role="status" className="mb-5 rounded-lg bg-emerald-50 p-3 text-base text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100">{message}</p>}

        <button
          type="button"
          onClick={handleGitHubSignIn}
          disabled={!isConfigured || isSubmitting}
          className="min-h-12 w-full rounded-lg border border-slate-400 px-4 text-base font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800"
        >
          {copy.login.github}
        </button>

        <div className="my-6 flex items-center gap-3 text-base text-slate-700 dark:text-slate-300">
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          {copy.login.orEmail}
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <label className="block text-base font-medium text-slate-800 dark:text-slate-200">
            {copy.login.email}
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-400 bg-white px-3 text-base text-slate-950 outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus:ring-indigo-900"
            />
          </label>
          <label className="block text-base font-medium text-slate-800 dark:text-slate-200">
            {copy.login.password}
            <input
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              minLength={6}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-400 bg-white px-3 text-base text-slate-950 outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus:ring-indigo-900"
            />
          </label>
          <button
            type="submit"
            disabled={!isConfigured || isSubmitting}
            className="min-h-12 w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-base font-semibold text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? copy.login.wait : mode === 'sign-in' ? copy.login.signInEmail : copy.login.signUp}
          </button>
        </form>

        <p className="mt-6 text-center text-base text-slate-700 dark:text-slate-300">
          {mode === 'sign-in' ? copy.login.newHere : copy.login.alreadyRegistered}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
              setError(null)
              setMessage(null)
            }}
            className="min-h-11 px-2 font-medium text-indigo-800 hover:text-indigo-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:text-indigo-300"
          >
            {mode === 'sign-in' ? copy.login.createAccount : copy.login.signIn}
          </button>
        </p>
        <p className="mt-5 text-center text-base text-slate-700 dark:text-slate-300">
          <Link to="/unlock" className="hover:text-indigo-600">{copy.login.unlockLink}</Link>
        </p>
      </section>
    </main>
  )
}

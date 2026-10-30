// In-memory chat using a saved route or one provider/model.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AllTargetsFailed, RouterRequestError } from '../../core/errors'
import { parseRoutingRule, type RouteTarget, type RoutingRule } from '../../core/route-types'
import { route } from '../../core/router'
import { PROVIDER_CONFIGS } from '../../core/providers'
import { parseModelChatSearch } from '../../core/modelChatLink'
import { createBrowserRouterDependencies } from '../../core/transport'
import type { ChatMessage, ProviderErrorClass } from '../../core/adapters/types'
import useAuth from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { useRouteHealth } from '../../store/route-health'
import { useVaultStore } from '../../store/vault'
import MessageBubble from './MessageBubble'
import type { FallbackEvent } from './FallbackNotice'
import ModelPicker from '../models/ModelPicker'
import { usePlaygroundStore } from '../../store/playground'
import { useFavoriteModels } from '../../lib/favorites'
import { useAutoBackupPlan } from '../../lib/autoBackupPlan'
import { useModelCatalogs } from '../../lib/modelCatalog'
import { mergeAutoBackupTargets } from '../../core/auto-backup-plan'
import { useUserSettings } from '../../hooks/useUserSettings'
import { copy, errorMessage } from '../../lib/copy'
import type { ProviderId } from '../../core/providers'
import InfoTooltip from '../ui/InfoTooltip'
import FallbackNotice from './FallbackNotice'
import { calculateEstimatedRequestCost, calculateEstimatedSavings, getModelCostPerMillionTokens, getModelPrice } from '../../lib/pricing'
import { enqueueRequestLog, getRequestLogSource, resolveTokenCounts, type RequestLogStatus } from '../../lib/requestLogger'

type DisplayMessage = ChatMessage & { id: string; model?: string }
type SimulatedError = 'none' | 'rate_limit' | 'server' | 'timeout' | 'auth'

function targetIdentity(target: RouteTarget): string {
  return `${target.provider}:${target.keyId}:${target.model}`
}

export default function ChatWindow() {
  const location = useLocation()
  const { session } = useAuth()
  const { isUnlocked, providerKeys } = useVaultStore()
  const { favorites } = useFavoriteModels()
  const { plan: autoPlan } = useAutoBackupPlan()
  const modelCatalogs = useModelCatalogs(providerKeys)
  const {
    showAdvancedFeatures,
    baselineProvider,
    baselineModel,
    priceOverrides,
  } = useUserSettings()
  const availableProviders = useMemo(
    () => PROVIDER_CONFIGS.filter(({ id }) => providerKeys.some((key) => key.provider === id)),
    [providerKeys],
  )
  const providerId = usePlaygroundStore((state) => state.providerId)
  const modelsByProvider = usePlaygroundStore((state) => state.modelsByProvider)
  const messages = usePlaygroundStore((state) => state.messages)
  const draft = usePlaygroundStore((state) => state.draft)
  const selectedRouteId = usePlaygroundStore((state) => state.selectedRouteId)
  const setProvider = usePlaygroundStore((state) => state.setProvider)
  const setModel = usePlaygroundStore((state) => state.setModel)
  const setGlobalSelectedRouteId = usePlaygroundStore((state) => state.setSelectedRouteId)
  const setMessages = usePlaygroundStore((state) => state.setMessages)
  const setDraft = usePlaygroundStore((state) => state.setDraft)
  const lastWorkedTarget = usePlaygroundStore((state) => state.lastWorkedTarget)
  const setLastWorkedTarget = usePlaygroundStore((state) => state.setLastWorkedTarget)
  const health = useRouteHealth((state) => state.health)
  const refreshHealth = useRouteHealth((state) => state.refresh)
  const [selectedKeyId, setSelectedKeyId] = useState('')
  const [simulateTargetId, setSimulateTargetId] = useState('')
  const [routes, setRoutes] = useState<RoutingRule[]>([])
  const [simulateByTarget, setSimulateByTarget] = useState<Record<string, SimulatedError>>({})
  const [whichAi, setWhichAi] = useState('auto')
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [routeLoadError, setRouteLoadError] = useState<string | null>(null)
  const [answerTarget, setAnswerTarget] = useState<RouteTarget | null>(null)
  const [fallbacks, setFallbacks] = useState<FallbackEvent[]>([])
  const controllerRef = useRef<AbortController | null>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  const selectedRoute = showAdvancedFeatures && selectedRouteId !== 'single'
    ? routes.find((savedRoute) => savedRoute.id === selectedRouteId) ?? null
    : null
  const providerKeysForSelection = providerKeys.filter((key) => key.provider === providerId)
  const selectedKey = providerKeysForSelection.find((key) => key.id === selectedKeyId)
    ?? providerKeysForSelection[0]
  const model = modelsByProvider[providerId]
  const singleTarget = useMemo<RouteTarget | null>(() => selectedKey
    ? { provider: providerId, model: model.trim(), keyId: selectedKey.id }
    : null, [model, providerId, selectedKey])
  const favoriteTargets = favorites.flatMap((favorite) => {
    const key = providerKeys.find((item) => item.provider === favorite.providerId)
    return key ? [{
      provider: favorite.providerId as ProviderId,
      model: favorite.modelId,
      keyId: key.id,
    }] : []
  })
  const lastWorked = lastWorkedTarget && providerKeys.some((key) => key.id === lastWorkedTarget.keyId)
    ? { provider: lastWorkedTarget.providerId, model: lastWorkedTarget.modelId, keyId: lastWorkedTarget.keyId }
    : null
  const discoveredTargets = modelCatalogs.flatMap((catalog) => catalog.models.map((model) => ({
    provider: catalog.providerId,
    model: model.id,
    keyId: catalog.keyId,
    timeoutMs: 30_000,
    maxAttempts: 1,
  })))
  const mergedAutoTargets = mergeAutoBackupTargets(
    autoPlan.targets,
    discoveredTargets,
    new Set(providerKeys.map((key) => key.id)),
  )
  const autoTargets = mergedAutoTargets.length
    ? mergedAutoTargets
    : favoriteTargets.length
      ? favoriteTargets.map((target) => ({ ...target, maxAttempts: 1 }))
    : lastWorked
      ? [{ ...lastWorked, maxAttempts: 1 }]
      : singleTarget?.model
        ? [{ ...singleTarget, maxAttempts: 1 }]
        : []
  const favoriteIndex = whichAi.startsWith('favorite:') ? Number(whichAi.slice('favorite:'.length)) : -1
  const chosenFavorite = Number.isInteger(favoriteIndex) ? favoriteTargets[favoriteIndex] : undefined
  const activeTargets = selectedRoute?.targets
    ?? (whichAi === 'auto' ? autoTargets : chosenFavorite ? [chosenFavorite] : singleTarget ? [singleTarget] : [])
  const simulationTarget = activeTargets.find((target) => targetIdentity(target) === simulateTargetId)
    ?? activeTargets[0]
  const linkedModel = useMemo(() => parseModelChatSearch(location.search), [location.search])
  const linkedProviderHasKey = !linkedModel
    || providerKeys.some((key) => key.provider === linkedModel.providerId)

  useEffect(() => {
    const conversation = conversationRef.current
    if (conversation && shouldAutoScrollRef.current) {
      conversation.scrollTop = conversation.scrollHeight
    }
  }, [answerTarget, error, fallbacks, isStreaming, messages])

  const settingsFields = (
    <>
      {showAdvancedFeatures && routes.length > 0 && (
        <label className="block text-sm font-medium">
          {copy.chat.routePicker}
          <select aria-label={copy.chat.routePicker} value={selectedRouteId} onChange={(event) => selectRoute(event.target.value)} disabled={isStreaming} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900">
            <option value="single">{copy.chat.auto}</option>
            {routes.map((savedRoute) => <option key={savedRoute.id} value={savedRoute.id}>{savedRoute.alias}</option>)}
          </select>
        </label>
      )}
      {availableProviders.length > 0 && (
        <label className="block text-sm font-medium">
          {copy.chat.providerPicker}
          <select aria-label={copy.chat.providerPicker} value={providerId} onChange={(event) => handleProviderChange(event.target.value)} disabled={isStreaming} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900">
            {availableProviders.map(({ id }) => <option key={id} value={id}>{copy.keys.serviceNames[id]}</option>)}
          </select>
        </label>
      )}
      <label className="block min-w-0 text-sm font-medium">
        {copy.chat.modelPicker}<InfoTooltip topic={copy.chat.modelPicker} explanation={copy.models.modelTooltip} />
        <ModelPicker
          ariaLabel={copy.chat.modelPicker}
          providerId={providerId}
          keyId={selectedKey?.id}
          value={model}
          onChange={(modelId) => setModel(providerId, modelId)}
          disabled={isStreaming}
          placeholder={copy.chat.chooseModel}
        />
      </label>
      {providerKeysForSelection.length > 1 && (
        <label className="block text-sm font-medium">
          {copy.chat.keyPicker}
          <select aria-label={copy.chat.keyPicker} value={selectedKey?.id ?? ''} onChange={(event) => setSelectedKeyId(event.target.value)} disabled={isStreaming} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900">
            {providerKeysForSelection.map((key) => <option key={key.id} value={key.id}>{key.label}</option>)}
          </select>
        </label>
      )}
      {import.meta.env.DEV && showAdvancedFeatures && simulationTarget && (
        <>
          <label className="block text-sm font-medium">
            {copy.chat.simulateTarget}
            <select aria-label={copy.chat.simulateTarget} value={targetIdentity(simulationTarget)} onChange={(event) => setSimulateTargetId(event.target.value)} disabled={isStreaming} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900">
              {activeTargets.map((target) => <option key={targetIdentity(target)} value={targetIdentity(target)}>{copy.keys.serviceNames[target.provider]}: {target.model}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {copy.chat.simulateFailure}
            <select aria-label={copy.chat.simulateFailure} value={simulateByTarget[targetIdentity(simulationTarget)] ?? 'none'} onChange={(event) => {
              const value = event.target.value
              if (value === 'none' || value === 'rate_limit' || value === 'server' || value === 'timeout' || value === 'auth') {
                const key = targetIdentity(simulationTarget)
                setSimulateByTarget((current) => ({ ...current, [key]: value }))
              }
            }} disabled={isStreaming} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900">
              <option value="none">{copy.chat.noSimulation}</option>
              <option value="rate_limit">{copy.chat.rateLimit}</option>
              <option value="server">{copy.chat.server}</option>
              <option value="timeout">{copy.chat.timeout}</option>
              <option value="auth">{copy.chat.auth}</option>
            </select>
          </label>
        </>
      )}
    </>
  )

  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    if (availableProviders.some(({ id }) => id === providerId)) return
    const firstAvailableProvider = availableProviders[0]
    if (firstAvailableProvider) {
      setProvider(firstAvailableProvider.id)
      setSelectedKeyId('')
    }
  }, [availableProviders, providerId, setProvider])

  useEffect(() => {
    if (!linkedModel) return
    setProvider(linkedModel.providerId)
    setModel(linkedModel.providerId, linkedModel.modelId)
    setSelectedKeyId('')
    setGlobalSelectedRouteId('single')
    setWhichAi('custom')
    setShowMoreOptions(true)
    setError(null)
  }, [linkedModel, setGlobalSelectedRouteId, setModel, setProvider])

  useEffect(() => {
    if (!supabase || !session?.user.id) return
    let cancelled = false
    async function loadRoutes() {
      try {
        const { data, error: queryError } = await supabase!
          .from('routes')
          .select('id, alias, strategy, targets, timeout_ms, max_attempts')
          .eq('user_id', session!.user.id)
          .order('created_at', { ascending: true })
        if (queryError) throw queryError
        const parsed = (data ?? []).map(parseRoutingRule)
        if (parsed.some((savedRoute) => savedRoute === null)) {
          throw new Error('A saved route has invalid data. Check it on the Routes page.')
        }
        if (!cancelled) setRoutes(parsed.filter((savedRoute): savedRoute is RoutingRule => savedRoute !== null))
      } catch {
        if (!cancelled) setRouteLoadError(copy.chat.noSavedRoute)
      }
    }
    void loadRoutes()
    return () => { cancelled = true }
  }, [session?.user.id])

  function handleProviderChange(value: string) {
    const provider = availableProviders.find((candidate) => candidate.id === value)
    if (!provider) return
    setProvider(provider.id)
    setSelectedKeyId('')
    setError(null)
  }

  function selectRoute(value: string) {
    setGlobalSelectedRouteId(value)
    setWhichAi(value === 'single' ? 'auto' : 'custom')
    setError(null)
    setAnswerTarget(null)
    setFallbacks([])
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt || isStreaming) return
    if (!isUnlocked || !providerKeys.length) {
      setError(copy.chat.addKeyPrompt)
      return
    }
    if (!session?.access_token) {
      setError(copy.errors.unknown)
      return
    }
    if (activeTargets.some((target) => !providerKeys.some((key) => key.id === target.keyId))) {
      setError(copy.chat.addKeyPrompt)
      return
    }
    if (!activeTargets.length) {
      setError(whichAi === 'auto' ? copy.chat.autoPlanMissing : copy.chat.noTargets)
      return
    }

    const currentMessages = messages
      .filter((message) => message.content)
      .slice(-23)
      .map(({ role, content }) => ({ role, content }))
      .filter((message) => message.content.length <= 12_000)
    while (currentMessages.length > 0
      && currentMessages.reduce((total, message) => total + message.content.length, prompt.length) > 48_000) {
      currentMessages.shift()
    }
    const chatMessages: ChatMessage[] = [...currentMessages, { role: 'user', content: prompt }]
    const userMessage: DisplayMessage = { role: 'user', content: prompt, id: crypto.randomUUID() }
    const assistantMessage: DisplayMessage = { role: 'assistant', content: '', id: crypto.randomUUID() }
    shouldAutoScrollRef.current = true
    setMessages((current) => [...current, userMessage, assistantMessage])
    setDraft('')
    setError(null)
    setAnswerTarget(null)
    setFallbacks([])
    setIsStreaming(true)

    const activeRule: RoutingRule = selectedRoute ?? {
      alias: whichAi === 'auto' ? 'Auto' : 'Single model',
      strategy: 'priority',
      timeoutMs: 30_000,
      ...(whichAi === 'auto' ? { firstTokenTimeoutMs: autoPlan.firstTokenTimeoutMs } : {}),
      maxAttempts: whichAi === 'auto' ? autoPlan.maxAttempts : Math.min(20, Math.max(1, activeTargets.length * 2)),
      ...(whichAi === 'auto' ? { maxCycles: 2, failoverOnQuota: true } : {}),
      targets: activeTargets,
    }
    const abortController = new AbortController()
    controllerRef.current = abortController
    let assistantContent = ''
    const startedAt = performance.now()
    const requestCreatedAt = new Date().toISOString()
    let firstTokenAt: number | null = null
    let answerTargetForLog: RouteTarget | null = null
    let lastAttemptedTarget: RouteTarget | null = null
    let inputTokensFromProvider: number | null = null
    let outputTokensFromProvider: number | null = null
    let usageTargetIdentity: string | null = null
    let httpStatus: number | null = null
    let lastErrorClass: ProviderErrorClass | null = null
    let fallbackCount = 0
    let requestStatus: RequestLogStatus = 'error'
    const keysById = Object.fromEntries(providerKeys.map((key) => [key.id, key.apiKey]))
    const simulateFailures: Partial<Record<string, 'rate_limit' | 'server' | 'timeout' | 'auth'>> = {}
    if (import.meta.env.DEV) {
      const simulation = simulationTarget
        ? simulateByTarget[targetIdentity(simulationTarget)]
        : undefined
      if (simulationTarget && simulation && simulation !== 'none') {
        simulateFailures[targetIdentity(simulationTarget)] = simulation
      }
    }
    const isSimulation = Object.keys(simulateFailures).length > 0
    const source = getRequestLogSource(Boolean(selectedRoute), whichAi === 'auto')
    const routerRequest = {
      messages: chatMessages,
      keysById,
      signal: abortController.signal,
      isTest: false,
      ...(import.meta.env.DEV ? { simulateFailures } : {}),
    }

    try {
      const dependencies = createBrowserRouterDependencies(
        session.access_token,
        health,
        (provider, modelId) => getModelCostPerMillionTokens(provider, modelId, priceOverrides),
      )
      for await (const event of route(routerRequest, activeRule, dependencies)) {
        if (event.type === 'attempt_start') {
          lastAttemptedTarget = event.target
          inputTokensFromProvider = null
          outputTokensFromProvider = null
          usageTargetIdentity = null
        } else if (event.type === 'chunk') {
          if (firstTokenAt === null) firstTokenAt = performance.now()
          assistantContent += event.text
          setMessages((current) => current.map((message) =>
            message.id === assistantMessage.id ? { ...message, content: assistantContent } : message,
          ))
        } else if (event.type === 'usage') {
          inputTokensFromProvider = event.inputTokens
          outputTokensFromProvider = event.outputTokens
          usageTargetIdentity = targetIdentity(event.target)
        } else if (event.type === 'fallback') {
          fallbackCount += 1
          inputTokensFromProvider = null
          outputTokensFromProvider = null
          usageTargetIdentity = null
          setFallbacks((current) => [...current, event])
        } else if (event.type === 'done') {
          requestStatus = 'success'
          answerTargetForLog = event.target
          setAnswerTarget(event.target)
          setMessages((current) => current.map((message) =>
            message.id === assistantMessage.id ? { ...message, model: event.target.model } : message,
          ))
          setLastWorkedTarget({
            providerId: event.target.provider,
            modelId: event.target.model,
            keyId: event.target.keyId,
          })
        } else if (event.type === 'error') {
          lastErrorClass = event.errorClass
          httpStatus = event.httpStatus ?? null
          if (event.target) lastAttemptedTarget = event.target
          setError(errorMessage(event.errorClass))
        }
        refreshHealth()
      }
    } catch (caughtError) {
      if (caughtError instanceof Error && caughtError.name === 'AbortError') {
        requestStatus = 'aborted'
        setError(copy.chat.responseStopped)
      } else if (caughtError instanceof AllTargetsFailed) {
        const lastFailure = caughtError.failures.at(-1)
        if (lastFailure) {
          lastErrorClass = lastFailure.errorClass
          httpStatus = lastFailure.httpStatus ?? null
          lastAttemptedTarget = {
            provider: lastFailure.provider,
            model: lastFailure.model,
            keyId: lastFailure.keyId,
          }
        }
        if (whichAi === 'auto') {
          setError(copy.chat.autoAllFailed)
        } else {
          setError(lastFailure ? errorMessage(lastFailure.errorClass) : copy.chat.noTargets)
        }
      } else {
        if (caughtError instanceof RouterRequestError) {
          lastErrorClass = caughtError.errorClass
          httpStatus = caughtError.status ?? null
        }
        setError(caughtError instanceof RouterRequestError
          ? errorMessage(caughtError.errorClass)
          : copy.errors.unknown)
      }
    } finally {
      if (abortController.signal.aborted) requestStatus = 'aborted'
      const target = answerTargetForLog ?? lastAttemptedTarget
      if (target) {
        const providerUsageMatches = usageTargetIdentity === targetIdentity(target)
        const counts = resolveTokenCounts(
          providerUsageMatches ? inputTokensFromProvider : null,
          providerUsageMatches ? outputTokensFromProvider : null,
          chatMessages.reduce((count, message) => count + message.content.length, 0),
          assistantContent.length,
        )
        const actualPrice = getModelPrice(target.provider, target.model, priceOverrides)
        const baselinePrice = baselineProvider && baselineModel
          ? getModelPrice(baselineProvider, baselineModel, priceOverrides)
          : null
        const actualCost = calculateEstimatedRequestCost(counts.inputTokens, counts.outputTokens, actualPrice)
        const baselineCost = calculateEstimatedRequestCost(counts.inputTokens, counts.outputTokens, baselinePrice)
        const saved = calculateEstimatedSavings(actualCost, baselineCost)

        enqueueRequestLog({
          user_id: session.user.id,
          created_at: requestCreatedAt,
          source,
          route_alias: selectedRoute?.alias ?? null,
          provider: target.provider,
          model: target.model,
          key_id: target.keyId,
          latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          ttfb_ms: firstTokenAt === null ? null : Math.max(0, Math.round(firstTokenAt - startedAt)),
          input_tokens: counts.inputTokens,
          output_tokens: counts.outputTokens,
          tokens_estimated: counts.tokensEstimated,
          status: requestStatus,
          http_status: httpStatus,
          error_class: lastErrorClass,
          fallback_count: fallbackCount,
          est_cost_usd: actualCost,
          est_baseline_cost_usd: baselineCost,
          est_saved_usd: saved,
        }, {
          isTest: routerRequest.isTest,
          isSimulation,
          source,
        })
      }
      controllerRef.current = null
      setIsStreaming(false)
      refreshHealth()
    }
  }

  if (!providerKeys.length) {
    return (
      <section className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-3xl font-bold text-slate-950 dark:text-white">{isUnlocked ? copy.chat.noKeyTitle : copy.chat.unlockFirst}</h1>
        {!isUnlocked && <p className="mt-3 max-w-lg text-base text-slate-700 dark:text-slate-300">{copy.chat.unlockFirstHint}</p>}
        <Link to={isUnlocked ? '/providers' : '/unlock'} className="mt-6 inline-flex min-h-14 items-center rounded-xl bg-indigo-700 px-7 text-lg font-bold text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
          {isUnlocked ? copy.chat.addKey : copy.chat.unlockFirstAction}
        </Link>
      </section>
    )
  }

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex shrink-0 flex-col gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-950 dark:text-white">{copy.chat.title}</h1>
          <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300">{copy.chat.subtitle}</p>
        </div>
        <label className="block min-w-0 sm:w-56 sm:shrink-0">
          <span className="text-sm font-semibold text-slate-950 dark:text-white">{copy.chat.whichAi}</span>
          <select value={whichAi.startsWith('plan:') ? 'auto' : whichAi} onChange={(event) => {
            const value = event.target.value
            setError(null)
            setWhichAi(value)
            setGlobalSelectedRouteId('single')
            if (value === 'custom') setShowMoreOptions(true)
            if (value.startsWith('favorite:')) {
              const favoriteTarget = favoriteTargets[Number(value.slice('favorite:'.length))]
              if (favoriteTarget) {
                setProvider(favoriteTarget.provider)
                setModel(favoriteTarget.provider, favoriteTarget.model)
              }
            }
          }} disabled={isStreaming} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950 dark:text-white">
            <option value="auto">{copy.chat.auto}</option>
            {favoriteTargets.map((target, index) => <option key={targetIdentity(target)} value={`favorite:${index}`}>{target.model}</option>)}
            <option value="custom">{copy.chat.chooseModel}</option>
          </select>
        </label>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <aside aria-label={copy.chat.moreOptions} className="hidden w-80 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950/50 lg:block">
          <h2 className="mb-4 text-base font-semibold text-slate-950 dark:text-white">{copy.chat.moreOptions}</h2>
          <div className="grid gap-4">{settingsFields}</div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <details open={showMoreOptions} onToggle={(event) => setShowMoreOptions(event.currentTarget.open)} className="shrink-0 border-b border-slate-200 lg:hidden dark:border-slate-800">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 py-2 text-sm font-semibold text-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:text-indigo-300">
              {showMoreOptions ? copy.chat.lessOptions : copy.chat.moreOptions}
              <span aria-hidden="true" className="ml-3 text-lg">{showMoreOptions ? '−' : '+'}</span>
            </summary>
            <div className="grid max-h-[38dvh] gap-3 overflow-y-auto px-4 pb-4">{settingsFields}</div>
          </details>

          {routeLoadError && <p role="alert" className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">{copy.chat.noSavedRoute}</p>}
          {!linkedProviderHasKey && linkedModel && (
            <p role="status" className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {copy.chat.linkedNoKey} <Link to="/providers" className="font-semibold underline">{copy.keys.addKey}</Link>
            </p>
          )}

          <div
            ref={conversationRef}
            aria-live="polite"
            aria-label={copy.chat.title}
            onScroll={(event) => {
              const conversation = event.currentTarget
              shouldAutoScrollRef.current = conversation.scrollHeight
                - conversation.clientHeight
                - conversation.scrollTop < 80
            }}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-5"
          >
            {whichAi === 'auto' && !activeTargets.length && (
              <div className="mx-auto max-w-lg rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-center text-sm text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100">
                <p>{copy.chat.autoPlanMissing}</p>
                <Link to="/routes" className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-indigo-700 px-4 font-semibold text-white hover:bg-indigo-800">{copy.chat.openBackupPlan}</Link>
                <Link to="/models" className="ml-4 inline-flex min-h-11 items-center font-semibold underline">{copy.nav.models}</Link>
              </div>
            )}
            {messages.length === 0
              ? <div className="py-12 text-center"><h2 className="text-xl font-semibold">{copy.chat.emptyTitle}</h2><p className="mt-2 text-base text-slate-700 dark:text-slate-300">{copy.chat.emptyText}</p></div>
              : messages.map((message) => <MessageBubble key={message.id} role={message.role} content={message.content} model={message.model} />)}
            {isStreaming && !answerTarget && <p role="status" className="text-base">{copy.chat.attempt}</p>}
            {fallbacks.length > 0 && answerTarget && (
              <div className="space-y-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
                <FallbackNotice
                  fallback={{
                    ...fallbacks[0],
                    to: { provider: answerTarget.provider, model: answerTarget.model },
                  }}
                />
              </div>
            )}
            {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{error}</p>}
          </div>

          <form onSubmit={handleSubmit} className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950 sm:p-4">
            <label htmlFor="chat-prompt" className="sr-only">{copy.chat.message}</label>
            <div className="flex min-w-0 items-end gap-2">
              <textarea id="chat-prompt" rows={2} maxLength={12_000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }} placeholder={copy.chat.placeholder} disabled={isStreaming} className="min-h-12 min-w-0 flex-1 resize-y rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-base text-slate-950 outline-none focus:border-indigo-700 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus:ring-indigo-900" />
              {isStreaming ? (
                <button type="button" onClick={() => controllerRef.current?.abort()} className="min-h-12 shrink-0 rounded-lg border border-slate-400 px-4 text-base font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800 sm:px-5">{copy.chat.stop}</button>
              ) : (
                <button type="submit" disabled={!draft.trim() || (activeTargets.length > 0 && activeTargets.some((target) => !providerKeys.some((key) => key.id === target.keyId)))} className="min-h-12 shrink-0 rounded-lg bg-indigo-700 px-4 text-base font-semibold text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6">{copy.chat.send}</button>
              )}
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}

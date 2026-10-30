# AI Router: Coding Instructions

## What we are building
A browser-based AI router. Users bring their own API keys (OpenAI, Anthropic,
Gemini, DeepSeek), create routing rules with fallback order, and chat through them.
Budget is $0: free hosting + Supabase free tier. No standalone backend server.

## Stack
React 18 + TypeScript (strict) + Vite, Tailwind CSS, React Router,
TanStack React Query, Zustand, Supabase (Auth, Postgres, Edge Functions).

## Hard rules (never break these)
1. TypeScript strict mode. No `any`. Prefer explicit types and discriminated unions.
2. `src/core/` is pure TypeScript. NO React, NO Zustand, NO Supabase imports inside it.
3. API keys:
   - Encrypted in the browser (Web Crypto: PBKDF2 SHA-256, 310,000+ iterations,
     then AES-GCM, random salt + IV per record) BEFORE saving to Supabase.
   - Decrypted keys live only in the in-memory Zustand store (`store/vault.ts`).
   - NEVER put keys or the passphrase in localStorage, sessionStorage, URLs,
     console logs, error messages, or analytics.
4. NEVER log or store prompts or responses. Analytics = metadata only
   (provider, model, latency, token counts, status, error class).
5. No `dangerouslySetInnerHTML`. Render model output as plain text or via a
   safe markdown renderer with HTML disabled.
6. Every Supabase table has Row Level Security: users can only access rows
   where user_id = auth.uid().
7. The Edge Function must NEVER accept a target URL from the client. It uses a
   hardcoded provider table with an allowlist of hosts. It must NOT store or
   log the API key it forwards.
8. Keep dependencies minimal. Ask before adding a new library.
9. Small files and small functions. Every function that can fail returns a typed
   result or throws a typed error. No silent catches.
10. Use Tailwind utility classes only. Clean, minimal, responsive (mobile =
    bottom tab bar, desktop = sidebar). Support light and dark mode.

## Architecture
- Two transport modes per provider: "direct" (browser -> provider) and
  "proxy" (browser -> Supabase Edge Function -> provider). Default every provider
  to "proxy"; flip to "direct" only after CORS is tested.
- In proxy mode the browser sends the already-decrypted key in the request
  header to the Edge Function, which forwards it and discards it.
  The server never stores plaintext keys.

## Router core behaviour (src/core)
- All providers are normalized to one internal request/response shape
  (OpenAI-style messages) through adapters.
- Adapter interface: buildRequest, parseStream (AsyncIterable of chunks),
  classifyError.
- Error classes: rate_limit | server | timeout | auth | bad_request | content_filter.
- Fallback rules:
  * Retry/fail over ONLY on rate_limit, server, timeout.
  * NEVER retry on auth or bad_request. Surface the error immediately.
  * Fail over ONLY before the first streamed token. After the first chunk,
    we are committed. If the stream dies, show an error instead of switching.
  * Respect Retry-After on 429s. Use exponential backoff + jitter.
  * Every attempt uses AbortController with the route's timeoutMs.
- Circuit breaker per target (provider+key): open after N consecutive failures,
  cooldown 30-120s, half-open probe after cooldown.
- Strategies: priority, round_robin, weighted, lowest_latency, lowest_cost.

## Data model (Postgres)
- vault_meta: user_id (pk), kdf_salt, canary_ciphertext, canary_iv
  (used to verify the passphrase without storing it)
- provider_keys: id, user_id, provider, label, ciphertext, iv, salt, created_at
- routes: id, user_id, alias, strategy, targets (jsonb), timeout_ms,
  max_attempts, created_at
- request_logs: id, user_id, created_at, route_alias, provider, model,
  latency_ms, input_tokens, output_tokens, status, error_class,
  fallback_count, est_cost_usd, est_saved_usd
- daily_stats: user_id, day, requests, successes, avg_latency_ms,
  total_cost_usd, total_saved_usd (rollup so we can delete old raw logs)

## UX rules
- First login shows an onboarding wizard: add one key (or pick "Free mode"),
  then send a test message.
- Route templates: "Cheapest", "Fastest", "Best quality".
- Friendly empty states and clear error messages. No raw stack traces in the UI.
- Playground always shows which model answered and whether a fallback happened.

## Working style
- Work in the phases I give you, one at a time. Do not build ahead.
- After each phase: list the files changed, then tell me how to test it.
- If something is unclear or risky, ask me instead of guessing.
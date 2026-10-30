# AI Router

## Authentication setup

1. Create a Supabase project and copy its project URL and anon key into a local
   `.env.local` file using `.env.example` as a template.
2. In Supabase **Authentication → Providers**, enable Email and GitHub.
3. For GitHub, create an OAuth app and set its callback URL to the Supabase
   project's **Authentication → URL Configuration → Callback URL**. Add the
   GitHub client ID and secret to the Supabase provider settings.
4. Add your local app URL (usually `http://localhost:5173`) to Supabase's
   **Authentication → URL Configuration → Redirect URLs**.
5. Start the app with `npm run dev`. Use the login page to create an email
   account, sign in, or continue with GitHub.

Apply the migrations in this order: `0001_init.sql`,
`0004_favorite_models.sql`, `0005_auto_backup_plans.sql`,
`0006_model_test_results.sql`, `0007_activity_analytics.sql`,
`0008_fix_activity_summary.sql`, `0009_phase6_hardening.sql`, and
`0010_gateway.sql`.
Migrations `0002` and `0003` are intentionally absent; do not create empty
placeholders for them. For an already initialized project, apply only migrations
that are not recorded as applied. The Supabase CLI may ask whether to apply them
to the linked remote project; confirm the target before accepting.

## Provider key vault

Sign in and open `/unlock` to create a vault passphrase. The passphrase is
required to encrypt each provider key and is never saved. Encrypted key records
use PBKDF2-SHA-256 (310,000 iterations) and AES-GCM with fresh salts and IVs.
Decrypted keys are held only in the in-memory Zustand store and are cleared on
sign-out or page reload.

The provider key test uses a small provider model-list request through the
authenticated `route` Supabase Edge Function; it does not send a prompt or
accept a target URL from the browser. Set the exact app origin (without a trailing slash) before deploying. For more
than one local or production origin, use the comma-separated `APP_ORIGINS`
secret; each entry is compared exactly, and wildcards are rejected:

```sh
npx.cmd supabase@latest login
npx.cmd supabase@latest link --project-ref YOUR_PROJECT_REF
npx.cmd supabase@latest secrets set APP_ORIGIN=https://your-app.example.com
npx.cmd supabase@latest functions deploy route
```

For local development using `http://localhost:5173`, set
`APP_ORIGINS=https://your-app.example.com,http://localhost:5173` instead of
`APP_ORIGIN`. Add `http://127.0.0.1:5173` separately only if you open the app
with that host. `APP_ORIGIN` remains supported for a single exact origin.

The function's JWT verification is enabled in `supabase/config.toml` and it
also verifies the access token with Supabase Auth. It only accepts provider
identifiers and uses hardcoded provider URLs. The provider key is forwarded in
an authorization header and is not logged or persisted by the function.

## OpenAI-compatible providers

The provider table is in `src/core/providers.ts`. The `gateway` Edge Function
imports that table directly, so its provider IDs and fixed host allowlist do not
drift from the browser's provider configuration. The authenticated `route`
function still has its own server-side provider configuration.
The table includes OpenAI, OpenRouter, Groq, Hugging Face, Together AI, Mistral,
DeepSeek, Anthropic, and Gemini. The Edge Function keeps an identical hardcoded
copy, including the API and authentication styles, and continues to reject
client-supplied URLs.

The configured base URLs were checked against provider documentation:

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)
- [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart)
- [Groq OpenAI compatibility](https://console.groq.com/docs/openai)
- [Hugging Face Inference Providers Quickstart](https://huggingface.co/docs/inference-providers/en/quicktour)
- [Together AI OpenAI compatibility](https://docs.together.ai/docs/inference/openai-compatibility)
- [Mistral API reference](https://docs.mistral.ai/api/)
- [DeepSeek API docs](https://api-docs.deepseek.com/)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)
- [Anthropic streaming events](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Gemini generateContent and streaming API](https://ai.google.dev/api/generate-content)

Together AI's official compatibility documentation specifies the canonical
`https://api.together.ai/v1` URL. The requested `api.together.xyz` domain
redirects to the `.ai` domain, so the provider table uses the documented
canonical URL. Hugging Face's docs specify `https://router.huggingface.co/v1`.

The Playground and route targets use a searchable model picker with manual ID
entry as a fallback. Model catalogs are cached in React Query memory for one
hour only; they are never written to browser storage. OpenRouter's public
`/models` catalog includes per-million-token prices, so the picker can sort by
price and filter to models whose input and output prices are both zero. Other
providers do not publish prices in this list. The OpenRouter catalog was
verified with an unauthenticated request and a browser CORS preflight.

The Playground accepts OpenRouter IDs such as `vendor/model` and `:free`
suffixes. Chat messages stay in browser memory and are sent through the
authenticated `route` Edge Function by default. DeepSeek, Anthropic, and Gemini
use their documented provider formats; Anthropic system prompts and Gemini
system instructions are translated by their adapters. Gemini keys are sent in
`x-goog-api-key`, not in the URL. The function streams provider responses and
does not store or log prompts, responses, or keys. It accepts JSON POST requests
only (plus CORS preflight), caps requests at 256 KB and 24 messages, limits each
message to 12,000 characters, limits generated output to 4,096 tokens / 512 KB,
times out upstream chat after two minutes, and allows at most 60 requests per
user per minute using a Postgres counter. The counter works across Edge Function
instances; it adds one small database operation to each request and fails
closed if that operation is unavailable. It is per account, not per IP, so
multiple accounts could bypass the limit; stronger global abuse protection
would need a separate service or stricter account verification. Generic app
errors do not include provider response bodies. OpenRouter attribution
headers use the exact configured `APP_ORIGIN`. Direct transport is an opt-in
build-time setting and sends the key from the browser to the provider; proxy
mode remains the default.

Model-list endpoint references:

- [OpenRouter model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [OpenAI list models](https://developers.openai.com/api/reference/resources/models/methods/list)
- [Groq model catalog and `/openai/v1/models`](https://console.groq.com/docs/models)
- [Together AI OpenAI compatibility](https://docs.together.ai/docs/inference/openai-compatibility) (uses the standard `/models` endpoint)
- [Hugging Face chat completion API](https://huggingface.co/docs/inference-providers/en/tasks/chat-completion) (OpenAI-compatible `/models` listing)
- [Mistral list models](https://docs.mistral.ai/api/endpoint/models)
- [DeepSeek API compatibility](https://api-docs.deepseek.com/) (uses the standard OpenAI-compatible `/models` path)
- [Anthropic list models](https://platform.claude.com/docs/en/api/models/list)
- [Gemini models list](https://ai.google.dev/api/models#method:-models.list)

The official Hugging Face and DeepSeek guides confirm their OpenAI-compatible
API usage, but do not provide a separate model-list reference page; their
catalog requests use the standard `/models` path specified for compatible
providers. `getKnownPrice(providerId, modelId)` exposes loaded prices from the
in-memory catalog for request-cost estimates.

## Routes and fallback

The **Routes** page stores route rules and model/key IDs in the RLS-protected
`routes` table; it never copies API key plaintext into a route. Add a provider
key and unlock the vault before adding a target. Choose each target's provider,
model, and saved key with the model picker, then drag targets to set priority
order. The **Cheapest**, **Fastest**, and **Best quality** templates update the
editable draft; review it and choose **Save route** when ready. Cheapest can
select the least expensive model from a loaded, priced catalog. Unknown prices
sort last for lowest-cost selection.

Choose a saved route in the Playground to enable retries and fallback. A
transient rate limit, server error, timeout, or network error is retried once
on the same target before moving on. Authentication, quota, and missing-model
errors skip to the next target and mark the failed provider/key for attention.
Malformed requests and content-filter errors stop immediately. Once a streamed
token arrives, the router does not switch providers if the stream is interrupted.
The Stop button cancels outstanding work. Circuit breaker and latency state stay
in memory and are keyed by provider plus saved key ID.

In development builds only, each route target has a **Simulate failure**
control. It is omitted from production builds. This lets you exercise retry,
fallback, and attention states without sending the simulated target's request
to its provider.

## Models page

The protected **Models** page combines model lists for saved provider keys with
OpenRouter's public list. A listed model has not been proven usable: **Test**
sends a tiny, non-streaming request to one selected model. Test status,
latency, and check time are saved in the per-user, RLS-protected
`model_test_results` table so they survive browser refreshes and
development-server restarts. They are separate from request logs and dashboard
statistics. The UI marks results older than 30 minutes as stale. Tests for paid
or unknown-price models require confirmation; free models do not. Batch tests
use up to three concurrent requests and pause a
provider after a rate limit. Manual group selection is limited to ten models;
range checks can test the first 1–20 testable models in the current filtered
and sorted list. Paid or unknown-price models still require confirmation.

Use **Chat** to open the Playground with the model selected, or **Add to route**
to create a route draft with the model as its first target. Favorites are saved
per account in the RLS-protected `favorite_models` table. Apply the migration
before using favorites:

```cmd
npx.cmd supabase@latest db push
```

Model-test, filter, sort, batch, and link tests use mocked transports; no
provider model test has been live-tested. Catalog parser fixtures are
hand-written from documentation and are not live provider responses.

## Activity and estimates

Migration `0007_activity_analytics.sql` adds the metadata-only chat history,
daily summaries, and per-account price settings. Migration
`0008_fix_activity_summary.sql` fixes the activity summary RPC for PostgreSQL.
Apply pending migrations to the linked Supabase project with:

```cmd
npx.cmd supabase@latest db push
```

Only the selected AI service/model, request timing, result class, usage counts,
and estimated costs are saved. Prompts, answers, API keys, and provider error
text are not included in activity rows. Model checks and development-only
simulated failures are excluded. History is kept as individual rows for 30 days;
older rows are summarized and pruned when the account opens Home, at most once
per UTC day. This uses the authenticated `rollup_and_prune` RPC instead of
depending on a scheduled `pg_cron` extension, whose availability on the Free
plan was not confirmed.

Estimated prices use a saved manual price first, then the loaded model catalog.
Unknown prices remain unknown, and savings are shown only when both the chosen
model and comparison model have known prices. OpenAI streaming requests ask for
usage counts; other adapters use a character-based estimate when usage is not
provided. Home uses one summary RPC and caches it for one minute. History is
filtered and paged on the server in groups of 25; CSV export fetches all matching
rows. **Settings → Delete my activity** permanently removes the account's
request rows and daily summaries.

## Tests

Run unit tests with:

```sh
npm test
```

The router, strategies, circuit breaker, provider adapters, model catalog
parsers, model tests, batch runner, filters, and model links have Vitest
coverage. Anthropic and Gemini streaming tests and model parser tests use
hand-written fixtures from provider documentation and are not live-tested.
**Anthropic, Gemini, and DeepSeek are not live-tested** because only an
OpenRouter key is available.

To test fallback locally using only an OpenRouter key:

1. On **Routes**, create a route with two OpenRouter targets. Select the same
   saved OpenRouter key for both and enter two model IDs; the second must be
   currently available to your key. Choose **Priority**, set maximum attempts
   to at least `3`, and save.
2. In the development Playground, choose that route. Set the first target's
   **Simulate failure** dropdown to `rate_limit`, and leave the second at `none`.
3. Send a short message. The first target fails twice (initial attempt plus one
   retry), then the second target should answer. The Playground should show a
   fallback notice and identify the answering provider/model.
4. Try `auth` on the first target to verify it skips retrying and displays the
   **Needs attention** badge. Restore both dropdowns to `none` afterward.

After changes to the proxy or provider authentication configuration, redeploy
the function:

```cmd
npx.cmd supabase@latest functions deploy route
```

To test OpenRouter end to end:

1. Set `APP_ORIGIN` to the exact origin shown in your browser's address bar.
   For the usual local Vite URL, run
   `npx.cmd supabase@latest secrets set APP_ORIGIN=http://localhost:5173`.
   Use `http://127.0.0.1:5173` only if that is the URL you open instead.
   Updating the secret takes effect without redeploying the function.
2. Sign in, unlock the vault, and go to **Providers**.
3. Choose **Get a key** on the OpenRouter card, create a key in OpenRouter, then
   choose **Add key** and save it encrypted with your vault passphrase.
4. Use **Test key** to verify provider access.
5. Open **Playground** and select **OpenRouter**. Wait for the catalog to load,
   use **Free only** if desired, search by model name or ID, and choose a
   currently available model. Send a short message and confirm the response
   streams into the chat. If discovery is unavailable, type a model ID manually.

## Phase 6 deployment and safety

### Set up Supabase

1. Create a Supabase project and save its project URL and anon key as the
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables for
   the frontend. The anon key is public client configuration; never put the
   service-role key in the browser or repository.
2. Link the repository to the project and apply the migrations listed above:

   ```cmd
   npx.cmd supabase@latest login
   npx.cmd supabase@latest link --project-ref YOUR_PROJECT_REF
   npx.cmd supabase@latest db push
   ```

3. Set `APP_ORIGIN` to the exact production URL (or `APP_ORIGINS` to a
   comma-separated list of exact origins), then deploy the Edge Function:

   ```cmd
   npx.cmd supabase@latest secrets set APP_ORIGIN=https://your-app.example.com
   npx.cmd supabase@latest functions deploy route
   ```

4. In Supabase **Authentication → URL Configuration**, set **Site URL** to
   your production app URL and add the production and local callback URLs to
   **Redirect URLs**. If GitHub sign-in is enabled, set the GitHub OAuth app's
   callback to the callback URL shown by Supabase under
   **Authentication → Providers → GitHub**.
5. In **Authentication → Providers**, enable only the sign-in providers you
   plan to use. The Edge Function verifies the user's JWT and its database RPCs
   are owner-scoped.

### Deploy the frontend

For Cloudflare Pages or Netlify, use build command `npm run build` and output
directory `dist`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the
hosting environment for every deployment environment. The included
`public/_redirects` provides the SPA fallback so routes such as `/models` keep
working after refresh. The `public/_headers` file applies production security
headers on Cloudflare Pages and Netlify.

For Vercel, `vercel.json` sets the Vite build command, `dist` output directory,
production security headers, and SPA rewrite. Import the GitHub repository
`jarifScript/Model-Router`, use the project root as the Root Directory, and add
these variables in **Project Settings → Environment Variables** for each
environment you will deploy:

- `VITE_SUPABASE_URL`: your Supabase project URL.
- `VITE_SUPABASE_ANON_KEY`: the project's anon/publishable key. This is public
  client configuration; do not use a service-role key here.

Add the variables before the first deployment, then redeploy after changing
them because Vite embeds them at build time. Never add `SUPABASE_SERVICE_ROLE_KEY`
or `GATEWAY_MASTER_KEY` to Vercel frontend environment variables. The static
security headers in `vercel.json` and `public/_headers` currently allow the
project origin `https://liauvnyywnbirrcurdbl.supabase.co`; update both if you
switch to a different Supabase project. The Vite preview policy is generated
from `VITE_SUPABASE_URL`; Vite development mode does not apply the production
CSP.

These policies allow only the Supabase origin in `connect-src`; GitHub OAuth
redirects through Supabase and do not require a GitHub `connect-src` entry. The
app does not need inline styles: Tailwind CSS is emitted as a stylesheet, so
the policy does not allow `unsafe-inline` or `unsafe-eval`. If browser-to-provider
transport is deliberately enabled, add only the exact API domains for enabled
providers to `connect-src` in both static header files: `api.openai.com`,
`openrouter.ai`, `api.groq.com`, `router.huggingface.co`, `api.together.ai`,
`api.mistral.ai`, `api.deepseek.com`, `api.anthropic.com`, and/or
`generativelanguage.googleapis.com`. Do not add these while proxy transport is
in use.

Vercel's free Hobby plan is for non-commercial use; check Vercel's current terms
before charging for this app.

### Keep the free project active

The GitHub workflow calls the data-free, public `keep_alive()` RPC every three
days. Add repository secrets named `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then
run **Actions → Keep Supabase active → Run workflow** once to verify setup.
The call reads or changes no user data and does not weaken any table's RLS.
GitHub may disable scheduled workflows after about 60 days without repository
activity; make a commit or other repository activity and re-enable the workflow
in the Actions tab if that happens. Supabase Free limits and project-pausing
rules can change; check the current Supabase plan dashboard and pricing page.
Keep-alive requests cannot guarantee that a project will never pause.

### Privacy, account data, and known limits

- Saved provider keys are encrypted in your browser before they are stored.
  Settings, routes, favorites, model-check results, and activity metadata are
  stored in Supabase with owner-only RLS. Activity contains request metadata,
  not message text.
- Prompts, answers, plaintext provider keys, and the secret password are never
  stored in the database or app browser storage. Decrypted keys exist only in
  memory while the vault is unlocked.
- **Change secret password** verifies the current password with the vault
  canary, re-encrypts saved keys, and replaces the encrypted keys and canary in
  one database transaction. If that password is forgotten, the keys cannot be
  recovered; **Start over** deletes the keys and vault so a new one can be set
  up. **Delete all my app data** removes app data but keeps the sign-in account.
  To remove the account itself, contact the project administrator; no service
  role key is shipped to the browser.
- Edge Function calls and database storage are limited by the current Supabase
  Free quotas. The app's proxy also limits each account to 60 requests per
  minute. A paused project or an unavailable network produces a friendly
  notice, but cannot make the remote service available again.
- The only provider catalog live-checked during development was OpenRouter's
  public model list. Live chat/model checks against OpenRouter and live API
  behavior for Anthropic, Gemini, and DeepSeek have not been independently
  verified; the other provider adapters also have not received a full live
  integration test. The tests use mocked responses and documented fixtures.

Before going live:

- [ ] Apply migrations `0001`, `0004`–`0010` to the intended Supabase project.
- [ ] Set `APP_ORIGIN` / `APP_ORIGINS` and deploy the `route` Edge Function.
- [ ] Set the Auth Site URL, redirect URLs, and OAuth callback.
- [ ] Set hosting environment variables and replace `YOUR_PROJECT_REF` in the
      CSP headers.
- [ ] Run the keep-alive workflow manually and confirm it succeeds.
- [ ] Run the OpenRouter manual test and the production-preview CSP check below.
- [ ] Confirm the hosting platform's current free-tier, commercial-use, and
      retention terms.

For a deployment CORS smoke check, a preflight from the configured origin
should return that exact origin in `access-control-allow-origin`:

```sh
curl.exe -i -X OPTIONS "https://YOUR_PROJECT_REF.supabase.co/functions/v1/route" -H "Origin: https://your-app.example.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type,x-provider-api-key"
```

A preflight from any other origin must not return an
`access-control-allow-origin` header. With the configured origin but no JWT,
the function should reject the request with `401`. The configured origin must
exactly match the browser's scheme, hostname, and port.

For local function testing, put `APP_ORIGIN=http://localhost:5173` in
`supabase/.env.local`, then run `supabase start` and
`supabase functions serve route --env-file supabase/.env.local`. Point the
app's `.env.local` Supabase URL and anon key at the local Supabase instance.
`VITE_OPENAI_TRANSPORT=proxy` is the default; set
`VITE_OPENAI_TRANSPORT=direct` only to select browser-to-provider streaming.

## Phase 7: OpenAI-compatible gateway

The optional gateway exposes the saved **Auto** backup plan through an
OpenAI-style chat-completions endpoint. It is not enabled just by deploying the
function: in **Settings**, unlock the vault, explicitly share at least one
provider key, then create a router key. Sharing creates a separate encrypted
copy of that key for gateway use; it does not change the browser vault copy.
Only targets in the saved Auto backup plan whose provider key has been shared
can be selected. Use model `auto` to let the plan choose, or pass a model ID to
restrict the plan to matching targets.

### Deploy and configure

1. Apply the pending migrations through `0010_gateway.sql`. Check
   `supabase migration list` and confirm the linked project before running
   `supabase db push`. If the remote database already has tables but the
   migration history is missing or `db push` reports that a relation already
   exists, stop and reconcile the migration history against the actual schema;
   do not drop tables or blindly mark migrations applied.
2. Keep the existing exact `APP_ORIGIN` secret for the `route` function. For
   gateway CORS, it is accepted as one exact origin; optionally set
   `APP_ORIGINS` to a comma-separated list of exact origins (no wildcards).
   Avoid adding localhost to production unless it is intentionally needed.
3. Generate a random 32-byte master key locally and save it directly in
   **Supabase Dashboard → Edge Functions → Secrets** as
   `GATEWAY_MASTER_KEY`. On Windows PowerShell, this generates the base64 value
   and copies it to the clipboard without printing it:

   ```powershell
   $bytes = New-Object byte[] 32
   $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   [Convert]::ToBase64String($bytes) | Set-Clipboard
   $rng.Dispose()
   ```

   Store a protected backup of this secret. If it is lost, the gateway's
   encrypted copies cannot be decrypted and must be shared again. Changing it
   also requires sharing the keys again; there is no master-key rotation tool.
4. Deploy both functions:

   ```cmd
   npx.cmd supabase@latest functions deploy gateway
   npx.cmd supabase@latest functions deploy gateway-admin
   ```

   `gateway` authenticates its generated `mrk_` router keys and has Supabase
   JWT verification disabled in `supabase/config.toml`. `gateway-admin` keeps
   JWT verification enabled and verifies the signed-in owner before accepting
   a provider key for encryption. The Supabase service-role key stays in the
   Edge Function environment and must never be placed in frontend settings.

The base URL shown in Settings ends in
`/functions/v1/gateway/v1`; the chat endpoint is
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/gateway/v1/chat/completions`.
Use an OpenAI-compatible client with that URL, the one-time router key as its
Bearer key, and a body such as:

```json
{
  "model": "auto",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

Router keys are shown only once. Save one securely, or revoke it and create a
replacement. Revocation removes its stored hash immediately. Stop sharing a
provider key in Settings to remove the gateway's encrypted copy.

### Limits and privacy

- Each router key can be configured from 1–60 requests per minute and 1–10,000
  per day. Defaults are 30 per minute and 1,000 per day; no more than 10 active
  router keys are allowed per account. Counters are stored in Postgres and
  shared across Edge Function instances. This is per key, not per IP.
- Requests are limited to 256,000 bytes, 24 text messages, 12,000 characters
  per message / 48,000 total, and 4,096 generated tokens. Output is additionally
  capped at 512,000 UTF-8 bytes. The saved plan's first-token deadline applies;
  each provider attempt is limited to two minutes.
- The database stores only the SHA-256 hash of each router key. Shared provider
  keys are encrypted with AES-GCM using `GATEWAY_MASTER_KEY` and authenticated
  user/key/provider identifiers. The gateway decrypts them only to make a
  request and forwards them only to the provider host from the fixed provider
  configuration. Client URLs and client-supplied forwarding headers are not
  used.
- Prompts and answers pass through the gateway to the chosen provider but are
  not written to the database or application logs. Activity rows contain
  metadata only. The gateway returns generic error messages rather than
  provider response bodies or headers.
- Sharing is an opt-in trust decision: while enabled, the Edge Function can
  decrypt the separate key copy and send requests to that provider. Anyone
  holding a router key can use the configured limits and may incur provider
  charges. Revoke router keys and unshare provider keys that should no longer
  be usable.

### Gateway checks

After deployment, unlock Settings and share an OpenRouter key included in the
Auto backup plan. Create a router key with a low limit, copy it once, then use
the **Test gateway** action or an OpenAI-compatible client against the URL
above. Verify that usage increases and the gateway request appears in History
as metadata only. Revoke the router key and verify it is rejected. Then unshare
the provider key and verify it is no longer available to the plan.

Unit tests cover router-key hashing, encrypted key envelopes, provider
configuration synchronization, request bounds, response formats, and metadata
logging. The Edge Functions were not validated against a live Supabase project
or live provider APIs during this work. Anthropic, Gemini, and DeepSeek remain
unverified against live APIs.

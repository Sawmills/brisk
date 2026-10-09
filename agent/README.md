# Brisk Agent

The Brisk page calls Agent Platform directly. No companion service or scheduled scan is required.

The page lives at `https://brisk-agent.brisk.sm-svc.com/`. It uses Brisk's internal network access without sign-in.

## Data and access

Follows and conversation history stay in browser `localStorage`. Content snapshots and observed changes stay in browser IndexedDB.
People who share one browser profile share this data. Separate browser profiles keep separate histories.
Browser storage does not verify identity or restrict access to platform runs. This page uses Brisk's trusted team model.

Each question starts an Agent Platform run. The browser supplies bounded source snapshots and six previous messages.
Agent Platform retains run input and output under its retention policy. Clearing browser history does not delete platform records.
Closing the page does not cancel an active run. Opening it again resumes status checks.

## Content checks

Select **Check sources** to read current Brisk content. No automatic check runs after the browser closes.
The first check creates a baseline. Later checks compare saved page text and comments.
The browser keeps 30 days of change history, with at most 1000 changes.
Failed reads preserve prior content and report incomplete coverage.

Checks read at most ten text files per site and 500 recent comments per site.
Checks skip files above 2 MB and instruction files. Each file contributes at most 12000 characters.
The browser index holds at most 1500 sources. It does not execute page JavaScript.
Search uses keyword matches over the browser index. Discovery matches followed topics and sites.
Each agent run receives at most ten source matches, with at most 6000 characters per source.
The agent cannot edit source sites or change browser follows. The capability tool describes these limits.

## Platform features

The pack exposes a capability tool, a source list tool, and a deferred source read tool.
The model receives bounded frozen source text in run input. Deferred reads use the same text. They need no companion API or source credential.
Codemode can compose source reads. Terra handles initial turns. Sonnet handles later turns.
A routing choice does not guarantee both models run. The run has a $0.50 ceiling and an eight-turn budget.
Users can send a focus update during a run. It applies at the next model turn.
Jev and image generation remain disabled for this pack.

## Checks and deployment

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm format:check
```

Publish the immutable pack through the platform publication procedure. Preserve namespace policy and attestation requirements.
Provision `LITELLM_KEY_BRISK_AGENT` with dedicated pack accounting and a $10 daily cap. Model credentials remain inside platform infrastructure.
Apply `agent/deploy/worker-key.yaml` and wait for its Ready condition.
Apply `worker-key-patch.yaml` as a strategic merge patch to staging `worker-playground` only.
Keep the SSM value out of local files and command output.

Set the returned exact `brisk-agent@N` pin in `agent/site/config.json`.
A null pin disables Ask agent. It does not disable local source checks or search.

The ingress routes `/v1/agent-runs` to AgentRuns. Brisk's existing ingress serves static files and Brisk APIs.
The ingress stays on the internal staging ALB. It does not grant private user identity or browser access control.

```sh
kubectl --context <staging-context> -n agent-platform apply --dry-run=server -f agent/deploy/ingress.yaml
kubectl --context <staging-context> -n agent-platform apply -f agent/deploy/ingress.yaml
node cli/dist/cli.js deploy agent/site --server https://brisk.sm-svc.com --site brisk-agent --username yogev --yes
```

The live page uses direct platform calls. The previous task-owned companion resources have been removed.
Preserve the original Brisk deployment and production resources.

Browser control tests use Playwright and Chrome through CLI. Run them against a local static server:

```sh
PLAYWRIGHT_MODULE=<installed-playwright-module> node agent/test/browser-smoke.mjs
```

These control tests simulate the provider. Verify live model execution separately on sawmills-cloud.

# create-brisk — agent guide

`npm create brisk` asks a few questions and writes the config an instance boots
from: a compose stack, a Helm values override, or a Cloudflare checklist. Zero
runtime deps, like `cli/`.

## The coupling that will bite you

**create-brisk is downstream of `worker/src/env.ts` and `deploy/`, and almost
nothing enforces it.** The worker reads a var; the chart and compose file pass
it; this package generates both. Add a var in one place and the others keep
compiling, keep passing, and quietly scaffold an instance that can't turn the
feature on. That is not hypothetical — `DEPLOY_HISTORY`, `OPENAI_API_KEY`, and
`ALLOWED_EMAILS` all shipped missing from generated config exactly this way.

So: `answers.ts` holds `CONFIG_VARS` and `SECRET_VARS`, a hand-kept mirror of
`Env`, and `test/env-parity.test.ts` asserts the two match and that every
emitter in `generate.ts` actually writes each one. Adding a var to `Env` now
fails this package's build until you thread it through. Keep it that way — the
test is the only machine-checked link between the worker and the config people
deploy it with.

## Adding a deployment target

`Target` in `answers.ts` is a closed union, and `generate()` switches on it with
no `default`, so TypeScript forces you to handle a new member in `generate()`
and `nextSteps()`. That covers this package's _inside_. Nothing tells you about
the _outside_, so also:

- `prompts.ts` — add it to the `choose<Target>` list, or the wizard never offers
  it. **The type checker will not catch this.** Also check the
  `target !== 'cloudflare'` guard around the storage question: it's a hardcoded
  negative, so any new Node-ish target silently inherits the storage prompt (or
  doesn't) based on a name comparison rather than a property.
- `test/generate.test.ts` — the security-warning test iterates a hardcoded list
  of targets. A new target isn't covered by the `AUTH=none` / empty-allowlist
  assertions until you add it there.
- `deploy/` — if the target ships an artifact (a chart, a compose file), it lives
  there, and `deploy/README.md` documents it.

## Security invariants the tests encode

Every target must warn when the generated config would stand up an open or
wide-open instance: `AUTH=none` (an anonymously-writable backend) and
`AUTH=google` with an empty allowlist (which admits _any_ Google account, not
just your company's). If you add a target, it inherits that obligation.

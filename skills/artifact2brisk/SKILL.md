---
name: artifact2brisk
description: Deploy a claude.ai artifact as a live site on the Sawmills-internal Brisk instance (brisk.sm-svc.com). Use whenever the user pastes a claude.ai/code/artifact/... URL and wants it hosted, shared internally, "made into a brisk", "put on brisk", deployed as a site, or given a permanent internal URL — even if they just say "ship this artifact" or "put this where the team can see it". Also use for updating a previously deployed artifact site with a newer artifact version.
---

# artifact2brisk

Turn a claude.ai artifact into a site at `https://<name>.brisk.sm-svc.com/`.

Brisk is the Sawmills-internal drop-a-folder hosting platform on the staging
cluster (VPN-only). Artifacts are already self-contained single-file HTML
(strict CSP forces inline CSS/JS), which makes them perfect Brisk sites.

## Steps

1. **Fetch the artifact.** Call WebFetch on the artifact URL
   (`https://claude.ai/code/artifact/<uuid>`). Artifact URLs are a special
   case: WebFetch authenticates via the claude.ai login and returns the RAW
   HTML verbatim (prefixed with one bracketed header line naming the artifact
   and its title) — it does not summarize. Plain curl gets a Cloudflare 403;
   don't try it.

2. **Write it to a scratch file verbatim.** Save everything after the
   bracketed header line, byte-for-byte, as `<scratchpad>/artifact.html`.
   Fidelity matters more than anything else here: do not reformat, "fix", or
   abbreviate the HTML — a single mangled line of its inline JS breaks the
   page. Don't bother stripping the `<!-- frame-runtime -->` block; the
   deploy script removes it.

3. **Pick a site name.** Use the name the user gave, else slugify the artifact
   title from the header line (lowercase letters, digits, dashes only — that's
   all Brisk accepts). Confirm-worthy only if the title is unusable.

4. **Deploy.** Run the bundled script (it lives in `scripts/` inside this
   skill's own directory — resolve the path relative to this SKILL.md):

   ```sh
   <this-skill-dir>/scripts/deploy.sh <file> <site-name> [--force]
   ```

   It strips the claude.ai iframe glue, deploys to `https://brisk.sm-svc.com`
   (falling back to a kubectl port-forward into the staging cluster when off
   VPN), and prints the deploy receipt plus the final URL. A 409 means the
   site name is owned by a different deployer name — rerun with `--force`
   only if the user actually intends to overwrite that site.

5. **Report.** Give the user the live URL (`https://<name>.brisk.sm-svc.com/`,
   VPN required) and mention the site now also appears on the
   https://brisk.sm-svc.com dashboard.

## Notes

- Re-deploying to the same name updates the site in place — that's the
  intended flow for a revised artifact.
- If the fetched content is markdown rather than HTML (no `<!doctype`), wrap
  it in a minimal HTML shell (inline styles, no external assets) before
  deploying, or ask the user if they'd rather have it rendered properly.
- `BRISK_USERNAME` env var overrides the deployer attribution (defaults to
  `whoami`); `BRISK_SERVER` overrides the instance URL.

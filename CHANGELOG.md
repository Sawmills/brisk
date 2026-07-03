# Changelog

All notable changes to Brisk are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Tagged
releases are published to
[GitHub Releases](https://github.com/tomperi/brisk/releases).

## [Unreleased]

### Added

### Changed

### Fixed

## [0.1.0] - 2026-06-14

### Added

- Folder-to-site deploys on a single Cloudflare Worker, backed by R2, D1, and
  Durable Objects — atomic version swaps, first-come site names, no config
  files.
- The `brisk` CLI: `init`, `deploy`, `dev` (watch and redeploy on every save),
  `list`, `open`, and `pull` to download any site's source. `brisk login`
  stores AWS-style per-instance profiles (`whoami`, `profiles`,
  `profile use`).
- The zero-dependency browser SDK served at `/brisk.js`: `brisk.db`
  (schemaless collections with realtime subscriptions), `brisk.fs` (uploads to
  permanent URLs), `brisk.channel` (realtime messaging and presence),
  `brisk.me` (identity), and `brisk.ai` (LLM calls proxied through the
  server's Anthropic/OpenAI keys).
- Realtime over one Durable Object per site — database change events, channel
  messages, and presence — using WebSocket hibernation so idle rooms cost
  nothing.
- Optional Google OAuth on the apex domain with a session cookie scoped to
  every site subdomain, plus `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS`
  allowlists, personal CLI tokens, and a CI deploy token.
- `VISIBILITY=public` demo mode: signed-out visitors get edge-cached,
  view-only access while every `brisk.*` API stays members-only.
- The dashboard at the apex domain — a live list of every site, drag-and-drop
  deploys with a launch flow and confetti, a one-page SDK reference at
  `/docs`, and a self-hosting guide at `/host`.
- `@usebrisk/cli` and `@usebrisk/sdk` published to npm, cut in lockstep by a
  tag-driven release workflow.

[unreleased]: https://github.com/tomperi/brisk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tomperi/brisk/releases/tag/v0.1.0

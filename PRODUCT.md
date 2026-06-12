# Brisk

## Product Purpose

Brisk is an open-source internal hosting platform inspired by Shopify's Quick:
drop a folder of HTML, get a live site at a subdomain, plus a zero-config
browser API for database, file uploads, AI, realtime channels, and identity.
It runs entirely on Cloudflare (Workers, R2, D1, Durable Objects) and costs
approximately nothing.

The dashboard (the "home" site) is the front door: it lists every site on the
instance, teaches the two commands you need, and documents the SDK.

## Register

product

## Users

Engineers, designers, and PMs inside a company that self-hosts Brisk. They
arrive mid-task: either "I want to ship this folder" (needs the deploy command
fast) or "what did my teammate ship?" (needs the site list, freshest first).
Comfortable with terminals. Allergic to enterprise dashboards.

## Brand & Tone

- Geocities energy with engineering discipline: playful, fast, personal, but
  precise. The early-2000s web without the downsides.
- Terminal-native: monospace is load-bearing, commands are first-class content.
- The platform's whole pitch is "less than you expect": no config, no
  permissions, no build step. The design should feel like that — almost
  nothing, but every detail considered.

## Anti-references

- Vercel/Netlify deploy dashboards (card grids, status badges, usage meters).
- Enterprise admin templates: sidebars, breadcrumbs, stat tiles.
- AI-slop aesthetics: purple gradients, glassmorphism, Inter-on-dark-blue.

## Strategic principles

- The site list is the product. Every deployed site is one row; rows read like
  a living changelog of what the company is making.
- Zero onboarding ceremony: the empty state IS the quickstart.
- Documentation lives one click away and reads like a good README, not a docs
  portal.

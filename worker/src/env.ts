export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;

  /** Sites hang off this host (`foo.<BASE_HOST>`). Empty = path-only mode. */
  BASE_HOST: string;
  /** "google" = Google OAuth on the apex domain; "none" = trusted network. */
  AUTH: 'none' | 'google';
  /** Comma-separated email domains allowed through OAuth. Empty = allow all. */
  ALLOWED_EMAIL_DOMAINS: string;

  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEPLOY_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

export interface User {
  email: string;
  name: string;
  picture?: string;
}

/** Hono app environment: bindings plus per-request site + user. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Site this request belongs to (subdomain, /s/<site> prefix, or header). */
    site: string;
    user: User;
  };
};

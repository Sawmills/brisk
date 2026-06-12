import { createApp } from './app';
import type { Env } from './env';

export { SiteRoom } from './room';

const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;

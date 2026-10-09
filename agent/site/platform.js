export class AgentPlatform {
  constructor({
    origin,
    namespace = 'playground',
    pack,
    fetcher = (...args) => fetch(...args),
  } = {}) {
    this.origin = origin;
    this.namespace = namespace;
    this.pack = pack;
    this.fetch = fetcher;
    if (pack && !/^brisk-agent@[1-9][0-9]*$/.test(pack))
      throw new Error('Pin an immutable brisk-agent pack version');
  }
  get ready() {
    return Boolean(this.origin && this.pack);
  }
  headers() {
    return {
      'content-type': 'application/json',
      'x-namespace': this.namespace,
      'x-org-id': this.namespace,
    };
  }
  async request(path, body) {
    if (!this.ready) throw new Error('Agent Platform is not configured');
    const response = await this.fetch(new URL(path, this.origin), {
      method: body === undefined ? 'GET' : 'POST',
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Agent Platform request failed (${response.status})`);
    return response.json();
  }
  async start(question, sources, requestId, history = [], coverage = {}) {
    const body = await this.request('/v1/agent-runs', {
      service: this.pack,
      agent: 'brisk-agent',
      trigger: 'TRIGGER_API_CALL',
      input: {
        question,
        coverage,
        history,
        sources: sources.map(({ id, title, url, excerpt, text, checked }) => ({
          id,
          title,
          url,
          excerpt,
          text: text.slice(0, 6000),
          checked,
        })),
      },
      idempotencyKey: requestId,
      executionPolicy: { startToClose: '180s', scheduleToStart: '60s' },
    });
    const id = body.runId ?? body.run_id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
      throw new Error('Agent Platform returned no run ID');
    return id;
  }
  result(id) {
    return this.request(`/v1/agent-runs/${id}/result`);
  }
  instruct(id, content, requestId) {
    return this.request(`/v1/agent-runs/${id}/instructions`, { apiVersion: 1, requestId, content });
  }
  async events(id, signal, sequence = 0) {
    const response = await this.fetch(
      new URL(`/v1/agent-runs/${id}/stream?from_sequence=${sequence}`, this.origin),
      { headers: { ...this.headers(), accept: 'text/event-stream' }, signal },
    );
    if (!response.ok) throw new Error(`Agent stream failed (${response.status})`);
    return response;
  }
}

export function finalText(result) {
  if (result.error) return String(result.error);
  const output = result.output;
  const message = [...(output?.messages ?? [])].reverse().find((m) => m.role === 'assistant');
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content))
    return message.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
  return typeof output?.text === 'string' ? output.text : '';
}

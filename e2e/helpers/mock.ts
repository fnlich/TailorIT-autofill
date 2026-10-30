/*
 * The specs' handle on the TailorIT mock (e2e/mock-server/mock.mjs), which scripts/e2e.mjs runs on port 3190: reset it
 * before each test, script its answers, and read its request log (Authorization redacted). It talks to 127.0.0.1, so
 * the test process never depends on how localhost resolves; the extension calls the same server as localhost.
 */
import { GOLDEN_RESUME, MOCK_SCENARIOS } from '../mock-server/mock.mjs';

export { GOLDEN_RESUME, MOCK_SCENARIOS };

/** The mock's address for the test process. */
export const MOCK_CONTROL = 'http://127.0.0.1:3190';

/** A scripted answer's name. */
export type MockScenario = keyof typeof MOCK_SCENARIOS;

/** One request the mock received, as its log holds it. */
export interface MockRequest {
  at: number;
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string;
  /** The answer's status; 0 while a slow answer is still waiting, and when its client went away first. */
  status: number;
}

async function control(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${MOCK_CONTROL}${path}`, init);
  if (!response.ok) throw new Error(`the mock refused ${path}: ${response.status}`);
  return response;
}

export const mock = {
  /** Forgets every request, scenario and code, and makes the golden token valid with all its scopes again. */
  async reset(): Promise<void> {
    await control('/__mock/reset', { method: 'POST' });
  },
  /** Turns a scripted answer on, for `times` matching requests (default: until the next reset). */
  async scenario(name: MockScenario, options: { times?: number; delayMs?: number } = {}): Promise<void> {
    await control('/__mock/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...options }) });
  },
  async requests(): Promise<MockRequest[]> {
    return (await (await control('/__mock/requests')).json()) as MockRequest[];
  },
  /** The requests to one route ("POST /api/autofill/lookup"); a path ending in * matches its prefix. */
  async requestsTo(route: string): Promise<MockRequest[]> {
    const [method, path] = route.split(' ') as [string, string];
    const matches = path.endsWith('*') ? (p: string) => p.startsWith(path.slice(0, -1)) : (p: string) => p === path;
    return (await this.requests()).filter((request) => request.method === method && matches(request.path));
  },
};

/** The golden resume's file route, as the worker calls it. */
export const RESUME_FILE_ROUTE = `GET /api/autofill/resumes/${GOLDEN_RESUME.id}/file`;

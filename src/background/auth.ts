/*
 * Pairing and the bearer token. The token lives in the extension origin's IndexedDB and in the worker's memory; no
 * content script, page or answer ever receives it. Pairing (docs/ARCHITECTURE.md, "TailorIT's side › Pairing"):
 * auth/startPairing keeps a single-use state for 10 minutes in storage.session and opens TailorIT's connect page; the
 * page sends pair/complete {state, code}, accepted only from TailorIT's exact origin with that pending state; the
 * worker redeems the code (no cookie, no Authorization header), stores the token, reads GET /session and answers ok.
 * auth/redeemCode is the options page's fallback for a typed code. A 401 on any token request drops the token.
 */
import { normalizeConnectCode } from '../contract/tailorit/connect';
import { ok, refuse, type Answer } from '../messaging/envelope';
import type { AuthStatus, ExternalMessage } from '../messaging/schemas';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { PAIRING_KEY, PairingRecordSchema, TokenRecordSchema, type TokenRecord } from '../shared/stored';
import { toBase64Url } from './bytes';
import { createKeyedQueue } from './locks';
import { CONNECT_PAGE_PATH } from './senders';
import type { ServerClient, ServerResult } from './server-client';

/** How long a pairing waits for TailorIT's page. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;

/** Why the last token went: the person disconnected, TailorIT refused it (401), or it reached its expiry. */
export type TokenDrop = 'disconnected' | 'revoked' | 'expired';

/** The token in memory, backed by IndexedDB. It never hands the token to anything but the server client. */
export interface TokenKeeper {
  /** The token's record when one is held and unexpired; reads IndexedDB once per worker life. */
  current(): Promise<TokenRecord | null>;
  /** The token itself, for the server client only. */
  token(): Promise<string | null>;
  store(record: TokenRecord): Promise<void>;
  forget(reason: TokenDrop): Promise<void>;
  /** Forgets the token only when it is still `token` (a 401 for an older one changes nothing). */
  forgetIfCurrent(token: string, reason: TokenDrop): Promise<void>;
  /** An answer named a version: true when it is this extension's. */
  noteVersion(matches: boolean): void;
  readonly versionMismatch: boolean;
  /** Why the last token went, when it did not go at the person's request; null otherwise. */
  readonly lastDrop: 'revoked' | 'expired' | null;
}

/** `onChange` runs whenever the token is stored or forgotten: whatever was read with the old one is dropped. */
export function createTokenKeeper(platform: Pick<WorkerPlatform, 'secrets' | 'now'>, onChange: () => void): TokenKeeper {
  let read: Promise<TokenRecord | null> | null = null;
  let record: TokenRecord | null = null;
  let versionMismatch = false;
  let lastDrop: 'revoked' | 'expired' | null = null;

  async function load(): Promise<TokenRecord | null> {
    let stored: unknown;
    try {
      stored = await platform.secrets.get();
    } catch {
      log('auth.token-unreadable');
      return null;
    }
    if (stored === undefined || stored === null) return null;
    const parsed = TokenRecordSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    log('auth.token-unreadable');
    await platform.secrets.clear().catch(() => undefined);
    return null;
  }

  const keeper: TokenKeeper = {
    async current() {
      if (read === null) {
        read = load().then((loaded) => {
          record = loaded;
          return loaded;
        });
      }
      await read;
      if (record !== null && record.expiresAt <= platform.now()) await keeper.forget('expired');
      return record;
    },
    async token() {
      return (await keeper.current())?.token ?? null;
    },
    async store(next) {
      const checked = TokenRecordSchema.parse(next);
      await platform.secrets.set(checked);
      read = Promise.resolve(checked);
      record = checked;
      lastDrop = null;
      versionMismatch = false;
      onChange();
    },
    async forget(reason) {
      const held = record !== null;
      read = Promise.resolve(null);
      record = null;
      lastDrop = reason === 'disconnected' ? null : reason;
      versionMismatch = false;
      await platform.secrets.clear().catch(() => undefined);
      if (held) log(reason === 'disconnected' ? 'auth.disconnected' : 'auth.token-dropped');
      onChange();
    },
    async forgetIfCurrent(token, reason) {
      if (record !== null && record.token === token) await keeper.forget(reason);
    },
    noteVersion(matches) {
      versionMismatch = !matches;
    },
    get versionMismatch() {
      return versionMismatch;
    },
    get lastDrop() {
      return lastDrop;
    },
  };
  return keeper;
}

/** What pairing and the connection need. */
export interface AuthDeps {
  platform: WorkerPlatform;
  /** TailorIT's origin, fixed per build. */
  origin: string;
  server: ServerClient;
  keeper: TokenKeeper;
  storageAccess(): AuthStatus['storageAccess'];
}

/** The connection as extension pages and TailorIT's connect page drive it. */
export interface Auth {
  connected(): Promise<boolean>;
  status(): Promise<AuthStatus>;
  startPairing(): Promise<Answer<{ expiresAt: number }>>;
  /** pair/complete from TailorIT's connect page; its sender was checked by the caller. */
  completePairing(message: ExternalMessage): Promise<Answer<Record<string, never>>>;
  redeemCode(code: string): Promise<Answer<AuthStatus>>;
  disconnect(): Promise<Answer<AuthStatus>>;
}

/** The account as the options page shows it, cut to the answer's caps. */
const accountOf = (account: { name: string; email: string }) => ({
  name: account.name.slice(0, 200),
  email: account.email.slice(0, 254),
});

/** A redeem refusal as the page's error: a wrong, used or expired code is 'expired'. */
function redeemRefusal(result: Extract<ServerResult<unknown>, { ok: false }>): Answer<never> {
  if (result.failure === 'rate-limited') {
    return result.retryAfterSeconds === undefined
      ? refuse('rate_limited')
      : { ok: false, error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds };
  }
  if (result.failure === 'unauthorized') return refuse('expired');
  if (result.failure === 'bad-request') return refuse('bad_message');
  return refuse('unavailable');
}

/** Pairing, the typed-code fallback, disconnecting and the status the options page shows. */
export function createAuth(deps: AuthDeps): Auth {
  const { platform, server, keeper } = deps;
  const session = platform.storage.session;
  /** Read from TailorIT's session, kept in memory only: never stored. */
  let account: { name: string; email: string } | null = null;
  /** Pairing steps run one at a time, so two pair/complete messages can never both take the one pending state. */
  const pairing = createKeyedQueue();

  async function pendingPairing() {
    const parsed = PairingRecordSchema.safeParse(await session.get(PAIRING_KEY));
    if (!parsed.success) return null;
    if (parsed.data.expiresAt <= platform.now()) {
      await session.remove([PAIRING_KEY]);
      return null;
    }
    return parsed.data;
  }

  async function readAccount(): Promise<void> {
    const answer = await server.session();
    if (answer.ok) account = accountOf(answer.value.account);
  }

  /** Exchanges a normalized code for a token, stores it, then reads the session. */
  async function redeem(code: string): Promise<Answer<null>> {
    const client = await platform.runtime.clientInfo();
    const result = await server.redeem({
      code,
      client: { browser: client.browser, extensionVersion: platform.runtime.version, os: client.os },
    });
    if (!result.ok) {
      log('auth.redeem-failed', { status: result.status ?? 0 });
      return redeemRefusal(result);
    }
    const expiresAt = Date.parse(result.value.expiresAt);
    const previous = await keeper.current();
    await keeper.store({
      token: result.value.token,
      tokenId: result.value.tokenId,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
      scopes: result.value.scopes,
    });
    account = accountOf(result.value.account);
    // A browser holds one connection: the one it replaced is revoked, best effort.
    if (previous !== null && previous.token !== result.value.token) void server.endSession(previous.token);
    await readAccount();
    if ((await keeper.current()) === null) return refuse('unavailable');
    log('auth.connected', { scopes: result.value.scopes.length });
    return ok(null);
  }

  async function status(): Promise<AuthStatus> {
    let record = await keeper.current();
    if (record !== null && account === null) {
      await readAccount();
      record = await keeper.current();
    }
    const pairing = await pendingPairing();
    return {
      connection: record !== null ? 'connected' : (keeper.lastDrop ?? 'not-connected'),
      account: record !== null ? account : null,
      scopes: record?.scopes ?? [],
      expiresAt: record?.expiresAt ?? null,
      storageAccess: deps.storageAccess(),
      versionMismatch: keeper.versionMismatch,
      pairingExpiresAt: pairing?.expiresAt ?? null,
    };
  }

  return {
    connected: async () => (await keeper.current()) !== null,
    status,
    startPairing() {
      return pairing.run(PAIRING_KEY, async () => {
        const state = toBase64Url(platform.randomBytes(32));
        const expiresAt = platform.now() + PAIRING_TTL_MS;
        await session.set({ [PAIRING_KEY]: { state, expiresAt } });
        const params = new URLSearchParams({ tab: 'extension', connect: '1', state });
        try {
          await platform.tabs.create(`${deps.origin}${CONNECT_PAGE_PATH}?${params.toString()}`);
        } catch {
          await session.remove([PAIRING_KEY]);
          return refuse('unavailable');
        }
        log('auth.pairing-started');
        return ok({ expiresAt });
      });
    },
    async completePairing(message) {
      const taken = await pairing.run(PAIRING_KEY, async () => {
        const pending = await pendingPairing();
        if (pending === null) {
          log('auth.pairing-refused', { pending: false });
          return refuse('expired');
        }
        if (pending.state !== message.state) {
          log('auth.pairing-refused', { pending: true });
          return refuse('bad_sender');
        }
        // Single use: the state is gone before the code is redeemed, whatever the outcome.
        await session.remove([PAIRING_KEY]);
        return ok(null);
      });
      if (!taken.ok) return taken;
      const code = normalizeConnectCode(message.code);
      if (code === null) return refuse('bad_message');
      const redeemed = await redeem(code);
      return redeemed.ok ? ok({}) : redeemed;
    },
    async redeemCode(typed) {
      const code = normalizeConnectCode(typed);
      if (code === null) return refuse('bad_message');
      const redeemed = await redeem(code);
      return redeemed.ok ? ok(await status()) : redeemed;
    },
    async disconnect() {
      const record = await keeper.current();
      await keeper.forget('disconnected');
      account = null;
      // Revoke on TailorIT too, best effort: the token is already gone from this browser.
      if (record !== null) await server.endSession(record.token);
      return ok(await status());
    },
  };
}

/*
 * v4 ui: the side panel's check that the profile is complete reads panel/profile {sensitive: false}: the profile alone,
 * never the sensitive part (work authorization, self-identification), even where the connection may read it. The
 * editor's own read (no flag) still reads both.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRateLimit } from './locks';
import { createProfileEditor } from './profile-editor';
import { goldens } from './worker.testkit';

describe('the side panel’s profile check (v4 ui)', () => {
  it('reads the profile alone with sensitive: false, and both for the editor', async () => {
    const server = {
      profile: vi.fn(async () => ({ ok: true as const, value: { ...goldens.profile, anythingElseFlaggedLines: [] } as never })),
      sensitive: vi.fn(async () => ({ ok: true as const, value: goldens.sensitive as never })),
      putProfile: vi.fn(),
    };
    const editor = createProfileEditor({ server: server as never, profiles: { drop: () => undefined },
      connected: async () => true, scopes: async () => ['profile:read', 'profile:sensitive'] as never,
      limit: createRateLimit(20, 60_000, () => 0) });
    expect(await editor.read({ v: 1, type: 'panel/profile', sensitive: false }))
      .toMatchObject({ ok: true, data: { sensitive: { state: 'not-shared' } } });
    expect([server.profile.mock.calls.length, server.sensitive.mock.calls.length]).toEqual([1, 0]);
    expect(await editor.read({ v: 1, type: 'panel/profile' }))
      .toMatchObject({ ok: true, data: { sensitive: { state: 'shared' } } });
    expect(server.sensitive).toHaveBeenCalledOnce();
  });
});

// v5 p1-panel (the Phase 1 review, S6): the check worked out in the worker, answered by name only.
describe('the panel’s profile check, worked out in the worker (v5)', () => {
  const editorOver = (profile: unknown, accountEmail: string | null = null) => {
    const server = {
      profile: vi.fn(async () => ({ ok: true as const, value: { profile, revision: 3, anythingElseFlaggedLines: [] } as never })),
      sensitive: vi.fn(async () => ({ ok: true as const, value: goldens.sensitive as never })),
      putProfile: vi.fn(),
    };
    const editor = createProfileEditor({ server: server as never, profiles: { drop: () => undefined },
      connected: async () => true, scopes: async () => ['profile:read', 'profile:sensitive'] as never,
      limit: createRateLimit(20, 60_000, () => 0), accountEmail: async () => accountEmail });
    return { server, editor };
  };

  it('answers what the profile lacks, by name only: never a value, never the sensitive part read', async () => {
    const full = goldens.profile.profile;
    const { server, editor } = editorOver(full);
    const answer = await editor.check();
    expect(answer).toEqual({ ok: true, data: { gaps: [], history: [] } });
    expect(server.sensitive).not.toHaveBeenCalled();
    // Nothing of the profile travels in the answer.
    for (const value of [full.name.first, full.name.last, full.contact.email]) {
      expect(JSON.stringify(answer)).not.toContain(value);
    }
    // A profile with no phone, no place and no history: those names; an empty email the account's address stands for.
    const lacking = { ...full, contact: { ...full.contact, email: '', phone: { ...full.contact.phone, number: '' },
      address: { ...full.contact.address, city: '', country: null } }, experience: [], education: [] };
    expect(await editorOver(lacking, 'morgan@example.test').editor.check())
      .toEqual({ ok: true, data: { gaps: ['phone', 'place'], history: ['experience', 'education'] } });
    expect(await editorOver(lacking, null).editor.check())
      .toEqual({ ok: true, data: { gaps: ['email', 'phone', 'place'], history: ['experience', 'education'] } });
  });

  it('refuses while not connected, and says when TailorIT could not be read', async () => {
    const offline = createProfileEditor({ server: { profile: vi.fn(), sensitive: vi.fn(), putProfile: vi.fn() } as never,
      profiles: { drop: () => undefined }, connected: async () => false, scopes: async () => [] as never,
      limit: createRateLimit(20, 60_000, () => 0) });
    expect(await offline.check()).toEqual({ ok: false, error: 'not_connected' });
    const failing = createProfileEditor({ server: { profile: vi.fn(async () => ({ ok: false as const, failure: 'unavailable',
      status: 503 })), sensitive: vi.fn(), putProfile: vi.fn() } as never, profiles: { drop: () => undefined },
    connected: async () => true, scopes: async () => [] as never, limit: createRateLimit(20, 60_000, () => 0) });
    expect(await failing.check()).toEqual({ ok: false, error: 'unavailable' });
  });
});

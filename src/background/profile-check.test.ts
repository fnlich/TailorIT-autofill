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

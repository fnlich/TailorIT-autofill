/*
 * The side panel's profile editor in the worker (v3 Phase 3b, profile-editor.ts), over a scripted server: what a save
 * does to the worker's profile cache. A save made, one TailorIT may have made, and a 409 (the profile changed elsewhere,
 * so the worker's copy is stale) drop it; a refusal before TailorIT changed anything keeps it.
 */
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_AUTOFILL_PROFILE, type ExtensionScope } from '../contract/tailorit';
import { createRateLimit } from './locks';
import { createProfileEditor } from './profile-editor';
import type { ServerResult } from './server-client';

const SCOPES: readonly ExtensionScope[] = ['profile:read', 'profile:write'];

/** An editor whose PUT /profile answers `put`; `drop` spies on the cache. */
function editorAnswering(put: ServerResult<unknown>) {
  const drop = vi.fn();
  const editor = createProfileEditor({
    server: {
      profile: vi.fn(),
      sensitive: vi.fn(),
      putProfile: vi.fn(async () => put),
    } as never,
    profiles: { drop },
    connected: async () => true,
    scopes: async () => SCOPES,
    limit: createRateLimit(100, 60_000, () => 0),
  });
  return { editor, drop };
}

const PROFILE = { ...EMPTY_AUTOFILL_PROFILE, name: { ...EMPTY_AUTOFILL_PROFILE.name, first: 'Morgan', last: 'Lee' } };
const save = { v: 1 as const, type: 'panel/saveProfile' as const, revision: 3, profile: PROFILE };

describe('the profile editor’s save and the worker’s profile cache', () => {
  it('drops the cache after a 409: the profile changed elsewhere, so the copy the worker holds is stale', async () => {
    const { editor, drop } = editorAnswering({ ok: false, failure: 'conflict', status: 409, code: 'revision_conflict' });
    expect(await editor.save(save)).toEqual({ ok: true, data: { outcome: 'conflict' } });
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it('drops it after a save, or one TailorIT may have made; keeps it after a refusal that changed nothing', async () => {
    const saved = editorAnswering({ ok: true, value: { revision: 4, updatedAt: null, profile: EMPTY_AUTOFILL_PROFILE,
      anythingElseFlaggedLines: [] } });
    expect((await saved.editor.save(save)).ok).toBe(true);
    expect(saved.drop).toHaveBeenCalledTimes(1);
    const unknown = editorAnswering({ ok: false, failure: 'timeout' });
    await unknown.editor.save(save);
    expect(unknown.drop).toHaveBeenCalledTimes(1);
    for (const failure of ['forbidden', 'bad-request', 'rate-limited', 'not-connected'] as const) {
      const refused = editorAnswering({ ok: false, failure, status: 400 });
      await refused.editor.save(save);
      expect(refused.drop, failure).not.toHaveBeenCalled();
    }
  });
});

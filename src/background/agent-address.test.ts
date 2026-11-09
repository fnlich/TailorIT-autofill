/*
 * The P2 review (L3): the agent opens an address only on a host the manifest's content script runs on
 * (shared/hosts.ts staticPlatformOfUrl). An employer's own domain at Oracle's Candidate Experience address, which
 * platformOfUrl names Oracle's by its address alone and whose content script comes only through the sentinel once the
 * page shows the app, is never the agent's, whether or not the career sites act. TailorIT's agentApplicationUrl gives no
 * Oracle address today (the agent's ATSs: AUTOFILL_AGENT_ATS), so it is stood in for here by one that gives back the
 * address it reads: the guard itself is what this holds.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as Contract from '../contract/tailorit';

vi.mock('../contract/tailorit', async (original) => ({
  ...(await original<typeof Contract>()),
  agentApplicationUrl: (url: string) => url,
}));

const { agentAddressOf } = await import('./agent');

describe("the agent's addresses (the P2 review, L3)", () => {
  it("never opens an employer's own domain at Oracle's Candidate Experience address", () => {
    expect(agentAddressOf('https://careers.acme-corp.example/hcmUI/CandidateExperience/en/sites/CX_1/job/12345/apply/section/1'))
      .toBeNull();
  });

  it("opens Oracle's own tenants' and the other static hosts' addresses as before", () => {
    const tenant = 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/section/1';
    expect(agentAddressOf(tenant)).toMatchObject({ address: tenant });
    expect(agentAddressOf(tenant)?.applicationKey).toMatch(/^oracle:[0-9a-f]{16}$/);
    expect(agentAddressOf('https://jobs.lever.co/acme/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00/apply'))
      .toMatchObject({ applicationKey: expect.stringMatching(/^lever:/) });
    expect(agentAddressOf('https://careers.acme-corp.example/jobs/1')).toBeNull();
  });
});

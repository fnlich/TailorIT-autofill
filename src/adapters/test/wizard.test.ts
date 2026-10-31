/*
 * The wizard's e2e-only test adapter in the registry (src/adapters/index.ts adaptersFor): first on the wizard's
 * addresses in an e2e build (__E2E__ on), absent with the switch off, as in every production build, and its
 * addresses one application each.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../generic';
import { adaptersFor, applicationOf } from '../index';
import { leverAdapter } from '../lever';
import { E2E_TEST_ADAPTER_MARKER, isWizardUrl, WIZARD_URL } from './index';

const CASES = ['wizard-4-step', 'wizard-4-step-off', 'wizard-4-step-auto', 'wizard-4-step-reload', 'wizard-4-step-restart']
  .map((name) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`);

describe("the wizard's test adapter in the registry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is not offered with the switch off, as in every production build', () => {
    expect(__E2E__).toBe(false);
    for (const address of CASES) expect(adaptersFor(new URL(address)), address).toEqual([leverAdapter, genericAdapter]);
  });

  it("comes first on the wizard's addresses with the switch on, with the marker and the step hooks", () => {
    vi.stubGlobal('__E2E__', true);
    for (const address of CASES) {
      const [first, ...rest] = adaptersFor(new URL(`${address}#step-2`));
      expect(first, address).toMatchObject({ id: 'generic', testOnly: E2E_TEST_ADAPTER_MARKER });
      expect(['stepSignature', 'nextButton', 'submitButton', 'isFinalStep', 'repeatables', 'detect']
        .filter((hook) => typeof (first as unknown as Record<string, unknown>)[hook] !== 'function'), address).toEqual([]);
      expect(rest).toEqual([leverAdapter, genericAdapter]);
    }
    expect(adaptersFor(new URL('https://jobs.lever.co/tailorit-fixture/conditional-reveal/apply'))
      .some((adapter) => 'testOnly' in adapter)).toBe(false);
  });

  it('keys each case as an application of its own, its fragment and query aside', () => {
    expect(CASES.every((address) => isWizardUrl(new URL(address)))).toBe(true);
    expect(CASES[0]).toBe(WIZARD_URL);
    const keys = CASES.map((address) => applicationOf(new URL(address))!.applicationKey);
    expect(new Set(keys).size).toBe(CASES.length);
    expect(applicationOf(new URL(`${WIZARD_URL}?x=1#step-3`))!.applicationKey).toBe(keys[0]);
  });
});

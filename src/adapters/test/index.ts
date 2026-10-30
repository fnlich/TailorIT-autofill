/*
 * The e2e-only test adapter (docs/ARCHITECTURE.md, the trap table, row 9(d)). Trap 09's case (d) is a visible
 * <button type="button">Attach</button> beside a hidden file input that no label ties to it, so only an adapter can
 * declare that button the input's upload widget, as Lever's and Greenhouse's adapters do for their own Attach
 * controls. This adapter does so for the trap page alone, https://jobs.lever.co/tailorit-fixture/trap-09/apply, and is
 * the generic adapter otherwise; its hooks name the trap fixture they were read from.
 *
 * The registry puts it first for that address in e2e builds only. A production build replaces __E2E__ with false, so
 * the registry's one reference to this module is dead code and the module is compiled out; scripts/check-build.mjs
 * fails a production bundle that holds E2E_TEST_ADAPTER_MARKER. Nothing here may run at import time (top-level
 * constants and functions only), so the bundler can drop the module whole.
 */
import { genericAdapter } from '../generic';
import { genericCanonicalUrl } from '../generic/url';
import type { Adapter } from '../types';

/** The string scripts/check-build.mjs looks for in production bundles: it is in a bundle only when this module is. */
export const E2E_TEST_ADAPTER_MARKER = 'tailorit-e2e-test-adapter';

/** The trap page this adapter is for, as the e2e suite serves it. */
export const TRAP_09_URL = 'https://jobs.lever.co/tailorit-fixture/trap-09/apply';

/** An adapter compiled into e2e builds only. It carries the marker, so a test can tell it apart. */
export interface TestAdapter extends Adapter {
  readonly testOnly: typeof E2E_TEST_ADAPTER_MARKER;
}

/** Whether an address shows the trap 09 page (its query and fragment aside). */
function isTrap09(url: URL): boolean {
  return `${url.origin}${url.pathname}` === TRAP_09_URL;
}

/** Trap 09's adapter: the generic one, plus case (d)'s upload widget and label. */
function trap09Adapter(): TestAdapter {
  return {
    ...genericAdapter,
    testOnly: E2E_TEST_ADAPTER_MARKER,
    matchesUrl: isTrap09,
    canonicalApplicationUrl: (url) => (isTrap09(url) ? genericCanonicalUrl(url) : null),
    // fixtures/traps/09-hidden-file-input.html: <div class="field" id="field-d"><span class="caption"
    // id="label-d">Resume</span><button type="button" id="attach-d">Attach</button><input type="file" id="file-d"
    // name="document_d" style="display: none"></div>
    uploadWidgets(root) {
      const control = root.querySelector('button#attach-d');
      const input = root.querySelector<HTMLInputElement>('input#file-d[type="file"]');
      return control === null || input === null ? [] : [{ control, input }];
    },
    labelFor(control) {
      if (control.localName !== 'input' || control.id !== 'file-d') return null;
      const label = control.ownerDocument.getElementById('label-d');
      return label !== null && label.parentElement === control.parentElement ? label : null;
    },
  };
}

/** The adapters an e2e build tries first for an address: trap 09's on its page, none anywhere else. */
export function e2eAdaptersFor(url: URL): TestAdapter[] {
  return isTrap09(url) ? [trap09Adapter()] : [];
}

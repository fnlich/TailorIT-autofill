/*
 * v5 p1-shell: the settings every e2e test starts from (the `connected` fixture saves them first): the product's own
 * defaults (src/core/types/settings.ts), but with "Default view: Minimized", so the sidebar does not open by itself on
 * every page: a spec that counts TailorIT's requests, stops the worker or times a run sees only what it drives, never a
 * sidebar's own reads (its job card, its letter check, its port keeping the worker awake). The pill still shows. The
 * sidebar's own specs (56-sidebar, 60-strict-csp) save PRODUCT_SETTINGS, the product's defaults, and open it as a
 * person's browser does. Specs import DEFAULT_SETTINGS from here, so their own resets keep the sidebar minimized.
 */
import { DEFAULT_SETTINGS as PRODUCT, type Settings } from '../../src/core/types/settings';

/** The product's own defaults ("Where the panel shows: On the page", "Default view: Expanded"). */
export const PRODUCT_SETTINGS: Settings = PRODUCT;

/** The e2e suite's defaults: the product's, the sidebar minimized. */
export const DEFAULT_SETTINGS: Settings = { ...PRODUCT, view: 'minimized' };

# TailorIT Autofill

A Manifest V3 browser extension that fills job applications on Greenhouse, Lever, Ashby, Workable, Workday, iCIMS, Taleo, SuccessFactors, Oracle Recruiting Cloud, SmartRecruiters, Jobvite, JazzHR, BambooHR, Rippling, Breezy HR, CareerPlug, Pinpoint, Paycor, HiBob, UltiPro, Dayforce, Paylocity, Dice, ClearCompany and ADP Workforce Now (and, once you turn it on, on employers' own careers sites) from the profile you keep in [TailorIT](../TailorIT). One click fills what it is sure of, with TailorIT's AI answering what your profile does not; everything is listed for you to review in the side panel. It submits an application only when you press Submit application in its panel, turn Submit mode to Auto (Manual by default), or turn on Run auto-apply for the jobs you queue in TailorIT (off by default).

The specification is [docs/SPEC.md](docs/SPEC.md); the design is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Work proceeds in phases 0-6, each ending with a report.

**Status:** v3, through Phase 8 (LinkedIn deferred to v5), and the snapshot build of 2026-11-06: it fills one-page and multi-step applications on the 25 sites above, and submits them only as described; the auto-apply agent, Sign-in Auto and Company career sites are built. [docs/OWNER-QUESTIONS.md](docs/OWNER-QUESTIONS.md) lists what still waits for the owner.

## Setup
Node 24 (`>=24.11 <25`), Windows first.

```
npm install
npx playwright install chromium
```

## Scripts
| Script | What it does |
|---|---|
| `npm run build` / `npm run build:edge` | Production builds in `.output/chrome-mv3` and `.output/edge-mv3` |
| `npm run zip` / `npm run zip:edge` | Zipped builds in `.output/` |
| `npm run dev` | A development build in `.output/chrome-mv3-dev` (adds the snapshot hotkey; never used by tests) |
| `npm run typecheck` | The app, the DOM-free core, the core's tests, and the tools |
| `npm run lint` | ESLint, including the layer and purity rules |
| `npm test` | Unit tests in Node (projects `core` and `ext`) |
| `npm run test:dom` | DOM tests in Chromium (Vitest browser mode) |
| `npm run test:e2e` | Builds production and the e2e variant, checks both, starts the TailorIT mock on 3190, runs Playwright |
| `npm run check:build` | Fails a build whose manifest drifts from the allowed one |
| `npm run verify` | All of the above in order, stopping at the first failure |
| `npm run icons` | Renders TailorIT's mark (its `logo-mark.svg`, drawn as data in `src/shared/icons.ts`) into the manifest's PNGs in `public/icon` |
| `npm run shots` | Opt-in, never part of verify: the e2e build against the mock draws the side panel, the in-page panel, the launcher and the options page into `e2e/artifacts/shots`; `TIA_SHOTS_REFERENCE` may name a local folder of reference pictures to show beside them |

## Loading the extension
Build it, open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, choose **Load unpacked** and pick `.output/chrome-mv3` (or `.output/edge-mv3`). The manifest carries a fixed public key, so the extension id is always `flmloalhjldmcihejnmkndbcnhaacmng`; TailorIT's `AUTOFILL_EXTENSION_IDS` defaults to it.

The production build talks to TailorIT at `http://localhost:3100`. It needs Chrome or Edge 144 or later.

## Layout
`src/core` is pure (no DOM, no browser APIs, no clock or randomness, enforced by its own tsconfig, lint and a test). `src/dom`, `src/adapters`, `src/content`, `src/background`, `src/messaging`, `src/platform`, `src/shared` and `src/ui` are the rest; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) gives the import rules. Only `src/platform/chrome.ts` touches the browser's extension APIs.

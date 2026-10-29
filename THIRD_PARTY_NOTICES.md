# Third-party notices

## Bundled code
- React and React DOM (MIT), in the extension pages.
- zod (MIT), in every entrypoint.
- `@wxt-dev/browser` and WXT's runtime helpers (MIT), in every entrypoint.

## Bundled data (from Phase 1)
The matcher's vocabularies are built by `scripts/vocab-build.ts` from pinned public sources; each source's release, checksum and licence is recorded in `vocab/sources.json` when it is added:
- NCES IPEDS institutional data and CIP 2020 (US federal works, public domain);
- the ROR data dump (CC0 1.0; credited as a courtesy);
- Unicode CLDR English names for countries and languages (Unicode License v3; its notice is reproduced here when the data is added).

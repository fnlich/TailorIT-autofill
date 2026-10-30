# Third-party notices

## Bundled code
- React and React DOM (MIT), in the extension pages.
- zod (MIT), in every entrypoint.
- `@wxt-dev/browser` and WXT's runtime helpers (MIT), in every entrypoint.

## Bundled data
The matcher's vocabularies, `src/core/vocab/data/*.json`, are built by `scripts/vocab-build.ts` from the pinned public sources below; each source's address, release, SHA-256 and licence is recorded in `vocab/sources.json`. The hand-kept tables in `vocab/curated/` are this repository's own.

### NCES: IPEDS and CIP 2020 (public domain)
- **IPEDS** Institutional Characteristics, Directory information, release HD2024, and the **Classification of Instructional Programs, 2020 edition (CIP 2020)**, from the U.S. Department of Education, National Center for Education Statistics.
- Both are works of the U.S. federal government, in the public domain in the United States. Their use here implies no endorsement by NCES.
- The self-identification wording in `vocab/curated/eeo.json` follows the EEO-1 report, the VEVRAA protected-veteran form and form CC-305, which are U.S. government works too.

### ROR (CC0 1.0)
- Data from the **Research Organization Registry (ROR)**, https://ror.org, release v2.15 (2026-10-20), schema v2, doi:10.5281/zenodo.23500708.
- Dedicated to the public domain under CC0 1.0 Universal. It is credited here as a courtesy, as ROR asks.

### Unicode CLDR (Unicode License v3)
- English territory names, English language names and the territory code mappings (ISO 3166-1 alpha-3) from **Unicode CLDR 49.0.0** (the cldr-json release).
- Used under the Unicode License v3:

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2015-2024 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0
```

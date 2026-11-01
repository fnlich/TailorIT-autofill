// Versions of the autofill API and of the stored profile.

/**
 * The autofill API's major version. Bump it for any change an extension built against the previous one cannot parse
 * (a removed or renamed field, a narrower type, a new value in a response enum). Additive optional fields and new
 * endpoints do not bump it. The server speaks one version at a time. 2: the scopes `jobs:add` and `letters:write`, the
 * resume reason `chosen` and the AI task kind `autofill_answer` (new values in response enums), with the lookup's
 * match and job facts, POST /api/autofill/jobs, POST /api/autofill/ai/answer, a draft question's `currentAnswer`, the
 * sensitive part's `legal.criminalRecord` and the cover letters (POST /api/autofill/cover-letters, GET …/:id and
 * …/:id/file, under `letters:write`), all unreleased until version 2 ships, so one version covers them.
 */
export const AUTOFILL_API_VERSION = 2;

/**
 * Sent by the extension on every request, and by the server on every answer to a request that presents a tia_ bearer,
 * refusals included. A token request whose header is missing or names another version is refused (409 `conflict`),
 * and the extension decides that versions differ only from this answer header, never from a status.
 */
export const AUTOFILL_API_HEADER = 'X-TailorIT-Autofill-Api';

/** Shape version of a stored profile row (autofill_profiles.profile_version), independent of the API version. */
export const AUTOFILL_PROFILE_VERSION = 1;

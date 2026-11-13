// Versions of the autofill API and of the stored profile.

/**
 * The autofill API's major version. Bump it for any change an extension built against the previous one cannot parse
 * (a removed or renamed field, a narrower type, a new value in a response enum). Additive optional fields and new
 * endpoints do not bump it. The server speaks one version at a time. 2: the scopes `jobs:add` and `letters:write`, the
 * resume reason `chosen` and the AI task kind `autofill_answer` (new values in response enums), with the lookup's
 * match and job facts, POST /api/autofill/jobs, POST /api/autofill/ai/answer, a draft question's `currentAnswer`, the
 * sensitive part's `legal.criminalRecord` and the cover letters (POST /api/autofill/cover-letters, GET …/:id and
 * …/:id/file, under `letters:write`), all unreleased until version 2 ships, so one version covers them. 3 (Jobright
 * parity): the scopes `profile:write`, `tracker:write`, `agent:run` and `credentials:read` and the lookup's job match
 * `chosen` (new values in response enums), and PUT /api/autofill/profile's answer without the sensitive part for a
 * connection that may not read it (a field that may now be absent), with Ashby's addresses in parseAtsUrl and Add job,
 * the profile's `anythingElse`, a draft question's `instruction`, the lookup's `jobId`, GET /api/autofill/jobs/search,
 * GET …/cover-letters/:id/text, POST /api/autofill/site-requests, POST /api/autofill/applied, the auto-apply queue
 * (/api/autofill/agent/*) and the job-site sign-ins (GET /api/autofill/credentials, /api/autofill/sign-ins): one
 * version bump, so the person connects the extension again once. 4 (Workable): the platform `workable`, last in
 * ATS_KINDS (a new value in the lookup's `ats.kind` and in a saved answer's `platform` and `scope`), with Workable's
 * addresses in parseAtsUrl, Add job, Applied and the agent's platforms, and an answer item's optional `format` (a
 * number or a date box). It adds no scope: an extension updated to 4 keeps its connection, and one still speaking 3
 * gets 409 `conflict` on every token request until it is updated. 5 (the other ATSs, LinkedIn and company career
 * sites, v3 Phases 6-8): the platforms `icims`, `taleo`, `successfactors` and `oracle`, after `workable` in ATS_KINDS
 * (new values in the lookup's `ats.kind` and in a saved answer's `platform` and `scope`), with their addresses and
 * Workday's in parseAtsUrl, Workday in Add job, and the lookup's job match `alias` (a new value in a response enum);
 * with parseLinkedInJobUrl, the lookup's `employerUrl` and its answer's `page`, POST /api/autofill/jobs/from-page
 * (scope jobs:add) and the every-site sign-in on login.icims.com, region-less Oracle and Taleo Business Edition hosts.
 * It adds no scope: an extension updated to 5 keeps its connection, and one still speaking 4 gets 409 `conflict` on
 * every token request until it is updated. 6 (the new ATSs of the owner's snapshots of 2026-11-06): the platforms
 * `jobvite`, `jazzhr`, `bamboohr`, `rippling`, `breezy`, `careerplug`, `pinpoint`, `paycor`, `hibob`, `ultipro`,
 * `dayforce`, `paylocity`, `dice`, `clearcompany`, `adp` and `smartrecruiters`, after `oracle` in ATS_KINDS in the
 * extension's order (new values in the lookup's `ats.kind`, the page's `employer.kind` and a saved answer's `platform`
 * and `scope`; migration 0810 lets the saved answers keep them), with their addresses in parseAtsUrl, Oracle's
 * government cloud, Workable's job-search site and iCIMS's steps after its gate there too, iCIMS and Pinpoint among the
 * agent's platforms, and the every-site sign-in on Oracle's government cloud, UltiPro, and ADP's and ClearCompany's
 * candidate paths (GET /api/autofill/credentials' optional `path`). Add job is unchanged: none of the new ATSs has a
 * public posting API TailorIT may read. It adds no scope: an extension updated to 6 keeps its connection, and one still
 * speaking 5 gets 409 `conflict` on every token request until it is updated. Within 6, additive (jr7 step 7a): the
 * Queue tab's platforms (AUTOFILL_QUEUE_ATS, queueApplicationUrl, queueCanOpen, a queue row's `runs`) and wider readers
 * of platforms 6 knew. 7 (jr7, the owner's snapshot7 of 2026-11-11): the platforms `ukgready`, `paycom`, `jobdiva` and
 * `eightfold`, after `smartrecruiters` in ATS_KINDS in the extension's order (new values in the lookup's `ats.kind`, the
 * page's `employer.kind` and a saved answer's `platform` and `scope`; migration 0819 lets the saved answers keep them),
 * with their addresses in parseAtsUrl and the Queue tab's list, and Jobvite, Workday and SmartRecruiters among the
 * agent's platforms (AUTOFILL_AGENT_ATS, by the integration's readiness tests). Add job is unchanged. It adds no scope:
 * an extension updated to 7 keeps its connection, and one still speaking 6 gets 409 `conflict` on every token request
 * until it is updated.
 */
export const AUTOFILL_API_VERSION = 7;

/**
 * Sent by the extension on every request, and by the server on every answer to a request that presents a tia_ bearer,
 * refusals included. A token request whose header is missing or names another version is refused (409 `conflict`),
 * and the extension decides that versions differ only from this answer header, never from a status.
 */
export const AUTOFILL_API_HEADER = 'X-TailorIT-Autofill-Api';

/** Shape version of a stored profile row (autofill_profiles.profile_version), independent of the API version. */
export const AUTOFILL_PROFILE_VERSION = 1;

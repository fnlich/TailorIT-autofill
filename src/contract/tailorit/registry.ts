import type { z } from 'zod';
import {
  AutofillClassifyRequestSchema,
  AutofillClassifyResultSchema,
  AutofillClassifyTaskSchema,
  AutofillDraftRequestSchema,
  AutofillDraftResultSchema,
  AutofillDraftTaskSchema,
  AutofillPickRequestSchema,
  AutofillPickResultSchema,
  AutofillPickTaskSchema,
  AutofillTaskAcceptedSchema,
  AutofillTaskViewSchema,
} from './ai';
import { AutofillErrorBodySchema } from './common';
import {
  AutofillConnectBodySchema,
  AutofillConnectResponseSchema,
  AutofillRedeemBodySchema,
  AutofillRedeemResponseSchema,
  AutofillSessionSchema,
  AutofillTokenListSchema,
  type ExtensionScope,
} from './connect';
import { AutofillLookupRequestSchema, AutofillLookupResponseSchema } from './lookup';
import {
  AutofillProfileEnvelopeSchema,
  AutofillProfileSchema,
  AutofillSeedQuerySchema,
  AutofillSeedSchema,
  AutofillSensitiveEnvelopeSchema,
  AutofillSensitiveSchema,
  PutAutofillProfileBodySchema,
  PutAutofillProfileResponseSchema,
} from './profile';
import { AutofillResumeListSchema } from './resumes';

/**
 * Every schema of the autofill API, by name. `npm run autofill:contract` writes each one's JSON Schema into
 * packages/shared/contract/autofill/v1/contract.json, and both repositories' contract tests parse each one's examples,
 * fixtures/<name>/{valid,invalid}/<case>.json: every name has a valid/golden.json, the one the extension's mock
 * server answers with.
 */
export const AUTOFILL_CONTRACT_SCHEMAS = {
  AutofillErrorBody: AutofillErrorBodySchema,
  AutofillConnectBody: AutofillConnectBodySchema,
  AutofillConnectResponse: AutofillConnectResponseSchema,
  AutofillRedeemBody: AutofillRedeemBodySchema,
  AutofillRedeemResponse: AutofillRedeemResponseSchema,
  AutofillSession: AutofillSessionSchema,
  AutofillTokenList: AutofillTokenListSchema,
  AutofillProfile: AutofillProfileSchema,
  AutofillSensitive: AutofillSensitiveSchema,
  AutofillProfileEnvelope: AutofillProfileEnvelopeSchema,
  AutofillSensitiveEnvelope: AutofillSensitiveEnvelopeSchema,
  PutAutofillProfileBody: PutAutofillProfileBodySchema,
  PutAutofillProfileResponse: PutAutofillProfileResponseSchema,
  AutofillSeedQuery: AutofillSeedQuerySchema,
  AutofillSeed: AutofillSeedSchema,
  AutofillLookupRequest: AutofillLookupRequestSchema,
  AutofillLookupResponse: AutofillLookupResponseSchema,
  AutofillResumeList: AutofillResumeListSchema,
  AutofillPickRequest: AutofillPickRequestSchema,
  AutofillPickResult: AutofillPickResultSchema,
  AutofillPickTask: AutofillPickTaskSchema,
  AutofillClassifyRequest: AutofillClassifyRequestSchema,
  AutofillClassifyResult: AutofillClassifyResultSchema,
  AutofillClassifyTask: AutofillClassifyTaskSchema,
  AutofillDraftRequest: AutofillDraftRequestSchema,
  AutofillDraftResult: AutofillDraftResultSchema,
  AutofillDraftTask: AutofillDraftTaskSchema,
  AutofillTaskAccepted: AutofillTaskAcceptedSchema,
  AutofillTaskView: AutofillTaskViewSchema,
} satisfies Record<string, z.ZodType>;
export type AutofillContractName = keyof typeof AUTOFILL_CONTRACT_SCHEMAS;

/**
 * Who may call a route: the Settings page's session cookie (a mutating call also needs the app's Origin), the
 * extension's token, either, or whoever holds a connect code. The redeem exchange is sent with no cookie and no
 * Authorization header, from an extension's Origin or none: a tia_ bearer makes any request that token's, so a dead
 * or malformed one is refused (401) before the code is read, and a live one needs the version header (409).
 */
export const AUTOFILL_ROUTE_CALLERS = ['session', 'token', 'either', 'code'] as const;
export type AutofillRouteCaller = (typeof AUTOFILL_ROUTE_CALLERS)[number];

export interface AutofillRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** The whole path; ':id' is a path parameter (a task's UUID on /api/ai/tasks/:id). */
  path: string;
  caller: AutofillRouteCaller;
  /** The scope a token needs here; null where no token comes, and on /session, which any live token may call. */
  scope: ExtensionScope | null;
  /** The JSON body's schema, or a GET's query's. */
  request: AutofillContractName | null;
  status: number;
  /** The success answer's schema; null for 204 and for the resume file, whose answer is the file itself. */
  response: AutofillContractName | null;
  /**
   * The 202 answer's schema, for a route that may answer before its work is done: an AI route answers `status` with
   * `response`, its finished task, when the task finishes within AUTOFILL_AI_WAIT_MS, else 202 with this. Null for
   * every other route.
   */
  accepted: AutofillContractName | null;
}

/**
 * The routes, as the design lists them (§11.1 of docs/design/tailorit.md in the extension's repository). Every answer
 * to a token request carries the X-TailorIT-Autofill-Api header; a refusal's body is an AutofillErrorBody (409
 * `conflict` for another API version, 401 for a dead token, 403 for a missing scope, 429 when rate-limited). The AI
 * routes refuse with AUTOFILL_AI_REFUSALS too; their tasks are polled and cancelled on /api/ai/tasks/:id, the one path
 * outside /api/autofill a token reaches, where a token sees only the autofill kinds (404 for any other task). POST
 * /api/autofill/ai/draft joins in Phase 6.
 */
export const AUTOFILL_ROUTES = [
  {
    method: 'POST',
    path: '/api/autofill/connect',
    caller: 'session',
    scope: null,
    request: 'AutofillConnectBody',
    status: 201,
    response: 'AutofillConnectResponse',
    accepted: null,
  },
  {
    method: 'POST',
    path: '/api/autofill/connect/redeem',
    caller: 'code',
    scope: null,
    request: 'AutofillRedeemBody',
    status: 200,
    response: 'AutofillRedeemResponse',
    accepted: null,
  },
  {
    method: 'GET',
    path: '/api/autofill/session',
    caller: 'token',
    scope: null,
    request: null,
    status: 200,
    response: 'AutofillSession',
    accepted: null,
  },
  {
    method: 'DELETE',
    path: '/api/autofill/session',
    caller: 'token',
    scope: null,
    request: null,
    status: 204,
    response: null,
    accepted: null,
  },
  {
    method: 'GET',
    path: '/api/autofill/tokens',
    caller: 'session',
    scope: null,
    request: null,
    status: 200,
    response: 'AutofillTokenList',
    accepted: null,
  },
  {
    method: 'DELETE',
    path: '/api/autofill/tokens/:id',
    caller: 'session',
    scope: null,
    request: null,
    status: 204,
    response: null,
    accepted: null,
  },
  {
    method: 'GET',
    path: '/api/autofill/profile',
    caller: 'either',
    scope: 'profile:read',
    request: null,
    status: 200,
    response: 'AutofillProfileEnvelope',
    accepted: null,
  },
  {
    method: 'GET',
    path: '/api/autofill/profile/sensitive',
    caller: 'either',
    scope: 'profile:sensitive',
    request: null,
    status: 200,
    response: 'AutofillSensitiveEnvelope',
    accepted: null,
  },
  {
    method: 'PUT',
    path: '/api/autofill/profile',
    caller: 'session',
    scope: null,
    request: 'PutAutofillProfileBody',
    status: 200,
    response: 'PutAutofillProfileResponse',
    accepted: null,
  },
  {
    method: 'GET',
    path: '/api/autofill/profile/seed',
    caller: 'session',
    scope: null,
    request: 'AutofillSeedQuery',
    status: 200,
    response: 'AutofillSeed',
    accepted: null,
  },
  {
    method: 'POST',
    path: '/api/autofill/lookup',
    caller: 'either',
    scope: 'jobs:lookup',
    request: 'AutofillLookupRequest',
    status: 200,
    response: 'AutofillLookupResponse',
    accepted: null,
  },
  {
    method: 'GET',
    path: '/api/autofill/resumes',
    caller: 'either',
    scope: 'resumes:read',
    request: null,
    status: 200,
    response: 'AutofillResumeList',
    accepted: null,
  },
  {
    method: 'GET',
    path: '/api/autofill/resumes/:id/file',
    caller: 'either',
    scope: 'resumes:read',
    request: null,
    status: 200,
    response: null,
    accepted: null,
  },
  {
    method: 'POST',
    path: '/api/autofill/ai/pick',
    caller: 'either',
    scope: 'ai:run',
    request: 'AutofillPickRequest',
    status: 200,
    response: 'AutofillPickTask',
    accepted: 'AutofillTaskAccepted',
  },
  {
    method: 'POST',
    path: '/api/autofill/ai/classify',
    caller: 'either',
    scope: 'ai:run',
    request: 'AutofillClassifyRequest',
    status: 200,
    response: 'AutofillClassifyTask',
    accepted: 'AutofillTaskAccepted',
  },
  {
    method: 'GET',
    path: '/api/ai/tasks/:id',
    caller: 'either',
    scope: 'ai:run',
    request: null,
    status: 200,
    response: 'AutofillTaskView',
    accepted: null,
  },
  {
    method: 'DELETE',
    path: '/api/ai/tasks/:id',
    caller: 'either',
    scope: 'ai:run',
    request: null,
    status: 200,
    response: 'AutofillTaskView',
    accepted: null,
  },
] as const satisfies readonly AutofillRoute[];

/*
 * jr7 ULTIPRO-7 (FIX7PLAN §6.8 item 1: UP7-01 with its verifier's corrections): UltiPro's page after submitting,
 * …/OpportunityApply/ApplicationSubmitted?applicationId=<uuid> (snapshot7 ultipro1 on recruiting2.ultipro.com, ultipro2
 * on recruiting.ultipro.com), read as its board's confirmation with no job id and no query (the applicationId is a
 * per-person record id, FIX7PLAN §5 D-10), and confirmationAfter: the page after the Submit armed on the same host,
 * tenant and board. Synthetic addresses only (made-up tenant, board and ids).
 */
import { describe, expect, it } from 'vitest';
import { canonicalApplicationUrl, confirmationAfter, parseUltiproUrl } from './url';

const BOARD = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_BOARD = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
const OPPORTUNITY = '2c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f';
const APPLICATION = '3d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a';
const pages = (host: string, tenant: string, board = BOARD) => `https://${host}/${tenant}/JobBoard/${board}`;
const form = (host = 'recruiting.ultipro.com', tenant = 'ACME1000', board = BOARD) =>
  `${pages(host, tenant, board)}/OpportunityApply?opportunityId=${OPPORTUNITY}`;
const posting = (host = 'recruiting.ultipro.com', tenant = 'ACME1000', board = BOARD) =>
  `${pages(host, tenant, board)}/OpportunityDetail?opportunityId=${OPPORTUNITY}`;
const done = (host = 'recruiting.ultipro.com', tenant = 'ACME1000', board = BOARD, query = `applicationId=${APPLICATION}`) =>
  `${pages(host, tenant, board)}/OpportunityApply/ApplicationSubmitted?${query}`;

describe("UltiPro's page after submitting (jr7 UP7-01)", () => {
  it.each(['recruiting.ultipro.com', 'recruiting2.ultipro.com', 'recruiting.ultipro.ca', 'acme.rec.pro.ukg.net'])(
    'reads it on %s as the board\'s confirmation, with no job id and no query', (host) => {
      expect(parseUltiproUrl(new URL(done(host)))).toEqual({ platform: 'ultipro', board: 'acme1000', jobId: '',
        page: 'confirmation',
        applicationUrl: `https://${host}/acme1000/JobBoard/${BOARD}/OpportunityApply/ApplicationSubmitted` });
      // Never an application's canonical address.
      expect(canonicalApplicationUrl(new URL(done(host)))).toBeNull();
    });

  it('names no per-person id: every application of the board reads the same', () => {
    const one = parseUltiproUrl(new URL(done()));
    const other = parseUltiproUrl(new URL(done(undefined, undefined, undefined, `applicationId=${OPPORTUNITY}`)));
    expect(other).toEqual(one);
    expect(JSON.stringify(one)).not.toContain(APPLICATION);
    // Its value is never read: the fixtures hold it redacted, and they read the same.
    expect(parseUltiproUrl(new URL(done(undefined, undefined, undefined, 'applicationId=REDACTED')))).toEqual(one);
  });

  it.each([
    ['no applicationId', ''],
    ['an empty applicationId', 'applicationId='],
    ['another parameter beside it', `applicationId=${APPLICATION}&x=1`],
    ['the applicationId twice', `applicationId=${APPLICATION}&applicationId=${APPLICATION}`],
  ])('reads none with %s', (_, query) => {
    expect(parseUltiproUrl(new URL(done(undefined, undefined, undefined, query)))).toBeNull();
  });

  it('reads none on another path, a board that is no uuid, or a host that is no candidate host', () => {
    expect(parseUltiproUrl(new URL(`${pages('recruiting.ultipro.com', 'ACME1000')}/ApplicationSubmitted?applicationId=${APPLICATION}`)))
      .toBeNull();
    expect(parseUltiproUrl(new URL(`${done()}`.replace('ApplicationSubmitted', 'ApplicationSubmitted/x')))).toBeNull();
    expect(parseUltiproUrl(new URL(done(undefined, undefined, 'board')))).toBeNull();
    expect(parseUltiproUrl(new URL(done('n12.ultipro.com')))).toBeNull();
    expect(parseUltiproUrl(new URL(done('signin-us.ultipro.com')))).toBeNull();
    expect(parseUltiproUrl(new URL(done().replace('https:', 'http:')))).toBeNull();
  });

  it('keeps every reading it had (the posting, the form and the account step)', () => {
    expect(parseUltiproUrl(new URL(form()))?.page).toBe('application');
    expect(parseUltiproUrl(new URL(posting()))?.page).toBe('posting');
  });
});

describe('confirmationAfter (jr7 UP7-01, FIX7PLAN §3.1)', () => {
  const after = (armed: string, here: string) => confirmationAfter(new URL(armed), new URL(here));

  it('is the page after the Submit armed on the same host, tenant and board (any case)', () => {
    expect(after(form(), done())).toBe(true);
    expect(after(form(undefined, 'acme1000'), done())).toBe(true);
    expect(after(form(undefined, undefined, BOARD.toUpperCase()), done())).toBe(true);
    expect(after(form('recruiting2.ultipro.com'), done('recruiting2.ultipro.com'))).toBe(true);
    // The posting address the worker's arm may keep for the same job.
    expect(after(posting(), done())).toBe(true);
  });

  it('is no other board\'s, tenant\'s or host\'s, and never a page that is no confirmation', () => {
    expect(after(form(undefined, undefined, OTHER_BOARD), done())).toBe(false);
    expect(after(form(undefined, 'OTHER1000'), done())).toBe(false);
    expect(after(form('recruiting2.ultipro.com'), done())).toBe(false);
    expect(after(form(), done('recruiting2.ultipro.com'))).toBe(false);
    expect(after(form(), form())).toBe(false);
    expect(after(done(), done())).toBe(false);
    expect(after(form(), done(undefined, undefined, undefined, ''))).toBe(false);
    expect(after('https://example.com/ACME1000/JobBoard/x/OpportunityApply', done())).toBe(false);
  });
});

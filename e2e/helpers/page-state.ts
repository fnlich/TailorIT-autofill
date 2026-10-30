/*
 * What a page holds after a fill, read from its main world as its own scripts would read it: a file input's file
 * (name, type, size and a SHA-256 computed in the page), the boxes checked in a group, a select's chosen options, and
 * the spies' events on one control. Reading changes nothing on the page.
 */
import type { Page } from '@playwright/test';
import { spyRecords, type SpyEvent } from './spies';

/** The file a file input holds, its SHA-256 computed in the page, or null when it holds none. */
export interface HeldFile {
  count: number;
  name: string;
  type: string;
  size: number;
  sha256: string;
}

export async function fileHeld(page: Page, selector: string): Promise<HeldFile | null> {
  return page.locator(selector).evaluate(async (el) => {
    const files = (el as HTMLInputElement).files;
    const file = files?.[0];
    if (files === null || file === undefined) return null;
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { count: files.length, name: file.name, type: file.type, size: file.size, sha256 };
  });
}

/** The values of a group's checked boxes (or radios), in page order. */
export async function checked(page: Page, name: string): Promise<string[]> {
  return page.locator(`input[name="${name}"]`).evaluateAll((inputs) =>
    inputs.filter((input) => (input as HTMLInputElement).checked).map((input) => (input as HTMLInputElement).value));
}

/** A select's chosen options' texts, in page order. */
export async function selectedTexts(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((el) => Array.from((el as HTMLSelectElement).selectedOptions, (option) => option.text));
}

/** Every spy event, in every frame, on the controls given by their spy identity (#id, or name=value for a box). */
export async function eventsOn(page: Page, ...controls: string[]): Promise<SpyEvent[]> {
  const wanted = new Set(controls);
  return (await spyRecords(page)).flatMap((record) => record.events)
    .filter((event) => wanted.has(event.control) || wanted.has(event.control.replace(/^label:/, '')));
}

/** The untrusted events the spies saw on form controls: the extension's writes. */
export async function writeEvents(page: Page): Promise<SpyEvent[]> {
  return (await spyRecords(page)).flatMap((record) => record.events).filter((event) => !event.trusted);
}

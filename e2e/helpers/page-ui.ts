/*
 * The extension's in-page UI as a person meets it: the launcher, the notices and the policy card, in the closed shadow
 * root the content script attaches to <html> (src/content/ui). No page script can reach a closed root, and neither can
 * Playwright's selectors, so tests read it through DevTools, which shows closed roots as its Elements panel does
 * (DOM.getDocument with pierce), and click in it with Playwright's mouse at the element's own box: a trusted click,
 * like a person's. Nothing here writes to the page.
 * The selectors follow the content script's markup; UI_PARTS is the one place to change if it changes.
 */
import type { CDPSession, Page } from '@playwright/test';

/** The parts of the in-page UI the specs look for (src/content/ui/launcher.ts and notices.ts). */
export const UI_PARTS = {
  launcher: 'button.launcher',
  notice: '.notice',
  policyCard: '[role="alertdialog"]',
} as const;

/** The DevTools DOM node fields this probe reads. */
interface DomNode {
  nodeId: number;
  nodeType: number;
  localName: string;
  nodeValue: string;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
  shadowRootType?: string;
}

/** What one element of the UI shows. */
export interface UiElement {
  nodeId: number;
  localName: string;
  attributes: Record<string, string>;
  /** Its text, as its text nodes hold it, whitespace collapsed. */
  text: string;
  /** It has a layout box larger than zero (an element with `hidden` has none). */
  shown: boolean;
}

function attributesOf(node: DomNode): Record<string, string> {
  const list = node.attributes ?? [];
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < list.length; i += 2) out[list[i]!] = list[i + 1]!;
  return out;
}

function textOf(node: DomNode): string {
  if (node.nodeType === 3) return node.nodeValue;
  return (node.children ?? []).map(textOf).join('');
}

function walk(node: DomNode, visit: (node: DomNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

export class PageUi {
  private constructor(private readonly page: Page, private readonly cdp: CDPSession) {}

  /** A probe on the page's main frame. */
  static async of(page: Page): Promise<PageUi> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    return new PageUi(page, cdp);
  }

  async close(): Promise<void> {
    await this.cdp.detach().catch(() => undefined);
  }

  /** The extension's closed root: the closed shadow root of a child of <html>; null when nothing is mounted. */
  private async root(): Promise<DomNode | null> {
    const { root } = await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const html = ((root as DomNode).children ?? []).find((node) => node.localName === 'html');
    for (const child of html?.children ?? []) {
      const shadow = child.shadowRoots?.find((candidate) => candidate.shadowRootType === 'closed');
      if (shadow !== undefined) return shadow;
    }
    return null;
  }

  /** Whether the UI's host and closed root are on the page. */
  async mounted(): Promise<boolean> {
    return (await this.root()) !== null;
  }

  private async shown(nodeId: number): Promise<boolean> {
    try {
      const { model } = await this.cdp.send('DOM.getBoxModel', { nodeId });
      return model.width > 0 && model.height > 0;
    } catch {
      return false;
    }
  }

  /** The UI's elements that match a selector, in document order. */
  async elements(selector: string): Promise<UiElement[]> {
    const root = await this.root();
    if (root === null) return [];
    const { nodeIds } = await this.cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
    const byId = new Map<number, DomNode>();
    walk(root, (node) => byId.set(node.nodeId, node));
    const found: UiElement[] = [];
    for (const nodeId of nodeIds) {
      const node = byId.get(nodeId);
      if (node === undefined) continue;
      found.push({ nodeId, localName: node.localName, attributes: attributesOf(node),
        text: textOf(node).replace(/\s+/g, ' ').trim(), shown: await this.shown(nodeId) });
    }
    return found;
  }

  /** The launcher, or null when none is mounted. */
  async launcher(): Promise<UiElement | null> {
    return (await this.elements(UI_PARTS.launcher))[0] ?? null;
  }

  /** The texts of the notices shown now (each in the plan's words, COPY.notices). */
  async noticeTexts(): Promise<string[]> {
    return (await this.elements(UI_PARTS.notice)).filter((el) => el.shown).map((el) => el.text);
  }

  /** Whether the policy card is shown. */
  async policyCardShown(): Promise<boolean> {
    return (await this.elements(UI_PARTS.policyCard)).some((el) => el.shown);
  }

  /** A trusted click at the centre of a shown element of the UI. */
  async click(target: UiElement): Promise<void> {
    await this.cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: target.nodeId });
    const { quads } = await this.cdp.send('DOM.getContentQuads', { nodeId: target.nodeId });
    const quad = quads[0];
    if (quad === undefined) throw new Error(`the ${target.localName} has no box to click`);
    const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4;
    const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
    await this.page.mouse.click(x, y);
  }

  /** A trusted click on the shown button whose text or accessible name is exactly `name`. */
  async clickButton(name: string): Promise<void> {
    const button = (await this.elements('button')).find((el) => el.shown && (el.text === name || el.attributes['aria-label'] === name));
    if (button === undefined) throw new Error(`the in-page UI shows no button named ${JSON.stringify(name)}`);
    await this.click(button);
  }

  /** A trusted click on the launcher. */
  async clickLauncher(): Promise<void> {
    const launcher = await this.launcher();
    if (launcher === null || !launcher.shown) throw new Error('the launcher is not shown');
    await this.click(launcher);
  }

  /** Computed style values of an element of the UI. */
  async style(target: UiElement, properties: readonly string[]): Promise<Record<string, string>> {
    const { computedStyle } = await this.cdp.send('CSS.getComputedStyleForNode', { nodeId: target.nodeId });
    const wanted = new Set(properties);
    return Object.fromEntries(computedStyle.filter((entry) => wanted.has(entry.name)).map((entry) => [entry.name, entry.value]));
  }

  /** The root's own stylesheet element, when the fallback (a <style> element) is in use. */
  async hasStyleElement(): Promise<boolean> {
    return (await this.elements('style')).length > 0;
  }
}

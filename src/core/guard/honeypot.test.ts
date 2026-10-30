import { describe, expect, it } from 'vitest';
import type { FieldKind, FieldVisibility, LabelSource } from '../enums';
import { checkHoneypot, llmMaySeeLabel } from './honeypot';

const field = (visibility: FieldVisibility, kind: FieldKind, labelSource: LabelSource = 'for',
  labelVisible = labelSource !== 'none') => ({ visibility, kind, labelSource, labelVisible });

describe('the honeypot policy (§7.11)', () => {
  it('lets a visible, labelled field be written', () => {
    for (const kind of ['text', 'select', 'radio', 'checkbox', 'file'] as const) {
      expect(checkHoneypot(field('visible', kind)), kind).toEqual({ ok: true });
    }
  });

  it('allows a hidden native radio or checkbox only with a visible label, and a hidden file only with a control', () => {
    for (const kind of ['radio', 'checkbox', 'checkbox-group'] as const) {
      expect(checkHoneypot(field('hidden-native-with-visible-label', kind)), kind).toEqual({ ok: true });
    }
    expect(checkHoneypot(field('hidden-file-with-visible-control', 'file'))).toEqual({ ok: true });
  });

  it('blocks every other hidden field as a honeypot', () => {
    expect(checkHoneypot(field('hidden-native-with-visible-label', 'text'))).toEqual({ ok: false, reason: 'honeypot' });
    expect(checkHoneypot(field('hidden-native-with-visible-label', 'file'))).toEqual({ ok: false, reason: 'honeypot' });
    expect(checkHoneypot(field('hidden-file-with-visible-control', 'text'))).toEqual({ ok: false, reason: 'honeypot' });
    expect(checkHoneypot(field('hidden-file-with-visible-control', 'radio'))).toEqual({ ok: false, reason: 'honeypot' });
    expect(checkHoneypot({ visibility: 'off-screen' as FieldVisibility, kind: 'text', labelSource: 'for',
      labelVisible: true })).toEqual({ ok: false, reason: 'honeypot' });
  });

  it('never fills a field with no visible label, even one its autocomplete would place', () => {
    expect(checkHoneypot(field('visible', 'text', 'none'))).toEqual({ ok: false, reason: 'no-visible-label' });
  });

  it('never fills a field named only by an aria-label nobody sees, whatever its kind', () => {
    for (const kind of ['text', 'select', 'radio', 'checkbox', 'checkbox-group', 'multiselect'] as const) {
      expect(checkHoneypot(field('visible', kind, 'aria-label', false)), kind)
        .toEqual({ ok: false, reason: 'no-visible-label' });
    }
    // A honeypot is still named as one first.
    expect(checkHoneypot(field('hidden-native-with-visible-label', 'text', 'aria-label', false)))
      .toEqual({ ok: false, reason: 'honeypot' });
  });

  it('lets a label known only from aria-label drive the rules, but never reach an LLM', () => {
    // Its words are visible beside the control, so a visible source names the field.
    expect(checkHoneypot(field('visible', 'text', 'aria-label', true))).toEqual({ ok: true });
    expect(llmMaySeeLabel('aria-label')).toBe(false);
    expect(llmMaySeeLabel('none')).toBe(false);
    for (const source of ['for', 'aria-labelledby', 'wrapping-label', 'legend', 'placeholder', 'adapter'] as const) {
      expect(llmMaySeeLabel(source), source).toBe(true);
    }
  });
});

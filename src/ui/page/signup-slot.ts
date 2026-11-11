/*
 * jr6: where the panel's Settings view (ui/panel/SettingsView.tsx) draws Sign-up Information's fields. The side panel's
 * page (entrypoints/sidepanel/main.tsx) gives the fields (ui/page/signup.tsx) here; the sidebar on the page gives none,
 * so its bundle never holds them, and its Settings view shows whether a password is saved and a link to the settings
 * page alone: no password box is ever drawn in a job site's page process, whose scripts hear what is typed there.
 */
import { createContext, type ReactNode } from 'react';
import type { PagePlatform } from '../../platform/types';

/** What the fields are given. */
export interface SignUpFieldsProps {
  platform: PagePlatform;
  /** The account's email as the page read it (AuthStatus.account): the email box's last fallback. */
  accountEmail?: string | null;
  /** After a save, a delete or an import: the page reads the connection's status again (AuthStatus.signUp). */
  onChanged?(): void;
}

/** Draws the fields, where the page gives them (the extension's own pages alone): ui/page/signup.tsx
 *  renderSignUpFields. */
export const SignUpSlot = createContext<((props: SignUpFieldsProps) => ReactNode) | null>(null);

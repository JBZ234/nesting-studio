import { T, Tn } from '../i18n';
import { useSyncExternalStore } from 'react';
import { storage } from '../platform';

/** Accent colours (light / dark variants live in styles.css under [data-accent]). Orange = default. */
export const ACCENTS = [
  { id: 'green', name: T('Verde'), light: '#15803d', dark: '#3cbf7a' },
  { id: 'blue', name: T('Azul'), light: '#1d6fd1', dark: '#5b9bff' },
  { id: 'purple', name: T('Morado'), light: '#7046d6', dark: '#a58bff' },
  { id: 'pink', name: T('Rosado'), light: '#c2407e', dark: '#ef8bbd' },
  { id: 'orange', name: T('Naranja (por defecto)'), light: '#d0700c', dark: '#f0962e' },
  { id: 'red', name: T('Rojo'), light: '#c93a2e', dark: '#f06b5e' },
  { id: 'slate', name: T('Gris azulado'), light: '#4f6478', dark: '#93a9bd' },
] as const;
export type Theme = 'light' | 'dark' | 'system';

let theme: Theme = storage.get('ns.theme', 'system') as Theme;
let accent: string = storage.get('ns.accent', 'orange');
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export function applyAppearance() {
  const el = document.documentElement;
  if (theme === 'system') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', theme);
  if (accent === 'orange') el.removeAttribute('data-accent'); else el.setAttribute('data-accent', accent);
}
export function setTheme(t: Theme) { theme = t; storage.set('ns.theme', t); applyAppearance(); emit(); }
export function setAccent(a: string) { accent = a; storage.set('ns.accent', a); applyAppearance(); emit(); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useTheme = () => useSyncExternalStore(subscribe, () => theme);
export const useAccent = () => useSyncExternalStore(subscribe, () => accent);

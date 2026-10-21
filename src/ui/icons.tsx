import React from 'react';

const S = (p: { children: React.ReactNode; vb?: string }) => (
  <svg viewBox={p.vb ?? '0 0 24 24'} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.children}</svg>
);

export const I = {
  folder: () => <S><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></S>,
  sheets: () => <S><rect x="3" y="5" width="18" height="14" rx="1" /><rect x="5.5" y="7.5" width="6" height="4" /><rect x="12.5" y="7.5" width="6" height="4" /><rect x="5.5" y="13" width="6" height="3.5" /></S>,
  rules: () => <S><path d="M4 6h10M4 12h7M4 18h10" /><circle cx="18" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></S>,
  panels: () => <S><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3" /><rect x="7" y="8" width="10" height="8" /></S>,
  settings: () => <S><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></S>,
  play: () => <S><path d="M7 5v14l11-7z" /></S>,
  stop: () => <S><rect x="6" y="6" width="12" height="12" rx="1" /></S>,
  undo: () => <S><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></S>,
  redo: () => <S><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></S>,
  rotate: () => <S><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></S>,
  lock: () => <S><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></S>,
  unlock: () => <S><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></S>,
  trash: () => <S><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></S>,
  plus: () => <S><path d="M12 5v14M5 12h14" /></S>,
  copy: () => <S><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></S>,
  up: () => <S><path d="m6 15 6-6 6 6" /></S>,
  down: () => <S><path d="m6 9 6 6 6-6" /></S>,
  x: () => <S><path d="M6 6l12 12M18 6 6 18" /></S>,
  download: () => <S><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></S>,
  upload: () => <S><path d="M12 20V9M7 14l5-5 5 5M5 4h14" /></S>,
  fit: () => <S><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></S>,
  layers: () => <S><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></S>,
  eye: () => <S><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></S>,
  zone: () => <S><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 10l7-7M3 16 16 3M8 21 21 8M14 21l7-7" /></S>,
  print: () => <S><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2" /><rect x="6" y="14" width="12" height="7" /></S>,
  moon: () => <S><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></S>,
  sun: () => <S><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>,
  auto: () => <S><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></S>,
  warn: () => <S><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17v.5" /></S>,
  check: () => <S><path d="m5 12 5 5 9-10" /></S>,
};

export const Logo = () => (
  <svg viewBox="0 0 40 40" aria-label="Nesting Studio">
    <rect x="3" y="7" width="34" height="26" rx="2" fill="var(--sheet)" stroke="var(--sheet-edge)" strokeWidth="1.5" />
    <rect x="6.5" y="10.5" width="13" height="9" fill="var(--part)" stroke="var(--part-edge)" strokeWidth="1" />
    <rect x="21.5" y="10.5" width="12" height="9" fill="var(--part)" stroke="var(--part-edge)" strokeWidth="1" />
    <rect x="6.5" y="21.5" width="19" height="8" fill="var(--accent)" stroke="var(--part-edge)" strokeWidth="1" />
  </svg>
);

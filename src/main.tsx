import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';
import { applyAppearance } from './ui/appearance';
applyAppearance();
createRoot(document.getElementById('root')!).render(<App />);

import { startupFolder, scanFolderTauri, startupFile, readTextAt, isTauri } from './platform';
import { loadSources, openSessionText, getState } from './store';
startupFile().then(async file => {
  if (file) { openSessionText(await readTextAt(file), file); return; }
  const f = await startupFolder(); if (f) loadSources(await scanFolderTauri(f), f, f);
});
// browser: warn before leaving with unsaved work
if (!isTauri) window.addEventListener('beforeunload', e => { const s = getState(); if (s.dirty && s.panels.length) { e.preventDefault(); e.returnValue = ''; } });

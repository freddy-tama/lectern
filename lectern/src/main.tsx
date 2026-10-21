import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/nunito';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/slides.css';
import './styles/studio.css';
import './styles/present.css';
import './styles/looks.css';
import './styles/notes.css';
import './styles/schedule.css';
import './styles/share.css';
import './styles/recordings.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import mods from 'virtual:lectern-plugins';
import { App } from './app/App';
import { initPwa } from './app/pwa';
import { installPlugin } from './core/plugins/registry';
import { loadLooks } from './data/looks';
import { ensureSeeded } from './data/repo';

for (const mod of mods) installPlugin(mod);
initPwa();

// Phones joining a shared deck, or opening a handed-out copy, don't need the sample courses.
if (!/^\/(join|phone|pack)(\/|$)/.test(window.location.pathname)) {
  ensureSeeded().catch((error) => console.error('Could not prepare sample data', error));
}

// Saved looks are registered first so decks that use them draw correctly on first paint.
loadLooks()
  .catch((error) => console.error('Could not load saved looks', error))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

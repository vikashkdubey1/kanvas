import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';

// Mount the React application onto the DOM. The HTML file should define a
// root element with id="root" where this app will be injected.
const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container missing in index.html');
}

// `container` is guaranteed to exist by the guard above; `!` prevents TS from
// treating it as potentially null when calling `createRoot`.
const root = createRoot(container!);
root.render(<Root />);

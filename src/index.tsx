import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';  

// Mount the React application onto the DOM. The HTML file should define a
// root element with id="root" where this app will be injected.
const container = document.getElementById('root');
const root = createRoot(container!);
if (!container) {
    throw new Error('Root container missing in index.html');
}
root.render(<Root />);

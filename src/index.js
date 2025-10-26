import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Mount the React application onto the DOM. The HTML file should define a
// root element with id="root" where this app will be injected.
const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
import React from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import { useState } from 'react';

/**
 * The root component of the Figma‑like application.
 *
 * It currently renders a simple canvas area where you can
 * draw shapes. Over time you can add toolbars, menus and
 * additional panels around this canvas component.
 */
export default function App() {
  // Track which tool is currently selected.  Default is 'select'.
  const [selectedTool, setSelectedTool] = useState('select');

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar at the top */}
      <Toolbar selectedTool={selectedTool} onSelect={setSelectedTool} />

      {/* Canvas takes up the remaining space */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Canvas selectedTool={selectedTool} />
      </div>
    </div>
  );
}
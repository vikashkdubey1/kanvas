import React from 'react';

/**
 * Toolbar component for selecting drawing tools.
 *
 * This component displays a set of buttons allowing the user to
 * choose which tool is currently active (e.g. select, rectangle,
 * circle).  The active tool is highlighted.  When a button is
 * clicked, it calls the onSelect callback passed via props with
 * the name of the selected tool.
 */
export default function Toolbar({ selectedTool, onSelect }) {
  // Define the available tools.  You can extend this array to add
  // more tool buttons (e.g. line, text, ellipse).
  const tools = [
    { id: 'select', label: 'Select' },
    { id: 'rectangle', label: 'Rectangle' },
    { id: 'circle', label: 'Circle' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        padding: '8px',
        background: '#f0f0f0',
        borderBottom: '1px solid #ccc',
      }}
    >
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onSelect(tool.id)}
          style={{
            padding: '6px 12px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            background: selectedTool === tool.id ? '#d0e6ff' : '#fff',
            cursor: 'pointer',
          }}
        >
          {tool.label}
        </button>
      ))}
    </div>
  );
}
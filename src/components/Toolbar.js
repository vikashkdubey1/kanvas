import React, { useEffect, useState } from "react";

// simple SVG icons
const Icon = {
    select: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 4l7 14 2-5 5-2-14-7z" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
    ),
    anchor: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 4v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="2" fill="none" />
            <path d="M7 10c0 2.761 2.239 5 5 5s5-2.239 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M4 20c2-1 4.5-3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M20 20c-2-1-4.5-3-5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    ),
    hand: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M7 11V6a2 2 0 1 1 4 0v5" stroke="currentColor" strokeWidth="2" />
            <path d="M11 11V5a2 2 0 1 1 4 0v6" stroke="currentColor" strokeWidth="2" />
            <path
                d="M15 11V7a2 2 0 1 1 4 0v6c0 3-2 6-6 6H9a4 4 0 0 1-4-4v-5a2 2 0 1 1 4 0"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
            />
        </svg>
    ),
    path: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M3 21l3.5-1 12-12a2.8 2.8 0 0 0-4-4L6.5 16 5 19.5 3 21z"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
            />
        </svg>
    ),
    rectangle: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="6" width="16" height="12" rx="1.5" stroke="currentColor" strokeWidth="2" />
        </svg>
    ),
    polygon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
                d="M12 3l7.794 5.657-2.977 9.178H7.183L4.206 8.657 12 3z"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
            />
        </svg>
    ),
    circle: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
        </svg>
    ),
    ellipse: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <ellipse cx="12" cy="12" rx="8" ry="5" stroke="currentColor" strokeWidth="2" />
        </svg>
    ),
    line: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 18L18 4" stroke="currentColor" strokeWidth="2" />
            <circle cx="18" cy="4" r="1.5" fill="currentColor" />
            <circle cx="4" cy="18" r="1.5" fill="currentColor" />
        </svg>
    ),
    text: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M5 6h14M9 6v12M15 6v12" stroke="currentColor" strokeWidth="2" />
        </svg>
    ),
};

export default function Toolbar({ selectedTool, onSelect }) {
    const containerOptions = [
        { value: 'frame', label: 'Frame' },
        { value: 'group', label: 'Group' },
    ];

    const tools = [
        { id: 'select', icon: Icon.select, label: 'Select' },
        { id: 'hand', icon: Icon.hand, label: 'Hand' },
        { id: 'path', icon: Icon.path, label: 'Path' },
        { id: 'anchor', icon: Icon.anchor, label: 'Anchor' },
        { id: 'rectangle', icon: Icon.rectangle, label: 'Rectangle' },
        { id: 'polygon', icon: Icon.polygon, label: 'Polygon' },
        { id: 'circle', icon: Icon.circle, label: 'Circle' },
        { id: 'ellipse', icon: Icon.ellipse, label: 'Ellipse' },
        { id: 'line', icon: Icon.line, label: 'Line' },
        { id: 'text', icon: Icon.text, label: 'Text' },
    ];

    const [containerTool, setContainerTool] = useState('frame');

    useEffect(() => {
        if (containerOptions.some((option) => option.value === selectedTool)) {
            setContainerTool(selectedTool);
        }
    }, [selectedTool]);

    const ToolButton = ({ tool }) => (
        <button
            key={tool.id}
            onClick={() => onSelect(tool.id)}
            aria-label={tool.label}
            title={tool.label}
            style={{
                width: 36,
                height: 36,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 8,
                border: selectedTool === tool.id ? '1px solid #4f83ff' : '1px solid #cdd5e0',
                background: selectedTool === tool.id ? '#e5efff' : '#fff',
                color: '#1f2a37',
                cursor: 'pointer',
                transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
        >
            {tool.icon}
        </button>
    );

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderBottom: '1px solid #dce2ea',
                background: '#ffffff',
                boxShadow: '0 1px 0 rgba(15, 23, 42, 0.04)',
                position: 'relative',
                zIndex: 20,
            }}
        >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Container</span>
                    <select
                        value={containerTool}
                        onChange={(event) => {
                            const nextTool = event.target.value;
                            setContainerTool(nextTool);
                            onSelect(nextTool);
                        }}
                        style={{
                            height: 36,
                            borderRadius: 8,
                            border: '1px solid #cdd5e0',
                            background: '#fff',
                            padding: '0 12px',
                            fontSize: 13,
                            color: '#1f2a37',
                        }}
                        aria-label="Container Tool"
                    >
                        {containerOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>

                <div style={{ display: 'flex', gap: 6 }}>
                    {tools.map((tool) => (
                        <ToolButton key={tool.id} tool={tool} />
                    ))}
                </div>
            </div>


        </div>
    );
}
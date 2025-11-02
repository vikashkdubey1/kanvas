import React, { forwardRef } from 'react';

const LayersPanel = forwardRef(function LayersPanel(
    { width, minWidth = 240, maxWidth = 500, children },
    ref
) {
    return (
        <aside
            ref={ref}
            style={{
                flex: '0 0 auto',
                width,
                minWidth,
                maxWidth,
                borderRight: '1px solid #e5e5e5',
                background: '#fdfdfd',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            {children}
        </aside>
    );
});

export default LayersPanel;

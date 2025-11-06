import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    DEFAULT_GRADIENT,
    GRADIENT_TYPES,
    applyAngleToHandles,
    getDefaultGradientHandles,
    getHandlesAngle,
    gradientToCss,
    interpolateGradientColor,
    normalizeGradient,
    rotateHandlesForType,
    swapHandles,
} from '../utils/gradient';

export const PROPERTIES_PANEL_MIN_WIDTH = 240;
export const PROPERTIES_PANEL_MAX_WIDTH = 500;
export const PROPERTIES_PANEL_DEFAULT_WIDTH = 320;

const DEFAULT_FONT_VARIATIONS = [
    { value: 'normal', label: 'Regular' },
    { value: 'italic', label: 'Italic' },
    { value: 'bold', label: 'Bold' },
    { value: 'bold italic', label: 'Bold Italic' },
];

const FONT_LIBRARY = [
    { value: 'system-ui', label: 'System UI', variations: DEFAULT_FONT_VARIATIONS },
    { value: '-apple-system', label: 'SF Pro (Apple)', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'BlinkMacSystemFont', label: 'BlinkMacSystemFont', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'ui-sans-serif', label: 'UI Sans Serif', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'ui-serif', label: 'UI Serif', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'ui-rounded', label: 'UI Rounded', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'ui-monospace', label: 'UI Monospace', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Segoe UI', label: 'Segoe UI', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Roboto', label: 'Roboto', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Helvetica Neue', label: 'Helvetica Neue', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Arial', label: 'Arial', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Verdana', label: 'Verdana', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Tahoma', label: 'Tahoma', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Trebuchet MS', label: 'Trebuchet MS', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Inter', label: 'Inter', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Open Sans', label: 'Open Sans', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Georgia', label: 'Georgia', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Times New Roman', label: 'Times New Roman', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Palatino Linotype', label: 'Palatino', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Garamond', label: 'Garamond', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Didot', label: 'Didot', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Courier New', label: 'Courier New', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Consolas', label: 'Consolas', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Menlo', label: 'Menlo', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Monaco', label: 'Monaco', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'Lucida Console', label: 'Lucida Console', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'sans-serif', label: 'Sans Serif', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'serif', label: 'Serif', variations: DEFAULT_FONT_VARIATIONS },
    { value: 'monospace', label: 'Monospace', variations: DEFAULT_FONT_VARIATIONS },
];

const DEFAULT_GRADIENT_ANGLES = {
    linear: 0,
    radial: 0,
    angular: 0,
    diamond: 0,
};

const basePanelStyle = {
    borderLeft: '1px solid #d9dee7',
    background: '#f7f8fb',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'inset 1px 0 0 rgba(15, 23, 42, 0.02)',
};

const headerStyle = {
    padding: '16px 20px 0',
};

const tabsRowStyle = {
    display: 'flex',
    gap: 6,
    marginBottom: 16,
};

const tabButtonStyle = {
    flex: 1,
    padding: '8px 0',
    borderRadius: 8,
    border: '1px solid transparent',
    background: 'transparent',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#64748b',
    cursor: 'pointer',
    transition: 'all 0.18s ease',
};

const activeTabStyle = {
    background: '#ffffff',
    borderColor: '#c7d2e2',
    color: '#1f2937',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
};

const disabledTabStyle = {
    ...tabButtonStyle,
    opacity: 0.45,
    cursor: 'not-allowed',
};

const activeSummaryStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingBottom: 12,
    borderBottom: '1px solid #d9dee7',
};

const activeTitleStyle = {
    fontSize: 16,
    fontWeight: 600,
    color: '#111827',
};

const activeSubtitleStyle = {
    fontSize: 12,
    color: '#6b7280',
};


    const contentStyle = {
        //padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        overflowY: 'auto',
    };

    const sectionCardStyle = {
        background: '#ffffff',
        borderRadius: 0,
        padding: '18px 16px',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
    };

    const sectionHeaderStyle = {
        marginBottom: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
};

const sectionHeaderActionsStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    };

    const sectionTitleStyle = {
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.7,
        textTransform: 'uppercase',
        color: '#64748b',
    };

    const sectionBodyStyle = {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
};

const sectionSubheadingStyle = {
    fontSize: '.5625rem',
    fontWeight: 700,
    letterSpacing: 0.6,
    color: '#475569',
    lineHeight: 1.5,
};

const iconButtonStyle = {
    width: 26,
    height: 24,
    borderRadius: 0,
    border: '0px solid #cbd5f5',
    background: '#e5e5e5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    color: '#1f2937',
    padding: 0,
};

const iconButtonActiveStyle = {
    background: '#1d4ed8',
    borderColor: '#1d4ed8',
    color: '#ffffff',
    boxShadow: '0 0 0 1px rgba(29, 78, 216, 0.12)',
};

const iconButtonDisabledStyle = {
    opacity: 0.45,
    cursor: 'not-allowed',
};

const alignmentGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 26px)',
    gap: 1,
    borderRadius: 8,
    background: '#ffffff',

};

const distributeRowStyle = {
    display: 'flex',
    gap: 8,
};

const rotationRowStyle = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) repeat(3, 24px)',
    gap: 8,
    alignItems: 'end',
};

const dimensionRowStyle = {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-end',
};

const cornerDetailsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
};

const appearanceRowStyle = {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-end',
    flexWrap: 'wrap',
};

const blendActionsWrapperStyle = {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
};

const numericRowStyle = {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
};

const numericFieldStyle = {
    flex: '1, 1',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    border: 'none',
};

const numericInputWrapperInlineStyle = {
    display: 'flex',
    alignItems: 'center',
    borderRadius: 4,
    border: '1px solid #cdd5e0',
    background: '#f8fafc',
    padding: '0 10px',
    height: 24,
    gap: 6,
};

const numericInputFieldStyle = {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: '#0f172a',
    minWidth: 0,
};

const unitSuffixStyle = {
    fontSize: 11,
    color: '#64748b',
    fontWeight: 600,
};

const unitPrefixStyle = {
    fontSize: 11,
    color: '#111',
    fontWeight: 600,
};

const dividerStyle = {
    height: 1,
    background: '#e5e5e5',
    padding: '1px 0',
};

const toggleButtonStyle = {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: '1px solid #cdd5e0',
    background: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    color: '#1f2937',
};

const toggleButtonActiveStyle = {
    background: '#1d4ed8',
    borderColor: '#1d4ed8',
    color: '#ffffff',
    boxShadow: '0 0 0 1px rgba(29, 78, 216, 0.12)',
};

const blendButtonStyle = {
    minWidth: 44,
    height: 28,
    borderRadius: 6,
    border: '1px solid #cdd5e0',
    background: '#f8fafc',
    fontSize: 11,
    fontWeight: 600,
    color: '#1f2937',
    padding: '0 8px',
    cursor: 'pointer',
    transition: 'all 0.18s ease',
};

const blendButtonActiveStyle = {
    background: '#1d4ed8',
    borderColor: '#1d4ed8',
    color: '#ffffff',
    boxShadow: '0 0 0 1px rgba(29, 78, 216, 0.12)',
};

const smoothingControlStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
};

const sliderStyle = {
    flex: 1,
};

const AlignLeftIcon = () => (
    <svg width="24" height="24" fill="#111111" viewBox="0 0 24 24" data-fpl-icon-size="24">
        <path fill="var(--fpl-icon-color, var(--color-icon))" d="M17.25 10a.75.75 0 0 0 .75-.75v-.5a.75.75 0 0 0-.75-.75h-8.5a.75.75 0 0 0-.75.75v.5c0 .414.336.75.75.75zm-4 5a.75.75 0 0 0 .75-.75v-.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0-.75.75v.5c0 .414.336.75.75.75z"></path>
        <path fill="var(--fpl-icon-color-3, var(--color-icon-tertiary))" d="M6 17.5a.5.5 0 0 1-1 0v-12a.5.5 0 0 1 1 0z"></path>
    </svg>
);

const AlignHCenterIcon = () => (
    <svg width="24" height="24" fill="#111111" viewBox="0 0 24 24" data-fpl-icon-size="24">
        <path fill="var(--fpl-icon-color, var(--color-icon))" d="M17.25 10a.75.75 0 0 0 .75-.75v-.5a.75.75 0 0 0-.75-.75h-9.5a.75.75 0 0 0-.75.75v.5c0 .414.336.75.75.75zm-2 5a.75.75 0 0 0 .75-.75v-.5a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v.5c0 .414.336.75.75.75z"></path>
        <path fill="var(--fpl-icon-color-3, var(--color-icon-tertiary))" d="M13 17.5a.5.5 0 0 1-1 0V15h1zm0-4.5v-3h-1v3zm0-7.5V8h-1V5.5a.5.5 0 0 1 1 0" ></path>
    </svg>
);

const AlignRightIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="14" y="3" width="2" height="12" rx="1" fill="currentColor" />
        <rect x="4" y="5" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
);

const AlignTopIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="2" width="12" height="2" rx="1" fill="currentColor" />
        <rect x="5" y="6" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
);

const AlignVMiddleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="3" width="8" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="3" y="8" width="12" height="2" rx="1" fill="currentColor" />
    </svg>
);

const AlignBottomIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="14" width="12" height="2" rx="1" fill="currentColor" />
        <rect x="5" y="4" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
);

const TidyUpIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="4" height="4" rx="1" fill="currentColor" />
        <rect x="11" y="3" width="4" height="4" rx="1" fill="currentColor" />
        <rect x="3" y="11" width="4" height="4" rx="1" fill="currentColor" />
        <rect x="11" y="11" width="4" height="4" rx="1" fill="currentColor" />
    </svg>
);

const DistributeHorizontalIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="4" width="3" height="10" rx="1" fill="currentColor" />
        <rect x="12" y="4" width="3" height="10" rx="1" fill="currentColor" />
        <rect x="7" y="2" width="1.5" height="14" rx="0.75" fill="currentColor" opacity="0.6" />
        <rect x="9.5" y="2" width="1.5" height="14" rx="0.75" fill="currentColor" opacity="0.6" />
    </svg>
);

const DistributeVerticalIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="3" width="10" height="3" rx="1" fill="currentColor" />
        <rect x="4" y="12" width="10" height="3" rx="1" fill="currentColor" />
        <rect x="2" y="7" width="14" height="1.5" rx="0.75" fill="currentColor" opacity="0.6" />
        <rect x="2" y="9.5" width="14" height="1.5" rx="0.75" fill="currentColor" opacity="0.6" />
    </svg>
);

const RotateIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 3a6 6 0 106 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 3H9V0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const FlipHorizontalIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 4L4 9l4 5V4zM10 14l4-5-4-5v10z" fill="currentColor" />
        <rect x="8.25" y="3" width="1.5" height="12" fill="currentColor" opacity="0.6" />
    </svg>
);

const FlipVerticalIcon = () => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 10l5 4 5-4H4zM14 8l-5-4-5 4h10z" fill="currentColor" />
        <rect x="3" y="8.25" width="12" height="1.5" fill="currentColor" opacity="0.6" />
    </svg>
);

const LockClosedIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3.5" y="7" width="9" height="7" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <path
            d="M5.5 7V5.5a2.5 2.5 0 115 0V7"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
        />
    </svg>
);

const LockOpenIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3.5" y="7" width="9" height="7" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <path
            d="M6 7V5.5a2.5 2.5 0 114.9-.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
        />
    </svg>
);

const ChevronDownIcon = ({ rotated = false }) => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ transform: rotated ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s ease' }}
    >
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const EyeIcon = ({ hidden = false }) => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M1.5 9c1.2-3 4-5.5 7.5-5.5S15.8 6 17 9c-1.2 3-4 5.5-8 5.5S2.7 12 1.5 9z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={hidden ? 'none' : 'rgba(30,64,175,0.08)'}
        />
        {hidden ? (
            <path d="M4 14l10-10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        ) : (
            <circle cx="9" cy="9" r="2.5" fill="currentColor" />
        )}
    </svg>
);

const BlendDot = () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="6" cy="6" r="4" fill="currentColor" opacity="0.45" />
    </svg>
);

const horizontalAlignmentControls = [
    { id: 'left', label: 'Align Left', icon: AlignLeftIcon },
    { id: 'center', label: 'Align Horizontal Center', icon: AlignHCenterIcon },
    { id: 'right', label: 'Align Right', icon: AlignRightIcon },
];

const verticalAlignmentControls = [
    { id: 'top', label: 'Align Top', icon: AlignTopIcon },
    { id: 'middle', label: 'Align Vertical Center', icon: AlignVMiddleIcon },
    { id: 'bottom', label: 'Align Bottom', icon: AlignBottomIcon },
];

const distributionControls = [
    { id: 'tidy', label: 'Tidy Up', icon: TidyUpIcon },
    { id: 'horizontal', label: 'Distribute Horizontal Spacing', icon: DistributeHorizontalIcon },
    { id: 'vertical', label: 'Distribute Vertical Spacing', icon: DistributeVerticalIcon },
];

const blendOptions = [
    { id: 'normal', label: 'Normal' },
    { id: 'multiply', label: 'Multiply' },
    { id: 'screen', label: 'Screen' },
];  

    const fieldStyle = {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
    };

    const fieldLabelStyle = {
        fontSize: 12,
        fontWeight: 600,
        color: '#1f2937',
    };

    const selectStyle = {
        height: 24,
        borderRadius: 4,
        //border: '1px solid #cdd5e0',
        border: 'none',
        background: '#e5e5e5',
        fontSize: 13,
        color: '#1f2937',
        padding: '0 12px',
    };

    const numberInputWrapperStyle = {
        display: 'flex',
        alignItems: 'center',
        borderRadius: 8,
        border: '1px solid #cdd5e0',
        background: '#f8fafc',
        padding: '0 10px',
        height: 24,
        gap: 6,
    };

    const numberInputStyle = {
        width: 64,
        border: 'none',
        background: 'transparent',
    fontSize: 13,
        color: '#111827',
        textAlign: 'right',
        outline: 'none',
    };

    const suffixStyle = {
        fontSize: 12,
        color: '#64748b',
};

const toggleButtonBase = {
    flex: 1,
    width: 26,
    maxWidth:24,
    height: 24,
    padding: '6px 8px',
    borderRadius: 8,
    border: '1px solid #cdd5e0',
    background: '#ffffff',
    fontSize: 12,
    fontWeight: 600,
    color: '#1f2937',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
};

const toggleButtonIconStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const ToggleButton = ({ active, onClick, children, title, icon }) => (
    <button
        type="button"
        onClick={onClick}
        title={title}
        style={{
            ...toggleButtonBase,
            background: active ? '#e8f0ff' : toggleButtonBase.background,
            borderColor: active ? '#4f83ff' : toggleButtonBase.border,
            color: active ? '#1d4ed8' : toggleButtonBase.color,
        }}
    >
        {icon ? <span style={toggleButtonIconStyle}>{icon}</span> : null}
    </button>
);

const ToggleGroup = ({ children }) => (
    <div style={{ display: 'flex', gap: 1, flexDirection: 'row' }}>{children}</div>
);

    const hiddenColorInputStyle = {
        position: 'absolute',
        inset: 0,
        opacity: 0,
        cursor: 'pointer',
    };

    const colorSwatchStyle = {
        position: 'relative',
        width: 14,
        height: 14,
        borderRadius: 2,
        border: '1px solid #cdd5e0',
        overflow: 'hidden',
        boxShadow: '0 1px 0 rgba(15, 23, 42, 0.04)',
};

const colorPickerButtonStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    padding: '2px 6px',
    borderRadius: 4,
    border: 'none',
    background: '#f2f2f2',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    minHeight: 24,
};

const colorPickerSummaryStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
};

const colorModeBadgeStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: '#1f2937',
    textTransform: 'capitalize',
};

const colorPopoverStyle = {
    position: 'fixed',
    width: 280,
    padding: 16,
    borderRadius: 16,
    border: '1px solid #d9dee7',
    background: '#ffffff',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.18)',
    zIndex: 999,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
};

const colorPopoverHeaderStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 12,
    borderBottom: '1px solid #e2e8f0',
    cursor: 'grab',
    userSelect: 'none',
    touchAction: 'none',
};

const colorPopoverTitleStyle = {
    fontSize: 13,
    fontWeight: 600,
    color: '#1f2937',
};

const colorPopoverCloseButtonStyle = {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: '1px solid transparent',
    background: '#f1f5f9',
    color: '#0f172a',
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease',
};

const colorPopoverBodyStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
};

const colorModeGridStyle = {
    display: 'flex',
    //gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
    gap: 6,
};

const GRADIENT_TYPE_OPTIONS = GRADIENT_TYPES.map((type) => ({
    value: type,
    label: type.charAt(0).toUpperCase() + type.slice(1),
}));

const colorPopoverSwatchStyle = {
    ...colorSwatchStyle,
    width: 64,
    height: 64,
};

const colorPopoverFieldLabelStyle = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#64748b',
};

const gradientPreviewStyle = {
    borderRadius: 12,
    border: '1px solid #cdd5e0',
    height: 100,
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.2)',
};

const gradientToolbarStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
};

const gradientTypeSelectStyle = {
    flex: 1,
    height: 34,
    borderRadius: 8,
    border: '1px solid #cdd5e0',
    background: '#f8fafc',
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 600,
    color: '#1f2937',
};

const gradientToolbarButtonStyle = {
    height: 34,
    minWidth: 36,
    borderRadius: 8,
    border: '1px solid #cdd5e0',
    background: '#ffffff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 600,
    color: '#1f2937',
    cursor: 'pointer',
    gap: 6,
};

const gradientToolbarIconStyle = {
    width: 14,
    height: 14,
};

const gradientMeterWrapperStyle = {
    padding: '6px 0 10px',
};

const gradientMeterStyle = {
    position: 'relative',
    height: 18,
    borderRadius: 10,
    border: '1px solid #cdd5e0',
    overflow: 'hidden',
    cursor: 'crosshair',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.18)',
};

const gradientStopHandleStyle = {
    position: 'absolute',
    top: '50%',
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: '2px solid #ffffff',
    boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.4)',
    transform: 'translate(-50%, -50%)',
    cursor: 'grab',
};

const gradientStopHandleActiveStyle = {
    boxShadow: '0 0 0 2px rgba(79, 131, 255, 0.5)',
    transform: 'translate(-50%, -50%) scale(1.05)',
    zIndex: 2,
};

const gradientStopsHeaderStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
};

const gradientStopsTitleStyle = {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#475569',
};

const gradientAddStopButtonStyle = {
    height: 30,
    borderRadius: 8,
    border: '1px solid #cdd5e0',
    background: '#ffffff',
    padding: '0 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#1f2937',
    cursor: 'pointer',
};

const gradientStopsListStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
};

const gradientStopRowStyle = {
    display: 'grid',
    gridTemplateColumns: 'minmax(64px, 72px) 46px minmax(90px, 1fr) 84px 28px',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    transition: 'border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
};

const gradientStopRowActiveStyle = {
    borderColor: '#4f83ff',
    boxShadow: '0 0 0 2px rgba(79, 131, 255, 0.18)',
    background: '#ffffff',
};

const gradientStopPositionInputStyle = {
    width: '100%',
    height: 32,
    borderRadius: 8,
    border: '1px solid #cdd5e0',
    background: '#ffffff',
    padding: '0 8px',
    fontSize: 13,
    color: '#111827',
};

const gradientStopOpacityInputStyle = {
    width: '100%',
    height: 32,
    borderRadius: 8,
    border: '1px solid #cdd5e0',
    background: '#ffffff',
    padding: '0 8px',
    fontSize: 13,
    color: '#111827',
};

const gradientStopRemoveButtonStyle = {
    width: 28,
    height: 28,
    borderRadius: 999,
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#ef4444',
    fontSize: 16,
    lineHeight: 1,
};

const gradientAngleControlsStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
};

const gradientAngleInputsStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
};

const gradientAngleNumberStyle = {
    width: 64,
    height: 32,
    borderRadius: 8,
    border: '1px solid #cdd5e0',
    background: '#f8fafc',
    padding: '0 8px',
    fontSize: 13,
    color: '#111827',
};

const gradientAngleSuffixStyle = {
    fontSize: 12,
    color: '#475569',
    fontWeight: 600,
};

    const hexInputStyle = {
        width: 80,
        height: 36,
        borderRadius: 8,
        border: '1px solid #cdd5e0',
        background: '#f8fafc',
        fontSize: 13,
        color: '#111827',
        padding: '0 10px',
        textTransform: 'uppercase',
        outline: 'none',
    };

    const disabledValueStyle = {
        fontSize: 12,
        color: '#94a3b8',
    };

const HEX_REGEX = /^#([0-9a-f]{6})$/i;

const COLOR_STYLE_OPTIONS = [
    { value: 'solid', label: 'Solid' },
    { value: 'gradient', label: 'Gradient' },
    { value: 'pattern', label: 'Pattern' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
];

const colorStyleIconBase = {
    width: 18,
    height: 18,
    borderRadius: 6,
    border: '1px solid rgba(15, 23, 42, 0.12)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
};

const FillOptionIcon = ({ type }) => {
    switch (type) {
        case 'solid':
            return (
                <span
                    aria-hidden="true"
                    style={{
                        ...colorStyleIconBase,
                        backgroundColor: '#2563eb',
                        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.2)',
                    }}
                />
            );
        case 'gradient':
            return (
                <span
                    aria-hidden="true"
                    style={{
                        ...colorStyleIconBase,
                        backgroundImage:
                            'linear-gradient(135deg, #6366f1 0%, #ec4899 50%, #f97316 100%)',
                    }}
                />
            );
        case 'pattern':
            return (
                <span
                    aria-hidden="true"
                    style={{
                        ...colorStyleIconBase,
                        backgroundColor: '#e2e8f0',
                        backgroundImage:
                            'linear-gradient(45deg, rgba(148, 163, 184, 0.7) 25%, transparent 25%, transparent 50%, rgba(148, 163, 184, 0.7) 50%, rgba(148, 163, 184, 0.7) 75%, transparent 75%, transparent 100%)',
                        backgroundSize: '6px 6px',
                    }}
                />
            );
        case 'image':
            return (
                <span
                    aria-hidden="true"
                    style={{
                        ...colorStyleIconBase,
                        backgroundColor: '#eff6ff',
                    }}
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M16 6C16.5304 6 17.0391 6.21071 17.4142 6.58579C17.7893 6.96086 18 7.46957 18 8V16C18 16.5304 17.7893 17.0391 17.4142 17.4142C17.0391 17.7893 16.5304 18 16 18H8C7.46957 18 6.96086 17.7893 6.58579 17.4142C6.21071 17.0391 6 16.5304 6 16V8C6 7.46957 6.21071 6.96086 6.58579 6.58579C6.96086 6.21071 7.46957 6 8 6H16ZM8 7C7.73478 7 7.48043 7.10536 7.29289 7.29289C7.10536 7.48043 7 7.73478 7 8V16C7 16.2652 7.10536 16.5196 7.29289 16.7071C7.48043 16.8946 7.73478 17 8 17H16C16.2652 17 16.5196 16.8946 16.7071 16.7071C16.8946 16.5196 17 16.2652 17 16V8C17 7.73478 16.8946 7.48043 16.7071 7.29289C16.5196 7.10536 16.2652 7 16 7H8ZM10.225 11.082C10.3212 11.0186 10.4363 10.9903 10.5509 11.002C10.6655 11.0136 10.7726 11.0645 10.854 11.146L14.854 15.146C14.9018 15.1921 14.9398 15.2473 14.9661 15.3083C14.9923 15.3693 15.006 15.4349 15.0066 15.5013C15.0072 15.5677 14.9946 15.6335 14.9694 15.695C14.9443 15.7564 14.9071 15.8123 14.8602 15.8592C14.8133 15.9061 14.7574 15.9433 14.696 15.9684C14.6345 15.9936 14.5687 16.0062 14.5023 16.0056C14.4359 16.005 14.3703 15.9913 14.3093 15.9651C14.2483 15.9388 14.1931 15.9008 14.147 15.853L10.5 12.208L8.854 13.854C8.80758 13.9005 8.75245 13.9374 8.69177 13.9626C8.6311 13.9877 8.56605 14.0007 8.50035 14.0008C8.43466 14.0008 8.36959 13.9879 8.30888 13.9628C8.24816 13.9377 8.19299 13.9009 8.1465 13.8545C8.10001 13.8081 8.06312 13.753 8.03794 13.6923C8.01275 13.6316 7.99977 13.5666 7.99972 13.5009C7.99968 13.4352 8.01257 13.3701 8.03767 13.3094C8.06277 13.2487 8.09958 13.1935 8.146 13.147L10.146 11.147L10.225 11.082ZM14.5 8C14.8978 8 15.2794 8.15804 15.5607 8.43934C15.842 8.72064 16 9.10218 16 9.5C16 9.89782 15.842 10.2794 15.5607 10.5607C15.2794 10.842 14.8978 11 14.5 11C14.1022 11 13.7206 10.842 13.4393 10.5607C13.158 10.2794 13 9.89782 13 9.5C13 9.10218 13.158 8.72064 13.4393 8.43934C13.7206 8.15804 14.1022 8 14.5 8ZM14.5 9C14.3674 9 14.2402 9.05268 14.1464 9.14645C14.0527 9.24021 14 9.36739 14 9.5C14 9.63261 14.0527 9.75979 14.1464 9.85355C14.2402 9.94732 14.3674 10 14.5 10C14.6326 10 14.7598 9.94732 14.8536 9.85355C14.9473 9.75979 15 9.63261 15 9.5C15 9.36739 14.9473 9.24021 14.8536 9.14645C14.7598 9.05268 14.6326 9 14.5 9Z" fill="black" />
                    </svg>
                </span>
            );
        case 'video':
            return (
                <span
                    aria-hidden="true"
                    style={{
                        ...colorStyleIconBase,
                        backgroundColor: '#fee2e2',
                    }}
                >
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <rect x="1" y="2" width="7" height="8" rx="1.5" fill="#f87171" />
                        <path d="M4.5 5.2V8L6.6 6.6 4.5 5.2Z" fill="#fff" />
                        <path
                            d="M8 4.2l2.2-1.2v5.9L8 7.7V4.2Z"
                            fill="#fca5a5"
                            stroke="#ef4444"
                            strokeWidth="0.6"
                            strokeLinejoin="round"
                        />
                    </svg>
                </span>
            );
        default:
            return null;
    }
};

const COLOR_TYPE_DESCRIPTIONS = {
    gradient: 'Blend multiple colours or angles to create a smooth transition.',
    pattern: 'Tile an asset to create repeating fills for surfaces or strokes.',
    image: 'Place a bitmap or photo as the fill source for the selected layer.',
    video: 'Use an animated texture or looping clip to fill the selected layer.',
};

const COLOR_TYPE_PREVIEW_BACKGROUND = {
    gradient: {
        backgroundColor: '#6366f1',
        backgroundImage: 'linear-gradient(135deg, #6366f1 0%, #ec4899 50%, #f97316 100%)',
    },
    pattern: {
        backgroundColor: '#e2e8f0',
        backgroundImage:
            'linear-gradient(135deg, rgba(148, 163, 184, 0.7) 25%, transparent 25%, transparent 50%, rgba(148, 163, 184, 0.7) 50%, rgba(148, 163, 184, 0.7) 75%, transparent 75%, transparent 100%)',
        backgroundSize: '12px 12px',
    },
    image: {
        backgroundColor: '#1d4ed8',
        backgroundImage: 'linear-gradient(135deg, rgba(148, 163, 184, 0.45) 0%, rgba(30, 64, 175, 0.75) 100%)',
    },
    video: {
        backgroundColor: '#db2777',
        backgroundImage: 'linear-gradient(135deg, rgba(236, 72, 153, 0.7) 0%, rgba(14, 165, 233, 0.7) 100%)',
    },
};

const colorTypePlaceholderStyle = {
    width: '100%',
    minHeight: 72,
    borderRadius: 12,
    border: '1px dashed #cdd5e0',
    background: '#f8fafc',
    padding: '16px',
    fontSize: 12,
    lineHeight: 1.5,
    color: '#475569',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
};

const clampRange = (value, min, max) => {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(value, min), max);
};

const clamp01 = (value) => clampRange(value, 0, 1);

const roundTo = (value, digits = 3) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

const componentToHex = (component) => {
    const safe = clampRange(Math.round(component), 0, 255);
    return safe.toString(16).padStart(2, '0');
};

const rgbaToHex = ({ r, g, b }) => `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;

const rgbaToCss = ({ r, g, b, a }) => {
    const alpha = clamp01(a);
    if (alpha >= 0.999) {
        return rgbaToHex({ r, g, b }).toLowerCase();
    }
    return `rgba(${clampRange(Math.round(r), 0, 255)}, ${clampRange(Math.round(g), 0, 255)}, ${clampRange(
        Math.round(b),
        0,
        255
    )}, ${roundTo(alpha, 3)})`;
};

const ensureRgba = (value) => ({
    r: clampRange(Math.round(value?.r ?? 0), 0, 255),
    g: clampRange(Math.round(value?.g ?? 0), 0, 255),
    b: clampRange(Math.round(value?.b ?? 0), 0, 255),
    a: clamp01(typeof value?.a === 'number' ? value.a : 1),
});

const RGBA_STRING_RE = /^rgba?\(([^)]+)\)$/i;

const FALLBACK_SOLID_RGBA = { r: 217, g: 217, b: 217, a: 1 };

const parseColorString = (value, fallback = FALLBACK_SOLID_RGBA) => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('#')) {
            const hex = trimmed.slice(1);
            if (hex.length === 3) {
                const r = parseInt(hex[0] + hex[0], 16);
                const g = parseInt(hex[1] + hex[1], 16);
                const b = parseInt(hex[2] + hex[2], 16);
                if (Number.isInteger(r) && Number.isInteger(g) && Number.isInteger(b)) {
                    return { r, g, b, a: 1 };
                }
            }
            if (hex.length === 6) {
                const int = Number.parseInt(hex, 16);
                if (Number.isInteger(int)) {
                    return {
                        r: (int >> 16) & 255,
                        g: (int >> 8) & 255,
                        b: int & 255,
                        a: 1,
                    };
                }
            }
        } else {
            const match = RGBA_STRING_RE.exec(trimmed);
            if (match) {
                const parts = match[1]
                    .split(',')
                    .map((part) => part.trim())
                    .filter(Boolean);
                if (parts.length >= 3) {
                    const [rPart, gPart, bPart, aPart] = parts;
                    const r = clampRange(Number.parseFloat(rPart), 0, 255);
                    const g = clampRange(Number.parseFloat(gPart), 0, 255);
                    const b = clampRange(Number.parseFloat(bPart), 0, 255);
                    const a = parts.length >= 4 ? clamp01(Number.parseFloat(aPart)) : 1;
                    if ([r, g, b].every((component) => Number.isFinite(component))) {
                        return {
                            r: Math.round(r),
                            g: Math.round(g),
                            b: Math.round(b),
                            a,
                        };
                    }
                }
            }
        }
    } else if (typeof value === 'object' && value) {
        return ensureRgba(value);
    }

    if (typeof fallback === 'string') {
        return parseColorString(fallback, FALLBACK_SOLID_RGBA);
    }
    return ensureRgba(fallback);
};

const rgbToHsva = ({ r, g, b, a }) => {
    const red = clampRange(r, 0, 255) / 255;
    const green = clampRange(g, 0, 255) / 255;
    const blue = clampRange(b, 0, 255) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;

    let hue = 0;
    if (delta !== 0) {
        if (max === red) {
            hue = ((green - blue) / delta) % 6;
        } else if (max === green) {
            hue = (blue - red) / delta + 2;
        } else {
            hue = (red - green) / delta + 4;
        }
        hue *= 60;
        if (hue < 0) hue += 360;
    }

    const saturation = max === 0 ? 0 : delta / max;
    const value = max;

    return { h: hue, s: saturation, v: value, a: clamp01(a) };
};

const hsvaToRgba = ({ h, s, v, a }) => {
    const hue = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
    const saturation = clamp01(s);
    const value = clamp01(v);
    const chroma = value * saturation;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = value - chroma;

    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (hue < 60) {
        r1 = chroma;
        g1 = x;
    } else if (hue < 120) {
        r1 = x;
        g1 = chroma;
    } else if (hue < 180) {
        g1 = chroma;
        b1 = x;
    } else if (hue < 240) {
        g1 = x;
        b1 = chroma;
    } else if (hue < 300) {
        r1 = x;
        b1 = chroma;
    } else {
        r1 = chroma;
        b1 = x;
    }

    return {
        r: Math.round((r1 + m) * 255),
        g: Math.round((g1 + m) * 255),
        b: Math.round((b1 + m) * 255),
        a: clamp01(a),
    };
};

const normalizeHsva = (value) => ({
    h: Number.isFinite(value?.h) ? ((value.h % 360) + 360) % 360 : 0,
    s: clamp01(value?.s ?? 0),
    v: clamp01(value?.v ?? 0),
    a: clamp01(value?.a ?? 1),
});

const SOLID_PRESET_SWATCHES = [
    '#000000',
    '#111827',
    '#1f2937',
    '#4b5563',
    '#9ca3af',
    '#d1d5db',
    '#ffffff',
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#facc15',
    '#84cc16',
    '#22c55e',
    '#06b6d4',
    '#0ea5e9',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#ec4899',
    '#f472b6',
    '#fb7185',
    '#fcd34d',
];

const solidEditorWrapperStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
};

const solidPickerMainStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
};

const solidSaturationWrapperStyle = {
    position: 'relative',
    width: '100%',
    height: 180,
    borderRadius: 14,
    overflow: 'hidden',
    cursor: 'crosshair',
    boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.12)',
};

const solidSaturationIndicatorStyle = {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: '50%',
    border: '2px solid #ffffff',
    boxShadow: '0 1px 4px rgba(15, 23, 42, 0.45)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
};

const solidSliderGroupStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
};

const solidSliderWrapperStyle = {
    position: 'relative',
    height: 28,
    borderRadius: 999,
    overflow: 'hidden',
    cursor: 'pointer',
    boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.12)',
    overflow: 'visible',
};

const solidSliderThumbStyle = {
    position: 'absolute',
    top: '50%',
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: '2px solid #ffffff',
    boxShadow: '0 1px 4px rgba(15, 23, 42, 0.45)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
};

const solidInputsRowStyle = {
    display: 'grid',
    gridTemplateColumns: 'minmax(72px, 92px) 1fr 72px',
    gap: 10,
    alignItems: 'center',
    width: '100%',
};

const solidFormatSelectStyle = {
    height: 36,
    borderRadius: 10,
    border: '1px solid #cdd5e0',
    background: '#0f172a',
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: 600,
    padding: '0 12px',
    letterSpacing: 0.4,
};

const solidHexInputStyle = {
    height: 36,
    borderRadius: 10,
    border: '1px solid #cdd5e0',
    background: '#111827',
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: 600,
    padding: '0 12px',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    width: 64,
};

const solidAlphaInputWrapperStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 0,
    height: 36,
    borderRadius: 10,
    border: '1px solid #cdd5e0',
    background: '#111827',
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: 600,
    padding: '0 10px 0 10px',
    width: 48,
};

const solidAlphaInputStyle = {
    flex: 1,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    textAlign: 'right',
    outline: 'none',
    width: 32,
};

const solidSwatchSectionStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingTop: 6,
};

const solidSwatchHeaderStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    color: '#94a3b8',
    letterSpacing: 0.8,
};

const solidSwatchGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(28px, 1fr))',
    gap: 6,
};

const solidSwatchButtonStyle = {
    width: '100%',
    paddingBottom: '100%',
    borderRadius: 8,
    border: '1px solid rgba(15, 23, 42, 0.25)',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.18)',
    position: 'relative',
    overflow: 'hidden',
    cursor: 'pointer',
};

const solidSwatchButtonInnerStyle = {
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
};

const Section = ({ title, children, disabled = false, actions = null }) => (
        <section
            style={{
                ...sectionCardStyle,
                opacity: disabled ? 0.55 : 1,
                pointerEvents: disabled ? 'none' : 'auto',
            }}
        >
            <div style={sectionHeaderStyle}>
            <div style={sectionTitleStyle}>{title}</div>
            {actions ? <div style={sectionHeaderActionsStyle}>{actions}</div> : null}
            </div>
            <div style={sectionBodyStyle}>{children}</div>
        </section>
    );

    const normalizeHex = (value, fallback = '#000000') => {
        if (typeof value === 'string' && HEX_REGEX.test(value)) {
            return value.toLowerCase();
        }
        return fallback;
    };

const ColorControl = ({
    label,
    style,
    onStyleChange,
    disabled = false,
    onGradientPopoverToggle,
    gradientInteractionRef,
}) => {
    const activeType = style?.type || 'solid';
    const solidStyleValue =
        typeof style?.value === 'string' ? style.value : rgbaToCss(FALLBACK_SOLID_RGBA);
    const parsedSolid = useMemo(
        () => parseColorString(solidStyleValue, FALLBACK_SOLID_RGBA),
        [solidStyleValue]
    );
    const initialHsva = useMemo(() => rgbToHsva(parsedSolid), [parsedSolid]);

    const [solidHsva, setSolidHsva] = useState(initialHsva);
    const [solidHexDraft, setSolidHexDraft] = useState(rgbaToHex(parsedSolid).toUpperCase());
    const [solidAlphaDraft, setSolidAlphaDraft] = useState(Math.round(parsedSolid.a * 100));

    const solidHsvaRef = useRef(solidHsva);
    const solidSaturationRef = useRef(null);
    const hueTrackRef = useRef(null);
    const alphaTrackRef = useRef(null);
    const saturationPointerIdRef = useRef(null);
    const huePointerIdRef = useRef(null);
    const alphaPointerIdRef = useRef(null);
    const solidInteractionIdCounterRef = useRef(0);
    const activeSolidInteractionIdRef = useRef(null);

    useEffect(() => {
        solidHsvaRef.current = solidHsva;
    }, [solidHsva]);

    useEffect(() => {
        const nextParsed = parseColorString(style?.value, FALLBACK_SOLID_RGBA);
        const hsva = rgbToHsva(nextParsed);
        solidHsvaRef.current = hsva;
        setSolidHsva(hsva);
        setSolidHexDraft(rgbaToHex(nextParsed).toUpperCase());
        setSolidAlphaDraft(Math.round(nextParsed.a * 100));
    }, [style?.value]);

    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);
    const popoverRef = useRef(null);
    const triggerRef = useRef(null);
    const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
    const hasCustomPositionRef = useRef(false);
    const dragPointerIdRef = useRef(null);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const [isDraggingPopover, setIsDraggingPopover] = useState(false);

    const gradientValue = useMemo(() => normalizeGradient(style?.value, DEFAULT_GRADIENT), [style?.value]);
    const [gradientDrafts, setGradientDrafts] = useState(
        gradientValue.stops.map((stop) => stop.color.toUpperCase())
    );
    const [activeStopIndex, setActiveStopIndex] = useState(0);
    const gradientCss = useMemo(() => gradientToCss(gradientValue), [gradientValue]);
    const gradientTrackRef = useRef(null);
    const draggingStopRef = useRef(null);
    const gradientValueRef = useRef(gradientValue);
    const commitStyleRef = useRef(() => { });

    useEffect(() => {
        gradientValueRef.current = gradientValue;
        setGradientDrafts(gradientValue.stops.map((stop) => stop.color.toUpperCase()));
        setActiveStopIndex((index) => {
            if (gradientValue.stops.length === 0) return 0;
            const clamped = Math.min(
                Math.max(index, 0),
                Math.max(0, gradientValue.stops.length - 1)
            );
            return Number.isNaN(clamped) ? 0 : clamped;
        });
    }, [gradientValue]);

    useEffect(() => {
        if (typeof onGradientPopoverToggle === 'function') {
            onGradientPopoverToggle(isOpen && activeType === 'gradient');
        }
    }, [activeType, isOpen, onGradientPopoverToggle]);

    useEffect(() => {
        if (typeof onGradientPopoverToggle !== 'function') return undefined;
        return () => {
            onGradientPopoverToggle(false);
        };
    }, [onGradientPopoverToggle]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handlePointerDown = (event) => {
            const container = containerRef.current;
            const popoverNode = popoverRef.current;
            const triggerNode = triggerRef.current;
            const target = event.target;

            if (
                (container && container.contains(target)) ||
                (popoverNode && popoverNode.contains(target)) ||
                (triggerNode && triggerNode.contains(target))
            ) {
                return;
            }

            if (gradientInteractionRef?.current?.active) {
                return;
            }


            setIsOpen(false);
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [gradientInteractionRef, isOpen]);

    const clampValue = (value, min, max) => {
        if (!Number.isFinite(value)) return min;
        return Math.min(Math.max(value, min), max);
    };

    const clampPositionToViewport = useCallback(
        (position) => {
            const margin = 16;
            const viewportWidth =
                typeof window !== 'undefined' ? window.innerWidth : margin * 2 + 280;
            const viewportHeight =
                typeof window !== 'undefined' ? window.innerHeight : margin * 2 + 360;
            const width = popoverRef.current?.offsetWidth ?? 280;
            const height = popoverRef.current?.offsetHeight ?? 360;
            const maxX = Math.max(margin, viewportWidth - width - margin);
            const maxY = Math.max(margin, viewportHeight - height - margin);
            const nextX = clampValue(
                typeof position?.x === 'number' ? position.x : margin,
                margin,
                maxX
            );
            const nextY = clampValue(
                typeof position?.y === 'number' ? position.y : margin,
                margin,
                maxY
            );
            return { x: nextX, y: nextY };
        },
        [popoverRef]
    );

    useEffect(() => {
        if (!isOpen) return undefined;
        if (typeof window === 'undefined') return undefined;

        const handleResize = () => {
            setPopoverPosition((previous) => {
                const next = clampPositionToViewport(previous);
                if (previous.x === next.x && previous.y === next.y) {
                    return previous;
                }
                return next;
            });
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [clampPositionToViewport, isOpen]);

    useEffect(() => {
        if (disabled && isOpen) {
            setIsOpen(false);
        }
    }, [disabled, isOpen]);

    const closePopover = useCallback(() => {
        setIsOpen(false);
    }, []);

    const handlePopoverDragMove = useCallback(
        (event) => {
            if (event.pointerId !== dragPointerIdRef.current) return;
            setPopoverPosition((previous) => {
                const next = clampPositionToViewport({
                    x: event.clientX - dragOffsetRef.current.x,
                    y: event.clientY - dragOffsetRef.current.y,
                });
                if (previous.x === next.x && previous.y === next.y) {
                    return previous;
                }
                return next;
            });
        },
        [clampPositionToViewport]
    );

    const handlePopoverDragEnd = useCallback(
        (event) => {
            if (event.pointerId !== dragPointerIdRef.current) return;
            dragPointerIdRef.current = null;
            setIsDraggingPopover(false);
            window.removeEventListener('pointermove', handlePopoverDragMove);
            window.removeEventListener('pointerup', handlePopoverDragEnd);
            window.removeEventListener('pointercancel', handlePopoverDragEnd);
            hasCustomPositionRef.current = true;
        },
        [handlePopoverDragMove]
    );

    const handlePopoverDragStart = useCallback(
        (event) => {
            if (typeof event.button === 'number' && event.button !== 0) return;
            event.preventDefault();
            setIsDraggingPopover(true);
            dragPointerIdRef.current = event.pointerId;
            dragOffsetRef.current = {
                x: event.clientX - popoverPosition.x,
                y: event.clientY - popoverPosition.y,
            };
            window.addEventListener('pointermove', handlePopoverDragMove);
            window.addEventListener('pointerup', handlePopoverDragEnd);
            window.addEventListener('pointercancel', handlePopoverDragEnd);
        },
        [handlePopoverDragEnd, handlePopoverDragMove, popoverPosition.x, popoverPosition.y]
    );

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        if (isOpen) return undefined;
        window.removeEventListener('pointermove', handlePopoverDragMove);
        window.removeEventListener('pointerup', handlePopoverDragEnd);
        window.removeEventListener('pointercancel', handlePopoverDragEnd);
        dragPointerIdRef.current = null;
        setIsDraggingPopover(false);
        return undefined;
    }, [handlePopoverDragEnd, handlePopoverDragMove, isOpen]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }
        return () => {
            window.removeEventListener('pointermove', handlePopoverDragMove);
            window.removeEventListener('pointerup', handlePopoverDragEnd);
            window.removeEventListener('pointercancel', handlePopoverDragEnd);
        };
    }, [handlePopoverDragEnd, handlePopoverDragMove]);

    const commitStyle = useCallback(
        (updates = {}) => {
            if (typeof onStyleChange !== 'function') return;
            const nextType = updates.type ?? activeType;
            let nextValue = updates.value ?? style?.value;
            const nextMeta =
                      updates.meta && typeof updates.meta === 'object'
                            ? { ...updates.meta }
                        : { source: 'colorControl' }; // ✅ default meta so Canvas knows it's user-initiated

            if (nextType === 'solid') {
                if (typeof nextValue !== 'string') {
                    const rgba = hsvaToRgba(solidHsvaRef.current);
                    nextValue = rgbaToCss(rgba);
                }
            } else if (nextType === 'gradient') {
                nextValue = normalizeGradient(nextValue, gradientValueRef.current);
            } else if (typeof nextValue !== 'string') {
                nextValue = rgbaToCss(hsvaToRgba(solidHsvaRef.current));
            }

            const payload = { type: nextType, value: nextValue };
            if (nextMeta && Object.keys(nextMeta).length > 0) {
                payload.meta = nextMeta;
            }

            onStyleChange(payload);
        },
        [activeType, onStyleChange, style?.value]
    );

    commitStyleRef.current = commitStyle;

    useEffect(() => {
        commitStyleRef.current = commitStyle;
    }, [commitStyle]);

    const beginSolidInteraction = useCallback(() => {
        solidInteractionIdCounterRef.current += 1;
        const nextId = solidInteractionIdCounterRef.current;
        activeSolidInteractionIdRef.current = nextId;
        return nextId;
    }, []);

    const finalizeSolidInteraction = useCallback(() => {
        const interactionId = activeSolidInteractionIdRef.current;
        if (interactionId == null) return;
        activeSolidInteractionIdRef.current = null;
        const rgba = hsvaToRgba(solidHsvaRef.current);
        commitStyleRef.current({
            type: 'solid',
            value: rgbaToCss(rgba),
            meta: { interactionId, isPreview: false },
        });
    }, []);

    const applySolidColor = useCallback(
        (nextHsva, options = {}) => {
            const normalized = normalizeHsva(nextHsva);
            solidHsvaRef.current = normalized;
            setSolidHsva(normalized);
            const rgba = hsvaToRgba(normalized);
            setSolidHexDraft(rgbaToHex(rgba).toUpperCase());
            setSolidAlphaDraft(Math.round(rgba.a * 100));
            let meta = null;
            if (options.preview) {
                const interactionId = activeSolidInteractionIdRef.current;
                if (interactionId != null) {
                    meta = { interactionId, isPreview: true };
                }
            } else if (options.meta && typeof options.meta === 'object') {
                meta = { ...options.meta };
            }
            commitStyleRef.current({ type: 'solid', value: rgbaToCss(rgba), meta });
        },
        []
    );

    const updateSaturationFromPoint = useCallback(
        (clientX, clientY, options = {}) => {
            const rect = solidSaturationRef.current?.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) return;
            const saturation = clamp01((clientX - rect.left) / rect.width);
            const value = clamp01(1 - (clientY - rect.top) / rect.height);
            const current = solidHsvaRef.current;
            applySolidColor({ ...current, s: saturation, v: value }, options);
        },
        [applySolidColor]
    );

    const updateHueFromPoint = useCallback(
        (clientX, options = {}) => {
            const rect = hueTrackRef.current?.getBoundingClientRect();
            if (!rect || rect.width === 0) return;
            const ratio = clamp01((clientX - rect.left) / rect.width);
            const current = solidHsvaRef.current;
            applySolidColor({ ...current, h: ratio * 360 }, options); // ✅ change hue (0–360)
        },
        [applySolidColor]
    );

    const updateAlphaFromPoint = useCallback(
        (clientX) => {
            const rect = alphaTrackRef.current?.getBoundingClientRect();
            if (!rect || rect.width === 0) return;
            const ratio = clamp01((clientX - rect.left) / rect.width);
            const current = solidHsvaRef.current;
            applySolidColor({ ...current, a: ratio });
        },
        [applySolidColor]
    );

    const handleSaturationPointerMove = useCallback(
        (event) => {
            if (event.pointerId !== saturationPointerIdRef.current) return;
            if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return;
            updateSaturationFromPoint(event.clientX, event.clientY, { preview: true });
        },
        [updateSaturationFromPoint]
    );

    const handleSaturationPointerUp = useCallback(
        (event) => {
            if (event.pointerId !== saturationPointerIdRef.current) return;
            saturationPointerIdRef.current = null;
            window.removeEventListener('pointermove', handleSaturationPointerMove);
            window.removeEventListener('pointerup', handleSaturationPointerUp);
            window.removeEventListener('pointercancel', handleSaturationPointerUp);
            finalizeSolidInteraction();
        },
        [finalizeSolidInteraction, handleSaturationPointerMove]
    );

    const handleHuePointerMove = useCallback(
        (event) => {
            if (event.pointerId !== huePointerIdRef.current) return;
            if (typeof event.clientX !== 'number') return;
            updateHueFromPoint(event.clientX, { preview: true });
        },
        [updateHueFromPoint]
    );

    const handleHuePointerUp = useCallback(
        (event) => {
            if (event.pointerId !== huePointerIdRef.current) return;
            huePointerIdRef.current = null;
            window.removeEventListener('pointermove', handleHuePointerMove);
            window.removeEventListener('pointerup', handleHuePointerUp);
            window.removeEventListener('pointercancel', handleHuePointerUp);
            finalizeSolidInteraction(); // ✅ commit the final hue
        },
        [finalizeSolidInteraction, handleHuePointerMove]
    );

    const handleAlphaPointerMove = useCallback(
        (event) => {
            if (event.pointerId !== alphaPointerIdRef.current) return;
            if (typeof event.clientX !== 'number') return;
            updateAlphaFromPoint(event.clientX, { preview: true });
        },
        [updateAlphaFromPoint]
    );

    const handleAlphaPointerUp = useCallback(
        (event) => {
            if (event.pointerId !== alphaPointerIdRef.current) return;
            alphaPointerIdRef.current = null;
            window.removeEventListener('pointermove', handleAlphaPointerMove);
            window.removeEventListener('pointerup', handleAlphaPointerUp);
            window.removeEventListener('pointercancel', handleAlphaPointerUp);
            finalizeSolidInteraction();
        },
        [finalizeSolidInteraction, handleAlphaPointerMove]
    );

    const handleSaturationPointerDown = (event) => {
        event.preventDefault();
        if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return;
        beginSolidInteraction();
        saturationPointerIdRef.current = event.pointerId;
        updateSaturationFromPoint(event.clientX, event.clientY, { preview: true });
        window.addEventListener('pointermove', handleSaturationPointerMove);
        window.addEventListener('pointerup', handleSaturationPointerUp);
        window.addEventListener('pointercancel', handleSaturationPointerUp);
    };

    const handleHuePointerDown = (event) => {
        event.preventDefault();
        if (typeof event.clientX !== 'number') return;
        beginSolidInteraction();
        huePointerIdRef.current = event.pointerId;
        updateHueFromPoint(event.clientX, { preview: true });
        window.addEventListener('pointermove', handleHuePointerMove);
        window.addEventListener('pointerup', handleHuePointerUp);
        window.addEventListener('pointercancel', handleHuePointerUp);
    };

    const handleAlphaPointerDown = (event) => {
        event.preventDefault();
        if (typeof event.clientX !== 'number') return;
        alphaPointerIdRef.current = event.pointerId;
        updateAlphaFromPoint(event.clientX);
        window.addEventListener('pointermove', handleAlphaPointerMove);
        window.addEventListener('pointerup', handleAlphaPointerUp);
        window.addEventListener('pointercancel', handleAlphaPointerUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener('pointermove', handleSaturationPointerMove);
            window.removeEventListener('pointerup', handleSaturationPointerUp);
            window.removeEventListener('pointercancel', handleSaturationPointerUp);
            window.removeEventListener('pointermove', handleHuePointerMove);
            window.removeEventListener('pointerup', handleHuePointerUp);
            window.removeEventListener('pointercancel', handleHuePointerUp);
            window.removeEventListener('pointermove', handleAlphaPointerMove);
            window.removeEventListener('pointerup', handleAlphaPointerUp);
            window.removeEventListener('pointercancel', handleAlphaPointerUp);
        };
    }, [
        handleAlphaPointerMove,
        handleAlphaPointerUp,
        handleHuePointerMove,
        handleHuePointerUp,
        handleSaturationPointerMove,
        handleSaturationPointerUp,
    ]);

    const handleSolidHexChange = (event) => {
        let next = event.target.value.trim();
        if (!next.startsWith('#')) next = `#${next}`;
        setSolidHexDraft(next.toUpperCase());
        if (HEX_REGEX.test(next)) {
            const parsed = parseColorString(next, parsedSolid);
            const currentAlpha = solidHsvaRef.current.a;
            const hsva = rgbToHsva({ ...parsed, a: currentAlpha });
            applySolidColor({ ...hsva, a: currentAlpha });
        }
    };

    const handleSolidHexBlur = () => {
        const rgba = hsvaToRgba(solidHsvaRef.current);
        setSolidHexDraft(rgbaToHex(rgba).toUpperCase());
    };

    const handleSolidAlphaChange = (event) => {
        const numeric = clampValue(Number(event.target.value), 0, 100);
        setSolidAlphaDraft(numeric);
        applySolidColor({ ...solidHsvaRef.current, a: numeric / 100 });
    };

    const handleSolidAlphaBlur = () => {
        setSolidAlphaDraft(Math.round(solidHsvaRef.current.a * 100));
    };

    const handleTypeSelect = (nextType) => {
        if (nextType === activeType) return;
        if (nextType === 'gradient') {
            commitStyle({ type: 'gradient', value: gradientValueRef.current });
            return;
        }
        if (nextType === 'solid') {
            const rgba = hsvaToRgba(solidHsvaRef.current);
            commitStyle({ type: 'solid', value: rgbaToCss(rgba) });
            return;
        }
        const fallback = typeof style?.value === 'string' ? style.value : rgbaToCss(parsedSolid);
        commitStyle({ type: nextType, value: fallback });
    };
    const handleGradientTypeChange = (event) => {
        const nextType = event.target.value;
        if (!GRADIENT_TYPES.includes(nextType)) return;
        commitGradientUpdate((current) => {
            current.type = nextType;
            current.handles = getDefaultGradientHandles(nextType);
            const nextAngle =
                typeof DEFAULT_GRADIENT_ANGLES[nextType] === 'number'
                    ? DEFAULT_GRADIENT_ANGLES[nextType]
                    : getHandlesAngle(current.handles);
            current.angle = nextAngle;
            return current;
        });
    };

    const commitGradientUpdate = useCallback(
        (updater, options = {}) => {
            const base = gradientValueRef.current;
            const draftValue = {
                type: base.type,
                angle: base.angle,
                stops: base.stops.map((stop) => ({ ...stop })),
                handles: base.handles ? { ...base.handles } : base.handles,
            };
            const updated = typeof updater === 'function' ? updater(draftValue) || draftValue : draftValue;
            const normalizedGradient = normalizeGradient(updated, DEFAULT_GRADIENT);
            gradientValueRef.current = normalizedGradient;
            setGradientDrafts(normalizedGradient.stops.map((stop) => stop.color.toUpperCase()));
            commitStyleRef.current({ type: 'gradient', value: normalizedGradient });
            setActiveStopIndex((previous) => {
                const { focusIndex, focusPosition } = options;
                if (typeof focusPosition === 'number') {
                    const matchIndex = normalizedGradient.stops.findIndex(
                        (stop) => Math.abs(stop.position - focusPosition) < 0.0005
                    );
                    if (matchIndex !== -1) {
                        return matchIndex;
                    }
                }
                if (typeof focusIndex === 'number') {
                    return clampValue(focusIndex, 0, normalizedGradient.stops.length - 1);
                }
                return clampValue(previous, 0, normalizedGradient.stops.length - 1);
            });
        },
        [clampValue]
    );

    const handleGradientFlip = () => {
        const stopsCount = gradientValueRef.current.stops.length;
        commitGradientUpdate(
            (current) => {
                current.stops = current.stops
                    .map((stop) => ({ ...stop, position: 1 - stop.position }))
                    .reverse();
                if (current.type === 'linear') {
                    current.handles = swapHandles(current.handles);
                    current.angle = getHandlesAngle(current.handles);
                }
                return current;
            },
            { focusIndex: stopsCount - 1 - activeStopIndex }
            );
    };

    const handleGradientRotate = () => {
        commitGradientUpdate((current) => {
            const rotated = rotateHandlesForType(current.type, current.handles, 90);
            current.handles = rotated;
            current.angle = getHandlesAngle(rotated);
            return current;
        });
    };

    const handleGradientAngleChange = (nextAngle) => {
        const normalizedAngle = Number.isNaN(nextAngle) ? gradientValue.angle : nextAngle;
        commitGradientUpdate((current) => {
            current.angle = normalizedAngle;
            current.handles = applyAngleToHandles(current.type, current.handles, normalizedAngle);
            return current;
        });
        };

        const handleGradientHexChange = (index, event) => {
            let next = event.target.value.trim();
            if (!next.startsWith('#')) next = `#${next}`;
            setActiveStopIndex(index);
            setGradientDrafts((prev) =>
                prev.map((draftValue, draftIndex) => (draftIndex === index ? next.toUpperCase() : draftValue))
            );
            if (HEX_REGEX.test(next)) {
                const safe = next.toLowerCase();
                commitGradientUpdate(
                    (current) => {
                        if (!current.stops[index]) return current;
                        current.stops[index].color = safe;
                        return current;
                    },
                    { focusIndex: index }
                );
            }
        };

        const handleGradientHexBlur = () => {
            setGradientDrafts(gradientValueRef.current.stops.map((stop) => stop.color.toUpperCase()));
        };

    const handleGradientStopColorChange = (index, color) => {
        setActiveStopIndex(index);
        const fallbackColor = gradientValueRef.current.stops[index]?.color || '#000000';
        const safeColor = normalizeHex(color, fallbackColor);
        commitGradientUpdate(
            (current) => {
                if (!current.stops[index]) return current;
                current.stops[index].color = safeColor;
                return current;
            },
            { focusIndex: index }
        );
    };

    const handleGradientStopPositionChange = (index, value) => {
        const numeric = clampValue(Number(value), 0, 100) / 100;
        setActiveStopIndex(index);
        commitGradientUpdate(
            (current) => {
                if (!current.stops[index]) return current;
                current.stops[index].position = numeric;
                return current;
            },
            { focusPosition: numeric }
        );
    };

    const handleGradientStopOpacityChange = (index, value) => {
        const numeric = clampValue(Number(value), 0, 100) / 100;
        setActiveStopIndex(index);
        commitGradientUpdate(
            (current) => {
                if (!current.stops[index]) return current;
                current.stops[index].opacity = numeric;
                return current;
            },
            { focusIndex: index }
        );
    };
    const handleGradientStopRemove = (index) => {
        const totalStops = gradientValueRef.current.stops.length;
        if (totalStops <= 2) return;
        const clampedIndex = clampValue(index, 0, totalStops - 1);
        commitGradientUpdate(
            (current) => {
                current.stops.splice(clampedIndex, 1);
                return current;
            },
            { focusIndex: Math.max(0, clampedIndex - 1) }
        );
    };

    const handleAddGradientStop = (position) => {
        const base = gradientValueRef.current;
        if (base.stops.length >= 8) return;
        let nextPosition;
        if (typeof position === 'number') {
            nextPosition = clampValue(position, 0, 1);
        } else if (base.stops.length > 1) {
            const currentIndex = clampValue(activeStopIndex, 0, base.stops.length - 1);
            const currentStop = base.stops[currentIndex];
            const nextStop = base.stops[currentIndex + 1];
            if (nextStop) {
                nextPosition = currentStop.position + (nextStop.position - currentStop.position) / 2;
            } else {
                nextPosition = clampValue(currentStop.position + 0.1, 0, 1);
                if (nextPosition === currentStop.position) {
                    nextPosition = clampValue(currentStop.position - 0.1, 0, 1);
                }
            }
        } else {
            nextPosition = 0.5;
        }
        nextPosition = clampValue(nextPosition, 0, 1);
        const overlapsExisting = base.stops.some(
            (stop) => Math.abs(stop.position - nextPosition) < 0.0005
        );
        if (overlapsExisting) {
            const upward = clampValue(nextPosition + 0.05, 0, 1);
            const downward = clampValue(nextPosition - 0.05, 0, 1);
            const canUseUpward = !base.stops.some(
                (stop) => Math.abs(stop.position - upward) < 0.0005
            );
            if (canUseUpward) {
                nextPosition = upward;
            } else {
                const canUseDownward = !base.stops.some(
                    (stop) => Math.abs(stop.position - downward) < 0.0005
                );
                nextPosition = canUseDownward ? downward : nextPosition;
            }
        }
        const sample = interpolateGradientColor(base.stops, nextPosition);
        commitGradientUpdate(
            (current) => {
                current.stops.push({
                    position: nextPosition,
                    color: sample.color,
                    opacity: sample.opacity,
                });
                return current;
            },
            { focusPosition: nextPosition }
        );
    };

    const updateStopPositionFromClientX = useCallback(
        (index, clientX) => {
            const rect = gradientTrackRef.current?.getBoundingClientRect();
            if (!rect || rect.width === 0) return;
            const ratio = clampValue((clientX - rect.left) / rect.width, 0, 1);
            commitGradientUpdate(
                (current) => {
                    if (!current.stops[index]) return current;
                    current.stops[index].position = ratio;
                    return current;
                },
                { focusPosition: ratio }
            );
        },
        [commitGradientUpdate]
    );

    const handleStopPointerMove = useCallback(
        (event) => {
            if (!draggingStopRef.current) return;
            const { index, pointerId } = draggingStopRef.current;
            if (typeof pointerId === 'number' && event.pointerId !== pointerId) return;
            if (typeof event.clientX !== 'number') return;
            updateStopPositionFromClientX(index, event.clientX);
        },
        [updateStopPositionFromClientX]
    );

    const handleStopPointerUp = useCallback(
        (event) => {
            if (!draggingStopRef.current) return;
            const { pointerId } = draggingStopRef.current;
            if (typeof pointerId === 'number' && event.pointerId !== pointerId) return;
            draggingStopRef.current = null;
            window.removeEventListener('pointermove', handleStopPointerMove);
            window.removeEventListener('pointerup', handleStopPointerUp);
            window.removeEventListener('pointercancel', handleStopPointerUp);
        },
        [handleStopPointerMove]
    );

    const handleStopPointerDown = (event, index) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.clientX !== 'number') return;
        setActiveStopIndex(index);
        draggingStopRef.current = { index, pointerId: event.pointerId };
        updateStopPositionFromClientX(index, event.clientX);
        window.addEventListener('pointermove', handleStopPointerMove);
        window.addEventListener('pointerup', handleStopPointerUp);
        window.addEventListener('pointercancel', handleStopPointerUp);
    };

    const handleGradientTrackPointerDown = (event) => {
        if (event.target?.dataset?.stopIndex) return;
        event.preventDefault();
        if (typeof event.clientX !== 'number') return;
        const rect = gradientTrackRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return;
        const ratio = clampValue((event.clientX - rect.left) / rect.width, 0, 1);
        handleAddGradientStop(ratio);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener('pointermove', handleStopPointerMove);
            window.removeEventListener('pointerup', handleStopPointerUp);
            window.removeEventListener('pointercancel', handleStopPointerUp);
            draggingStopRef.current = null;
        };
    }, [handleStopPointerMove, handleStopPointerUp]);

    const solidHueColor = hsvaToRgba({ h: solidHsva.h, s: 1, v: 1, a: 1 });
    const solidHueHex = rgbaToHex(solidHueColor);
    const solidRgba = hsvaToRgba(solidHsva);
    const solidCssValue = rgbaToCss(solidRgba);

    const summaryLabel = useMemo(() => {
        const match = COLOR_STYLE_OPTIONS.find((option) => option.value === activeType);
        return match?.label || 'Solid';
    }, [activeType]);

    const summaryPreview = useMemo(() => {
        if (activeType === 'solid') {
            return { backgroundColor: solidCssValue, backgroundImage: 'none' };
        }
        if (activeType === 'gradient') {
            return {
                backgroundImage: gradientCss,
                backgroundColor: gradientValue.stops[0]?.color || solidCssValue,
            };
        }
        const preset = COLOR_TYPE_PREVIEW_BACKGROUND[activeType];
        if (preset) {
            return { ...preset };
        }
        return { backgroundColor: solidCssValue };
    }, [activeType, gradientCss, gradientValue.stops, solidCssValue]);

    const togglePopover = () => {
        if (isOpen) {
            closePopover();
            return;
        }

        if (!hasCustomPositionRef.current) {
            const triggerBounds = triggerRef.current?.getBoundingClientRect();
            const fallbackPosition =
                typeof window !== 'undefined'
                    ? {
                        x: window.innerWidth / 2 - 140,
                        y: window.innerHeight / 2 - 160,
                    }
                    : { x: 0, y: 0 };
            const desiredPosition = triggerBounds
                ? { x: triggerBounds.right + 16, y: triggerBounds.top }
                : fallbackPosition;
            setPopoverPosition((previous) => {
                const next = clampPositionToViewport(desiredPosition);
                if (previous.x === next.x && previous.y === next.y) {
                    return previous;
                }
                return next;
            });
        }

        setIsOpen(true);
    };

    const handleSolidSwatchSelect = (value) => {
        const parsed = parseColorString(value, parsedSolid);
        const currentAlpha = solidHsvaRef.current.a;
        const hsva = rgbToHsva({ ...parsed, a: currentAlpha });
        applySolidColor({ ...hsva, a: currentAlpha });
    };
    const renderSolidEditor = () => {
        const saturationStyle = {
            ...solidSaturationWrapperStyle,
            backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) 100%), linear-gradient(90deg, #ffffff 0%, ${solidHueHex} 100%)`,
        };
        const hueStyle = {
            ...solidSliderWrapperStyle,
            backgroundImage:
                'linear-gradient(90deg, #ff0000 0%, #ffff00 16.66%, #00ff00 33.33%, #00ffff 50%, #0000ff 66.66%, #ff00ff 83.33%, #ff0000 100%)',
        };
        const alphaStyle = {
            ...solidSliderWrapperStyle,
            backgroundImage: `linear-gradient(45deg, rgba(226, 232, 240, 0.7) 25%, transparent 25%, transparent 50%, rgba(226, 232, 240, 0.7) 50%, rgba(226, 232, 240, 0.7) 75%, transparent 75%, transparent 100%), linear-gradient(90deg, rgba(${solidRgba.r}, ${solidRgba.g}, ${solidRgba.b}, 0) 0%, rgba(${solidRgba.r}, ${solidRgba.g}, ${solidRgba.b}, 1) 100%)`,
            backgroundSize: '12px 12px, 100% 100%',
        };
        const solidHexLower = rgbaToHex(solidRgba).toLowerCase();

        return (
            <div style={solidEditorWrapperStyle}>
                <div style={solidPickerMainStyle}>
                    <div
                        ref={solidSaturationRef}
                        style={saturationStyle}
                        onPointerDown={handleSaturationPointerDown}
                    >
                        <div
                            style={{
                                ...solidSaturationIndicatorStyle,
                                left: `${solidHsva.s * 100}%`,
                                top: `${(1 - solidHsva.v) * 100}%`,
                                backgroundColor: solidCssValue,
                            }}
                        />
                    </div>
                    <div ref={hueTrackRef} style={hueStyle} onPointerDown={handleHuePointerDown}>
                        <div
                            style={{
                                ...solidSliderThumbStyle,
                                left: `${(solidHsva.h / 360) * 100}%`,
                                background: rgbaToHex(solidHueColor),
                            }}
                        />
                    </div>
                    <div ref={alphaTrackRef} style={alphaStyle} onPointerDown={handleAlphaPointerDown}>
                        <div
                            style={{
                                ...solidSliderThumbStyle,
                                left: `${solidHsva.a * 100}%`,
                                background: solidCssValue,
                            }}
                        />
                    </div>
                </div>
                <div style={solidInputsRowStyle}>
                    <select value="hex" style={solidFormatSelectStyle} disabled>
                        <option value="hex">Hex</option>
                    </select>
                    <input
                        type="text"
                        value={solidHexDraft}
                        onChange={handleSolidHexChange}
                        onBlur={handleSolidHexBlur}
                        style={solidHexInputStyle}
                    />
                    <div style={solidAlphaInputWrapperStyle}>
                        <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={solidAlphaDraft}
                            onChange={handleSolidAlphaChange}
                            onBlur={handleSolidAlphaBlur}
                            style={solidAlphaInputStyle}
                        />
                        <span>%</span>
                    </div>
                </div>
                <div style={solidSwatchSectionStyle}>
                    <div style={solidSwatchHeaderStyle}>
                        <span>On this page</span>
                        <span>{SOLID_PRESET_SWATCHES.length} colours</span>
                    </div>
                    <div style={solidSwatchGridStyle}>
                        {SOLID_PRESET_SWATCHES.map((swatch) => {
                            const isActive = swatch.toLowerCase() === solidHexLower;
                            return (
                                <button
                                    type="button"
                                    key={swatch}
                                    onClick={() => handleSolidSwatchSelect(swatch)}
                                    style={{
                                        ...solidSwatchButtonStyle,
                                        borderColor: isActive ? '#4f83ff' : solidSwatchButtonStyle.border,
                                        boxShadow: isActive
                                            ? '0 0 0 2px rgba(79, 131, 255, 0.35)'
                                            : solidSwatchButtonStyle.boxShadow,
                                    }}
                                >
                                    <span
                                        aria-hidden="true"
                                        style={{
                                            ...solidSwatchButtonInnerStyle,
                                            backgroundColor: swatch,
                                        }}
                                    />
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

        const renderGradientEditor = () => {
            const stops = gradientValue.stops;
            const canRemove = stops.length > 2;
            const canAddStop = stops.length < 8;
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={gradientToolbarStyle}>
                        <select
                            value={gradientValue.type}
                            onChange={handleGradientTypeChange}
                            style={gradientTypeSelectStyle}
                        >
                            {GRADIENT_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={handleGradientFlip}
                            style={gradientToolbarButtonStyle}
                        >
                            <span style={gradientToolbarIconStyle} aria-hidden="true">
                                ⇆
                            </span>
                            Flip
                        </button>
                        <button
                            type="button"
                            onClick={handleGradientRotate}
                            style={gradientToolbarButtonStyle}
                        >
                            <span style={gradientToolbarIconStyle} aria-hidden="true">
                                ↻
                            </span>
                            Rotate 90°
                        </button>
                    </div>
                    <div
                        style={{
                            ...gradientPreviewStyle,
                            backgroundImage: gradientCss,
                            backgroundColor: stops[0]?.color || '#000000',
                        }}
                    />
                    <div style={gradientMeterWrapperStyle}>
                        <div
                            ref={gradientTrackRef}
                            style={{
                                ...gradientMeterStyle,
                                backgroundImage: gradientCss,
                                backgroundColor: stops[0]?.color || '#000000',
                            }}
                            onPointerDown={handleGradientTrackPointerDown}
                        >
                            {stops.map((stop, index) => {
                                const isActive = index === activeStopIndex;
                                const opacity = clampValue(stop.opacity ?? 1, 0, 1);
                                return (
                                <div
                                    key={`stop-handle-${index}`}
                                    data-stop-index={index}
                                    onPointerDown={(event) => handleStopPointerDown(event, index)}
                                        style={{
                                            ...gradientStopHandleStyle,
                                        ...(isActive ? gradientStopHandleActiveStyle : null),
                                        left: `${stop.position * 100}%`,
                                            background: stop.color,
                                            opacity,
                                        }}
                                    />
                                );
                            })}
                        </div>
                    </div>
                    <div style={gradientStopsHeaderStyle}>
                        <span style={gradientStopsTitleStyle}>Stops</span>
                        <button
                            type="button"
                            onClick={() => handleAddGradientStop()}
                            style={{
                                ...gradientAddStopButtonStyle,
                                opacity: canAddStop ? 1 : 0.4,
                                cursor: canAddStop ? 'pointer' : 'not-allowed',
                            }}
                            disabled={!canAddStop}
                        >
                            + Add stop
                        </button>
                    </div>
                    <div style={gradientStopsListStyle}>
                        {stops.map((stop, index) => {
                            const isActive = index === activeStopIndex;
                            const opacityPercent = Math.round(clampValue(stop.opacity ?? 1, 0, 1) * 100);
                            return (
                            <div
                                key={`stop-row-${index}`}
                                style={{
                                    ...gradientStopRowStyle,
                                    ...(isActive ? gradientStopRowActiveStyle : null),
                                }}
                                onClick={() => setActiveStopIndex(index)}
                            >
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={Math.round(stop.position * 100)}
                                    onChange={(event) =>
                                        handleGradientStopPositionChange(index, event.target.value)
                                    }
                                    style={gradientStopPositionInputStyle}
                                />
                                <label
                                    style={{
                                        ...colorPopoverSwatchStyle,
                                        width: 32,
                                        height: 32,
                                        }}
                                        >
                                    <span
                                        aria-hidden="true"
                                        style={{
                                            display: 'block',
                                            width: '100%',
                                            height: '100%',
                                            background: stop.color,
                                            opacity: clampValue(stop.opacity ?? 1, 0, 1),
                                        }}
                                    />
                                    <input
                                        type="color"
                                        value={stop.color}
                                        onChange={(event) =>
                                            handleGradientStopColorChange(index, event.target.value)
                                        }
                                        style={hiddenColorInputStyle}
                                    />
                                </label>
                                <input
                                    type="text"
                                    value={gradientDrafts[index] ?? stop.color.toUpperCase()}
                                    onChange={(event) => handleGradientHexChange(index, event)}
                                    onBlur={handleGradientHexBlur}
                                    style={hexInputStyle}
                                    />
                                    <input
                                        type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={opacityPercent}
                                        onChange={(event) =>
                                            handleGradientStopOpacityChange(index, event.target.value)
                                        }
                                        style={gradientStopOpacityInputStyle}
                                    />
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleGradientStopRemove(index);
                                        }}
                                        style={{
                                            ...gradientStopRemoveButtonStyle,
                                            opacity: canRemove ? 1 : 0.4,
                                            cursor: canRemove ? 'pointer' : 'not-allowed',
                                        }}
                                        disabled={!canRemove}
                                        aria-label="Remove colour stop"
                                    >
                                        ×
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <div style={gradientAngleControlsStyle}>
                        <span style={colorPopoverFieldLabelStyle}>Angle</span>
                        <div style={gradientAngleInputsStyle}>
                            <input
                                type="range"
                                min={0}
                                max={360}
                                value={gradientValue.angle}
                                onChange={(event) =>
                                    handleGradientAngleChange(Number(event.target.value))
                                }
                                style={{ flex: 1 }}
                            />
                            <input
                                type="number"
                                min={0}
                                max={360}
                                value={Math.round(gradientValue.angle)}
                                onChange={(event) =>
                                    handleGradientAngleChange(Number(event.target.value))
                                }
                                style={gradientAngleNumberStyle}
                            />
                            <span style={gradientAngleSuffixStyle}>°</span>
                        </div>
                    </div>
                </div>
            );
        };

    const renderNonSolidPlaceholder = () => {
        const description = COLOR_TYPE_DESCRIPTIONS[activeType];
        return (
            <div style={colorTypePlaceholderStyle}>
                {description || 'Choose a rich media source to apply this style.'}
            </div>
        );
    };

    if (disabled) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={fieldLabelStyle}>{label}</span>
                <span style={disabledValueStyle} />
            </div>
        );
    }

    const canRenderPortal = typeof document !== 'undefined';
    const popoverNode =
        isOpen && canRenderPortal
            ? createPortal(
                <div
                    ref={popoverRef}
                    style={{
                        ...colorPopoverStyle,
                        top: popoverPosition.y,
                        left: popoverPosition.x,
                    }}
                    role="dialog"
                    aria-label={`${label} colour picker`}
                >
                    <div
                        style={{
                            ...colorPopoverHeaderStyle,
                            cursor: isDraggingPopover ? 'grabbing' : 'grab',
                        }}
                        onPointerDown={handlePopoverDragStart}
                    >
                        <span style={colorPopoverTitleStyle}>{`${label} Colour`}</span>
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            style={colorPopoverCloseButtonStyle}
                            aria-label="Close colour picker"
                            onPointerDown={(event) => event.stopPropagation()}
                        >


                        </button>
                    </div>
                    <div style={colorPopoverBodyStyle}>
                        <div style={colorModeGridStyle}>
                            {COLOR_STYLE_OPTIONS.map((option) => (
                                <ToggleButton
                                    key={option.value}
                                    active={option.value === activeType}
                                    onClick={() => handleTypeSelect(option.value)}
                                    title={option.label}
                                    icon={<FillOptionIcon type={option.value} />}
                                >
                                    {option.label}
                                </ToggleButton>
                            ))}
                        </div>
                        {activeType === 'solid'
                            ? renderSolidEditor()
                            : activeType === 'gradient'
                                ? renderGradientEditor()
                                : renderNonSolidPlaceholder()}
                    </div>
                </div>,
                document.body
            )
            : null;

    return (
        <>
            <div
                ref={containerRef}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}
        >
                <span style={sectionSubheadingStyle}>{label}</span>
                <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={isOpen}
                    ref={triggerRef}
                    onClick={togglePopover}
                    style={{
                        ...colorPickerButtonStyle,
                        borderColor: isOpen ? '#4f83ff' : colorPickerButtonStyle.border,
                        boxShadow: isOpen ? '0 0 0 4px rgba(79, 131, 255, 0.14)' : 'none',
                    }}
                >
                    <span style={colorPickerSummaryStyle}>
                        <span
                            aria-hidden="true"
                            style={{
                                ...colorSwatchStyle,
                                width: 14,
                                height: 14,
                                ...summaryPreview,
                            }}
                        />
                        <span style={colorModeBadgeStyle}>{summaryLabel}</span>
                    </span>
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 20 20"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                    >
                        <path
                            d="M6 8l4 4 4-4"
                            stroke={isOpen ? '#1d4ed8' : '#475569'}
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </button>
            </div>
            {popoverNode}
        </>
    );
};

const NumberControl = ({
    label,
    value,
    onChange,
    min = 0,
    max = 128,
    step = 1,
    suffix = 'px',
    disabled = false,
}) => (
    <div style={{ ...fieldStyle, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
        <span style={sectionSubheadingStyle}>{label}</span>
        <div style={numberInputWrapperStyle}>
            <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={typeof value === 'number' && !Number.isNaN(value) ? value : 0}
                onChange={(event) => {
                    const numeric = Number(event.target.value);
                    if (typeof onChange === 'function') {
                        onChange(Number.isNaN(numeric) ? 0 : numeric);
                    }
                }}
                style={numberInputStyle}
                disabled={disabled}
            />
            <span style={suffixStyle}>{suffix}</span>
        </div>
    </div>
);

const SelectControl = ({ label, value, onChange, options }) => {
    const normalizedOptions = options.map((option) =>
        typeof option === 'string' ? { value: option, label: option } : option
    );

    return (
        <label style={fieldStyle}>
            <span style={fieldLabelStyle}>{label}</span>
            <select value={value} onChange={onChange} style={selectStyle}>
                {normalizedOptions.map(({ value: optionValue, label: optionLabel }) => (
                    <option key={optionValue} value={optionValue}>
                        {optionLabel}
                    </option>
                ))}
            </select>
        </label>
    );
};

    const ToggleField = ({ label, children }) => (
        <div style={fieldStyle}>
            <span style={sectionSubheadingStyle}>{label}</span>
            {children}
        </div>
);

export default function PropertiesPanel({
    panelWidth,
    shape,
    fillStyle,
    onFillStyleChange,
    strokeStyle,
    onStrokeStyleChange,
    onGradientPickerToggle,
    gradientInteractionRef,
    strokeWidth,
    onStrokeWidthChange,
    textFontFamily,
    onTextFontFamilyChange,
    textFontStyle,
    onTextFontStyleChange,
    textFontSize,
    onTextFontSizeChange,
    textLineHeight,
    onTextLineHeightChange,
    textLetterSpacing,
    onTextLetterSpacingChange,
    textAlign,
    onTextAlignChange,
    textVerticalAlign,
    onTextVerticalAlignChange,
    textDecoration,
    onTextDecorationChange,
    selectionInfo,
    onAlign,
    onDistribute,
    onPositionChange,
    onRotationChange,
    onRotateClockwise,
    onFlip,
    onDimensionChange,
    onVisibilityChange,
    onBlendModeChange,
    onOpacityChange,
    onCornerRadiusChange = () => { },
    onCornerSmoothingChange,
}) {
        const isTextShape = shape?.type === 'text';
    const supportsFill = !shape || ['rectangle', 'circle', 'ellipse', 'text', 'frame'].includes(shape.type);
    const disableStrokeControls = shape?.type === 'group';

    // ---- current values derived from the active selection ----
    
    const currentX = primaryShape?.x ?? 0;
    const currentY = primaryShape?.y ?? 0;
    const currentW = primaryShape?.width ?? 0;   // fine as a baseline; your dimension effect handles special types
    const currentH = primaryShape?.height ?? 0;

    const clamp = (value, min, max) => {
        if (!Number.isFinite(value)) return min;
        return Math.min(Math.max(value, min), max);
    };

    const formatNumeric = (value, precision = 2) => {
        if (!Number.isFinite(value)) return '0';
        const factor = 10 ** precision;
        const rounded = Math.round(value * factor) / factor;
        if (precision <= 0) {
            return String(Math.round(rounded));
        }
        const fixed = rounded.toFixed(precision);
        return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
    };

    const primaryShape = shape || selectionInfo?.shape || null;
    const selectedIds = Array.isArray(selectionInfo?.selectedIds)
        ? selectionInfo.selectedIds
        : primaryShape?.id != null
            ? [primaryShape.id]
            : [];
    const selectedIdsKey = selectedIds.join(',');
    const isMultiSelect = selectedIds.length > 1;
    const hasSelection = Boolean(primaryShape);
    const supportsCornerRadius = Boolean(
        primaryShape && ['rectangle', 'frame', 'group'].includes(primaryShape.type)
    );
    const supportsDimensions = Boolean(
        primaryShape && ['rectangle', 'frame', 'group', 'circle', 'ellipse', 'text'].includes(primaryShape.type)
    );

    const [alignmentActive, setAlignmentActive] = useState(null);
    const [distributionActive, setDistributionActive] = useState(null);

    useEffect(() => {
        setAlignmentActive(null);
        setDistributionActive(null);
    }, [selectedIdsKey]);

    const positionRef = useRef({ x: 0, y: 0 });
    const [positionDraft, setPositionDraft] = useState({ x: '', y: '' });
    const positionEditingRef = useRef(false);

    useEffect(() => {
        if (positionEditingRef.current) return; // don't stomp while typing
        const committedX = formatNumeric(currentX /* from selected shape */);
        const committedY = formatNumeric(currentY /* from selected shape */);
        positionRef.current = { x: Number(committedX) || 0, y: Number(committedY) || 0 };
        setPositionDraft({ x: committedX, y: committedY });
    }, [currentX, currentY, hasSelection]);

    useEffect(() => {
        if (primaryShape) {
            const nextX = typeof primaryShape.x === 'number' ? primaryShape.x : 0;
            const nextY = typeof primaryShape.y === 'number' ? primaryShape.y : 0;
            positionRef.current = { x: nextX, y: nextY };
            setPositionDraft({ x: formatNumeric(nextX), y: formatNumeric(nextY) });
        } else {
            positionRef.current = { x: 0, y: 0 };
            setPositionDraft({ x: '', y: '' });
        }
    }, [primaryShape?.x, primaryShape?.y, primaryShape?.id]);

    const getShapeDimensionsForPanel = useCallback(
        (target) => {
            if (!target) return { width: 0, height: 0 };
            switch (target.type) {
                case 'rectangle':
                case 'frame':
                case 'group':
                    return {
                        width: Math.max(0, target.width || 0),
                        height: Math.max(0, target.height || 0),
                    };
                case 'circle': {
                    const radius = Math.max(0, target.radius || 0);
                    return { width: radius * 2, height: radius * 2 };
                }
                case 'ellipse':
                    return {
                        width: Math.max(0, (target.radiusX || 0) * 2),
                        height: Math.max(0, (target.radiusY || 0) * 2),
                    };
                case 'text':
                    return {
                        width: Math.max(0, target.width || 0),
                        height: Math.max(0, target.height || 0),
                    };
                default:
                    return { width: 0, height: 0 };
            }
        },
        []
    );

    const dimensionRef = useRef({ width: 0, height: 0 });
    const [dimensionDraft, setDimensionDraft] = useState({ width: '', height: '' });
    const aspectRatioRef = useRef(1);
    const dimensionEditingRef = useRef(false);
    const [isAspectLocked, setAspectLocked] = useState(true);

    useEffect(() => {
        if (dimensionEditingRef.current) return; // don't stomp while typing
        const committedW = formatNumeric(currentW /* from selected shape */);
        const committedH = formatNumeric(currentH /* from selected shape */);
        dimensionRef.current = { width: Number(committedW) || 0, height: Number(committedH) || 0 };
        setDimensionDraft({ width: committedW, height: committedH });
    }, [currentW, currentH, hasSelection]);

    useEffect(() => {
        if (primaryShape && supportsDimensions) {
            const dims = getShapeDimensionsForPanel(primaryShape);
            dimensionRef.current = dims;
            if (dims.height > 0) {
                aspectRatioRef.current = dims.width / dims.height;
            }
            setDimensionDraft({
                width: dims.width ? formatNumeric(dims.width) : '0',
                height: dims.height ? formatNumeric(dims.height) : '0',
            });
        } else {
            dimensionRef.current = { width: 0, height: 0 };
            setDimensionDraft({ width: '', height: '' });
        }
    }, [
        primaryShape?.width,
        primaryShape?.height,
        primaryShape?.radius,
        primaryShape?.radiusX,
        primaryShape?.radiusY,
        primaryShape?.id,
        getShapeDimensionsForPanel,
        supportsDimensions,
    ]);

    const [rotationDraft, setRotationDraft] = useState('0');
    const rotationRef = useRef(0);

    useEffect(() => {
        const rotation = typeof primaryShape?.rotation === 'number' ? primaryShape.rotation : 0;
        rotationRef.current = rotation;
        setRotationDraft(formatNumeric(rotation, 1));
    }, [primaryShape?.rotation, primaryShape?.id]);

    const [opacityDraft, setOpacityDraft] = useState('100');
    useEffect(() => {
        if (primaryShape) {
            const opacity = typeof primaryShape.opacity === 'number' ? clamp(primaryShape.opacity, 0, 1) : 1;
            setOpacityDraft(String(Math.round(opacity * 100)));
        } else {
            setOpacityDraft('100');
        }
    }, [primaryShape?.opacity, primaryShape?.id]);

    const [cornerRadiusDraft, setCornerRadiusDraft] = useState('0');
    const [cornerDetailDraft, setCornerDetailDraft] = useState({
        topLeft: '0',
        topRight: '0',
        bottomRight: '0',
        bottomLeft: '0',
    });
    const cornerDetailRef = useRef({ topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 });
    const [showCornerDetails, setShowCornerDetails] = useState(false);

    useEffect(() => {
        if (primaryShape && supportsCornerRadius) {
            if (primaryShape.cornerRadii && typeof primaryShape.cornerRadii === 'object') {
                const details = {
                    topLeft: Number(primaryShape.cornerRadii.topLeft) || 0,
                    topRight: Number(primaryShape.cornerRadii.topRight) || 0,
                    bottomRight: Number(primaryShape.cornerRadii.bottomRight) || 0,
                    bottomLeft: Number(primaryShape.cornerRadii.bottomLeft) || 0,
                };
                cornerDetailRef.current = details;
                setCornerDetailDraft({
                    topLeft: formatNumeric(details.topLeft),
                    topRight: formatNumeric(details.topRight),
                    bottomRight: formatNumeric(details.bottomRight),
                    bottomLeft: formatNumeric(details.bottomLeft),
                });
                const uniqueValues = new Set(
                    Object.values(details).map((value) => Math.round((value || 0) * 1000) / 1000)
                );
                if (uniqueValues.size === 1) {
                    setCornerRadiusDraft(formatNumeric(details.topLeft));
                } else {
                    setCornerRadiusDraft('');
                    setShowCornerDetails(true);
                }
            } else {
                const uniform = Number(primaryShape.cornerRadius) || 0;
                cornerDetailRef.current = {
                    topLeft: uniform,
                    topRight: uniform,
                    bottomRight: uniform,
                    bottomLeft: uniform,
                };
                setCornerDetailDraft({
                    topLeft: formatNumeric(uniform),
                    topRight: formatNumeric(uniform),
                    bottomRight: formatNumeric(uniform),
                    bottomLeft: formatNumeric(uniform),
                });
                setCornerRadiusDraft(formatNumeric(uniform));
            }
        } else {
            cornerDetailRef.current = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
            setCornerDetailDraft({ topLeft: '0', topRight: '0', bottomRight: '0', bottomLeft: '0' });
            setCornerRadiusDraft('0');
            setShowCornerDetails(false);
        }
    }, [primaryShape?.cornerRadius, primaryShape?.cornerRadii, primaryShape?.id, supportsCornerRadius]);

    const [smoothingActive, setSmoothingActive] = useState(false);
    const [smoothingValue, setSmoothingValue] = useState(0);
    const smoothingRef = useRef(0);

    useEffect(() => {
        if (primaryShape && supportsCornerRadius) {
            const smoothing = typeof primaryShape.cornerSmoothing === 'number'
                ? clamp(primaryShape.cornerSmoothing, 0, 1)
                : 0;
            smoothingRef.current = smoothing;
            setSmoothingValue(smoothing);
            setSmoothingActive(smoothing > 0);
        } else {
            smoothingRef.current = 0;
            setSmoothingValue(0);
            setSmoothingActive(false);
        }
    }, [primaryShape?.cornerSmoothing, primaryShape?.id, supportsCornerRadius]);

    const currentBlendMode = typeof primaryShape?.blendMode === 'string' ? primaryShape.blendMode : 'normal';
    const isVisible = primaryShape ? primaryShape.visible !== false : true;

    const handleAlignmentClick = (id) => {
        if (!isMultiSelect || typeof onAlign !== 'function') return;
        onAlign(id);
        setAlignmentActive(id);
    };

    const handleDistributionClick = (mode) => {
        if (!isMultiSelect || typeof onDistribute !== 'function') return;
        onDistribute(mode);
        setDistributionActive(mode);
    };

    const handlePositionFieldChange = (axis, rawValue) => {
        setPositionDraft((prev) => ({ ...prev, [axis]: rawValue }));
        /*if (!hasSelection || typeof onPositionChange !== 'function') return;
        const numeric = Number(rawValue);
        if (Number.isNaN(numeric)) return;
        const next = { ...positionRef.current, [axis]: numeric };
        positionRef.current = next;
        onPositionChange(next);*/
    };

    const commitPositionDraft = () => {
        if (!hasSelection || typeof onPositionChange !== 'function') return;
        const xNum = Number(positionDraft.x);
        const yNum = Number(positionDraft.y);
        if (!Number.isNaN(xNum) && !Number.isNaN(yNum)) {
            positionRef.current = { x: xNum, y: yNum };
            onPositionChange(positionRef.current);
        }
    };

    const commitDimensionDraft = () => {
        if (!supportsDimensions || typeof onDimensionChange !== 'function') return;
        let w = Number(dimensionDraft.width);
        let h = Number(dimensionDraft.height);
        if (Number.isNaN(w) || Number.isNaN(h)) return;

        if (isAspectLocked && w > 0 && h > 0) {
            // keep ratio; infer which field changed and compute the other
            const last = dimensionRef.current; // previous committed
            const ratio = aspectRatioRef.current || (last.height > 0 ? last.width / last.height : w / (h || 1));
            if (String(w) !== String(last.width)) {
                h = ratio ? w / ratio : h;
            } else if (String(h) !== String(last.height)) {
                w = ratio ? h * ratio : w;
            }
        }

        w = Math.max(0, w);
        h = Math.max(0, h);
        dimensionRef.current = { width: w, height: h };
        if (h > 0) aspectRatioRef.current = w / h;

        // single commit
        onDimensionChange({ width: w, height: h });

        // normalize drafts so the UI shows clean numbers after commit
        setDimensionDraft({ width: String(Math.round(w * 100) / 100), height: String(Math.round(h * 100) / 100) });
    };

    const handleDimensionFieldChange = (axis, rawValue) => {
        setDimensionDraft((prev) => ({ ...prev, [axis]: rawValue }));
        /*if (!supportsDimensions || typeof onDimensionChange !== 'function') return;
        const numeric = Number(rawValue);
        if (Number.isNaN(numeric)) return;
        let nextWidth = dimensionRef.current.width;
        let nextHeight = dimensionRef.current.height;
        if (axis === 'width') {
            nextWidth = Math.max(0, numeric);
            if (isAspectLocked && aspectRatioRef.current > 0) {
                nextHeight = aspectRatioRef.current ? nextWidth / aspectRatioRef.current : nextHeight;
                dimensionRef.current = { width: nextWidth, height: nextHeight };
                setDimensionDraft((prev) => ({ ...prev, height: formatNumeric(nextHeight) }));
            } else {
                dimensionRef.current = { ...dimensionRef.current, width: nextWidth };
            }
        } else {
            nextHeight = Math.max(0, numeric);
            if (isAspectLocked && aspectRatioRef.current > 0) {
                nextWidth = nextHeight * aspectRatioRef.current;
                dimensionRef.current = { width: nextWidth, height: nextHeight };
                setDimensionDraft((prev) => ({ ...prev, width: formatNumeric(nextWidth) }));
            } else {
                dimensionRef.current = { ...dimensionRef.current, height: nextHeight };
            }
        }
        if (nextHeight > 0) {
            aspectRatioRef.current = nextWidth / nextHeight;
        }
        onDimensionChange({ width: nextWidth, height: nextHeight });*/
    };

    const handleAspectToggle = () => {
        setAspectLocked((prev) => {
            const next = !prev;
            if (next) {
                const { width, height } = dimensionRef.current;
                if (height > 0) {
                    aspectRatioRef.current = width / height;
                }
            }
            return next;
        });
    };

    const handleRotationInputChange = (value) => {
        setRotationDraft(value);
        if (!hasSelection || typeof onRotationChange !== 'function') return;
        const numeric = Number(value);
        if (Number.isNaN(numeric)) return;
        rotationRef.current = numeric;
        onRotationChange(numeric);
    };

    const handleRotateClockwiseClick = () => {
        if (!hasSelection || typeof onRotateClockwise !== 'function') return;
        onRotateClockwise();
        const next = rotationRef.current + 90;
        rotationRef.current = next;
        setRotationDraft(formatNumeric(next, 1));
    };

    const handleFlipClick = (axis) => {
        if (!hasSelection || typeof onFlip !== 'function') return;
        onFlip(axis);
    };

    const handleOpacityInputChange = (value) => {
        setOpacityDraft(value);
        if (!hasSelection || typeof onOpacityChange !== 'function') return;
        const numeric = Number(value);
        if (Number.isNaN(numeric)) return;
        const clampedPercent = clamp(numeric, 0, 100);
        onOpacityChange(clampedPercent / 100);
    };
    const commitRotation = () => {
        if (!hasSelection || typeof onRotationChange !== 'function') return;
        const n = Number(rotationDraft); if (Number.isNaN(n)) return;
        onRotationChange(n);
    };

    const commitOpacity = () => {
        if (!hasSelection || typeof onOpacityChange !== 'function') return;
        const n = Number(opacityDraft); if (Number.isNaN(n)) return;
        onOpacityChange(Math.min(100, Math.max(0, n)) / 100);
    };


    const handleCornerRadiusInputChange = (value) => {
        /*setCornerRadiusDraft(value);
        //if (!supportsCornerRadius || typeof onCornerRadiusChange !== 'function') return;
        const numeric = Number(value);
        if (Number.isNaN(numeric)) return;
        const clampedValue = Math.max(0, numeric);
        console.log('clampedValue', value),
        cornerDetailRef.current = {
            topLeft: clampedValue,
            topRight: clampedValue,
            bottomRight: clampedValue,
            bottomLeft: clampedValue,
        };
        setCornerDetailDraft({
            topLeft: formatNumeric(clampedValue),
            topRight: formatNumeric(clampedValue),
            bottomRight: formatNumeric(clampedValue),
            bottomLeft: formatNumeric(clampedValue),
        });
        onCornerRadiusChange(clampedValue);*/
        setCornerRadiusDraft(value);
    };

    // Commit the single unified corner radius from the draft
    const commitCornerRadiusFromDraft = () => {
        if (!supportsCornerRadius || typeof onCornerRadiusChange !== 'function') return;
        const numeric = Number(cornerRadiusDraft);
        if (Number.isNaN(numeric)) return;
        const clampedValue = Math.max(0, numeric);

        // keep detail ref in sync
        cornerDetailRef.current = {
            topLeft: clampedValue,
            topRight: clampedValue,
            bottomRight: clampedValue,
            bottomLeft: clampedValue,
        };
        setCornerDetailDraft({
            topLeft: formatNumeric(clampedValue),
            topRight: formatNumeric(clampedValue),
            bottomRight: formatNumeric(clampedValue),
            bottomLeft: formatNumeric(clampedValue),
        });

        onCornerRadiusChange(clampedValue);
    };

    // Factory to commit one corner detail by key, from its draft field
    const commitCornerDetailFromDraft = (key) => {
        if (!supportsCornerRadius || typeof onCornerRadiusChange !== 'function') return;
        const draftValue = cornerDetailDraft?.[key];
        const numeric = Number(draftValue);
        if (Number.isNaN(numeric)) return;
        const clampedValue = Math.max(0, numeric);

        cornerDetailRef.current = { ...cornerDetailRef.current, [key]: clampedValue };
        onCornerRadiusChange({ ...cornerDetailRef.current });
    };

    // Convenience: handle Enter key to commit
    const handleCommitKeyDown = (e, commitFn) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitFn();
            // Optionally blur to show commit happened
            if (e.currentTarget && typeof e.currentTarget.blur === 'function') e.currentTarget.blur();
        }
    };

    // Commit a uniform corner radius from the single input
    const commitCornerRadius = () => {
        if (!supportsCornerRadius || typeof onCornerRadiusChange !== 'function') return;
        const numeric = Number(cornerRadiusDraft);
        if (Number.isNaN(numeric)) return;
        const clamped = Math.max(0, numeric);
        // keep the detail ref in sync
        cornerDetailRef.current = {
            topLeft: clamped, topRight: clamped, bottomRight: clamped, bottomLeft: clamped,
        };
        setCornerDetailDraft({
            topLeft: formatNumeric(clamped),
            topRight: formatNumeric(clamped),
            bottomRight: formatNumeric(clamped),
            bottomLeft: formatNumeric(clamped),
        });
        onCornerRadiusChange(clamped);
    };

    // Commit an individual corner by key
    const commitCornerDetail = (key) => {
        if (!supportsCornerRadius || typeof onCornerRadiusChange !== 'function') return;
        const raw = cornerDetailDraft[key];
        const numeric = Number(raw);
        if (Number.isNaN(numeric)) return;
        const clamped = Math.max(0, numeric);
        cornerDetailRef.current = { ...cornerDetailRef.current, [key]: clamped };
        onCornerRadiusChange({ ...cornerDetailRef.current });
    };

    const handleCornerDetailInputChange = (key, value) => {
        setCornerDetailDraft((prev) => ({ ...prev, [key]: value }));
        /*if (!supportsCornerRadius || typeof onCornerRadiusChange !== 'function') return;
        const numeric = Number(value);
        if (Number.isNaN(numeric)) return;
        const clampedValue = Math.max(0, numeric);
        cornerDetailRef.current = { ...cornerDetailRef.current, [key]: clampedValue };
        onCornerRadiusChange({ ...cornerDetailRef.current });*/
    };

    const handleCornerDetailsToggle = () => {
        setShowCornerDetails((prev) => !prev);
    };

    const handleSmoothingToggle = () => {
        if (!supportsCornerRadius || typeof onCornerSmoothingChange !== 'function') return;
        if (smoothingActive) {
            setSmoothingActive(false);
            setSmoothingValue(0);
            smoothingRef.current = 0;
            onCornerSmoothingChange(0);
        } else {
            const nextValue = smoothingValue > 0 ? smoothingValue : 0.2;
            setSmoothingActive(true);
            setSmoothingValue(nextValue);
            smoothingRef.current = nextValue;
            onCornerSmoothingChange(nextValue);
        }
    };

    const handleSmoothingSliderChange = (event) => {
        if (!supportsCornerRadius || typeof onCornerSmoothingChange !== 'function') return;
        const numeric = Number(event.target.value);
        if (Number.isNaN(numeric)) return;
        const normalized = clamp(numeric, 0, 100) / 100;
        setSmoothingValue(normalized);
        smoothingRef.current = normalized;
        if (!smoothingActive && normalized > 0) {
            setSmoothingActive(true);
        }
        onCornerSmoothingChange(normalized);
    };

    const handleVisibilityToggle = () => {
        if (!hasSelection || typeof onVisibilityChange !== 'function') return;
        const isVisible = primaryShape ? primaryShape.visible !== false : true;
        onVisibilityChange(!isVisible);
    };

    const handleBlendChange = (mode) => {
        if (!hasSelection || typeof onBlendModeChange !== 'function') return;
        onBlendModeChange(mode);
    };

    const getIconButtonStyles = (active, disabled) => ({
        ...iconButtonStyle,
        ...(active ? iconButtonActiveStyle : null),
        ...(disabled ? iconButtonDisabledStyle : null),
    });

    const appearanceActions = (
        <>
            <button
                type="button"
                title={isVisible ? 'Hide selection' : 'Show selection'}
                onClick={handleVisibilityToggle}
                disabled={!hasSelection}
                style={{
                    ...iconButtonStyle,
                    width: 32,
                    height: 32,
                    ...(isVisible ? null : { color: '#1d4ed8', borderColor: '#94a3b8' }),
                    pointerEvents: !hasSelection ? 'none' : 'auto',
                }}
            >
                <EyeIcon hidden={!isVisible} />
            </button>
            <div style={blendActionsWrapperStyle}>
                {blendOptions.map((option) => (
                    <button
                        key={option.id}
                        type="button"
                        title={option.label}
                        onClick={() => handleBlendChange(option.id)}
                        disabled={!hasSelection}
                        style={{
                            ...blendButtonStyle,
                            ...(currentBlendMode === option.id ? blendButtonActiveStyle : null),
                            pointerEvents: !hasSelection ? 'none' : 'auto',
                        }}
                    >
                        <BlendDot />
                    </button>
                ))}
            </div>
        </>
    );

    const NumericField = ({
        label,
        value,
        onChange,
        onBlur,
        onKeyDown,
        onFocus,
        suffix = 'px',
        prefix = 'x',
        step = 1,
        min = undefined,
        max = undefined,
        disabled = false,
    }) => (
        <label style={{ ...numericFieldStyle, opacity: disabled ? 0.5 : 1 }}>
            <span style={sectionSubheadingStyle}>{label}</span>
            <div

                style={{
                    ...numericInputWrapperInlineStyle,
                    pointerEvents: disabled ? 'none' : 'auto',
                }}
            >
                {prefix ? <span style={unitPrefixStyle}>{prefix}</span> : null}
                <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    step={step}
                    min={min}
                    max={max}
                    onChange={(event) => onChange(event.target.value)}
                    onFocus={(event) => event.target.select?.()}
                    onBlur={onBlur}
                    onKeyDown={onKeyDown}
                    style={numericInputFieldStyle}
                    disabled={disabled}
                />
                {suffix ? <span style={unitSuffixStyle}>{suffix}</span> : null}
            </div>
        </label>
    );

    const [localFontEntries, setLocalFontEntries] = useState([]);

    /*
    useEffect(() => {
        let isActive = true;

        const normalizeFonts = (fonts) => {
            const families = Array.from(
                new Set(
                    fonts
                        .map((font) =>
                            typeof font === 'string'
                                ? font
                                : font?.family || font?.fullName || font?.postscriptName
                        )
                        .filter((family) => typeof family === 'string')
                        .map((family) => family.trim())
                        .filter(Boolean)
                )
            ).slice(0, 200);

            return families.map((family) => ({
                value: family,
                label: family,
                variations: DEFAULT_FONT_VARIATIONS,
            }));
        };

        const loadLocalFonts = async () => {
            if (typeof window === 'undefined' || typeof navigator === 'undefined') {
                return;
            }

            try {
                if (navigator?.fonts?.query) {
                    const collected = [];
                    // eslint-disable-next-line no-restricted-syntax
                    for await (const fontData of navigator.fonts.query()) {
                        collected.push(fontData);
                    }
                    if (isActive) {
                        setLocalFontEntries(normalizeFonts(collected));
                    }
                } else if (typeof window.queryLocalFonts === 'function') {
                    const localFonts = await window.queryLocalFonts();
                    if (isActive) {
                        setLocalFontEntries(normalizeFonts(localFonts));
                    }
                }
            } catch (error) {
                console.warn('Unable to access local fonts', error);
            }
        };

        loadLocalFonts();

        return () => {
            isActive = false;
        };
    }, []);
    */

   const normalizeFonts = (fontArray) => {
  if (!Array.isArray(fontArray)) return [];
  return fontArray.map((font) => ({
    family: font.family || font.familyName || font.fullName || 'Unknown',
    fullName: font.fullName || font.family || 'Unknown',
    postscriptName: font.postscriptName || font.postscript || font.fullName || 'Unknown',
  }));
};

   // Ask for local fonts only after a user gesture
  const loadLocalFonts = async () => {
      let isActive = true;
      console.log('Requesting local fonts...');
      try {
          if (navigator?.fonts?.query) {
              const collected = [];
              // Must be called from a user gesture (e.g., button onClick)
              for await (const fontData of navigator.fonts.query()) {
                  collected.push(fontData);
              }
              if (isActive) setLocalFontEntries(normalizeFonts(collected));
          } else if (typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function') {
              // Chromium alt API
              const localFonts = await window.queryLocalFonts();
              if (isActive) setLocalFontEntries(normalizeFonts(localFonts));
          } else {
              console.info('Local Font Access API not supported in this browser');
          }
      } catch (err) {
          // SecurityError typically means no user activation or permission denied
          console.warn('Unable to access local fonts', err);
      }
      return () => { isActive = false; };
  };

    const fontOptions = useMemo(() => {
        const seen = new Set();
        const options = [];

        const registerOption = ({ label, value }) => {
            if (typeof value !== 'string') return;
            const key = value.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            options.push({ label, value });
        };

        FONT_LIBRARY.forEach(registerOption);
        localFontEntries.forEach(registerOption);

        return options;
    }, [localFontEntries]);

    const fontVariationOptions = useMemo(() => {
        const selectedFont = [...FONT_LIBRARY, ...localFontEntries].find(
            (option) => option.value === textFontFamily
        );
        const variations = selectedFont?.variations || DEFAULT_FONT_VARIATIONS;
        return variations;
    }, [textFontFamily, localFontEntries]);

    const normalizedFontStyle = useMemo(
        () => (typeof textFontStyle === 'string' && textFontStyle.trim() ? textFontStyle.trim() : 'normal'),
        [textFontStyle]
    );

    const decorationState = useMemo(() => {
        const underline = typeof textDecoration === 'string' && textDecoration.includes('underline');
        const lineThrough = typeof textDecoration === 'string' && textDecoration.includes('line-through');
        return { underline, lineThrough };
    }, [textDecoration]);

    const updateDecoration = (updates) => {
        const next = {
            underline: decorationState.underline,
            lineThrough: decorationState.lineThrough,
            ...updates,
        };
        const parts = [];
        if (next.underline) parts.push('underline');
        if (next.lineThrough) parts.push('line-through');
        if (typeof onTextDecorationChange === 'function') {
            onTextDecorationChange(parts.join(' ') || 'none');
        }
    };

    const alignOptions = ['left', 'center', 'right', 'justify'];
    const verticalAlignOptions = [
        { id: 'top', label: 'Top' },
        { id: 'middle', label: 'Middle' },
        { id: 'bottom', label: 'Bottom' },
];

const shapeName = useMemo(() => {
    if (!shape) return 'No selection';
    const labels = {
        rectangle: 'Rectangle',
        circle: 'Circle',
        ellipse: 'Ellipse',
        line: 'Line',
        pen: 'Path',
        text: 'Text',
    };
    const base = labels[shape.type] || 'Layer';
    return `${base}${typeof shape.id === 'number' ? ` #${shape.id}` : ''}`;
}, [shape]);

const subtitle = shape
    ? 'Adjust layer appearance and typography.'
        : 'Select a layer on the canvas to edit its properties.';

    const resolvedPanelWidth = Math.min(
        Math.max(
            typeof panelWidth === 'number' ? panelWidth : PROPERTIES_PANEL_DEFAULT_WIDTH,
            PROPERTIES_PANEL_MIN_WIDTH
        ),
        PROPERTIES_PANEL_MAX_WIDTH
    );

    const asideStyle = {
        ...basePanelStyle,
        flex: '0 0 auto',
        width: resolvedPanelWidth,
        minWidth: PROPERTIES_PANEL_MIN_WIDTH,
        maxWidth: PROPERTIES_PANEL_MAX_WIDTH,
        height: '100%',
    };

    return (
        <aside style={asideStyle}>
            <div style={headerStyle}>
                <div style={tabsRowStyle}>
                    <button type="button" style={{ ...tabButtonStyle, ...activeTabStyle }}>Design</button>
                    <button type="button" style={disabledTabStyle} disabled>
                        Prototype
                    </button>
                    <button type="button" style={disabledTabStyle} disabled>
                        Inspect
                    </button>
                </div>
                <div style={activeSummaryStyle}>
                    <div style={activeTitleStyle}>{shapeName}</div>
                    <div style={activeSubtitleStyle}>{subtitle}</div>
                </div>
            </div>

            <div style={contentStyle}>
                <Section title="Positions">
                    <div>
                        <div style={sectionSubheadingStyle}>Alignment</div>
                        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, marginTop: 4 }}>
                            <div style={alignmentGridStyle}>
                                {horizontalAlignmentControls.map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        title={label}
                                        onClick={() => handleAlignmentClick(id)}
                                        disabled={!isMultiSelect}
                                        style={getIconButtonStyles(alignmentActive === id, !isMultiSelect)}
                                    >
                                        <Icon />
                                    </button>
                                ))}
                            </div>
                            <div style={alignmentGridStyle}>
                                {verticalAlignmentControls.map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        title={label}
                                        onClick={() => handleAlignmentClick(id)}
                                        disabled={!isMultiSelect}
                                        style={getIconButtonStyles(alignmentActive === id, !isMultiSelect)}
                                    >
                                        <Icon />
                                    </button>
                                ))}
                            </div>
                            <div style={distributeRowStyle}>
                                {distributionControls.map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        title={label}
                                        onClick={() => handleDistributionClick(id)}
                                        disabled={!isMultiSelect}
                                        style={getIconButtonStyles(distributionActive === id, !isMultiSelect)}
                                    >
                                        <Icon />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <div style={sectionSubheadingStyle}>Position</div>
                        <div style={numericRowStyle}>
                            <NumericField
                                value={positionDraft.x}
                                onChange={(value) => handlePositionFieldChange('x', value)}
                                onFocus={() => { positionEditingRef.current = true; }}
                                onBlur={commitPositionDraft}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitPositionDraft(); }}
                                step={1}
                                prefix="X"
                                suffix="px"
                                disabled={!hasSelection}
                            />
                            <NumericField
                                value={positionDraft.y}
                                onChange={(value) => handlePositionFieldChange('y', value)}
                                onFocus={() => { positionEditingRef.current = true; }}
                                onBlur={commitPositionDraft}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitPositionDraft(); }}
                                step={1}
                                prefix="Y"
                                suffix="px"
                                disabled={!hasSelection}
                            />
                        </div>
                    </div>
                    <div>
                        <div style={sectionSubheadingStyle}>Rotation</div>
                        <div style={rotationRowStyle}>
                            <NumericField
                                label=""
                                value={rotationDraft}
                                onChange={handleRotationInputChange}
                                onBlur={commitRotation}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitRotation(); }}
                                prefix=""
                                suffix="°"
                                step={1}
                                disabled={!hasSelection}
                            />
                            <button
                                type="button"
                                title="Rotate 90° Clockwise"
                                onClick={handleRotateClockwiseClick}
                                disabled={!hasSelection}
                                style={getIconButtonStyles(false, !hasSelection)}
                            >
                                <RotateIcon />
                            </button>
                            <button
                                type="button"
                                title="Flip Horizontal"
                                onClick={() => handleFlipClick('horizontal')}
                                disabled={!hasSelection}
                                style={getIconButtonStyles(false, !hasSelection)}
                            >
                                <FlipHorizontalIcon />
                            </button>
                            <button
                                type="button"
                                title="Flip Vertical"
                                onClick={() => handleFlipClick('vertical')}
                                disabled={!hasSelection}
                                style={getIconButtonStyles(false, !hasSelection)}
                            >
                                <FlipVerticalIcon />
                            </button>
                        </div>
                    </div>
                </Section>

                <div style={dividerStyle} />

                <Section title="Layout">
                    <div>
                        <div style={sectionSubheadingStyle}>Dimension</div>
                        <div style={dimensionRowStyle}>
                            <NumericField
                                label=""
                                value={dimensionDraft.width}
                                onChange={(value) => handleDimensionFieldChange('width', value)}
                                onFocus={() => { dimensionEditingRef.current = true; }}
                                onBlur={commitDimensionDraft}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitDimensionDraft(); }}
                                step={1}
                                suffix="px"
                                prefix="W"
                                disabled={!supportsDimensions || !hasSelection}
                            />
                            <NumericField
                                label=""
                                value={dimensionDraft.height}
                                onChange={(value) => handleDimensionFieldChange('height', value)}
                                onFocus={() => { dimensionEditingRef.current = true; }}
                                onBlur={commitDimensionDraft}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitDimensionDraft(); }}
                                step={1}
                                suffix="px"
                                prefix="H"
                                disabled={!supportsDimensions || !hasSelection}
                            />
                            <button
                                type="button"
                                title={isAspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                                onClick={handleAspectToggle}
                                disabled={!supportsDimensions || !hasSelection}
                                style={{
                                    ...toggleButtonStyle,
                                    width: 24,
                                    height: 24,
                                    padding: 0,
                                    ...(isAspectLocked ? toggleButtonActiveStyle : null),
                                    pointerEvents: !supportsDimensions || !hasSelection ? 'none' : 'auto',
                                }}
                            >
                                {isAspectLocked ? <LockClosedIcon /> : <LockOpenIcon />}
                            </button>
                        </div>
                    </div>
                </Section>

                <div style={dividerStyle} />

                <Section title="Appearance" actions={appearanceActions}>
                    <div>
                        <div style={appearanceRowStyle}>
                            <NumericField
                                label="Opacity"
                                value={opacityDraft}
                                onChange={handleOpacityInputChange}
                                onBlur={commitOpacity}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitOpacity(); }}
                                min={0}
                                max={100}
                                suffix="%"
                                prefix=""
                                disabled={!hasSelection}
                            />
                            <NumericField
                                label="Corner Radius"
                                value={cornerRadiusDraft}
                                onChange={handleCornerRadiusInputChange}
                                //onChange={(value) => setCornerRadiusDraft(value)}
                                onBlur={commitCornerRadius}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitCornerRadius(); }}
                                step={1}
                                suffix="px"
                                prefix=""
                                disabled={!supportsCornerRadius || !hasSelection}
                            />
                            <button
                                type="button"
                                title={showCornerDetails ? 'Hide individual corners' : 'Show individual corners'}
                                onClick={handleCornerDetailsToggle}
                                disabled={!supportsCornerRadius || !hasSelection}
                                style={{
                                    ...toggleButtonStyle,
                                    width: 24,
                                    height: 24,
                                    padding: 0,
                                    ...(showCornerDetails ? toggleButtonActiveStyle : null),
                                    pointerEvents: !supportsCornerRadius || !hasSelection ? 'none' : 'auto',
                                }}
                            >
                                <ChevronDownIcon rotated={showCornerDetails} />
                            </button>
                        </div>
                        {showCornerDetails ? (
                            <div style={cornerDetailsGridStyle}>
                                <NumericField
                                    label="Top-Left"
                                    value={cornerDetailDraft.topLeft || cornerRadiusDraft}
                                    onChange={(value) => handleCornerDetailInputChange('topLeft', value)}
                                    onBlur={() => commitCornerDetail('topLeft')}
                                    onKeyDown={(e) => { if (e.key === 'Enter') commitCornerDetail('topLeft'); }}
                                    step={1}
                                    suffix="px"
                                    disabled={!supportsCornerRadius || !hasSelection}
                                />
                                <NumericField
                                    label="Top-Right"
                                    value={cornerDetailDraft.topRight}
                                    onChange={(value) => handleCornerDetailInputChange('topRight', value)}
                                    onBlur={() => commitCornerDetail('topRight')}
                                    onKeyDown={(e) => { if (e.key === 'Enter') commitCornerDetail('topRight'); }}
                                    step={1}
                                    suffix="px"
                                    disabled={!supportsCornerRadius || !hasSelection}
                                />
                                <NumericField
                                    label="Bottom-Right"
                                    value={cornerDetailDraft.bottomRight}
                                    onChange={(value) => handleCornerDetailInputChange('bottomRight', value)}
                                    onBlur={() => commitCornerDetail('bottomRight')}
                                    onKeyDown={(e) => { if (e.key === 'Enter') commitCornerDetail('bottomRight') }}
                                    step={1}
                                    suffix="px"
                                    disabled={!supportsCornerRadius || !hasSelection}
                                />
                                <NumericField
                                    label="Bottom-Left"
                                    value={cornerDetailDraft.bottomLeft}
                                    onChange={(value) => handleCornerDetailInputChange('bottomLeft', value)}
                                    onBlur={() => commitCornerDetail('bottomLeft')}
                                    onKeyDown={(e) => { if (e.key === 'Enter') commitCornerDetail('bottomLeft'); }}
                                    step={1}
                                    suffix="px"
                                    disabled={!supportsCornerRadius || !hasSelection}
                                />
                            </div>
                        ) : null}
                        <div style={smoothingControlStyle}>
                            <span style={sectionSubheadingStyle}>Corner Smoothing</span>
                            <button
                                type="button"
                                title={smoothingActive ? 'Disable corner smoothing' : 'Enable corner smoothing'}
                                onClick={handleSmoothingToggle}
                                disabled={!supportsCornerRadius || !hasSelection}
                                style={{
                                    ...toggleButtonStyle,
                                    ...(smoothingActive ? toggleButtonActiveStyle : null),
                                    pointerEvents: !supportsCornerRadius || !hasSelection ? 'none' : 'auto',
                                }}
                            >
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={Math.round(smoothingValue * 100)}
                                onChange={handleSmoothingSliderChange}
                                disabled={!supportsCornerRadius || !hasSelection || !smoothingActive}
                                style={{
                                    ...sliderStyle,
                                    opacity: smoothingActive ? 1 : 0.5,
                                    pointerEvents:
                                        !supportsCornerRadius || !hasSelection || !smoothingActive
                                            ? 'none'
                                            : 'auto',
                                }}
                            />
                            <span style={fieldLabelStyle}>{Math.round(smoothingValue * 100)}%</span>
                        </div>
                    </div>
                </Section>

                <div style={dividerStyle} />

                <Section title="Fill">
                    <ColorControl
                        label=""
                        style={supportsFill ? fillStyle : { type: 'solid', value: '#000000' }}
                        onStyleChange={supportsFill ? onFillStyleChange : undefined}
                        disabled={!supportsFill}
                        onGradientPopoverToggle={supportsFill ? onGradientPickerToggle : undefined}
                        gradientInteractionRef={gradientInteractionRef}
                    />
                </Section>

                <div style={dividerStyle} />

                <Section title="Stroke">
                    <ColorControl
                        label=""
                        style={strokeStyle}
                        onStyleChange={disableStrokeControls ? undefined : onStrokeStyleChange}
                        disabled={disableStrokeControls}
                    />
                    <NumberControl
                        label="Stroke Width"
                        value={strokeWidth}
                        onChange={disableStrokeControls ? undefined : onStrokeWidthChange}
                        min={0}
                        max={64}
                        step={1}
                        disabled={disableStrokeControls}
                    />
                    
                </Section>

                <div style={dividerStyle} />

                <Section title="Typography" disabled={!isTextShape}>
                    {/* Optional: only show if API is available and nothing loaded yet */}
                       {(!localFontEntries.length && (navigator?.fonts?.query || window?.queryLocalFonts)) && (
                             <button
                             type="button"
                           onClick={loadLocalFonts}
                           style={{ alignSelf: 'flex-start', marginBottom: 8 }}
                           title="Load local fonts from your system (requires a click)"
     >
                           Load local fonts
                         </button>
   )}
                    <SelectControl
                        label=""
                        value={textFontFamily}
                        onChange={(event) =>
                            typeof onTextFontFamilyChange === 'function' &&
                            onTextFontFamilyChange(event.target.value)
                        }
                        options={fontOptions}
                    />
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <SelectControl
                        label=""
                        value={normalizedFontStyle}
                        onChange={(event) =>
                            typeof onTextFontStyleChange === 'function' &&
                            onTextFontStyleChange(event.target.value || 'normal')
                        }
                        options={fontVariationOptions}
                    />
                    <NumberControl
                        label=""
                        value={textFontSize}
                        onChange={(value) =>
                            typeof onTextFontSizeChange === 'function' && onTextFontSizeChange(value)
                        }
                        min={0}
                        suffix=""
                        prefix=""
                        max={200}
                        step={1}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        
                        <NumberControl
                            label="Line Height"
                            value={textLineHeight}
                            onChange={(value) =>
                                typeof onTextLineHeightChange === 'function' && onTextLineHeightChange(value)
                            }
                            min={0.5}
                            max={4}
                            step={0.1}
                            suffix=""
                        />
                        <NumberControl
                            label="Letter Spacing"
                            value={textLetterSpacing}
                            onChange={(value) =>
                                typeof onTextLetterSpacingChange === 'function' && onTextLetterSpacingChange(value)
                            }
                            min={-10}
                            max={50}
                            step={0.5}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'row', gap: 8, }}>
                    
                    <ToggleField label="Alignment">
                        <ToggleGroup>
                            {alignOptions.map((option) => (
                                <ToggleButton
                                    key={option}
                                    title={`Align ${option}`}
                                    active={textAlign === option}
                                    onClick={() =>
                                        typeof onTextAlignChange === 'function' && onTextAlignChange(option)
                                    }
                                >
                                    {option.charAt(0).toUpperCase()}
                                </ToggleButton>
                            ))}
                        </ToggleGroup>
                    </ToggleField>

                    <ToggleField label="Vertical">
                        <ToggleGroup>
                            {verticalAlignOptions.map((option) => (
                                <ToggleButton
                                    key={option.id}
                                    title={`Vertical align ${option.label}`}
                                    active={textVerticalAlign === option.id}
                                    onClick={() =>
                                        typeof onTextVerticalAlignChange === 'function' &&
                                        onTextVerticalAlignChange(option.id)
                                    }
                                >
                                    {option.label.charAt(0)}
                                </ToggleButton>
                            ))}
                        </ToggleGroup>
                    </ToggleField>

                    <ToggleField label="Decoration">
                        <ToggleGroup>
                            <ToggleButton
                                title="Underline"
                                active={decorationState.underline}
                                onClick={() => updateDecoration({ underline: !decorationState.underline })}
                            >
                                U
                            </ToggleButton>
                            <ToggleButton
                                title="Strikethrough"
                                active={decorationState.lineThrough}
                                onClick={() => updateDecoration({ lineThrough: !decorationState.lineThrough })}
                            >
                                S
                            </ToggleButton>
                        </ToggleGroup>
                        </ToggleField>
                    </div>
                </Section>
            </div>
        </aside>
    );
}

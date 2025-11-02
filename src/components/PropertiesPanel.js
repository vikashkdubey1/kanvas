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
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflowY: 'auto',
    };

    const sectionCardStyle = {
        background: '#ffffff',
        borderRadius: 12,
        padding: '18px 16px',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
    };

    const sectionHeaderStyle = {
        marginBottom: 14,
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
        gap: 14,
    };

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
        height: 36,
        borderRadius: 8,
        border: '1px solid #cdd5e0',
        background: '#f8fafc',
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
        height: 36,
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
    width: 24,
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
    <div style={{ display: 'flex', gap: 6 }}>{children}</div>
);

    const hiddenColorInputStyle = {
        position: 'absolute',
        inset: 0,
        opacity: 0,
        cursor: 'pointer',
    };

    const colorSwatchStyle = {
        position: 'relative',
        width: 36,
        height: 36,
        borderRadius: 10,
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
    padding: '6px 10px',
    borderRadius: 12,
    border: '1px solid #cdd5e0',
    background: '#ffffff',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    minHeight: 48,
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
    gap: 14,
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

    const Section = ({ title, children, disabled = false }) => (
        <section
            style={{
                ...sectionCardStyle,
                opacity: disabled ? 0.55 : 1,
                pointerEvents: disabled ? 'none' : 'auto',
            }}
        >
            <div style={sectionHeaderStyle}>
                <div style={sectionTitleStyle}>{title}</div>
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
    const normalized = normalizeHex(style?.value, '#000000');
    const [draft, setDraft] = useState(normalized.toUpperCase());
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
        if (activeType === 'solid') {
            setDraft(normalized.toUpperCase());
        }
    }, [normalized, activeType]);

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
    }, [isOpen]);

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
    }, [isOpen, clampPositionToViewport]);

        const summaryLabel = useMemo(() => {
        const match = COLOR_STYLE_OPTIONS.find((option) => option.value === activeType);
        return match?.label || 'Solid';
    }, [activeType]);

    const summaryPreview = useMemo(() => {
        if (activeType === 'solid') {
            return { backgroundColor: normalized };
        }
        if (activeType === 'gradient') {
            return {
                backgroundImage: gradientCss,
                backgroundColor: gradientValue.stops[0]?.color || normalized,
            };
        }
        const preset = COLOR_TYPE_PREVIEW_BACKGROUND[activeType];
        if (preset) {
            return { ...preset };
        }
        return { backgroundColor: normalized };
    }, [activeType, normalized, gradientCss, gradientValue]);

    useEffect(() => {
        if (disabled && isOpen) {
            setIsOpen(false);
        }
    }, [disabled, isOpen]);

    if (disabled) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={fieldLabelStyle}>{label}</span>
                <span style={disabledValueStyle}></span>
            </div>
        );
    }

    const commitStyle = (updates) => {
        if (typeof onStyleChange !== 'function') return;
        const nextType = updates.type ?? activeType;
        let nextValue = updates.value ?? style?.value ?? normalized;
        if (nextType === 'solid') {
            nextValue = normalizeHex(nextValue, '#000000');
        } else if (nextType === 'gradient') {
            nextValue = normalizeGradient(nextValue, gradientValue);
        }
        onStyleChange({ type: nextType, value: nextValue });
    };

    commitStyleRef.current = commitStyle;

    useEffect(() => {
        commitStyleRef.current = commitStyle;
    }, [commitStyle]);

    const handleHexChange = (event) => {
        let next = event.target.value.trim();
        if (!next.startsWith('#')) next = `#${next}`;
        setDraft(next.toUpperCase());
        if (HEX_REGEX.test(next)) {
            commitStyle({ type: 'solid', value: next.toLowerCase() });
        }
    };

    const handleBlur = () => {
        setDraft(normalized.toUpperCase());
    };

    const handleTypeSelect = (nextType) => {
        if (nextType === activeType) return;
        if (nextType === 'gradient') {
            commitStyle({ type: 'gradient', value: gradientValue });
            return;
        }
        commitStyle({ type: nextType, value: style?.value ?? normalized });
        };

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
    }, [isOpen, handlePopoverDragEnd, handlePopoverDragMove]);

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

    const commitGradientUpdate = useCallback(
        (updater, options = {}) => {
            const base = gradientValueRef.current;
            const draft = {
                type: base.type,
                angle: base.angle,
                stops: base.stops.map((stop) => ({ ...stop })),
            };
            const updated = typeof updater === 'function' ? updater(draft) || draft : draft;
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
        [setActiveStopIndex, setGradientDrafts]
    );

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
                prev.map((draft, draftIndex) => (draftIndex === index ? next.toUpperCase() : draft))
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
                            <span style={gradientToolbarIconStyle} aria-hidden="true">⇆</span>
                            Flip
                        </button>
                        <button
                            type="button"
                            onClick={handleGradientRotate}
                            style={gradientToolbarButtonStyle}
                        >
                            <span style={gradientToolbarIconStyle} aria-hidden="true">↻</span>
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

    const togglePopover = () => {
        if (isOpen) {
            setIsOpen(false);
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
                            ×
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
                        {activeType === 'solid' ? (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                                <label style={colorPopoverSwatchStyle}>
                                    <span
                                        aria-hidden="true"
                                        style={{
                                            display: 'block',
                                            width: '100%',
                                            height: '100%',
                                            background: normalized,
                                        }}
                                    />
                                    <input
                                        type="color"
                                        value={normalized}
                                        onChange={(event) =>
                                            commitStyle({ type: 'solid', value: event.target.value })
                                        }
                                        style={hiddenColorInputStyle}
                                    />
                                </label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={colorPopoverFieldLabelStyle}>Hex</span>
                                    <input
                                        type="text"
                                        value={draft}
                                        onChange={handleHexChange}
                                        onBlur={handleBlur}
                                        style={hexInputStyle}
                                    />
                                </div>
                            </div>
                        ) : activeType === 'gradient' ? (
                            renderGradientEditor()
                        ) : (
                            renderNonSolidPlaceholder()
                        )}
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
                <span style={fieldLabelStyle}>{label}</span>
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
                                width: 32,
                                height: 32,
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
    }) => (
        <div style={fieldStyle}>
            <span style={fieldLabelStyle}>{label}</span>
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
            <span style={fieldLabelStyle}>{label}</span>
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
}) {
        const isTextShape = shape?.type === 'text';
const supportsFill = !shape || ['rectangle', 'circle', 'ellipse', 'text'].includes(shape.type);

    const [localFontEntries, setLocalFontEntries] = useState([]);

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
                <Section title="Appearance">
                    <ColorControl
                        label="Fill"
                        style={supportsFill ? fillStyle : { type: 'solid', value: '#000000' }}
                        onStyleChange={supportsFill ? onFillStyleChange : undefined}
                        disabled={!supportsFill}
                        onGradientPopoverToggle={supportsFill ? onGradientPickerToggle : undefined}
                        gradientInteractionRef={gradientInteractionRef}
                    />
                    <ColorControl
                        label="Stroke"
                        style={strokeStyle}
                        onStyleChange={onStrokeStyleChange}
                    />
                    <NumberControl
                        label="Stroke Width"
                        value={strokeWidth}
                        onChange={onStrokeWidthChange}
                        min={0}
                        max={64}
                        step={1}
                    />
                </Section>

                <Section title="Typography" disabled={!isTextShape}>
                    <SelectControl
                        label="Font"
                        value={textFontFamily}
                        onChange={(event) =>
                            typeof onTextFontFamilyChange === 'function' &&
                            onTextFontFamilyChange(event.target.value)
                        }
                        options={fontOptions}
                    />

                    <SelectControl
                        label="Variation"
                        value={normalizedFontStyle}
                        onChange={(event) =>
                            typeof onTextFontStyleChange === 'function' &&
                            onTextFontStyleChange(event.target.value || 'normal')
                        }
                        options={fontVariationOptions}
                    />

                    <NumberControl
                        label="Size"
                        value={textFontSize}
                        onChange={(value) =>
                            typeof onTextFontSizeChange === 'function' && onTextFontSizeChange(value)
                        }
                        min={0}
                        max={200}
                        step={1}
                    />
                    <div style={{ display: 'flex', height: '100%', gap: '12px' }}>

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

                    <div style={{ display: 'flex', height: '100%', gap: '12px' }}>

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
                    </div>

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
                </Section>
            </div>
        </aside>
    );
}

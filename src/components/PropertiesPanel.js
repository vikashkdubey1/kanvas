import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    DEFAULT_GRADIENT,
    gradientToCss,
    normalizeGradient,
} from '../utils/gradient';

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


const panelStyle = {
    flex: '0 0 320px',
    minWidth: 280,
    maxWidth: 360,
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
    minWidth: 36,
    padding: '6px 0',
    borderRadius: 8,
    border: '1px solid #cdd5e0',
    background: '#ffffff',
    fontSize: 12,
    fontWeight: 600,
    color: '#1f2937',
    cursor: 'pointer',
    transition: 'all 0.15s ease'
};

const ToggleButton = ({ active, onClick, children, title }) => (
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
        {children}
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
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 8,
    width: 260,
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

const colorModeGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
    gap: 6,
};

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

const gradientStopRowStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
};

const gradientStopControlsStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
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

const ColorControl = ({ label, style, onStyleChange, disabled = false }) => {
    const activeType = style?.type || 'solid';
    const normalized = normalizeHex(style?.value, '#000000');
    const [draft, setDraft] = useState(normalized.toUpperCase());
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    const gradientValue = useMemo(() => normalizeGradient(style?.value, DEFAULT_GRADIENT), [style?.value]);
    const [gradientDrafts, setGradientDrafts] = useState(gradientValue.stops.map((stop) => stop.color.toUpperCase()));
    const gradientCss = useMemo(() => gradientToCss(gradientValue), [gradientValue]);

    useEffect(() => {
        setGradientDrafts(gradientValue.stops.map((stop) => stop.color.toUpperCase()));
    }, [gradientValue]);

    useEffect(() => {
        if (activeType === 'solid') {
            setDraft(normalized.toUpperCase());
        }
    }, [normalized, activeType]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const handlePointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
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

    const handleGradientStopColorChange = (index, color) => {
        const safeColor = normalizeHex(color, gradientValue.stops[index]?.color || '#000000');
        const stops = gradientValue.stops.map((stop, stopIndex) =>
            stopIndex === index ? { ...stop, color: safeColor } : stop
        );
        commitStyle({ type: 'gradient', value: { ...gradientValue, stops } });
    };

    const handleGradientHexChange = (index, event) => {
        let next = event.target.value.trim();
        if (!next.startsWith('#')) next = `#${next}`;
        setGradientDrafts((prev) =>
            prev.map((draft, draftIndex) => (draftIndex === index ? next.toUpperCase() : draft))
        );
        if (HEX_REGEX.test(next)) {
            const stops = gradientValue.stops.map((stop, stopIndex) =>
                stopIndex === index ? { ...stop, color: next.toLowerCase() } : stop
            );
            commitStyle({ type: 'gradient', value: { ...gradientValue, stops } });
        }
    };

    const handleGradientHexBlur = () => {
        setGradientDrafts(gradientValue.stops.map((stop) => stop.color.toUpperCase()));
    };

    const handleGradientAngleChange = (nextAngle) => {
        const normalizedAngle = Number.isNaN(nextAngle) ? gradientValue.angle : nextAngle;
        commitStyle({ type: 'gradient', value: { ...gradientValue, angle: normalizedAngle } });
    };

    const renderGradientEditor = () => {
        const stops = gradientValue.stops.slice(0, 2);
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div
                    style={{
                        ...gradientPreviewStyle,
                        backgroundImage: gradientCss,
                        backgroundColor: stops[0]?.color || '#000000',
                    }}
                />
                {stops.map((stop, index) => (
                    <div key={index} style={gradientStopRowStyle}>
                        <span style={colorPopoverFieldLabelStyle}>
                            {index === 0 ? 'Start colour' : 'End colour'}
                        </span>
                        <div style={gradientStopControlsStyle}>
                            <label style={colorPopoverSwatchStyle}>
                                <span
                                    aria-hidden="true"
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        height: '100%',
                                        background: stop.color,
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
                        </div>
                    </div>
                ))}
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
        setIsOpen((value) => !value);
    };

    return (
        <div
            ref={containerRef}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}
        >
            <span style={fieldLabelStyle}>{label}</span>
            <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={isOpen}
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
            {isOpen && (
                <div style={colorPopoverStyle} role="dialog" aria-label={`${label} colour picker`}>
                    <div style={colorModeGridStyle}>
                        {COLOR_STYLE_OPTIONS.map((option) => (
                            <ToggleButton
                                key={option.value}
                                active={option.value === activeType}
                                onClick={() => handleTypeSelect(option.value)}
                                title={option.label}
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
                                    onChange={(event) => commitStyle({ type: 'solid', value: event.target.value })}
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
            )}
        </div>
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
    shape,
    fillStyle,
    onFillStyleChange,
    strokeStyle,
    onStrokeStyleChange,
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

    return (
        <aside style={panelStyle}>
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
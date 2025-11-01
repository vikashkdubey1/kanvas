import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import PropertiesPanel from './components/PropertiesPanel';

const DEFAULT_FILL_STYLE = { type: 'solid', value: '#d9d9d9' };
const DEFAULT_STROKE_STYLE = { type: 'solid', value: '#000000' };
const DEFAULT_STROKE_WIDTH = 0;
const DEFAULT_TEXT_PROPS = {
    fontFamily: 'Inter',
    fontStyle: 'normal',
    fontSize: 24,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: 'left',
    verticalAlign: 'top',
    textDecoration: 'none',
};

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
    const [fillStyle, setFillStyle] = useState(DEFAULT_FILL_STYLE);
    const [strokeStyle, setStrokeStyle] = useState(DEFAULT_STROKE_STYLE);
    const [strokeWidth, setStrokeWidth] = useState(DEFAULT_STROKE_WIDTH);

    const [textFontFamily, setTextFontFamily] = useState(DEFAULT_TEXT_PROPS.fontFamily);
    const [textFontStyle, setTextFontStyle] = useState(DEFAULT_TEXT_PROPS.fontStyle);
    const [textFontSize, setTextFontSize] = useState(DEFAULT_TEXT_PROPS.fontSize);
    const [textLineHeight, setTextLineHeight] = useState(DEFAULT_TEXT_PROPS.lineHeight);
    const [textLetterSpacing, setTextLetterSpacing] = useState(DEFAULT_TEXT_PROPS.letterSpacing);
    const [textAlign, setTextAlign] = useState(DEFAULT_TEXT_PROPS.align);
    const [textVerticalAlign, setTextVerticalAlign] = useState(DEFAULT_TEXT_PROPS.verticalAlign);
    const [textDecoration, setTextDecoration] = useState(DEFAULT_TEXT_PROPS.textDecoration);

    const [activeShape, setActiveShape] = useState(null);

    useEffect(() => {
        const handleKeyDown = (event) => {
            const target = event.target;
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable)
            ) {
                return;
            }

            if (event.ctrlKey || event.metaKey || event.altKey) return;

            const key = event.key.toLowerCase();
            const shortcutMap = {
                s: 'select',
                r: 'rectangle',
                l: 'line',
                p: 'pen',
                o: 'ellipse',
                h: 'hand',
            };

            const nextTool = shortcutMap[key];
            if (!nextTool) return;

            event.preventDefault();
            setSelectedTool(nextTool);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSelectionChange = useCallback((shape) => {
        setActiveShape(shape);
        if (!shape) {
            return;
        }

        setFillStyle((prev) => {
            const nextType = typeof shape.fillType === 'string' ? shape.fillType : prev.type;
            const nextValue =
                typeof shape.fill === 'string'
                    ? shape.fill
                    : ['rectangle', 'circle', 'ellipse', 'text'].includes(shape.type)
                        ? DEFAULT_FILL_STYLE.value
                        : prev.value;
            return { type: nextType, value: nextValue };
        });

        setStrokeStyle((prev) => {
            const nextType = typeof shape.strokeType === 'string' ? shape.strokeType : prev.type;
            const nextValue = typeof shape.stroke === 'string' ? shape.stroke : prev.value;
            return { type: nextType, value: nextValue };
        });

        if (typeof shape.strokeWidth === 'number' && !Number.isNaN(shape.strokeWidth)) {
            setStrokeWidth(shape.strokeWidth);
        } else {
            setStrokeWidth(shape.type === 'line' || shape.type === 'pen' ? 1 : DEFAULT_STROKE_WIDTH);
        }

        if (shape.type === 'text') {
            setTextFontFamily(shape.fontFamily || DEFAULT_TEXT_PROPS.fontFamily);
            setTextFontStyle(shape.fontStyle || DEFAULT_TEXT_PROPS.fontStyle);
            setTextFontSize(typeof shape.fontSize === 'number' ? shape.fontSize : DEFAULT_TEXT_PROPS.fontSize);
            setTextLineHeight(
                typeof shape.lineHeight === 'number' ? shape.lineHeight : DEFAULT_TEXT_PROPS.lineHeight
            );
            setTextLetterSpacing(
                typeof shape.letterSpacing === 'number' ? shape.letterSpacing : DEFAULT_TEXT_PROPS.letterSpacing
            );
            setTextAlign(shape.align || DEFAULT_TEXT_PROPS.align);
            setTextVerticalAlign(shape.verticalAlign || DEFAULT_TEXT_PROPS.verticalAlign);
            setTextDecoration(shape.textDecoration || DEFAULT_TEXT_PROPS.textDecoration);
        }
    }, []);

    const textOptions = useMemo(
        () => ({
            fontFamily: textFontFamily,
            fontStyle: textFontStyle,
            fontSize: textFontSize,
            lineHeight: textLineHeight,
            letterSpacing: textLetterSpacing,
            align: textAlign,
            verticalAlign: textVerticalAlign,
            textDecoration,
        }),
        [
            textFontFamily,
            textFontStyle,
            textFontSize,
            textLineHeight,
            textLetterSpacing,
            textAlign,
            textVerticalAlign,
            textDecoration,
        ]
    );

    return (
        <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', background: '#f4f6f8' }}>
            <Toolbar selectedTool={selectedTool} onSelect={setSelectedTool} />

            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Canvas
                        selectedTool={selectedTool}
                        onToolChange={setSelectedTool}
                        fillStyle={fillStyle}
                        strokeStyle={strokeStyle}
                        strokeWidth={strokeWidth}
                        textOptions={textOptions}
                        onSelectionChange={handleSelectionChange}
                    />
                </div>

                <PropertiesPanel
                    shape={activeShape}
                    fillStyle={fillStyle}
                    onFillStyleChange={setFillStyle}
                    strokeStyle={strokeStyle}
                    onStrokeStyleChange={setStrokeStyle}
                    strokeWidth={strokeWidth}
                    onStrokeWidthChange={setStrokeWidth}
                    textFontFamily={textFontFamily}
                    onTextFontFamilyChange={setTextFontFamily}
                    textFontStyle={textFontStyle}
                    onTextFontStyleChange={setTextFontStyle}
                    textFontSize={textFontSize}
                    onTextFontSizeChange={setTextFontSize}
                    textLineHeight={textLineHeight}
                    onTextLineHeightChange={setTextLineHeight}
                    textLetterSpacing={textLetterSpacing}
                    onTextLetterSpacingChange={setTextLetterSpacing}
                    textAlign={textAlign}
                    onTextAlignChange={setTextAlign}
                    textVerticalAlign={textVerticalAlign}
                    onTextVerticalAlignChange={setTextVerticalAlign}
                    textDecoration={textDecoration}
                    onTextDecorationChange={setTextDecoration}
                />
            </div>
        </div>
    );
}
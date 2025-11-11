import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import PropertiesPanel, {
    PROPERTIES_PANEL_DEFAULT_WIDTH,
    PROPERTIES_PANEL_MIN_WIDTH,
    PROPERTIES_PANEL_MAX_WIDTH,
} from './components/PropertiesPanel';
import { DEFAULT_GRADIENT, normalizeGradient } from './utils/gradient';

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
    const [strokeWidthVersion, setStrokeWidthVersion] = useState(0);
    const [isGradientPickerOpen, setGradientPickerOpen] = useState(false);
    const gradientInteractionRef = useRef({ active: false });
    const [propertiesPanelWidth, setPropertiesPanelWidth] = useState(
        PROPERTIES_PANEL_DEFAULT_WIDTH
    );

    const [textFontFamily, setTextFontFamily] = useState(DEFAULT_TEXT_PROPS.fontFamily);
    const [textFontStyle, setTextFontStyle] = useState(DEFAULT_TEXT_PROPS.fontStyle);
    const [textFontSize, setTextFontSize] = useState(DEFAULT_TEXT_PROPS.fontSize);
    const [textLineHeight, setTextLineHeight] = useState(DEFAULT_TEXT_PROPS.lineHeight);
    const [textLetterSpacing, setTextLetterSpacing] = useState(DEFAULT_TEXT_PROPS.letterSpacing);
    const [textAlign, setTextAlign] = useState(DEFAULT_TEXT_PROPS.align);
    const [textVerticalAlign, setTextVerticalAlign] = useState(DEFAULT_TEXT_PROPS.verticalAlign);
    const [textDecoration, setTextDecoration] = useState(DEFAULT_TEXT_PROPS.textDecoration);

    const [activeShape, setActiveShape] = useState(null);
    const [shapePropertyRequest, setShapePropertyRequest] = useState(null);

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
                p: 'path',
                a: 'anchor',
                o: 'ellipse',
                h: 'hand',
                f: 'frame',
                g: 'group',
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
            if (nextType === 'gradient') {
                const gradientValue = normalizeGradient(shape.fillGradient || prev.value || DEFAULT_GRADIENT);
                return { type: 'gradient', value: gradientValue };
            }
            const nextValue =
                typeof shape.fill === 'string'
                    ? shape.fill
                    : ['rectangle', 'circle', 'ellipse', 'text', 'frame'].includes(shape.type)
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
            setStrokeWidth(shape.type === 'line' || shape.type === 'path' ? 1 : DEFAULT_STROKE_WIDTH);
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

    const emitShapePropertyChange = useCallback(
        (type, value) => {
            if (!activeShape || !activeShape.id) return;
            setShapePropertyRequest({
                version: Date.now(),
                targetId: activeShape.id,
                payload: { type, value },
            });
        },
        [activeShape]
    );

    const handleShapePropertyRequestHandled = useCallback((version) => {
        setShapePropertyRequest((prev) => (prev && prev.version === version ? null : prev));
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

    const handlePropertiesResizeStart = useCallback(
        (event) => {
@@ -198,147 +217,197 @@ export default function App() {
                        handleElement.releasePointerCapture(pointerId);
                    } catch (error) {
                        // ignore environments without pointer capture support
                    }
                }
                handleElement.removeEventListener('pointermove', handlePointerMove);
                handleElement.removeEventListener('pointerup', handlePointerEnd);
                handleElement.removeEventListener('pointercancel', handlePointerEnd);
            };

            handleElement.addEventListener('pointermove', handlePointerMove);
            handleElement.addEventListener('pointerup', handlePointerEnd);
            handleElement.addEventListener('pointercancel', handlePointerEnd);

            if (typeof handleElement.setPointerCapture === 'function') {
                try {
                    handleElement.setPointerCapture(pointerId);
                } catch (error) {
                    // ignore environments without pointer capture support
                }
            }
        },
        [propertiesPanelWidth]
    );

    const handlePositionChange = useCallback(
        (value) => {
            if (!value) return;
            const next = {
                x: Number(value.x),
                y: Number(value.y),
            };
            if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return;
            emitShapePropertyChange('position', next);
        },
        [emitShapePropertyChange]
    );

    const handleDimensionChange = useCallback(
        (value) => {
            if (!value) return;
            const next = {
                width: Number(value.width),
                height: Number(value.height),
            };
            if (!Number.isFinite(next.width) || !Number.isFinite(next.height)) return;
            emitShapePropertyChange('dimensions', next);
        },
        [emitShapePropertyChange]
    );

    const handleRotationChange = useCallback(
        (value) => {
            const next = Number(value);
            if (!Number.isFinite(next)) return;
            emitShapePropertyChange('rotation', next);
        },
        [emitShapePropertyChange]
    );

    const handleOpacityChange = useCallback(
        (value) => {
            const next = Number(value);
            if (!Number.isFinite(next)) return;
            emitShapePropertyChange('opacity', Math.min(1, Math.max(0, next)));
        },
        [emitShapePropertyChange]
    );

    const handleCornerRadiusChange = useCallback(
        (value) => {
            emitShapePropertyChange('cornerRadius', value);
        },
        [emitShapePropertyChange]
    );

    const handleCornerSmoothingChange = useCallback(
        (value) => {
            emitShapePropertyChange('cornerSmoothing', value);
        },
        [emitShapePropertyChange]
    );

    const handlePolygonSidesChange = useCallback(
        (value) => {
            const next = Math.max(3, Math.floor(Number(value)) || 0);
            emitShapePropertyChange('polygonSides', next);
        },
        [emitShapePropertyChange]
    );

    const handleStrokeWidthChange = useCallback((value) => {
        setStrokeWidth(value);
        setStrokeWidthVersion((prev) => prev + 1);
    }, []);

    return (
    <>
        <style>
            {`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
          html, body, * {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            font-weight: 400;
            letter-spacing: 0.01em;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
        `}
      </style>

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
                        strokeWidthVersion={strokeWidthVersion}
                        textOptions={textOptions}
                        onSelectionChange={handleSelectionChange}
                        showGradientHandles={isGradientPickerOpen}
                        gradientInteractionRef={gradientInteractionRef}
                        shapePropertyRequest={shapePropertyRequest}
                        onShapePropertyRequestHandled={handleShapePropertyRequestHandled}
                    />
                </div>

                <div
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={handlePropertiesResizeStart}
                    style={{
                        flex: '0 0 auto',
                        width: 1,
                        padding: '0',
                        cursor: 'col-resize',
                        display: 'flex',
                        alignItems: 'stretch',
                        touchAction: 'none',
                        background: 'transparent',
                    }}
                >
                    <div
                        style={{
                            flex: 1,
                            borderLeft: '1px solid #dfe3eb',
                            borderRight: '1px solid #dfe3eb',
                            background: '#f3f5f9',
                        }}
                    />
                </div>

                <PropertiesPanel
                    panelWidth={propertiesPanelWidth}
                    shape={activeShape}
                    fillStyle={fillStyle}
                    onFillStyleChange={setFillStyle}
                    onGradientPickerToggle={setGradientPickerOpen}
                    gradientInteractionRef={gradientInteractionRef}
                    strokeStyle={strokeStyle}
                    onStrokeStyleChange={setStrokeStyle}
                    strokeWidth={strokeWidth}
                    onStrokeWidthChange={handleStrokeWidthChange}
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
                    onPositionChange={handlePositionChange}
                    onDimensionChange={handleDimensionChange}
                    onRotationChange={handleRotationChange}
                    onOpacityChange={handleOpacityChange}
                    onCornerRadiusChange={handleCornerRadiusChange}
                    onCornerSmoothingChange={handleCornerSmoothingChange}
                    onPolygonSidesChange={handlePolygonSidesChange}
                />
            </div>
        </div>
        </>
    );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Circle, Ellipse, Line, Text, Transformer } from 'react-konva';
import {
    buildGradientColorStops,
    getGradientFirstColor,
    gradientStopsEqual,
    normalizeGradient,
} from '../utils/gradient';

/**
 * Canvas is the central drawing surface for the application.
 * This component supports creating simple shapes by clicking when a
 * drawing tool is selected. Shapes are stored in local state and
 * rendered with `react-konva`. This version adds selection and a
 * Transformer so shapes can be resized/rotated, plus inline text editing
 * and undo/redo support. It also provides zoom controls.
 */
const normalizeColor = (value, fallback) => (typeof value === 'string' ? value : fallback);

const toRadians = (value) => (value * Math.PI) / 180;

const computeLinearGradientPoints = (shape, angle) => {
    const rad = toRadians(angle || 0);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let halfWidth = 0;
    let halfHeight = 0;

    switch (shape.type) {
        case 'rectangle':
            halfWidth = (shape.width || 0) / 2;
            halfHeight = (shape.height || 0) / 2;
            break;
        case 'circle':
            halfWidth = halfHeight = shape.radius || 0;
            break;
        case 'ellipse':
            halfWidth = shape.radiusX || 0;
            halfHeight = shape.radiusY || 0;
            break;
        case 'text': {
            const estimatedWidth =
                typeof shape.width === 'number' && shape.width > 0
                    ? shape.width
                    : Math.max(120, (shape.text ? shape.text.length : 0) * ((shape.fontSize || 24) * 0.6));
            const estimatedHeight =
                typeof shape.height === 'number' && shape.height > 0
                    ? shape.height
                    : (shape.fontSize || 24) * (shape.lineHeight || 1.2);
            halfWidth = estimatedWidth / 2;
            halfHeight = estimatedHeight / 2;
            break;
        }
        default:
            return null;
    }

    const halfDiagonal = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);
    if (!halfDiagonal) {
        return null;
    }

    return {
        startPoint: { x: -cos * halfDiagonal, y: -sin * halfDiagonal },
        endPoint: { x: cos * halfDiagonal, y: sin * halfDiagonal },
    };
};

export default function Canvas({
    selectedTool,
    onToolChange,
    fillStyle,
    strokeStyle,
    strokeWidth = 0,
    textOptions = {},
    onSelectionChange,
}) {
    const resolvedFillType = fillStyle?.type || 'solid';
    const resolvedFillGradient = useMemo(
        () => (resolvedFillType === 'gradient' ? normalizeGradient(fillStyle?.value) : null),
        [resolvedFillType, fillStyle?.value]
    );
    const resolvedFillColor =
        resolvedFillType === 'gradient'
            ? getGradientFirstColor(resolvedFillGradient, '#d9d9d9')
            : normalizeColor(fillStyle?.value, '#d9d9d9');
    const resolvedStrokeType = strokeStyle?.type || 'solid';
    const resolvedStrokeColor = normalizeColor(strokeStyle?.value, '#000000');
    const stageRef = useRef(null);
    const trRef = useRef(null);
    const idCounterRef = useRef(1); // stable id generator
    const stageContainerRef = useRef(null);
    // panning (hand tool)
    const isPanningRef = useRef(false);
    const panLastPosRef = useRef({ x: 0, y: 0 });
    // drawing (drag-create)
    const isDrawingRef = useRef(false);
    const drawingStartRef = useRef(null);
    const currentDrawingIdRef = useRef(null);
    const pendingTextEditRef = useRef(null);

    const [shapes, setShapes] = useState([]);
    const shapesRef = useRef(shapes);
    useEffect(() => {
        shapesRef.current = shapes;
    }, [shapes]);

    // zoom state
    const [scale, setScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
    const MIN_SCALE = 0.2;
    const MAX_SCALE = 4;
    const LAYER_PANEL_WIDTH = 220;
    const MIN_STAGE_WIDTH = 120;
    const MIN_STAGE_HEIGHT = 200;

    const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

    useEffect(() => {
        const element = stageContainerRef.current;
        if (!element) return;

        const Observer = window.ResizeObserver || ResizeObserver;
        if (!Observer) return;

        const observer = new Observer((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const { width, height } = entry.contentRect;
            setStageSize({
                width: Math.max(MIN_STAGE_WIDTH, width),
                height: Math.max(MIN_STAGE_HEIGHT, height),
            });
        });

        observer.observe(element);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getStageCenter = () => ({ x: stageSize.width / 2, y: stageSize.height / 2 });

    const getCanvasPointer = () => {
        const stage = stageRef.current;
        if (!stage) return null;
        const pointer = stage.getPointerPosition();
        if (!pointer) return null;
        const transform = stage.getAbsoluteTransform().copy();
        transform.invert();
        return transform.point(pointer);
    };

    const resolvedTextOptions = useMemo(
        () => ({
            fontFamily: textOptions.fontFamily || 'Inter',
            fontStyle: textOptions.fontStyle || 'normal',
            fontSize:
                typeof textOptions.fontSize === 'number' && !Number.isNaN(textOptions.fontSize)
                    ? textOptions.fontSize
                    : 24,
            lineHeight:
                typeof textOptions.lineHeight === 'number' && !Number.isNaN(textOptions.lineHeight)
                    ? textOptions.lineHeight
                    : 1.2,
            letterSpacing:
                typeof textOptions.letterSpacing === 'number' && !Number.isNaN(textOptions.letterSpacing)
                    ? textOptions.letterSpacing
                    : 0,
            align: textOptions.align || 'left',
            verticalAlign: textOptions.verticalAlign || 'top',
            textDecoration: textOptions.textDecoration || 'none',
        }),
        [textOptions]
    );

    const {
        fontFamily: textFontFamily,
        fontStyle: textFontStyle,
        fontSize: textFontSize,
        lineHeight: textLineHeight,
        letterSpacing: textLetterSpacing,
        align: textAlignValue,
        verticalAlign: textVerticalAlignValue,
        textDecoration: textDecorationValue,
    } = resolvedTextOptions;

    // snap settings
    const SNAP_ANGLE = 15;
    const snapAngle = (angle) => {
        // normalize to -180..180 then snap
        let a = ((angle + 180) % 360) - 180;
        return Math.round(a / SNAP_ANGLE) * SNAP_ANGLE;
    };

    // helper to zoom centered on a pointer position
    const zoomBy = (factor, pointerPos) => {
        const stage = stageRef.current;
        if (!stage) return;
        const anchor = pointerPos || getStageCenter();
        const oldScale = scale;
        const mousePointTo = {
            x: (anchor.x - stagePos.x) / oldScale,
            y: (anchor.y - stagePos.y) / oldScale,
        };
        let newScale = oldScale * factor;
        newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
        setScale(newScale);
        setStagePos({ x: anchor.x - mousePointTo.x * newScale, y: anchor.y - mousePointTo.y * newScale });
    };

    // rotation handle positions for the selected shape
    //const [rotationHandles, setRotationHandles] = useState([]);

    // history
    const pastRef = useRef([]); // stack of previous states
    const futureRef = useRef([]); // stack for redo
    const HISTORY_LIMIT = 100;

    // helper to record history and apply changes
    const applyChange = (updater) => {
        const prev = shapesRef.current;
        const next = typeof updater === 'function' ? updater(prev) : updater;
        // push prev into past
        pastRef.current.push(prev);
        if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
        // clear future on new change
        futureRef.current = [];
        setShapes(next);
    };

    const undo = () => {
        const past = pastRef.current;
        if (past.length === 0) return;
        const previous = past.pop();
        // push current to future
        futureRef.current.push(shapesRef.current);
        setShapes(previous);
    };

    const redo = () => {
        const future = futureRef.current;
        if (future.length === 0) return;
        const nextState = future.pop();
        pastRef.current.push(shapesRef.current);
        setShapes(nextState);
    };

    // expose for debugging / toolbar integration
    useEffect(() => {
        window.kanvas = window.kanvas || {};
        window.kanvas.undo = undo;
        window.kanvas.redo = redo;
        window.kanvas.zoomIn = () => zoomBy(1.2, getStageCenter());
        window.kanvas.zoomOut = () => zoomBy(1 / 1.2, getStageCenter());
        window.kanvas.resetZoom = () => { setScale(1); setStagePos({ x: 0, y: 0 }); };
        return () => {
            if (window.kanvas) {
                delete window.kanvas.undo;
                delete window.kanvas.redo;
                delete window.kanvas.zoomIn;
                delete window.kanvas.zoomOut;
                delete window.kanvas.resetZoom;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [selectedId, setSelectedId] = useState(null);

    useEffect(() => {
        if (selectedTool === 'select' || selectedId == null) return;
        if (isDrawingRef.current) return;
        setSelectedId(null);
    }, [selectedTool, selectedId]);

    useEffect(() => {
        if (typeof onSelectionChange !== 'function') return;
        const shape = selectedId ? shapes.find((s) => s.id === selectedId) : null;
        onSelectionChange(shape ? { ...shape } : null);
    }, [selectedId, shapes, onSelectionChange]);

    // keyboard shortcuts
    useEffect(() => {
        const onKeyDown = (e) => {
            const target = e.target;
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable)
            ) {
                return;
            }

            const ctrlOrMeta = e.ctrlKey || e.metaKey;

            // 🗑 Delete or Backspace key
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
                e.preventDefault();
                applyChange((prev) => prev.filter((shape) => shape.id !== selectedId));
                setSelectedId(null);
                return;
            }
            if (!ctrlOrMeta) return;

            if (e.key === 'z' || e.key === 'Z') {
                if (e.shiftKey) {
                    // Ctrl+Shift+Z -> redo
                    e.preventDefault();
                    redo();
                } else {
                    e.preventDefault();
                    undo();
                }
            } else if (e.key === 'y' || e.key === 'Y') {
                e.preventDefault();
                redo();
            }

        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    useEffect(() => {
        if (!selectedId) return;
        const shape = shapesRef.current.find((s) => s.id === selectedId);
        if (!shape) return;
        if (!['rectangle', 'circle', 'ellipse', 'text'].includes(shape.type)) return;
        const currentType = typeof shape.fillType === 'string' ? shape.fillType : 'solid';

        if (resolvedFillType === 'gradient' && resolvedFillGradient) {
            const currentGradient =
                currentType === 'gradient' ? normalizeGradient(shape.fillGradient) : null;
            if (currentType === 'gradient' && currentGradient && gradientStopsEqual(currentGradient, resolvedFillGradient)) {
                return;
            }
            applyChange((prev) =>
                prev.map((s) =>
                    s.id === selectedId
                        ? {
                              ...s,
                              fill: getGradientFirstColor(resolvedFillGradient, resolvedFillColor),
                              fillType: 'gradient',
                              fillGradient: resolvedFillGradient,
                          }
                        : s
                )
            );
            return;
        }

        const currentFill = typeof shape.fill === 'string' ? shape.fill : '';
        if (currentFill === resolvedFillColor && currentType === resolvedFillType) return;
        applyChange((prev) =>
            prev.map((s) =>
                s.id === selectedId
                    ? { ...s, fill: resolvedFillColor, fillType: resolvedFillType, fillGradient: null }
                    : s
            )
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvedFillColor, resolvedFillType, resolvedFillGradient]);

    useEffect(() => {
        if (!selectedId) return;
        const shape = shapesRef.current.find((s) => s.id === selectedId);
        if (!shape) return;
        if (!['rectangle', 'circle', 'ellipse', 'line', 'pen', 'text'].includes(shape.type)) return;
        const desiredStrokeWidth = typeof strokeWidth === 'number' ? strokeWidth : 0;
        const currentWidth = typeof shape.strokeWidth === 'number' ? shape.strokeWidth : 0;
        const currentStroke = typeof shape.stroke === 'string' ? shape.stroke : null;
        const currentType = typeof shape.strokeType === 'string' ? shape.strokeType : 'solid';
        if (
            currentStroke === resolvedStrokeColor &&
            currentWidth === desiredStrokeWidth &&
            currentType === resolvedStrokeType
        )
            return;
        applyChange((prev) =>
            prev.map((s) =>
                s.id === selectedId
                    ? {
                        ...s,
                        stroke: resolvedStrokeColor,
                        strokeWidth: desiredStrokeWidth,
                        strokeType: resolvedStrokeType,
                    }
                    : s
            )
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvedStrokeColor, resolvedStrokeType, strokeWidth]);

    useEffect(() => {
        if (!selectedId) return;
        const shape = shapesRef.current.find((s) => s.id === selectedId);
        if (!shape || shape.type !== 'text') return;
        const updates = {};
        if (shape.fontFamily !== textFontFamily) updates.fontFamily = textFontFamily;
        if (shape.fontStyle !== textFontStyle) updates.fontStyle = textFontStyle;
        if (shape.fontSize !== textFontSize) updates.fontSize = textFontSize;
        if (shape.lineHeight !== textLineHeight) updates.lineHeight = textLineHeight;
        if (shape.letterSpacing !== textLetterSpacing) updates.letterSpacing = textLetterSpacing;
        if (shape.align !== textAlignValue) updates.align = textAlignValue;
        if (shape.verticalAlign !== textVerticalAlignValue) updates.verticalAlign = textVerticalAlignValue;
        if (shape.textDecoration !== textDecorationValue) updates.textDecoration = textDecorationValue;
        if (Object.keys(updates).length === 0) return;
        applyChange((prev) =>
            prev.map((s) => (s.id === selectedId ? { ...s, ...updates } : s))
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        textFontFamily,
        textFontStyle,
        textFontSize,
        textLineHeight,
        textLetterSpacing,
        textAlignValue,
        textVerticalAlignValue,
        textDecorationValue,
    ]);

    const handleStageMouseDown = (e) => {
        const stage = stageRef.current;
        if (!stage) return;
        const clickedOnEmpty = e.target === stage;

        // PEN tool: begin freehand stroke anywhere
        if (selectedTool === 'pen') {
            const effectiveStrokeWidth = typeof strokeWidth === 'number' && strokeWidth > 0 ? strokeWidth : 1;
            const pos = getCanvasPointer();
            if (!pos) return;
            const newId = idCounterRef.current++;
            isDrawingRef.current = true;
            currentDrawingIdRef.current = newId;
            drawingStartRef.current = pos;
            setSelectedId(null);
            applyChange((prev) => [
                ...prev,
                {
                    id: newId,
                    type: 'pen',
                    x: 0,
                    y: 0,
                    points: [pos.x, pos.y],
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: effectiveStrokeWidth,
                    lineCap: 'round',
                    lineJoin: 'round',
                    tension: 0.4,
                    rotation: 0,
                },
            ]);
            return;
        }


        // If hand tool is active, start panning instead of creating shapes
        if (selectedTool === 'hand') {
            isPanningRef.current = true;
            const pos = stage.getPointerPosition();
            if (pos) panLastPosRef.current = pos;
            const container = stage.container();
            if (container) container.style.cursor = 'grabbing';
            return;
        }

        // clicking on empty area should clear selection
        if (clickedOnEmpty) setSelectedId(null);

        // start drag-create for supported tools
        const dragTools = ['rectangle', 'circle', 'ellipse', 'line'];
        if (clickedOnEmpty && dragTools.includes(selectedTool)) {
            const pos = getCanvasPointer();
            if (!pos) return;
            const newId = idCounterRef.current++;
            currentDrawingIdRef.current = newId;
            drawingStartRef.current = pos;
            isDrawingRef.current = true;
            let newShape = null;
            if (selectedTool === 'rectangle') {
                newShape = {
                    id: newId,
                    type: 'rectangle',
                    x: pos.x,
                    y: pos.y,
                    width: 1,
                    height: 1,
                    fill: resolvedFillColor,
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                    rotation: 0,
                };
            } else if (selectedTool === 'circle') {
                newShape = {
                    id: newId,
                    type: 'circle',
                    x: pos.x,
                    y: pos.y,
                    radius: 1,
                    fill: resolvedFillColor,
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                    rotation: 0,
                };
            } else if (selectedTool === 'ellipse') {
                newShape = {
                    id: newId,
                    type: 'ellipse',
                    x: pos.x,
                    y: pos.y,
                    radiusX: 1,
                    radiusY: 1,
                    fill: resolvedFillColor,
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                    rotation: 0,
                };
            } else if (selectedTool === 'line') {
                const effectiveStrokeWidth = typeof strokeWidth === 'number' && strokeWidth > 0 ? strokeWidth : 1;
                newShape = {
                    id: newId,
                    type: 'line',
                    points: [pos.x, pos.y, pos.x, pos.y],
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: effectiveStrokeWidth,
                    rotation: 0,
                };
            }
            if (!newShape) return;
            applyChange((prev) => [...prev, newShape]);
            setSelectedId(newId);
            return;
        }

        // fall back to click-to-create (text or simple click behavior)
        // Only add a shape when clicking on empty stage (not on an existing shape)
        if (!clickedOnEmpty) return;
        const pointerPos = getCanvasPointer();
        if (!pointerPos) return;
        const newId = idCounterRef.current++;

        if (selectedTool === 'text') {
            applyChange((prev) => [
                ...prev,
                {
                    id: newId,
                    type: 'text',
                    x: pointerPos.x,
                    y: pointerPos.y,
                    text: 'Text',
                    fill: resolvedFillColor,
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                    rotation: 0,
                    fontFamily: resolvedTextOptions.fontFamily,
                    fontStyle: resolvedTextOptions.fontStyle,
                    fontSize: resolvedTextOptions.fontSize,
                    lineHeight: resolvedTextOptions.lineHeight,
                    letterSpacing: resolvedTextOptions.letterSpacing,
                    align: resolvedTextOptions.align,
                    verticalAlign: resolvedTextOptions.verticalAlign,
                    textDecoration: resolvedTextOptions.textDecoration,
                },
            ]);
            pendingTextEditRef.current = newId;
            setSelectedId(newId);
            if (typeof onToolChange === 'function') onToolChange('select');
        }
    };

    // handle mouse move for panning (hand tool) and drawing
    const handleStageMouseMove = () => {
        const stage = stageRef.current;
        if (!stage) return;
        // if we are drawing, update the temporary shape
        if (isDrawingRef.current) {
            const pos = getCanvasPointer();
            const start = drawingStartRef.current;
            const id = currentDrawingIdRef.current;
            if (!pos || !start || id == null) return;

            // If using PEN, append points to the active stroke and return
            if (selectedTool === 'pen') {
                setShapes((prev) =>
                    prev.map((s) => {
                        if (s.id !== id || s.type !== 'pen') return s;
                        return { ...s, points: [...s.points, pos.x, pos.y] };
                    })
                );
                return;
            }

            setShapes((prev) =>
                prev.map((s) => {
                    if (s.id !== id) return s;
                    if (s.type === 'rectangle') {
                        const dx = pos.x - start.x;
                        const dy = pos.y - start.y;
                        const width = Math.max(2, Math.abs(dx));
                        const height = Math.max(2, Math.abs(dy));
                        const cx = start.x + dx / 2;
                        const cy = start.y + dy / 2;
                        return { ...s, x: cx, y: cy, width, height };
                    }
                    if (s.type === 'circle') {
                        const dx = pos.x - start.x;
                        const dy = pos.y - start.y;
                        const r = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                        return { ...s, radius: r };
                    }
                    if (s.type === 'ellipse') {
                        const dx = pos.x - start.x;
                        const dy = pos.y - start.y;
                        const rx = Math.max(1, Math.abs(dx) / 2);
                        const ry = Math.max(1, Math.abs(dy) / 2);
                        const cx = start.x + dx / 2;
                        const cy = start.y + dy / 2;
                        return { ...s, x: cx, y: cy, radiusX: rx, radiusY: ry };
                    }
                    if (s.type === 'line') {
                        return { ...s, points: [start.x, start.y, pos.x, pos.y] };
                    }
                    return s;
                })
            );
            return;
        }

        // otherwise handle panning
        if (selectedTool !== 'hand' || !isPanningRef.current) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const last = panLastPosRef.current;
        const dx = (pointer.x - last.x) * scale;
        const dy = (pointer.y - last.y) * scale;
        panLastPosRef.current = pointer;
        setStagePos((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    };

    // handle mouse up to stop panning or finish drawing
    const handleStageMouseUp = (e) => {
        const stage = stageRef.current;
        if (!stage) return;
        // finish drawing
        if (isDrawingRef.current) {
            const id = currentDrawingIdRef.current;
            isDrawingRef.current = false;
            currentDrawingIdRef.current = null;
            drawingStartRef.current = null;
            let removed = false;
            // remove very small shapes
            applyChange((prev) => {
                const next = prev.filter((s) => {
                    if (s.id !== id) return true;
                    let keep = true;
                    if (s.type === 'rectangle') keep = s.width >= 5 && s.height >= 5;
                    else if (s.type === 'circle') keep = s.radius >= 3;
                    else if (s.type === 'ellipse') keep = s.radiusX >= 3 && s.radiusY >= 3;
                    else if (s.type === 'line') keep = !(Math.abs(s.points[0] - s.points[2]) < 2 && Math.abs(s.points[1] - s.points[3]) < 2);
                    else if (s.type === 'pen') keep = Array.isArray(s.points) && s.points.length > 4;
                    if (!keep) removed = true;
                    return keep;
                });
                return next;
            });
            if (!removed && selectedTool !== 'pen' && selectedTool !== 'select') {
                if (typeof onToolChange === 'function') onToolChange('select');
            }
            return;
        }

        // otherwise stop panning
        if (selectedTool !== 'hand') return;
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        const container = stage.container();
        if (container) container.style.cursor = 'grab';
    };

    // update cursor when selectedTool changes
    useEffect(() => {

        const stage = stageRef.current;
        if (!stage) return;
        const container = stage.container();
        if (!container) return;

        if (selectedTool === 'select') {
            container.style.cursor = 'default';
        } else if (selectedTool === 'hand') {
            container.style.cursor = isPanningRef.current ? 'grabbing' : 'grab';
        } else {
            // other drawing tools: show crosshair (plus-like)
            container.style.cursor = 'crosshair';
        }

    }, [selectedTool]);

    // Attach transformer to the selected node
    useEffect(() => {
        const tr = trRef.current;
        const stage = stageRef.current;
        if (!tr || !stage) return;

        if (selectedTool !== 'select') {
            if (typeof tr.nodes === 'function') tr.nodes([]);
            const trLayer = typeof tr.getLayer === 'function' ? tr.getLayer() : null;
            if (trLayer && typeof trLayer.batchDraw === 'function') trLayer.batchDraw();
            return;
        }

        if (selectedId == null) {
            if (typeof tr.nodes === 'function') tr.nodes([]);
            const trLayer = typeof tr.getLayer === 'function' ? tr.getLayer() : null;
            if (trLayer && typeof trLayer.batchDraw === 'function') trLayer.batchDraw();
            return;
        }

        const node = stage.findOne(`#shape-${selectedId}`);
        if (node) {
            if (typeof tr.nodes === 'function') {
                tr.nodes([node]);
                if (typeof tr.setAttrs === 'function') {
                    tr.setAttrs({ rotationEnabled: false, enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] });
                }
            }
        } else if (typeof tr.nodes === 'function') {
            tr.nodes([]);
        }
        const trLayer = typeof tr.getLayer === 'function' ? tr.getLayer() : null;
        if (trLayer && typeof trLayer.batchDraw === 'function') trLayer.batchDraw();
    }, [selectedId, shapes, selectedTool]);

    const handleDragEnd = (id, e) => {
        const x = e.target.x();
        const y = e.target.y();
        applyChange((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)));
    };

    const handleTransformEnd = (shape, node) => {
        const id = shape.id;
        if (shape.type === 'rectangle') {
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            const newWidth = Math.max(5, node.width() * scaleX);
            const newHeight = Math.max(5, node.height() * scaleY);
            const rotation = node.rotation() || 0;
            // reset scale back to1
            node.scaleX(1);
            node.scaleY(1);
            applyChange((prev) => prev.map((s) => (s.id === id ? { ...s, width: newWidth, height: newHeight, x: node.x(), y: node.y(), rotation: snapAngle(rotation) } : s)));
        } else if (shape.type === 'circle') {
            // use scaleX to keep circle uniform
            const scaleVal = node.scaleX();
            const newRadius = Math.max(1, node.radius() * scaleVal);
            const rotation = node.rotation() || 0;
            node.scaleX(1);
            node.scaleY(1);
            applyChange((prev) => prev.map((s) => (s.id === id ? { ...s, radius: newRadius, x: node.x(), y: node.y(), rotation: snapAngle(rotation) } : s)));
        } else if (shape.type === 'ellipse') {
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            const newRadiusX = Math.max(1, node.radiusX() * scaleX);
            const newRadiusY = Math.max(1, node.radiusY() * scaleY);
            const rotation = node.rotation() || 0;
            node.scaleX(1);
            node.scaleY(1);
            applyChange((prev) => prev.map((s) => (s.id === id ? { ...s, radiusX: newRadiusX, radiusY: newRadiusY, x: node.x(), y: node.y(), rotation: snapAngle(rotation) } : s)));
        } else if (shape.type === 'line') {
            // lines are transformed by points; for simplicity just update points
            const rotation = node.rotation() || 0;
            applyChange((prev) => prev.map((s) => (s.id === id ? { ...s, points: node.points(), rotation: snapAngle(rotation) } : s)));
        } else if (shape.type === 'text') {
            const rotation = node.rotation() || 0;
            applyChange((prev) => prev.map((s) => (s.id === id ? { ...s, x: node.x(), y: node.y(), rotation: snapAngle(rotation) } : s)));
        }
    };

    // Inline text editing: create a textarea overlay over the clicked Text node
    const openTextEditor = (shapeId) => {
        const stage = stageRef.current;
        if (!stage) return;
        const shape = shapesRef.current.find((s) => s.id === shapeId && s.type === 'text');
        if (!shape) return;
        const node = stage.findOne(`#shape-${shapeId}`);
        if (!node) return;

        const stageBox = stage.container().getBoundingClientRect();
        const stageScale = stage.scaleX();
        const stageX = stage.x();
        const stageY = stage.y();
        const absPos = node.getAbsolutePosition();

        const areaPosition = {
            x: stageBox.left + stageX + absPos.x * stageScale,
            y: stageBox.top + stageY + absPos.y * stageScale,
        };

        // create textarea and style it
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);

        const currentFontStyle = shape.fontStyle || textFontStyle;
        const currentFontSize = shape.fontSize || textFontSize;
        const currentLineHeight = shape.lineHeight || textLineHeight;
        const currentLetterSpacing = shape.letterSpacing || textLetterSpacing;

        textarea.value = shape.text || '';
        textarea.style.position = 'absolute';
        textarea.style.top = `${areaPosition.y}px`;
        textarea.style.left = `${areaPosition.x}px`;
        textarea.style.width = Math.max(120, node.width() * stageScale) + 'px';
        textarea.style.height = Math.max(32, node.height() * stageScale) + 'px';
        textarea.style.fontSize = `${currentFontSize * stageScale}px`;
        textarea.style.fontFamily = shape.fontFamily || textFontFamily;
        textarea.style.fontStyle = currentFontStyle.includes('italic') ? 'italic' : 'normal';
        textarea.style.fontWeight = currentFontStyle.includes('bold') ? '700' : '400';
        textarea.style.lineHeight = String(currentLineHeight);
        textarea.style.letterSpacing = `${currentLetterSpacing * stageScale}px`;
        textarea.style.textAlign = shape.align || textAlignValue;
        textarea.style.textDecoration = shape.textDecoration || textDecorationValue;
        textarea.style.border = '1px solid #4f83ff';
        textarea.style.padding = '6px 8px';
        textarea.style.margin = '0';
        textarea.style.overflow = 'hidden';
        textarea.style.background = '#ffffff';
        textarea.style.outline = 'none';
        textarea.style.resize = 'none';
        textarea.style.boxShadow = '0 0 0 2px rgba(79, 131, 255, 0.25)';
        textarea.style.borderRadius = '6px';
        textarea.style.color = '#1f2a37';
        textarea.style.zIndex = 1000;

        textarea.focus();
        if (typeof textarea.setSelectionRange === 'function') {
            const length = textarea.value.length;
            textarea.setSelectionRange(length, length);
        }

        let cancelled = false;

        const cleanup = () => {
            textarea.removeEventListener('keydown', onKeyDown);
            textarea.removeEventListener('blur', onBlur);
            if (textarea.parentNode) textarea.parentNode.removeChild(textarea);
        };

        const commit = () => {
            const value = textarea.value;
            applyChange((prev) => prev.map((s) => (s.id === shape.id ? { ...s, text: value } : s)));
            cleanup();
        };

        const cancel = () => {
            cancelled = true;
            cleanup();
        };

        const onKeyDown = (evt) => {
            if (evt.key === 'Enter' && !evt.shiftKey) {
                evt.preventDefault();
                commit();
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                cancel();
            }
            evt.stopPropagation();
        };

        const onBlur = () => {
            if (cancelled) return;
            commit();
        };

        textarea.addEventListener('keydown', onKeyDown);
        textarea.addEventListener('blur', onBlur);
    };

    useEffect(() => {
        const pendingId = pendingTextEditRef.current;
        if (!pendingId) return;
        const hasShape = shapes.some((shape) => shape.id === pendingId && shape.type === 'text');
        if (!hasShape) return;
        pendingTextEditRef.current = null;
        requestAnimationFrame(() => openTextEditor(pendingId));
    }, [shapes]);

    const setStageCursor = (cursor) => {
        const stage = stageRef.current;
        if (!stage) return;
        const container = stage.container();
        if (!container) return;
        container.style.cursor = cursor;
    };

    const CORNER_THRESHOLD = 12; // px

    // rotation state when dragging from a corner
    const rotatingRef = useRef({ active: false, id: null, node: null });
    const rotateCenterRef = useRef({ x: 0, y: 0 });
    const rotationStartRef = useRef(null);

    const handleShapeMouseMove = (shape, e) => {
        const stage = stageRef.current;
        if (!stage) return;
        const pos = stage.getPointerPosition();
        if (!pos) return;
        const node = stage.findOne(`#shape-${shape.id}`);
        if (!node) return;
        const rect = node.getClientRect({ relativeTo: stage });
        // corners in stage coords
        const corners = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.width, y: rect.y },
            { x: rect.x + rect.width, y: rect.y + rect.height },
            { x: rect.x, y: rect.y + rect.height },
        ];
        let nearCorner = false;
        for (let i = 0; i < corners.length; i++) {
            const dx = pos.x - corners[i].x;
            const dy = pos.y - corners[i].y;
            if (Math.hypot(dx, dy) <= CORNER_THRESHOLD) {
                nearCorner = true;
                break;
            }
        }

        if (nearCorner && selectedTool === 'select') {
            // show rotation cursor when hovering a corner in select mode
            setStageCursor('crosshair');
        } else {
            // restore based on tool
            if (selectedTool === 'hand') {
                setStageCursor(isPanningRef.current ? 'grabbing' : 'grab');
            } else if (selectedTool === 'select') {
                setStageCursor('default');
            } else {
                setStageCursor('crosshair');
            }
        }
    };

    const handleShapeMouseLeave = () => {
        if (selectedTool === 'hand') {
            setStageCursor(isPanningRef.current ? 'grabbing' : 'grab');
        } else if (selectedTool === 'select') {
            setStageCursor('default');
        } else {
            setStageCursor('crosshair');
        }
    };

    const handleShapeMouseDown = (shape, e) => {
        if (selectedTool !== 'select') return;
        const stage = stageRef.current;
        if (!stage) return;
        const pos = stage.getPointerPosition();
        if (!pos) return;
        const node = stage.findOne(`#shape-${shape.id}`);
        if (!node) return;
        const rect = node.getClientRect({ relativeTo: stage });
        const corners = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.width, y: rect.y },
            { x: rect.x + rect.width, y: rect.y + rect.height },
            { x: rect.x, y: rect.y + rect.height },
        ];
        for (let i = 0; i < corners.length; i++) {
            const dx = pos.x - corners[i].x;
            const dy = pos.y - corners[i].y;
            if (Math.hypot(dx, dy) <= CORNER_THRESHOLD) {
                // start rotating
                const before = shapesRef.current.map((s) => ({ ...s }));
                rotatingRef.current = { active: true, id: shape.id, node };
                rotateCenterRef.current = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                rotationStartRef.current = { id: shape.id, before, initialRotation: shape.rotation || 0 };
                if (typeof node.stopDrag === 'function') node.stopDrag();
                if (typeof node.draggable === 'function') node.draggable(false);
                const container = stage.container();
                if (container) container.style.cursor = 'grabbing';
                e.cancelBubble = true;
                return;
            }
        }
    };

    // update rotation while dragging from corner
    useEffect(() => {
        const onMove = (e) => {
            if (!rotatingRef.current.active) return;
            const stage = stageRef.current;
            if (!stage) return;
            const pos = stage.getPointerPosition();
            if (!pos) return;
            const center = rotateCenterRef.current;
            const angle = (Math.atan2(pos.y - center.y, pos.x - center.x) * 180) / Math.PI;
            const rotation = e.shiftKey ? snapAngle(angle) : angle;
            setShapes((prev) =>
                prev.map((s) => (s.id === rotatingRef.current.id ? { ...s, rotation } : s))
            );
        };

        const onUp = () => {
            if (!rotatingRef.current.active) return;

            const stage = stageRef.current;
            const container = stage && stage.container();
            if (container) {
                if (selectedTool === 'hand') container.style.cursor = isPanningRef.current ? 'grabbing' : 'grab';
                else if (selectedTool === 'select') container.style.cursor = 'default';
                else container.style.cursor = 'crosshair';
            }

            const node = rotatingRef.current.node;
            if (node && typeof node.draggable === 'function') node.draggable(true);

            const info = rotationStartRef.current;
            rotatingRef.current = { active: false, id: null, node: null };
            rotationStartRef.current = null;

            if (info) {
                const { before, id, initialRotation } = info;
                const currentShape = shapesRef.current.find((s) => s.id === id);
                if (currentShape && currentShape.rotation !== initialRotation) {
                    pastRef.current.push(before);
                    if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
                    futureRef.current = [];

                }
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTool]);

    const getFillPropsForShape = (shape) => {
        if (!shape || shape.fillType !== 'gradient' || !shape.fillGradient) {
            return { fill: shape?.fill, fillPriority: 'color' };
        }
        const gradient = normalizeGradient(shape.fillGradient);
        if (!gradient || !Array.isArray(gradient.stops) || gradient.stops.length < 2) {
            return { fill: shape.fill, fillPriority: 'color' };
        }

        if (gradient.type !== 'linear' && gradient.type !== 'radial') {
            return { fill: gradient.stops[0]?.color || shape.fill, fillPriority: 'color' };
        }

        const colorStops = buildGradientColorStops(gradient);
        if (colorStops.length < 4) {
            return { fill: shape.fill, fillPriority: 'color' };
        }
        if (gradient.type === 'linear') {
            const points = computeLinearGradientPoints(shape, gradient.angle);
            if (!points) {
                return { fill: shape.fill, fillPriority: 'color' };
            }
            return {
                fill: shape.fill || gradient.stops[0]?.color,
                fillPriority: 'linear-gradient',
                fillLinearGradientStartPoint: points.startPoint,
                fillLinearGradientEndPoint: points.endPoint,
                fillLinearGradientColorStops: colorStops,
            };
        }

        // radial fallback
        const getRadius = () => {
            switch (shape.type) {
                case 'rectangle':
                    return Math.max(shape.width || 0, shape.height || 0) / 2;
                case 'circle':
                    return shape.radius || 0;
                case 'ellipse':
                    return Math.max(shape.radiusX || 0, shape.radiusY || 0);
                default:
                    return 0;
            }
        };

        const endRadius = getRadius();
        if (!endRadius) {
            return { fill: gradient.stops[0]?.color || shape.fill, fillPriority: 'color' };
        }

        return {
            fill: shape.fill || gradient.stops[0]?.color,
            fillPriority: 'radial-gradient',
            fillRadialGradientStartPoint: { x: 0, y: 0 },
            fillRadialGradientEndPoint: { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius: endRadius,
            fillRadialGradientColorStops: colorStops,
        };
    };

    const renderShape = (shape) => {
        const commonProps = {
            key: shape.id,
            id: `shape-${shape.id}`,
            name: 'shape',
            draggable: selectedTool === 'select',
            listening: selectedTool === 'select',
            onClick: (e) => {
                if (selectedTool !== 'select') return;
                // prevent stage from handling the click
                e.cancelBubble = true;
                setSelectedId(shape.id);
            },
            onDragEnd: (e) => handleDragEnd(shape.id, e),
            onTransformEnd: (e) => handleTransformEnd(shape, e.target),
            onMouseMove: (e) => handleShapeMouseMove(shape, e),
            onMouseLeave: (e) => handleShapeMouseLeave(e),
            onMouseDown: (e) => handleShapeMouseDown(shape, e),
        };
        const fillProps = getFillPropsForShape(shape);

        switch (shape.type) {
            case 'rectangle':
                return (
                    <Rect
                        {...commonProps}
                        x={shape.x}
                        y={shape.y}
                        width={shape.width}
                        height={shape.height}
                        offset={{ x: shape.width / 2, y: shape.height / 2 }}
                        {...fillProps}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        rotation={shape.rotation || 0}
                    />
                );
            case 'circle':
                return (
                    <Circle
                        {...commonProps}
                        x={shape.x}
                        y={shape.y}
                        radius={shape.radius}
                        {...fillProps}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        rotation={shape.rotation || 0}
                    />
                );
            case 'ellipse':
                return (
                    <Ellipse
                        {...commonProps}
                        x={shape.x}
                        y={shape.y}
                        radiusX={shape.radiusX}
                        radiusY={shape.radiusY}
                        {...fillProps}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        rotation={shape.rotation || 0}
                    />
                );
            case 'line':
                return (
                    <Line
                        {...commonProps}
                        points={shape.points}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        rotation={shape.rotation || 0}
                    />
                );
            case 'pen':
                return (
                    <Line
                        {...commonProps}
                        x={shape.x || 0}
                        y={shape.y || 0}
                        points={shape.points}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        lineCap={shape.lineCap}
                        lineJoin={shape.lineJoin}
                        tension={shape.tension}
                        rotation={shape.rotation || 0}
                    />
                );
            case 'text':
                return (
                    <Text
                        {...commonProps}
                        x={shape.x}
                        y={shape.y}
                        text={shape.text || 'Text'}
                        {...fillProps}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        rotation={shape.rotation || 0}
                        fontFamily={shape.fontFamily || textFontFamily}
                        fontStyle={shape.fontStyle || textFontStyle}
                        fontSize={shape.fontSize || textFontSize}
                        lineHeight={shape.lineHeight || textLineHeight}
                        letterSpacing={shape.letterSpacing || textLetterSpacing}
                        align={shape.align || textAlignValue}
                        verticalAlign={shape.verticalAlign || textVerticalAlignValue}
                        textDecoration={shape.textDecoration || textDecorationValue}
                        onDblClick={() => openTextEditor(shape.id)}
                    />
                );
            default:
                return null;
        }
    };


    // handle wheel to zoom
    const handleWheel = (e) => {
        const stage = stageRef.current;
        if (!stage) return;
        e.evt.preventDefault();

        // CTRL + wheel to zoom
        if (e.evt.ctrlKey || e.evt.metaKey) {

            // get mouse position on stage
            const pointer = stage.getPointerPosition();
            const factor = e.evt.deltaY > 0 ? 1.1 : 1 / 1.1;
            zoomBy(factor, pointer || getStageCenter());
        }
    };

    // zoom in/out handlers
    const zoomIn = () => zoomBy(1.2, getStageCenter());

    const zoomOut = () => zoomBy(1 / 1.2, getStageCenter());

    // reset zoom to100%
    const resetZoom = () => {
        setScale(1);
        setStagePos({ x: 0, y: 0 });
    };

    const typeLabels = {
        rectangle: 'Rectangle',
        circle: 'Circle',
        ellipse: 'Ellipse',
        line: 'Line',
        pen: 'Pen',
        text: 'Text',
    };

    const sortedShapes = [...shapes].slice().reverse();

    const [draggedLayerId, setDraggedLayerId] = useState(null);
    const [dragOverLayerId, setDragOverLayerId] = useState(null);
    const [dragOverZone, setDragOverZone] = useState(null);
    const isDraggingLayer = draggedLayerId != null;

    const reorderLayers = (sourceId, targetId, placeAfter) => {
        if (!sourceId || !targetId || sourceId === targetId) return;
        applyChange((prev) => {
            const topOrder = [...prev].reverse();
            const sourceIndex = topOrder.findIndex((shape) => shape.id === sourceId);
            const targetIndex = topOrder.findIndex((shape) => shape.id === targetId);
            if (sourceIndex === -1 || targetIndex === -1) return prev;
            const updated = [...topOrder];
            const [item] = updated.splice(sourceIndex, 1);
            const adjustedTargetIndex = updated.findIndex((shape) => shape.id === targetId);
            const insertIndex = adjustedTargetIndex === -1
                ? updated.length
                : adjustedTargetIndex + (placeAfter ? 1 : 0);
            updated.splice(insertIndex, 0, item);
            return updated.reverse();
        });
    };

    const handleLayerDrop = (event, targetId) => {
        event.preventDefault();
        if (!draggedLayerId || !targetId) return;

        const bounds = event.currentTarget.getBoundingClientRect();
        const dropY = event.clientY;
        const placeAfter = dropY > bounds.top + bounds.height / 2;
        reorderLayers(draggedLayerId, targetId, placeAfter);
        setDraggedLayerId(null);
        setDragOverLayerId(null);
        setDragOverZone(null);
    };

    const handleLayerDragEnd = () => {
        setDraggedLayerId(null);
        setDragOverLayerId(null);
        setDragOverZone(null);
    };


    const handleLayerSelect = (shapeId) => {
        setSelectedId(shapeId);
        if (typeof onToolChange === 'function') onToolChange('select');
    };

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;

        // apply scale and position to stage
        stage.scaleX(scale);
        stage.scaleY(scale);
        stage.x(stagePos.x);
        stage.y(stagePos.y);
        const layer = stage.getLayer ? stage.getLayer() : null;
        if (layer && typeof layer.batchDraw === 'function') layer.batchDraw();
    }, [scale, stagePos, shapes]);

    return (
        <div style={{ display: 'flex', height: '100%' }}>
            <aside
                style={{
                    width: LAYER_PANEL_WIDTH,
                    borderRight: '1px solid #e5e5e5',
                    background: '#fdfdfd',
                    padding: '12px 8px',
                    boxSizing: 'border-box',
                    overflowY: 'auto',
                }}
            >
                <div style={{ fontWeight: 600, fontSize: 14, color: '#555', marginBottom: 8 }}>Layers</div>
                {sortedShapes.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#888' }}>No shapes yet</div>
                ) : (
                    <>
                        <div
                            onDragOver={(event) => {
                                if (!isDraggingLayer) return;
                                event.preventDefault();
                                setDragOverLayerId(null);
                                setDragOverZone('top');
                            }}
                            onDragEnter={(event) => {
                                if (!isDraggingLayer) return;
                                event.preventDefault();
                                setDragOverLayerId(null);
                                setDragOverZone('top');
                            }}
                            onDragLeave={() => {
                                setDragOverZone((zone) => (zone === 'top' ? null : zone));
                            }}
                            onDrop={(event) => {
                                if (!isDraggingLayer || sortedShapes.length === 0) return;
                                event.preventDefault();
                                reorderLayers(draggedLayerId, sortedShapes[0].id, false);
                                setDraggedLayerId(null);
                                setDragOverLayerId(null);
                                setDragOverZone(null);
                            }}
                            style={{
                                height: isDraggingLayer ? 12 : 0,
                                margin: isDraggingLayer ? '0 4px 8px' : 0,
                                borderRadius: 6,
                                border: isDraggingLayer
                                    ? `1px dashed ${dragOverZone === 'top' ? '#4d90fe' : '#c7d7ff'}`
                                    : '1px dashed transparent',
                                transition: 'all 0.12s ease',
                                pointerEvents: isDraggingLayer ? 'auto' : 'none',
                            }}
                        />
                        {sortedShapes.map((shape) => {
                            const label = `${typeLabels[shape.type] || 'Shape'} ${shape.id}`;
                            const isSelected = shape.id === selectedId;
                            const swatchColor = shape.fill || shape.stroke || '#ccc';
                            const isDragged = shape.id === draggedLayerId;
                            const isDragOver =
                                shape.id === dragOverLayerId && draggedLayerId !== dragOverLayerId;

                            return (
                                <div
                                    key={shape.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        marginBottom: 4,
                                    }}
                                >
                                    <button
                                        type="button"
                                        onClick={() => handleLayerSelect(shape.id)}
                                        draggable
                                        onDragStart={(event) => {
                                            setDraggedLayerId(shape.id);
                                            setDragOverLayerId(null);
                                            if (event.dataTransfer) {
                                                event.dataTransfer.effectAllowed = 'move';
                                                try {
                                                    event.dataTransfer.setData('text/plain', String(shape.id));
                                                } catch (error) {
                                                    // ignore if not supported
                                                }
                                            }
                                        }}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            setDragOverLayerId(shape.id);
                                            setDragOverZone(null);
                                        }}
                                        onDragEnter={(event) => {
                                            event.preventDefault();
                                            setDragOverLayerId(shape.id);
                                            setDragOverZone(null);
                                        }}
                                        onDragLeave={(event) => {
                                            if (!event.currentTarget.contains(event.relatedTarget)) {
                                                setDragOverLayerId((current) => (current === shape.id ? null : current));
                                                setDragOverZone(null);
                                            }
                                        }}
                                        onDrop={(event) => handleLayerDrop(event, shape.id)}
                                        onDragEnd={handleLayerDragEnd}
                                        style={{
                                            flex: 1,
                                            textAlign: 'left',
                                            padding: '6px 8px',
                                            border: 'none',
                                            background: isDragged
                                                ? '#dbe9ff'
                                                : isDragOver
                                                    ? '#f0f6ff'
                                                    : isSelected
                                                        ? '#e8f2ff'
                                                        : 'transparent',
                                            borderRadius: 6,
                                            cursor: isDragged ? 'grabbing' : 'grab',
                                            color: '#222',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            opacity: isDragged ? 0.8 : 1,
                                        }}
                                    >
                                        <span
                                            aria-hidden="true"
                                            style={{
                                                display: 'inline-block',
                                                width: 12,
                                                height: 12,
                                                borderRadius: 2,
                                                background: swatchColor,
                                                border: '1px solid rgba(0,0,0,0.12)',
                                            }}
                                        />
                                        <span style={{ fontSize: 13 }}>{label}</span>
                                    </button>
                                </div>
                            );
                        })}
                        <div
                            onDragOver={(event) => {
                                if (!isDraggingLayer) return;
                                event.preventDefault();
                                setDragOverLayerId(null);
                                setDragOverZone('bottom');
                            }}
                            onDragEnter={(event) => {
                                if (!isDraggingLayer) return;
                                event.preventDefault();
                                setDragOverLayerId(null);
                                setDragOverZone('bottom');
                            }}
                            onDragLeave={() => {
                                setDragOverZone((zone) => (zone === 'bottom' ? null : zone));
                            }}
                            onDrop={(event) => {
                                if (!isDraggingLayer || sortedShapes.length === 0) return;
                                event.preventDefault();
                                reorderLayers(
                                    draggedLayerId,
                                    sortedShapes[sortedShapes.length - 1].id,
                                    true
                                );
                                setDraggedLayerId(null);
                                setDragOverLayerId(null);
                                setDragOverZone(null);
                            }}
                            style={{
                                height: isDraggingLayer ? 12 : 0,
                                margin: isDraggingLayer ? '8px 4px 0' : 0,
                                borderRadius: 6,
                                border: isDraggingLayer
                                    ? `1px dashed ${dragOverZone === 'bottom' ? '#4d90fe' : '#c7d7ff'}`
                                    : '1px dashed transparent',
                                transition: 'all 0.12s ease',
                                pointerEvents: isDraggingLayer ? 'auto' : 'none',
                            }}
                        />
                    </>
                )}
            </aside>

            <div
                ref={stageContainerRef}
                style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}
            >
                <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, display: 'flex', gap: 8 }}>
                    <button onClick={undo}>Undo</button>
                    <button onClick={redo}>Redo</button>
                </div>

                <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: 8 }}>
                    <button onClick={zoomIn}>Zoom In</button>
                    <button onClick={zoomOut}>Zoom Out</button>
                    <button onClick={resetZoom}>Reset Zoom</button>
                </div>

                <Stage
                    width={stageSize.width}
                    height={stageSize.height}
                    ref={stageRef}
                    x={stagePos.x}
                    y={stagePos.y}
                    scaleX={scale}
                    scaleY={scale}
                    style={{ background: '#fafafa' }}
                    onMouseDown={handleStageMouseDown}
                    onWheel={handleWheel}
                    onMouseMove={handleStageMouseMove}
                    onMouseUp={handleStageMouseUp}
                >
                    <Layer>
                        {shapes.map((shape) => renderShape(shape))}

                        <Transformer
                            ref={trRef}
                            rotationEnabled={false}
                            rotateEnabled={false}
                            rotationAnchorOffset={-9999}
                            enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
                        />
                    </Layer>
                </Stage>
            </div>


        </div>
    );
}
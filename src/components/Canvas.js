import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Circle, Ellipse, Group, Line, Text, Transformer } from 'react-konva';
import {
    buildGradientColorStops,
    getGradientFirstColor,
    getHandlesAngle,
    gradientStopsEqual,
    interpolateGradientColor,
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

const clampValue = (value, min, max) => Math.min(Math.max(value, min), max);

const LAYER_PANEL_MIN_WIDTH = 240;
const LAYER_PANEL_MAX_WIDTH = 500;
const LAYER_PANEL_DEFAULT_WIDTH = 280;

const CONTAINER_TYPES = ['frame', 'group'];

const isContainerShape = (shape) => Boolean(shape && CONTAINER_TYPES.includes(shape.type));

const SHAPE_LABELS = {
    frame: 'Frame',
    group: 'Group',
    rectangle: 'Rectangle',
    circle: 'Circle',
    ellipse: 'Ellipse',
    line: 'Line',
    pen: 'Pen',
    text: 'Text',
};

const BLEND_MODE_TO_COMPOSITE = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten',
};

const getShapeDimensions = (shape) => {
    switch (shape.type) {
        case 'rectangle':
            return {
                width: Math.max(0, shape.width || 0),
                height: Math.max(0, shape.height || 0),
            };
        case 'circle': {
            const radius = Math.max(0, shape.radius || 0);
            return { width: radius * 2, height: radius * 2 };
        }
        case 'ellipse':
            return {
                width: Math.max(0, (shape.radiusX || 0) * 2),
                height: Math.max(0, (shape.radiusY || 0) * 2),
            };
        case 'text': {
            const estimatedWidth =
                typeof shape.width === 'number' && shape.width > 0
                    ? shape.width
                    : Math.max(120, (shape.text ? shape.text.length : 0) * ((shape.fontSize || 24) * 0.6));
            const estimatedHeight =
                typeof shape.height === 'number' && shape.height > 0
                    ? shape.height
                    : (shape.fontSize || 24) * (shape.lineHeight || 1.2);
            return { width: estimatedWidth, height: estimatedHeight };
        }
        default:
            return { width: 0, height: 0 };
    }
};

const convertNormalizedPointToLocal = (point, dimensions) => ({
    x: (point.x - 0.5) * dimensions.width,
    y: (point.y - 0.5) * dimensions.height,
});

const convertLocalPointToNormalized = (point, dimensions) => ({
    x: dimensions.width ? point.x / dimensions.width + 0.5 : 0.5,
    y: dimensions.height ? point.y / dimensions.height + 0.5 : 0.5,
});

const HEX_COLOR_RE = /^#([0-9a-f]{6})$/i;

const parseHexColor = (hex, fallback = { r: 0, g: 0, b: 0 }) => {
    if (typeof hex !== 'string') return fallback;
    const match = HEX_COLOR_RE.exec(hex);
    if (!match) return fallback;
    const int = parseInt(match[1], 16);
    return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255,
    };
};

const roundForKey = (value) => Math.round(value * 1000) / 1000;

const getLocalHandlePoints = (shape, handles) => {
    if (!handles) return null;
    const dimensions = getShapeDimensions(shape);
    if (!dimensions.width && !dimensions.height) {
        return null;
    }
    return {
        dimensions,
        start: convertNormalizedPointToLocal(handles.start, dimensions),
        end: convertNormalizedPointToLocal(handles.end, dimensions),
    };
};

const computeLinearGradientPoints = (shape, angle) => {
    const rad = toRadians(angle || 0);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const { width, height } = getShapeDimensions(shape);
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    if (!halfWidth && !halfHeight) {
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
    showGradientHandles = false,
    gradientInteractionRef = null,
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
    const shapeCountersRef = useRef({
        frame: 1,
        group: 1,
        rectangle: 1,
        circle: 1,
        ellipse: 1,
        line: 1,
        pen: 1,
        text: 1,
    });
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
    const [activeContainerPath, setActiveContainerPath] = useState([null]);
    const fillPreviewRef = useRef(null);
    const gradientPatternCacheRef = useRef(new Map());
    const activeContainerPathRef = useRef(activeContainerPath);
    useEffect(() => {
        activeContainerPathRef.current = activeContainerPath;
    }, [activeContainerPath]);

    const allocateShapeId = () => {
        const nextId = idCounterRef.current;
        idCounterRef.current += 1;
        return nextId;
    };

    const getNextShapeName = (type) => {
        const base = SHAPE_LABELS[type] || 'Layer';
        const counters = shapeCountersRef.current;
        const next = counters[type] || 1;
        counters[type] = next + 1;
        return `${base} ${next}`;
    };

    const getActiveContainerId = () => {
        const path = activeContainerPathRef.current;
        if (!Array.isArray(path) || path.length === 0) return null;
        const last = path[path.length - 1];
        return last ?? null;
    };

    const createShape = (type, overrides = {}) => {
        const id = overrides.id ?? allocateShapeId();
        const parentId =
            overrides.parentId !== undefined
                ? overrides.parentId
                : getActiveContainerId();
        const shape = {
            id,
            type,
            name: overrides.name || getNextShapeName(type),
            parentId: parentId ?? null,
            visible: overrides.visible ?? true,
            locked: overrides.locked ?? false,
            opacity: clampValue(
                typeof overrides.opacity === 'number' ? overrides.opacity : 1,
                0,
                1
            ),
            blendMode: overrides.blendMode || 'normal',
            ...overrides,
        };
        return shape;
    };

    const getShapeById = (id, source = shapesRef.current) => {
        if (id == null) return null;
        return source.find((shape) => shape.id === id) || null;
    };

    const getParentShape = (shape, source = shapesRef.current) => {
        if (!shape || shape.parentId == null) return null;
        return getShapeById(shape.parentId, source);
    };

    const getContainerAncestor = (shape, source = shapesRef.current) => {
        let current = shape;
        while (current) {
            if (isContainerShape(current)) return current;
            current = getParentShape(current, source);
        }
        return null;
    };

    const getContainerPathForId = (shapeId, source = shapesRef.current) => {
        const path = [];
        let current = getShapeById(shapeId, source);
        while (current) {
            if (isContainerShape(current)) {
                path.unshift(current.id);
            }
            current = getParentShape(current, source);
        }
        return path;
    };

    const collectDescendantIds = (source, ancestorId) => {
        const result = [];
        if (ancestorId == null) return result;
        const queue = [ancestorId];
        while (queue.length) {
            const currentId = queue.shift();
            source.forEach((shape) => {
                if (shape.parentId === currentId) {
                    result.push(shape.id);
                    queue.push(shape.id);
                }
            });
        }
        return result;
    };

    const isDescendantOf = (shapeId, ancestorId, source = shapesRef.current) => {
        if (shapeId == null || ancestorId == null) return false;
        let current = getShapeById(shapeId, source);
        while (current) {
            if (current.parentId === ancestorId) return true;
            current = getParentShape(current, source);
        }
        return false;
    };

    const getContainerBounds = (shape) => {
        if (!shape || !isContainerShape(shape)) return null;
        const width = Math.max(0, shape.width || 0);
        const height = Math.max(0, shape.height || 0);
        if (!width || !height) return null;
        const centerX = shape.x || 0;
        const centerY = shape.y || 0;
        return {
            left: centerX - width / 2,
            right: centerX + width / 2,
            top: centerY - height / 2,
            bottom: centerY + height / 2,
        };
    };

    const findContainerAtPoint = (point, excludedIds = new Set(), source = shapesRef.current) => {
        if (!point) return null;
        const localExcluded = excludedIds instanceof Set ? excludedIds : new Set(excludedIds);
        for (let index = source.length - 1; index >= 0; index -= 1) {
            const candidate = source[index];
            if (!isContainerShape(candidate)) continue;
            if (localExcluded.has(candidate.id)) continue;
            if (candidate.visible === false) continue;
            if (candidate.locked) continue;
            const bounds = getContainerBounds(candidate);
            if (!bounds) continue;
            if (
                point.x >= bounds.left &&
                point.x <= bounds.right &&
                point.y >= bounds.top &&
                point.y <= bounds.bottom
            ) {
                return candidate;
            }
        }
        return null;
    };

    const scaleChildWithinContainer = (
        shape,
        prevContainer,
        nextContainer,
        scaleX,
        scaleY
    ) => {
        const prevX = prevContainer?.x || 0;
        const prevY = prevContainer?.y || 0;
        const nextX = nextContainer?.x || 0;
        const nextY = nextContainer?.y || 0;
        const offsetX = (shape.x || 0) - prevX;
        const offsetY = (shape.y || 0) - prevY;
        const updated = {
            ...shape,
            x: nextX + offsetX * scaleX,
            y: nextY + offsetY * scaleY,
        };

        switch (shape.type) {
            case 'rectangle':
            case 'frame':
            case 'group':
                return {
                    ...updated,
                    width: Math.max(1, (shape.width || 0) * scaleX),
                    height: Math.max(1, (shape.height || 0) * scaleY),
                };
            case 'circle': {
                const radius = shape.radius || 0;
                const scaledRadius = Math.max(1, radius * Math.max(scaleX, scaleY));
                return { ...updated, radius: scaledRadius };
            }
            case 'ellipse':
                return {
                    ...updated,
                    radiusX: Math.max(1, (shape.radiusX || 0) * scaleX),
                    radiusY: Math.max(1, (shape.radiusY || 0) * scaleY),
                };
            case 'line': {
                const points = Array.isArray(shape.points) ? [...shape.points] : [];
                const scaledPoints = points.map((value, index) => {
                    if (index % 2 === 0) {
                        const absolute = value - prevX;
                        return nextX + absolute * scaleX;
                    }
                    const absolute = value - prevY;
                    return nextY + absolute * scaleY;
                });
                return { ...updated, points: scaledPoints };
            }
            case 'pen': {
                const points = Array.isArray(shape.points) ? [...shape.points] : [];
                const scaledPoints = points.map((value, index) => {
                    if (index % 2 === 0) {
                        const absolute = value - prevX;
                        return nextX + absolute * scaleX;
                    }
                    const absolute = value - prevY;
                    return nextY + absolute * scaleY;
                });
                return { ...updated, points: scaledPoints };
            }
            case 'text': {
                const averageScale = (scaleX + scaleY) / 2;
                return {
                    ...updated,
                    fontSize: Math.max(1, (shape.fontSize || textFontSize) * averageScale),
                    lineHeight: Math.max(0.1, (shape.lineHeight || textLineHeight) * scaleY),
                };
            }
            default:
                return updated;
        }
    };

    // zoom state
    const [scale, setScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
    const MIN_SCALE = 0.2;
    const MAX_SCALE = 4;
    const MIN_STAGE_WIDTH = 120;
    const MIN_STAGE_HEIGHT = 200;
    const [layerPanelWidth, setLayerPanelWidth] = useState(LAYER_PANEL_DEFAULT_WIDTH);

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
    const applyChange = useCallback(
        (updater, options = {}) => {
            const prev = shapesRef.current;
            const next = typeof updater === 'function' ? updater(prev) : updater;
            const baseState = options.baseState || prev;
            pastRef.current.push(baseState);
            if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
            futureRef.current = [];
            setShapes(next);
        },
        []
    );

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
        if (fillPreviewRef.current?.isPreview) return;
        if (typeof onSelectionChange !== 'function') return;
        const shape = selectedId ? shapes.find((s) => s.id === selectedId) : null;
        onSelectionChange(shape ? { ...shape } : null);
    }, [selectedId, shapes, onSelectionChange]);

    useEffect(() => {
        fillPreviewRef.current = null;
    }, [selectedId]);

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
                applyChange((prev) => {
                    const removalIds = new Set([selectedId]);
                    collectDescendantIds(prev, selectedId).forEach((childId) =>
                        removalIds.add(childId)
                    );
                    return prev.filter((shape) => !removalIds.has(shape.id));
                });
                setSelectedId(null);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setActiveContainerPath((current) => {
                    if (!Array.isArray(current) || current.length <= 1) {
                        return [null];
                    }
                    return current.slice(0, -1);
                });
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
        if (!['rectangle', 'circle', 'ellipse', 'text', 'frame'].includes(shape.type)) return;

        const meta = fillStyle?.meta;
        const interactionId =
            meta && (typeof meta.interactionId === 'number' || typeof meta.interactionId === 'string')
                ? meta.interactionId
                : null;
        const isPreview = Boolean(meta && meta.isPreview === true && interactionId != null);
        const isFinalizing = Boolean(
            meta &&
                meta.isPreview === false &&
                interactionId != null &&
                fillPreviewRef.current &&
                fillPreviewRef.current.interactionId === interactionId
        );

        const currentType = typeof shape.fillType === 'string' ? shape.fillType : 'solid';
        const currentFill = typeof shape.fill === 'string' ? shape.fill : '';
        const targetGradient =
            resolvedFillType === 'gradient' && resolvedFillGradient
                ? normalizeGradient(resolvedFillGradient)
                : null;
        const currentGradient =
            currentType === 'gradient' && shape.fillGradient
                ? normalizeGradient(shape.fillGradient)
                : null;

        const updater = (source) =>
            source.map((s) => {
                if (s.id !== selectedId) return s;
                if (targetGradient) {
                    return {
                        ...s,
                        fill: getGradientFirstColor(targetGradient, resolvedFillColor),
                        fillType: 'gradient',
                        fillGradient: targetGradient,
                    };
                }
                return {
                    ...s,
                    fill: resolvedFillColor,
                    fillType: resolvedFillType,
                    fillGradient: null,
                };
            });

        const needsUpdate = targetGradient
            ? currentType !== 'gradient' ||
              !currentGradient ||
              !gradientStopsEqual(currentGradient, targetGradient)
            : currentType !== resolvedFillType ||
              (currentType === 'gradient' && resolvedFillType !== 'gradient') ||
              currentFill !== resolvedFillColor;

        if (isPreview) {
            const previewState = fillPreviewRef.current;
            if (!previewState || previewState.interactionId !== interactionId) {
                fillPreviewRef.current = {
                    interactionId,
                    baseState: shapesRef.current,
                    isPreview: true,
                };
            } else {
                previewState.isPreview = true;
            }
            if (needsUpdate) {
                setShapes((prevShapes) => updater(prevShapes));
            }
            return;
        }

        const previewState = fillPreviewRef.current;
        if (isFinalizing) {
            fillPreviewRef.current = null;
            const baseState = previewState?.baseState || shapesRef.current;
            const baseShape = previewState?.baseState?.find((s) => s.id === selectedId);
            let changedFromBase = true;
            if (baseShape) {
                const baseType = typeof baseShape.fillType === 'string' ? baseShape.fillType : 'solid';
                const baseColor = typeof baseShape.fill === 'string' ? baseShape.fill : '';
                const baseGradient =
                    baseType === 'gradient' && baseShape.fillGradient
                        ? normalizeGradient(baseShape.fillGradient)
                        : null;
                if (targetGradient) {
                    if (baseType === 'gradient' && baseGradient) {
                        changedFromBase = !gradientStopsEqual(baseGradient, targetGradient);
                    } else {
                        changedFromBase = true;
                    }
                } else if (baseGradient) {
                    changedFromBase = true;
                } else {
                    changedFromBase =
                        baseType !== resolvedFillType || baseColor !== resolvedFillColor;
                }
            }
            if (!changedFromBase) {
                return;
            }
            applyChange(updater, { baseState });
            return;
        }

        fillPreviewRef.current = null;
        if (!needsUpdate) {
            return;
        }
        applyChange(updater);
    }, [
        applyChange,
        fillStyle?.meta,
        resolvedFillColor,
        resolvedFillGradient,
        resolvedFillType,
        selectedId,
    ]);

    useEffect(() => {
        if (!selectedId) return;
        const shape = shapesRef.current.find((s) => s.id === selectedId);
        if (!shape) return;
        if (!['rectangle', 'circle', 'ellipse', 'line', 'pen', 'text', 'frame'].includes(shape.type)) return;
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
        const targetNode = e.target;
        const targetName =
            targetNode && typeof targetNode.name === 'function' ? targetNode.name() : '';
        const containerIdFromTarget = (() => {
            if (!['frame', 'group'].includes(targetName)) return null;
            if (!targetNode || typeof targetNode.id !== 'function') return null;
            const idValue = targetNode.id();
            const match = /^shape-(\d+)$/.exec(idValue || '');
            if (!match) return null;
            const parsed = Number(match[1]);
            return Number.isFinite(parsed) ? parsed : null;
        })();
        const clickedOnEmpty = targetNode === stage || containerIdFromTarget != null;

        // PEN tool: begin freehand stroke anywhere
        if (selectedTool === 'pen') {
            const effectiveStrokeWidth = typeof strokeWidth === 'number' && strokeWidth > 0 ? strokeWidth : 1;
            const pos = getCanvasPointer();
            if (!pos) return;
            const newShape = createShape('pen', {
                parentId: containerIdFromTarget ?? undefined,
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
            });
            isDrawingRef.current = true;
            currentDrawingIdRef.current = newShape.id;
            drawingStartRef.current = pos;
            setSelectedId(null);
            applyChange((prev) => [...prev, newShape]);
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
        const dragTools = ['rectangle', 'circle', 'ellipse', 'line', 'frame', 'group'];
        if (clickedOnEmpty && dragTools.includes(selectedTool)) {
            const pos = getCanvasPointer();
            if (!pos) return;
            const baseProps = {
                x: pos.x,
                y: pos.y,
                rotation: 0,
                parentId: containerIdFromTarget ?? undefined,
            };
            let newShape = null;
            if (selectedTool === 'rectangle') {
                newShape = createShape('rectangle', {
                    ...baseProps,
                    width: 1,
                    height: 1,
                    fill: resolvedFillColor,
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                });
            } else if (selectedTool === 'circle') {
                newShape = createShape('circle', {
                    ...baseProps,
                    radius: 1,
                    fill: resolvedFillColor,
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                });
            } else if (selectedTool === 'ellipse') {
                newShape = createShape('ellipse', {
                    ...baseProps,
                    radiusX: 1,
                    radiusY: 1,
                    fill: resolvedFillColor,
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                });
            } else if (selectedTool === 'line') {
                const effectiveStrokeWidth = typeof strokeWidth === 'number' && strokeWidth > 0 ? strokeWidth : 1;
                newShape = createShape('line', {
                    points: [pos.x, pos.y, pos.x, pos.y],
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: effectiveStrokeWidth,
                    rotation: 0,
                    parentId: containerIdFromTarget ?? undefined,
                });
            } else if (selectedTool === 'frame') {
                newShape = createShape('frame', {
                    ...baseProps,
                    width: 1,
                    height: 1,
                    clipContent: true,
                    fill: resolvedFillColor,
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                });
            } else if (selectedTool === 'group') {
                newShape = createShape('group', {
                    ...baseProps,
                    width: 1,
                    height: 1,
                });
            }
            if (!newShape) return;
            currentDrawingIdRef.current = newShape.id;
            drawingStartRef.current = pos;
            isDrawingRef.current = true;
            applyChange((prev) => [...prev, newShape]);
            setSelectedId(newShape.id);
            return;
        }

        // fall back to click-to-create (text or simple click behavior)
        // Only add a shape when clicking on empty stage (not on an existing shape)
        if (!clickedOnEmpty) return;
        const pointerPos = getCanvasPointer();
        if (!pointerPos) return;
        if (selectedTool === 'text') {
            const newShape = createShape('text', {
                x: pointerPos.x,
                y: pointerPos.y,
                text: 'Text',
                parentId: containerIdFromTarget ?? undefined,
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
            });
            applyChange((prev) => [...prev, newShape]);
            pendingTextEditRef.current = newShape.id;
            setSelectedId(newShape.id);
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
                    if (s.type === 'frame' || s.type === 'group') {
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
                    else if (s.type === 'frame' || s.type === 'group') keep = s.width >= 5 && s.height >= 5;
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

    const handleStageDoubleClick = () => {
        setActiveContainerPath((current) => {
            if (!Array.isArray(current) || current.length <= 1) {
                return [null];
            }
            return current.slice(0, -1);
        });
        setSelectedId(null);
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

    const handleDragMove = (id, e) => {
        const x = e.target.x();
        const y = e.target.y();
        const current = shapesRef.current.find((shape) => shape.id === id);
        const deltaX = current ? x - (current.x || 0) : 0;
        const deltaY = current ? y - (current.y || 0) : 0;
        setShapes((prev) =>
            prev.map((s) => {
                if (s.id === id) {
                    return { ...s, x, y };
                }
                if (current && isContainerShape(current) && isDescendantOf(s.id, id, prev)) {
                    return { ...s, x: (s.x || 0) + deltaX, y: (s.y || 0) + deltaY };
                }
                return s;
            })
        );
    };

    const handleDragEnd = (id, e) => {
        const x = e.target.x();
        const y = e.target.y();
        const snapshot = shapesRef.current;
        const current = snapshot.find((shape) => shape.id === id) || null;
        const deltaX = current ? x - (current.x || 0) : 0;
        const deltaY = current ? y - (current.y || 0) : 0;
        const pointer = getCanvasPointer();
        const dropPoint = pointer || { x, y };
        const excludedIds = new Set([id]);
        if (current) {
            collectDescendantIds(snapshot, id).forEach((childId) => excludedIds.add(childId));
        }
        const dropTarget = findContainerAtPoint(dropPoint, excludedIds, snapshot);
        const nextParentId = dropTarget ? dropTarget.id : null;
        const previousParentId = current?.parentId ?? null;

        applyChange((prev) => {
            let updated = prev.map((s) => {
                if (s.id === id) {
                    return { ...s, x, y };
                }
                if (current && isContainerShape(current) && isDescendantOf(s.id, id, prev)) {
                    return { ...s, x: (s.x || 0) + deltaX, y: (s.y || 0) + deltaY };
                }
                return s;
            });

            if (current && nextParentId !== previousParentId) {
                updated = updated.map((shape) =>
                    shape.id === id ? { ...shape, parentId: nextParentId } : shape
                );
            }

            return updated;
        });
    };

    const handleTransformEnd = (shape, node) => {
        const id = shape.id;
        if (shape.type === 'frame' || shape.type === 'group') {
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            const newWidth = Math.max(5, node.width() * scaleX);
            const newHeight = Math.max(5, node.height() * scaleY);
            node.scaleX(1);
            node.scaleY(1);
            const nextX = node.x();
            const nextY = node.y();
            const prevShape = shapesRef.current.find((s) => s.id === id);
            const prevWidth = prevShape?.width || 1;
            const prevHeight = prevShape?.height || 1;
            const scaleFactorX = prevWidth ? newWidth / prevWidth : 1;
            const scaleFactorY = prevHeight ? newHeight / prevHeight : 1;
            const nextContainer = { x: nextX, y: nextY };
            applyChange((prev) =>
                prev.map((s) => {
                    if (s.id === id) {
                        return { ...s, x: nextX, y: nextY, width: newWidth, height: newHeight };
                    }
                    if (isDescendantOf(s.id, id, prev) && prevShape) {
                        return scaleChildWithinContainer(
                            s,
                            prevShape,
                            { ...nextContainer },
                            scaleFactorX,
                            scaleFactorY
                        );
                    }
                    return s;
                })
            );
        } else if (shape.type === 'rectangle') {
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

    const gradientDragRef = useRef({ active: false, shapeId: null, type: null, stopIndex: null, before: null });

    const setGradientHandleInteraction = useCallback(
        (active) => {
            if (!gradientInteractionRef) return;
            const store = gradientInteractionRef.current || {};
            if (store.active === active && gradientInteractionRef.current) {
                return;
            }
            store.active = active;
            gradientInteractionRef.current = store;
        },
        [gradientInteractionRef]
    );

    const markTransientGradientInteraction = useCallback(() => {
        if (!gradientInteractionRef) return;
        setGradientHandleInteraction(true);
        const release = () => {
            if (!gradientDragRef.current.active) {
                setGradientHandleInteraction(false);
            }
        };
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(release);
        } else {
            setTimeout(release, 0);
        }
    }, [gradientInteractionRef, setGradientHandleInteraction]);

    useEffect(() => {
        if (!showGradientHandles) {
            setGradientHandleInteraction(false);
        }
    }, [showGradientHandles, setGradientHandleInteraction]);

    useEffect(
        () => () => {
            setGradientHandleInteraction(false);
        },
        [setGradientHandleInteraction]
    );

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

    const handleShapeClick = (shape, event) => {
        if (!shape) return;
        if (event && typeof event.cancelBubble !== 'undefined') {
            event.cancelBubble = true;
        }
        if (selectedTool !== 'select') return;
        if (shape?.locked) return;
        if (isContainerShape(shape)) {
            setSelectedId(shape.id);
            return;
        }
        const containerAncestor = getContainerAncestor(shape);
        if (containerAncestor) {
            setSelectedId(containerAncestor.id);
            return;
        }
        setSelectedId(shape.id);
    };

    const handleShapeDoubleClick = (shape, event) => {
        if (!shape) return;
        if (event && typeof event.cancelBubble !== 'undefined') {
            event.cancelBubble = true;
        }
        if (selectedTool !== 'select') return;
        if (isContainerShape(shape)) {
            const path = getContainerPathForId(shape.id);
            setActiveContainerPath([null, ...path]);
            setSelectedId(shape.id);
            return;
        }
        const containerAncestor = getContainerAncestor(shape);
        if (containerAncestor) {
            const path = getContainerPathForId(containerAncestor.id);
            setActiveContainerPath([null, ...path]);
        }
        setSelectedId(shape.id);
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

    const beginGradientHandleDrag = (shapeId, type, stopIndex = null) => {
        setGradientHandleInteraction(true);
        gradientDragRef.current = {
            active: true,
            shapeId,
            type,
            stopIndex,
            before: shapesRef.current.map((shape) => ({ ...shape })),
        };
    };

    const finishGradientHandleDrag = () => {
        const dragState = gradientDragRef.current;
        if (!dragState.active || !dragState.before) {
            gradientDragRef.current = { active: false, shapeId: null, type: null, stopIndex: null, before: null };
            setGradientHandleInteraction(false);
            return;
        }
        const currentShape = shapesRef.current.find((shape) => shape.id === dragState.shapeId);
        const previousShape = dragState.before.find((shape) => shape.id === dragState.shapeId);
        if (currentShape && previousShape) {
            const currentGradient =
                currentShape.fillType === 'gradient' && currentShape.fillGradient
                    ? normalizeGradient(currentShape.fillGradient)
                    : null;
            const previousGradient =
                previousShape.fillType === 'gradient' && previousShape.fillGradient
                    ? normalizeGradient(previousShape.fillGradient)
                    : null;
            if (currentGradient && previousGradient && !gradientStopsEqual(currentGradient, previousGradient)) {
                pastRef.current.push(dragState.before);
                if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
                futureRef.current = [];
            }
        }
        gradientDragRef.current = { active: false, shapeId: null, type: null, stopIndex: null, before: null };
        setGradientHandleInteraction(false);
    };

    const updateGradientHandleFromStage = (shapeId, type, stopIndex, stagePoint) => {
        const shape = shapesRef.current.find((s) => s.id === shapeId);
        if (!shape || shape.fillType !== 'gradient' || !shape.fillGradient) {
            return null;
        }
        const gradient = normalizeGradient(shape.fillGradient);
        const stage = stageRef.current;
        if (!stage) return null;
        const stageAbsoluteTransform = stage.getAbsoluteTransform().copy();
        const stageToAbsolute = (point) => stageAbsoluteTransform.point(point);
        const stageInverseTransform = stageAbsoluteTransform.copy();
        stageInverseTransform.invert();
        const absoluteToStage = (point) => stageInverseTransform.point(point);
        const node = stage.findOne(`#shape-${shape.id}`);
        if (!node) return null;
        const nodeAbsoluteTransform = node.getAbsoluteTransform().copy();
        const inverted = nodeAbsoluteTransform.copy();
        inverted.invert();
        if (type === 'stop') {
            const handlePoints = getLocalHandlePoints(shape, gradient.handles);
            if (!handlePoints) return null;
            const stagePointAbsolute = stageToAbsolute(stagePoint);
            const localPoint = inverted.point(stagePointAbsolute);
            const axis = {
                x: handlePoints.end.x - handlePoints.start.x,
                y: handlePoints.end.y - handlePoints.start.y,
            };
            const lengthSq = axis.x * axis.x + axis.y * axis.y;
            if (!lengthSq) return null;
            const dot =
                (localPoint.x - handlePoints.start.x) * axis.x +
                (localPoint.y - handlePoints.start.y) * axis.y;
            const ratio = clampValue(dot / lengthSq, 0, 1);
            const projectedLocal = {
                x: handlePoints.start.x + axis.x * ratio,
                y: handlePoints.start.y + axis.y * ratio,
            };
            const projectedAbsolute = nodeAbsoluteTransform.point(projectedLocal);
            const projectedStage = absoluteToStage(projectedAbsolute);
            const nextGradient = normalizeGradient(
                {
                    ...gradient,
                    stops: gradient.stops.map((stop, index) =>
                        index === stopIndex ? { ...stop, position: ratio } : stop
                    ),
                },
                gradient
            );
            setShapes((prev) =>
                prev.map((s) => (s.id === shapeId ? { ...s, fillGradient: nextGradient } : s))
            );
            return projectedStage;
        }

        const stagePointAbsolute = stageToAbsolute(stagePoint);
        const localPoint = inverted.point(stagePointAbsolute);
        const dimensions = getShapeDimensions(shape);
        const normalizedPoint = convertLocalPointToNormalized(localPoint, dimensions);
        const nextHandles = {
            start: type === 'start' ? normalizedPoint : gradient.handles.start,
            end: type === 'end' ? normalizedPoint : gradient.handles.end,
        };
        const nextGradient = normalizeGradient(
            {
                ...gradient,
                handles: nextHandles,
                angle: getHandlesAngle(nextHandles),
            },
            gradient
        );
        setShapes((prev) => prev.map((s) => (s.id === shapeId ? { ...s, fillGradient: nextGradient } : s)));
        return null;
    };

    const addGradientStopAtRatio = (shapeId, ratio) => {
        const shape = shapesRef.current.find((s) => s.id === shapeId);
        if (!shape || shape.fillType !== 'gradient' || !shape.fillGradient) return;
        const gradient = normalizeGradient(shape.fillGradient);
        if (!gradient || !Array.isArray(gradient.stops)) return;
        if (gradient.stops.length >= 8) return;
        const clampedRatio = clampValue(ratio, 0, 1);
        if (gradient.stops.some((stop) => Math.abs(stop.position - clampedRatio) < 0.002)) {
            return;
        }
        const sample = interpolateGradientColor(gradient.stops, clampedRatio);
        const newStop = {
            position: Math.round(clampedRatio * 1000) / 1000,
            color: sample.color,
            opacity: clampValue(sample.opacity ?? 1, 0, 1),
        };
        const nextGradient = normalizeGradient(
            {
                ...gradient,
                stops: [...gradient.stops, newStop].sort((a, b) => a.position - b.position),
            },
            gradient
        );
        applyChange((prev) =>
            prev.map((s) => (s.id === shapeId ? { ...s, fillGradient: nextGradient } : s))
        );
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

    const getAdvancedGradientPattern = (shape, gradient) => {
        if (typeof document === 'undefined') return null;
        if (!gradient || !gradient.handles || !Array.isArray(gradient.stops)) return null;
        const dimensions = getShapeDimensions(shape);
        const width = Math.max(1, Math.round(dimensions.width || 0));
        const height = Math.max(1, Math.round(dimensions.height || 0));
        if (!width || !height) return null;

        const keyParts = [
            gradient.type,
            width,
            height,
            roundForKey(gradient.handles.start.x),
            roundForKey(gradient.handles.start.y),
            roundForKey(gradient.handles.end.x),
            roundForKey(gradient.handles.end.y),
            roundForKey(gradient.angle || 0),
            gradient.stops
                .map(
                    (stop) =>
                        `${roundForKey(stop.position)}:${stop.color}:${roundForKey(stop.opacity ?? 1)}`
                )
                .join('|'),
        ];
        const cacheKey = keyParts.join(';');
        const cache = gradientPatternCacheRef.current;
        if (cache.has(cacheKey)) {
            return cache.get(cacheKey);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const handlePoints =
            getLocalHandlePoints(shape, gradient.handles) ||
            {
                start: convertNormalizedPointToLocal(gradient.handles.start, dimensions),
                end: convertNormalizedPointToLocal(gradient.handles.end, dimensions),
            };
        const startPoint = handlePoints.start;
        const endPoint = handlePoints.end;
        const axis = { x: endPoint.x - startPoint.x, y: endPoint.y - startPoint.y };
        const axisLength = Math.sqrt(axis.x * axis.x + axis.y * axis.y);
        const fallbackLength = Math.max(dimensions.width, dimensions.height) / 2 || 1;
        const effectiveAxisLength = axisLength > 0.0001 ? axisLength : fallbackLength;
        const dir =
            axisLength > 0.0001
                ? { x: axis.x / axisLength, y: axis.y / axisLength }
                : { x: 1, y: 0 };
        const perp = { x: -dir.y, y: dir.x };
        const startAngle = Math.atan2(axis.y, axis.x);
        const twoPi = Math.PI * 2;

        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        const defaultRgb = parseHexColor(gradient.stops[0]?.color || '#000000');

        for (let y = 0; y < height; y += 1) {
            const localY = y - height / 2;
            for (let x = 0; x < width; x += 1) {
                const localX = x - width / 2;
                const vector = { x: localX - startPoint.x, y: localY - startPoint.y };
                let ratio;
                if (gradient.type === 'angular') {
                    const angle = Math.atan2(vector.y, vector.x);
                    let delta = angle - startAngle;
                    if (!Number.isFinite(delta)) delta = 0;
                    delta %= twoPi;
                    if (delta < 0) delta += twoPi;
                    ratio = delta / twoPi;
                } else if (gradient.type === 'diamond') {
                    const projX = vector.x * dir.x + vector.y * dir.y;
                    const projY = vector.x * perp.x + vector.y * perp.y;
                    ratio = (Math.abs(projX) + Math.abs(projY)) / effectiveAxisLength;
                } else {
                    const distance = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
                    ratio = distance / effectiveAxisLength;
                }
                const clamped = clampValue(ratio, 0, 1);
                const sample = interpolateGradientColor(gradient.stops, clamped);
                const rgb = parseHexColor(sample.color, defaultRgb);
                const opacity = clampValue(sample.opacity ?? 1, 0, 1);
                const index = (y * width + x) * 4;
                data[index] = rgb.r;
                data[index + 1] = rgb.g;
                data[index + 2] = rgb.b;
                data[index + 3] = Math.round(opacity * 255);
            }
        }

        ctx.putImageData(imageData, 0, 0);
        cache.set(cacheKey, canvas);
        if (cache.size > 32) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey) {
                cache.delete(oldestKey);
            }
        }
        return canvas;
    };

    const getFillPropsForShape = (shape) => {
        if (!shape || shape.fillType !== 'gradient' || !shape.fillGradient) {
            return { fill: shape?.fill, fillPriority: 'color' };
        }
        const gradient = normalizeGradient(shape.fillGradient);
        if (!gradient || !Array.isArray(gradient.stops) || gradient.stops.length < 2) {
            return { fill: shape.fill, fillPriority: 'color' };
        }

        const fallbackFill = gradient.stops[0]?.color || shape.fill;

        if (gradient.type === 'linear' || gradient.type === 'radial') {
            const colorStops = buildGradientColorStops(gradient);
            if (colorStops.length < 4) {
                return { fill: shape.fill, fillPriority: 'color' };
            }
            if (gradient.type === 'linear') {
                const handlePoints = getLocalHandlePoints(shape, gradient.handles);
                let startPoint = handlePoints?.start;
                let endPoint = handlePoints?.end;
                if (
                    !startPoint ||
                    !endPoint ||
                    (Math.abs(startPoint.x - endPoint.x) < 0.001 &&
                        Math.abs(startPoint.y - endPoint.y) < 0.001)
                ) {
                    const fallback = computeLinearGradientPoints(shape, gradient.angle);
                    if (!fallback) {
                        return { fill: shape.fill, fillPriority: 'color' };
                    }
                    startPoint = fallback.startPoint;
                    endPoint = fallback.endPoint;
                }
                return {
                    fill: shape.fill || fallbackFill,
                    fillPriority: 'linear-gradient',
                    fillLinearGradientStartPoint: startPoint,
                    fillLinearGradientEndPoint: endPoint,
                    fillLinearGradientColorStops: colorStops,
                };
            }

            const handlePoints = getLocalHandlePoints(shape, gradient.handles);
            const centerPoint = handlePoints?.start || { x: 0, y: 0 };
            const radiusVector = handlePoints
                ? {
                      x: handlePoints.end.x - handlePoints.start.x,
                      y: handlePoints.end.y - handlePoints.start.y,
                  }
                : { x: 0, y: 0 };
            const radiusMagnitude = Math.sqrt(
                radiusVector.x * radiusVector.x + radiusVector.y * radiusVector.y
            );
            const fallbackDimensions = handlePoints?.dimensions || getShapeDimensions(shape);
            const fallbackRadius = Math.max(fallbackDimensions.width, fallbackDimensions.height) / 2 || 0;
            const endRadius = radiusMagnitude > 1 ? radiusMagnitude : fallbackRadius;
            if (!endRadius) {
                return { fill: fallbackFill, fillPriority: 'color' };
            }

            return {
                fill: shape.fill || fallbackFill,
                fillPriority: 'radial-gradient',
                fillRadialGradientStartPoint: centerPoint,
                fillRadialGradientEndPoint: centerPoint,
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndRadius: endRadius,
                fillRadialGradientColorStops: colorStops,
            };
        }

        const patternCanvas = getAdvancedGradientPattern(shape, gradient);
        if (!patternCanvas) {
            return { fill: fallbackFill, fillPriority: 'color' };
        }
        return {
            fillPriority: 'pattern',
            fillPatternImage: patternCanvas,
            fillPatternOffsetX: patternCanvas.width / 2,
            fillPatternOffsetY: patternCanvas.height / 2,
            fillPatternRepeat: 'no-repeat',
        };
    };

    const renderShapeNode = (shape) => {
        if (shape.visible === false) {
            return null;
        }
        const opacity = clampValue(
            typeof shape.opacity === 'number' ? shape.opacity : 1,
            0,
            1
        );
        const blendMode = BLEND_MODE_TO_COMPOSITE[shape.blendMode] || 'source-over';
        const isLocked = Boolean(shape.locked);
        const isSelectable = selectedTool === 'select';
        const commonProps = {
            key: shape.id,
            id: `shape-${shape.id}`,
            name: 'shape',
            draggable: isSelectable && !isLocked,
            listening: true,
            onClick: (e) => handleShapeClick(shape, e),
            onTap: (e) => handleShapeClick(shape, e),
            onDblClick: (e) => handleShapeDoubleClick(shape, e),
            onDblTap: (e) => handleShapeDoubleClick(shape, e),
            onDragMove: (e) => handleDragMove(shape.id, e),
            onDragEnd: (e) => handleDragEnd(shape.id, e),
            onTransformEnd: (e) => handleTransformEnd(shape, e.target),
            onMouseMove: (e) => handleShapeMouseMove(shape, e),
            onMouseLeave: (e) => handleShapeMouseLeave(e),
            onMouseDown: (e) => handleShapeMouseDown(shape, e),
            opacity,
            globalCompositeOperation: blendMode,
        };
        const fillProps = getFillPropsForShape(shape);

        switch (shape.type) {
            case 'frame':
                return (
                    <Rect
                        {...commonProps}
                        name="frame"
                        x={shape.x}
                        y={shape.y}
                        width={shape.width || 0}
                        height={shape.height || 0}
                        offset={{ x: (shape.width || 0) / 2, y: (shape.height || 0) / 2 }}
                        {...fillProps}
                        stroke={shape.stroke || '#1f2937'}
                        strokeWidth={shape.strokeWidth || 1}
                    />
                );
            case 'group':
                return (
                    <Rect
                        {...commonProps}
                        name="group"
                        x={shape.x}
                        y={shape.y}
                        width={shape.width || 0}
                        height={shape.height || 0}
                        offset={{ x: (shape.width || 0) / 2, y: (shape.height || 0) / 2 }}
                        stroke={shape.stroke || 'rgba(100,116,139,0.9)'}
                        strokeWidth={shape.strokeWidth || 1}
                        dash={[6, 4]}
                        fillEnabled={false}
                    />
                );
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

    const renderGradientHandles = () => {
        if (!showGradientHandles) return null;
        if (!selectedId) return null;
        const allowHandleVisibility = selectedTool === 'select' || selectedTool === 'hand';
        if (!allowHandleVisibility) return null;
        const canEditGradientHandles = selectedTool === 'select';
        const shape = shapes.find((s) => s.id === selectedId);
        if (!shape || shape.fillType !== 'gradient' || !shape.fillGradient) return null;
        const stage = stageRef.current;
        if (!stage) return null;
        const node = stage.findOne(`#shape-${shape.id}`);
        if (!node) return null;
        const gradient = normalizeGradient(shape.fillGradient);
        if (!gradient || gradient.stops.length < 2) return null;
        const handlePoints = getLocalHandlePoints(shape, gradient.handles);
        if (!handlePoints) return null;

        const stageAbsoluteTransform = stage.getAbsoluteTransform().copy();
        const stageToAbsolute = (point) => stageAbsoluteTransform.point(point);
        const stageInverseTransform = stageAbsoluteTransform.copy();
        stageInverseTransform.invert();
        const absoluteToStage = (point) => stageInverseTransform.point(point);

        const absoluteTransform = node.getAbsoluteTransform().copy();
        const toStage = (point) => absoluteToStage(absoluteTransform.point(point));
        const inverseTransform = absoluteTransform.copy();
        inverseTransform.invert();

        const startStage = toStage(handlePoints.start);
        const endStage = toStage(handlePoints.end);

        const axisVector = {
            x: handlePoints.end.x - handlePoints.start.x,
            y: handlePoints.end.y - handlePoints.start.y,
        };
        const axisLengthSq = axisVector.x * axisVector.x + axisVector.y * axisVector.y;

        const handleAxisPointerDown = (event) => {
            if (!canEditGradientHandles) return;
            if (!axisLengthSq) return;
            markTransientGradientInteraction();
            event.cancelBubble = true;
            const stageNode = event.target.getStage();
            if (!stageNode) return;
            const pointer = stageNode.getPointerPosition();
            if (!pointer) return;
            const pointerAbsolute = stageToAbsolute(pointer);
            const localPoint = inverseTransform.point(pointerAbsolute);
            const dot =
                (localPoint.x - handlePoints.start.x) * axisVector.x +
                (localPoint.y - handlePoints.start.y) * axisVector.y;
            const ratio = axisLengthSq ? dot / axisLengthSq : 0;
            addGradientStopAtRatio(shape.id, ratio);
        };

        const stopHandles = gradient.stops.map((stop, index) => {
            const localPoint = {
                x: handlePoints.start.x + (handlePoints.end.x - handlePoints.start.x) * stop.position,
                y: handlePoints.start.y + (handlePoints.end.y - handlePoints.start.y) * stop.position,
            };
            return {
                index,
                stop,
                stagePoint: toStage(localPoint),
            };
        });

        const baseHandleRadius = gradient.type === 'linear' ? 9 : 14;
        const endHandleRadius = gradient.type === 'linear' ? 9 : 14;
        const stopHandleRadius = gradient.type === 'linear' ? 7 : 10;

        return (
            <Group listening={canEditGradientHandles}>
                <Line
                    points={[startStage.x, startStage.y, endStage.x, endStage.y]}
                    stroke="#2563eb"
                    strokeWidth={2}
                    dash={[6, 4]}
                    listening={canEditGradientHandles}
                    hitStrokeWidth={24}
                    onMouseDown={handleAxisPointerDown}
                    onTouchStart={handleAxisPointerDown}
                />
                <Circle
                    x={startStage.x}
                    y={startStage.y}
                    radius={baseHandleRadius}
                    fill="#1d4ed8"
                    stroke="#ffffff"
                    strokeWidth={2}
                    draggable={canEditGradientHandles}
                    onMouseDown={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        markTransientGradientInteraction();
                    }}
                    onTouchStart={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        markTransientGradientInteraction();
                    }}
                    onDragStart={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        beginGradientHandleDrag(shape.id, 'start');
                    }}
                    onDragMove={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        const pos = event.target.getAbsolutePosition();
                        updateGradientHandleFromStage(shape.id, 'start', null, pos);
                    }}
                    onDragEnd={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        const pos = event.target.getAbsolutePosition();
                        updateGradientHandleFromStage(shape.id, 'start', null, pos);
                        finishGradientHandleDrag();
                    }}
                    opacity={0.95}
                />
                <Circle
                    x={endStage.x}
                    y={endStage.y}
                    radius={endHandleRadius}
                    fill="#f97316"
                    stroke="#ffffff"
                    strokeWidth={2}
                    draggable={canEditGradientHandles}
                    onMouseDown={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        markTransientGradientInteraction();
                    }}
                    onTouchStart={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        markTransientGradientInteraction();
                    }}
                    onDragStart={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        beginGradientHandleDrag(shape.id, 'end');
                    }}
                    onDragMove={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        const pos = event.target.getAbsolutePosition();
                        updateGradientHandleFromStage(shape.id, 'end', null, pos);
                    }}
                    onDragEnd={(event) => {
                        if (!canEditGradientHandles) return;
                        event.cancelBubble = true;
                        const pos = event.target.getAbsolutePosition();
                        updateGradientHandleFromStage(shape.id, 'end', null, pos);
                        finishGradientHandleDrag();
                    }}
                    opacity={0.95}
                />
                {stopHandles.map(({ index, stop, stagePoint }) => (
                    <Circle
                        key={`gradient-stop-${index}`}
                        x={stagePoint.x}
                        y={stagePoint.y}
                        radius={stopHandleRadius}
                        fill={stop.color}
                        stroke="#0f172a"
                        strokeWidth={2}
                        opacity={clampValue(stop.opacity ?? 1, 0.2, 1)}
                        draggable={canEditGradientHandles}
                        onMouseDown={(event) => {
                            if (!canEditGradientHandles) return;
                            event.cancelBubble = true;
                            markTransientGradientInteraction();
                        }}
                        onTouchStart={(event) => {
                            if (!canEditGradientHandles) return;
                            event.cancelBubble = true;
                            markTransientGradientInteraction();
                        }}
                        onDragStart={(event) => {
                            if (!canEditGradientHandles) return;
                            event.cancelBubble = true;
                            beginGradientHandleDrag(shape.id, 'stop', index);
                        }}
                        onDragMove={(event) => {
                            if (!canEditGradientHandles) return;
                            event.cancelBubble = true;
                            const pos = event.target.getAbsolutePosition();
                            const projected = updateGradientHandleFromStage(shape.id, 'stop', index, pos);
                            if (projected) {
                                event.target.absolutePosition(projected);
                            }
                        }}
                        onDragEnd={(event) => {
                            if (!canEditGradientHandles) return;
                            event.cancelBubble = true;
                            const pos = event.target.getAbsolutePosition();
                            const projected = updateGradientHandleFromStage(shape.id, 'stop', index, pos);
                            if (projected) {
                                event.target.absolutePosition(projected);
                            }
                            finishGradientHandleDrag();
                        }}
                        shadowBlur={4}
                        shadowColor="rgba(15, 23, 42, 0.18)"
                    />
                ))}
            </Group>
        );
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
        frame: 'Frame',
        group: 'Group',
        rectangle: 'Rectangle',
        circle: 'Circle',
        ellipse: 'Ellipse',
        line: 'Line',
        pen: 'Pen',
        text: 'Text',
    };

    const childrenMap = useMemo(() => {
        const map = new Map();
        map.set(null, []);
        shapes.forEach((shape) => {
            map.set(shape.id, []);
        });
        for (let i = shapes.length - 1; i >= 0; i -= 1) {
            const shape = shapes[i];
            const key = shape.parentId ?? null;
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key).push(shape);
        }
        return map;
    }, [shapes]);

    const layerList = useMemo(() => {
        const result = [];
        const visit = (parentId, depth) => {
            const siblings = childrenMap.get(parentId) || [];
            siblings.forEach((shape) => {
                result.push({ shape, depth });
                visit(shape.id, depth + 1);
            });
        };
        visit(null, 0);
        return result;
    }, [childrenMap]);

    const renderShapeTree = (shape) => {
        if (!shape || shape.visible === false) {
            return null;
        }
        const node = renderShapeNode(shape);
        if (!isContainerShape(shape)) {
            return node;
        }
        const children = childrenMap.get(shape.id) || [];
        const clipContent = shape.type === 'frame' && shape.clipContent;
        const clipProps = {};
        if (clipContent) {
            const bounds = getContainerBounds(shape);
            if (bounds) {
                clipProps.clipFunc = (ctx) => {
                    ctx.beginPath();
                    ctx.rect(
                        bounds.left,
                        bounds.top,
                        Math.max(0, bounds.right - bounds.left),
                        Math.max(0, bounds.bottom - bounds.top)
                    );
                };
            }
        }
        return (
            <Group key={`container-${shape.id}`} {...clipProps}>
                {node}
                {children.map((child) => renderShapeTree(child))}
            </Group>
        );
    };

    const [draggedLayerId, setDraggedLayerId] = useState(null);
    const [dragOverLayerId, setDragOverLayerId] = useState(null);
    const [dragOverZone, setDragOverZone] = useState(null);
    const isDraggingLayer = draggedLayerId != null;

    const reorderLayers = (sourceId, targetId, placeAfter) => {
        if (!sourceId || !targetId || sourceId === targetId) return;
        applyChange((prev) => {
            const sourceIndex = prev.findIndex((shape) => shape.id === sourceId);
            const targetIndex = prev.findIndex((shape) => shape.id === targetId);
            if (sourceIndex === -1 || targetIndex === -1) return prev;
            const sourceShape = prev[sourceIndex];
            const targetShape = prev[targetIndex];
            const sourceParent = sourceShape.parentId ?? null;
            const targetParent = targetShape.parentId ?? null;
            if (sourceParent !== targetParent) {
                return prev;
            }
            const updated = [...prev];
            const [item] = updated.splice(sourceIndex, 1);
            let insertIndex = updated.findIndex((shape) => shape.id === targetId);
            if (insertIndex === -1) {
                updated.splice(sourceIndex, 0, item);
                return updated;
            }
            if (placeAfter) {
                insertIndex += 1;
            }
            updated.splice(insertIndex, 0, item);
            return updated;
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
        const shape = shapesRef.current.find((s) => s.id === shapeId);
        if (shape && isContainerShape(shape)) {
            const path = getContainerPathForId(shape.id, shapesRef.current);
            setActiveContainerPath([null, ...path]);
        }
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

    const handleLayerResizeStart = useCallback(
        (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) {
                return;
            }
            if (typeof event.clientX !== 'number') return;

            event.preventDefault();
            event.stopPropagation();

            const handleElement = event.currentTarget;
            const pointerId = event.pointerId;
            const startX = event.clientX;
            const startWidth = layerPanelWidth;

            const applyWidth = (clientX) => {
                if (typeof clientX !== 'number') return;
                const delta = clientX - startX;
                const nextWidth = clampValue(
                    startWidth + delta,
                    LAYER_PANEL_MIN_WIDTH,
                    LAYER_PANEL_MAX_WIDTH
                );
                setLayerPanelWidth((current) =>
                    Math.abs(current - nextWidth) < 0.5 ? current : nextWidth
                );
            };

            const handlePointerMove = (moveEvent) => {
                applyWidth(moveEvent.clientX);
            };

            const handlePointerEnd = () => {
                if (typeof handleElement.releasePointerCapture === 'function') {
                    try {
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
        [layerPanelWidth]
    );

    const rootShapes = childrenMap.get(null) || [];

    return (
        <div style={{ display: 'flex', height: '100%' }}>
            <aside
                style={{
                    flex: '0 0 auto',
                    width: layerPanelWidth,
                    minWidth: LAYER_PANEL_MIN_WIDTH,
                    maxWidth: LAYER_PANEL_MAX_WIDTH,
                    borderRight: '1px solid #e5e5e5',
                    background: '#fdfdfd',
                    padding: '12px 8px',
                    boxSizing: 'border-box',
                    overflowY: 'auto',
                }}
            >
                <div style={{ fontWeight: 600, fontSize: 14, color: '#555', marginBottom: 8 }}>Layers</div>
                {layerList.length === 0 ? (
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
                                if (!isDraggingLayer || layerList.length === 0) return;
                                event.preventDefault();
                                const topShapeId = layerList[0]?.shape?.id;
                                if (!topShapeId) return;
                                reorderLayers(draggedLayerId, topShapeId, false);
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
                        {layerList.map(({ shape, depth }) => {
                            const fallbackLabel = `${typeLabels[shape.type] || 'Shape'} ${shape.id}`;
                            const label =
                                typeof shape.name === 'string' && shape.name.trim()
                                    ? shape.name
                                    : fallbackLabel;
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
                                        <span style={{ fontSize: 13, marginLeft: depth * 12 }}>{label}</span>
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
                                if (!isDraggingLayer || layerList.length === 0) return;
                                event.preventDefault();
                                const bottomShapeId = layerList[layerList.length - 1]?.shape?.id;
                                if (!bottomShapeId) return;
                                reorderLayers(draggedLayerId, bottomShapeId, true);
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
                role="separator"
                aria-orientation="vertical"
                onPointerDown={handleLayerResizeStart}
                style={{
                    flex: '0 0 auto',
                    width: 8,
                    padding: '0 2px',
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
                    onDblClick={handleStageDoubleClick}
                >
                    <Layer>
                        {rootShapes.map((shape) => renderShapeTree(shape))}

                        <Transformer
                            ref={trRef}
                            rotationEnabled={false}
                            rotateEnabled={false}
                            rotationAnchorOffset={-9999}
                            enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
                        />
                    </Layer>
                    <Layer listening={selectedTool === 'select'}>{renderGradientHandles()}</Layer>
                </Stage>
            </div>


        </div>
    );
}
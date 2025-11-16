import React, { useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import { Stage, Layer, Rect, Circle, Ellipse, Group, Line, Text, Transformer, Path, RegularPolygon, Arc, Shape } from 'react-konva';
import PagesPanel from './PagesPanel';
import LayersPanel from './LayersPanel';
import PropertiesPanel from './PropertiesPanel';
import PixelGrid from "./PixelGrid";
import { nanoid } from 'nanoid';
import {
    buildGradientColorStops,
    getGradientFirstColor,
    getHandlesAngle,
    gradientStopsEqual,
    interpolateGradientColor,
    normalizeGradient,
} from '../utils/gradient';
import PATH_NODE_TYPES, {
    MAX_POINTS_PER_PATH,
    MIN_SEGMENT_LENGTH,
    buildSvgPath,
    canConvertShapeToPath,
    clonePathPoint,
    clonePathPoints,
    createPathPoint,
    distanceBetween,
    distanceToSegment,
    ensureHandlesForType,
    roundPathCorners,
    shapeToPath,
    translatePathPoints,
    updateHandleSymmetry,
} from '../utils/path';


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

const FULL_ARC_SWEEP = 360;
const ARC_RATIO_MAX = 0.99;
const ARC_EPSILON = 0.0001;
const CANVAS_STORAGE_KEY = 'kanvas:canvas-state';

const LAYER_PANEL_MIN_WIDTH = 240;
const LAYER_PANEL_MAX_WIDTH = 500;
const LAYER_PANEL_DEFAULT_WIDTH = 280;
const PAGES_SECTION_MIN_HEIGHT = 140;
const LAYERS_SECTION_MIN_HEIGHT = 180;
const PAGES_SECTION_DEFAULT_HEIGHT = 220;

const CONTAINER_TYPES = ['frame', 'group'];

const isContainerShape = (shape) => Boolean(shape && CONTAINER_TYPES.includes(shape.type));

const getPathPoints = (shape) => {
    if (!shape || !Array.isArray(shape.points)) return [];
    return shape.points.map((point) => ({
        x: typeof point.x === 'number' ? point.x : 0,
        y: typeof point.y === 'number' ? point.y : 0,
        type: point.type || PATH_NODE_TYPES.CORNER,
        handles: point.handles || undefined,
    }));
};

const getRadiusHandlePosition = (shape) => {
    const { x, y, width, height } = shape;

    return {
        x: x + width,
        y: y + height
    };
};

const getPointsBoundingBox = (points) => {
    if (!Array.isArray(points) || points.length === 0) return null;
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let i = 1; i < points.length; i += 1) {
        const p = points[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return {
        left: minX,
        right: maxX,
        top: minY,
        bottom: maxY,
    };
};

const getLineBoundingBox = (points) => {
    if (!Array.isArray(points) || points.length < 2) {
        return null;
    }
    let minX = Number(points[0]) || 0;
    let maxX = minX;
    let minY = Number(points[1]) || 0;
    let maxY = minY;
    for (let i = 2; i < points.length; i += 2) {
        const x = Number(points[i]);
        const y = Number(points[i + 1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return {
        left: minX,
        right: maxX,
        top: minY,
        bottom: maxY,
    };
};

const translateLinePoints = (points, dx = 0, dy = 0) => {
    if (!Array.isArray(points) || points.length === 0) {
        return [];
    }
    const next = new Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
        const px = Number(points[i]);
        const py = Number(points[i + 1]);
        next[i] = Number.isFinite(px) ? px + dx : px;
        next[i + 1] = Number.isFinite(py) ? py + dy : py;
    }
    return next;
};

const SHAPE_LABELS = {
    frame: 'Frame',
    group: 'Group',
    rectangle: 'Rectangle',
    circle: 'Circle',
    ellipse: 'Ellipse',
    polygon: 'Polygon',
    roundedPolygon: 'Rounded Polygon',
    line: 'Line',
    path: 'Path',
    text: 'Text',
};

const isPolygonLikeType = (type) => type === 'polygon' || type === 'roundedPolygon';
const isPolygonLikeShape = (shape) => isPolygonLikeType(shape?.type);

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
        case 'line': {
            const bounds = getLineBoundingBox(shape.points);
            if (!bounds) return { width: 0, height: 0 };
            return {
                width: Math.max(0, bounds.right - bounds.left),
                height: Math.max(0, bounds.bottom - bounds.top),
            };
        }
        case 'polygon':
        case 'roundedPolygon': {
            const radius = Math.max(0, shape.radius || 0);
            return { width: radius * 2, height: radius * 2 };
        }
        case 'path': {
            const bounds = getPointsBoundingBox(getPathPoints(shape));
            if (!bounds) return { width: 0, height: 0 };
            return {
                width: Math.max(0, bounds.right - bounds.left),
                height: Math.max(0, bounds.bottom - bounds.top),
            };
        }
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

const getShapeBoundingBox = (shape) => {
    if (!shape) return null;
    switch (shape.type) {
        case 'rectangle':
        case 'frame':
        case 'group': {
            const width = Math.max(0, shape.width || 0);
            const height = Math.max(0, shape.height || 0);
            const centerX = shape.x || 0;
            const centerY = shape.y || 0;
            return {
                left: centerX - width / 2,
                right: centerX + width / 2,
                top: centerY - height / 2,
                bottom: centerY + height / 2,
            };
        }
        case 'circle': {
            const radius = Math.max(0, shape.radius || 0);
            const centerX = shape.x || 0;
            const centerY = shape.y || 0;
            return {
                left: centerX - radius,
                right: centerX + radius,
                top: centerY - radius,
                bottom: centerY + radius,
            };
        }
        case 'ellipse': {
            const radiusX = Math.max(0, shape.radiusX || 0);
            const radiusY = Math.max(0, shape.radiusY || 0);
            const centerX = shape.x || 0;
            const centerY = shape.y || 0;
            return {
                left: centerX - radiusX,
                right: centerX + radiusX,
                top: centerY - radiusY,
                bottom: centerY + radiusY,
            };
        }
        case 'polygon':
        case 'roundedPolygon': {
            const radius = Math.max(0, shape.radius || 0);
            const centerX = shape.x || 0;
            const centerY = shape.y || 0;
            return {
                left: centerX - radius,
                right: centerX + radius,
                top: centerY - radius,
                bottom: centerY + radius,
            };
        }
        case 'line': {
            const points = Array.isArray(shape.points) ? shape.points : [];
            if (points.length < 2) {
                const x = shape.x || 0;
                const y = shape.y || 0;
                return { left: x, right: x, top: y, bottom: y };
            }
            let minX = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            let maxY = Number.NEGATIVE_INFINITY;
            for (let index = 0; index + 1 < points.length; index += 2) {
                const px = points[index];
                const py = points[index + 1];
                if (typeof px === 'number') {
                    if (px < minX) minX = px;
                    if (px > maxX) maxX = px;
                }
                if (typeof py === 'number') {
                    if (py < minY) minY = py;
                    if (py > maxY) maxY = py;
                }
            }
            if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
                const x = shape.x || 0;
                const y = shape.y || 0;
                return { left: x, right: x, top: y, bottom: y };
            }
            return { left: minX, right: maxX, top: minY, bottom: maxY };
        }
        case 'path': {
            const bounds = getPointsBoundingBox(getPathPoints(shape));
            if (!bounds) {
                const x = shape.x || 0;
                const y = shape.y || 0;
                return { left: x, right: x, top: y, bottom: y };
            }
            return bounds;
        }
        case 'text': {
            const { width, height } = getShapeDimensions(shape);
            const centerX = shape.x || 0;
            const centerY = shape.y || 0;
            return {
                left: centerX - width / 2,
                right: centerX + width / 2,
                top: centerY - height / 2,
                bottom: centerY + height / 2,
            };
        }
        default:
            return null;
    }
};

const buildRegularPolygonPoints = (center, radius, sides, rotationDegrees = 0) => {
    const resolvedSides = Math.max(3, Math.floor(sides || 0));
    const resolvedRadius = Math.max(0, radius || 0);
    const rotation = (Number.isFinite(rotationDegrees) ? rotationDegrees : 0) * (Math.PI / 180);
    const baseAngle = rotation - Math.PI / 2;
    const step = (Math.PI * 2) / resolvedSides;
    const points = [];
    for (let index = 0; index < resolvedSides; index += 1) {
        const angle = baseAngle + index * step;
        points.push(center.x + Math.cos(angle) * resolvedRadius);
        points.push(center.y + Math.sin(angle) * resolvedRadius);
    }
    return points;
};

const unionBoundingBoxes = (boxes) => {
    if (!Array.isArray(boxes) || boxes.length === 0) return null;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    boxes.forEach((box) => {
        if (!box) return;
        if (box.left < left) left = box.left;
        if (box.right > right) right = box.right;
        if (box.top < top) top = box.top;
        if (box.bottom > bottom) bottom = box.bottom;
    });
    if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
        return null;
    }
    return { left, right, top, bottom };
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

// Compute group box from its children's bounding boxes
function computeGroupBox(group, source) {
    const kids = source.filter(s => s.parentId === group.id && s.visible !== false);
    if (!kids.length) return null;
    const boxes = kids.map(getShapeBoundingBox).filter(Boolean);
    const u = unionBoundingBoxes(boxes);
    if (!u) return null;
    return {
        x: (u.left + u.right) / 2,
        y: (u.top + u.bottom) / 2,
        width: Math.max(1, u.right - u.left),
        height: Math.max(1, u.bottom - u.top),
    };
}

// --- Naming counters per shape type (monotonic, start at 0) ---
const nameCounters = new Map();

const formatTypeLabel = (t) => {
    const map = {
        rectangle: 'Rectangle',
        circle: 'Circle',
        ellipse: 'Ellipse',
        line: 'Line',
        path: 'Path',
        text: 'Text',
        frame: 'Frame',
        group: 'Group',
        image: 'Image',
    };
    return map[t] || (t?.charAt(0).toUpperCase() + t?.slice(1));
};

const getNextName = (type) => {
    const key = String(type || 'Shape');
    const label = formatTypeLabel(key);
    const n = nameCounters.get(key) ?? 0;
    nameCounters.set(key, n + 1);
    return `${label} ${n}`;
};

function cloneShape(shape, shapesMap, opts = { preserveName: false }) {
    const { preserveName = false } = opts;
    const newId = nanoid();
    const cloneName =
        preserveName && shape.name
            ? shape.name                              // keep original name on clipboard paste
            : getNextName(shape.type);               // still use incremental names for other flows
    const clone = {
        ...shape,
        id: newId,
        name: cloneName,
    };
    if (shape.type === 'group' || shape.type === 'frame') {
        const children = shapesMap
            .filter((s) => s.parentId === shape.id)
            .map((child) => cloneShape(child, shapesMap, { preserveName }));
        return [clone, ...children.map((c) => ({ ...c, parentId: newId }))];
    }
    return [clone];
}

export default function Canvas({
    selectedTool,
    onToolChange,
    fillStyle,
    strokeStyle,
    strokeWidth = 0,
    strokeWidthVersion = 0,
    textOptions = {},
    onSelectionChange,
    showGradientHandles = false,
    gradientInteractionRef = null,
    shapePropertyRequest = null,
    onShapePropertyRequestHandled = null,
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
    const dragSnapshotRef = useRef(null);
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isSelectLikeTool = selectedTool === 'select' || selectedTool === 'anchor';
    const handleDragStart = (id, e) => {
        const shape = shapesRef.current.find((s) => s.id === id);
        if (!shape) {
            dragSnapshotRef.current = null;
            return;
        }

        if (shape.type === 'path') {
            const konvaNode = e?.target;
            const startX = typeof konvaNode?.x === 'function' ? konvaNode.x() : 0;
            const startY = typeof konvaNode?.y === 'function' ? konvaNode.y() : 0;
            const stage = stageRef.current;
            const pointer = stage?.getPointerPosition?.() || null;
            dragSnapshotRef.current = {
                id,
                type: 'path',
                startX,
                startY,
                baseX: shape.x || 0,
                baseY: shape.y || 0,
                basePoints: getPathPoints(shape),
                baseState: shapesRef.current.map((s) => ({ ...s })),
                dx: 0,
                dy: 0,
                startPointer: pointer ? { x: pointer.x, y: pointer.y } : null,
                lastPointer: pointer ? { x: pointer.x, y: pointer.y } : null,
            };
            return;
        }

        if (shape.type === 'line') {
            const konvaNode = e?.target;
            const startX = typeof konvaNode?.x === 'function' ? konvaNode.x() : 0;
            const startY = typeof konvaNode?.y === 'function' ? konvaNode.y() : 0;
            const stage = stageRef.current;
            const pointer = stage?.getPointerPosition?.() || null;
            dragSnapshotRef.current = {
                id,
                type: 'line',
                startX,
                startY,
                basePoints: Array.isArray(shape.points) ? [...shape.points] : [],
                baseState: shapesRef.current.map((s) => ({ ...s })),
                dx: 0,
                dy: 0,
                startPointer: pointer ? { x: pointer.x, y: pointer.y } : null,
                lastPointer: pointer ? { x: pointer.x, y: pointer.y } : null,
            };
            return;
        }

        if (!isContainerShape(shape)) {
            dragSnapshotRef.current = null;
            return;
        }

        const startX = shape.x || 0;
        const startY = shape.y || 0;
        const descendants = collectDescendantIds(shapesRef.current, id);
        const childPos = new Map();
        const pathChildPoints = new Map();
        for (const childId of descendants) {
            const childShape = shapesRef.current.find((s) => s.id === childId);
            if (!childShape) continue;
            childPos.set(childId, { x: childShape.x || 0, y: childShape.y || 0 });
            if (childShape.type === 'path') {
                pathChildPoints.set(childId, getPathPoints(childShape));
            }
        }
        dragSnapshotRef.current = {
            id,
            type: 'container',
            startX,
            startY,
            childPos,
            pathChildPoints,
            baseState: shapesRef.current.map((s) => ({ ...s })),
        };
    };

    const shapeCountersRef = useRef({
        frame: 1,
        group: 1,
        rectangle: 1,
        circle: 1,
        ellipse: 1,
        polygon: 1,
        roundedPolygon: 1,
        line: 1,
        path: 1,
        text: 1,
    });
    const stageContainerRef = useRef(null);
    const sidePanelRef = useRef(null);
    // panning (hand tool)
    const isPanningRef = useRef(false);
    const panLastPosRef = useRef({ x: 0, y: 0 });
    // drawing (drag-create)
    const isDrawingRef = useRef(false);
    const drawingStartRef = useRef(null);
    const currentDrawingIdRef = useRef(null);
    const pendingTextEditRef = useRef(null);
    const strokeTxnRef = useRef(false);
    const pathInteractionRef = useRef({
        shapeId: null,
        pendingPoint: null,
        draggingHandle: null,
        baseState: null,
        containerId: null,
    });
    const pathHandleDragRef = useRef(null);
    const lineAnchorDragRef = useRef(null);
    const strokeWidthVersionRef = useRef(strokeWidthVersion);
    const [activePathSelection, setActivePathSelection] = useState(null);


    const [shapes, setShapes] = useState([]);
    const shapesRef = useRef(shapes);

    const initialPageStateRef = useRef(null);
    if (!initialPageStateRef.current) {
        const createdAt = Date.now();
        const defaultPageId = `page-${createdAt}`;
        initialPageStateRef.current = {
            pages: [{ id: defaultPageId, name: 'Page 1', createdAt }],
            activePageId: defaultPageId,
        };
    }
    const [pages, setPages] = useState(initialPageStateRef.current.pages);
    const [activePageId, setActivePageId] = useState(initialPageStateRef.current.activePageId);
    const pagesRef = useRef(pages);
    const persistCanvasState = useCallback((payload) => {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            window.localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(payload));
        } catch { }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            const raw = window.localStorage.getItem(CANVAS_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.shapes)) {
                setShapes(parsed.shapes);
            }
            if (parsed && Array.isArray(parsed.pages) && parsed.pages.length) {
                setPages(parsed.pages);
                const fallbackPageId = parsed.pages[0]?.id;
                const nextActiveId =
                    parsed.activePageId && parsed.pages.some((page) => page.id === parsed.activePageId)
                        ? parsed.activePageId
                        : fallbackPageId;
                if (nextActiveId) {
                    setActivePageId(nextActiveId);
                }
            }
        } catch { }
    }, []);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;


        const onDragStart = (e) => {
            const node = e.target;
            const lyr = node?.getLayer?.();
            const restoreIfNeeded = () => {
                const stage = stageRef.current;
                const ctx = dragCtxRef.current;
                if (!stage || !ctx?.layer) return;
                try { ctx.layer.listening(true); } catch { }
                dragCtxRef.current = { active: false, node: null, cached: false, disabledHit: false, layer: null };
            };
            window.addEventListener('mouseup', restoreIfNeeded);
            window.addEventListener('touchend', restoreIfNeeded);
            return () => {
                window.removeEventListener('mouseup', restoreIfNeeded);
                window.removeEventListener('touchend', restoreIfNeeded);
            };
            // remember exactly which layer we touched
            dragCtxRef.current = { active: true, node, cached: false, disabledHit: !!lyr, layer: lyr || null };
            if (lyr && typeof lyr.listening === 'function') lyr.listening(false);

            // 2) Cache the node if it’s complex
            try {
                if (node.getClassName?.() === 'Group' || node.children?.length > 0) {
                    node.cache({ pixelRatio: 1 });
                    dragCtxRef.current.cached = true;
                }
            } catch { }
            try { node.opacity(0.96); } catch { }

            rafBatchDraw();
        };

        const onDragMove = (e) => {
            rafBatchDraw();

            const now = performance.now();
            if (now - lastDragUpdateRef.current < 16) return;
            lastDragUpdateRef.current = now;

            // Optional: throttle any state updates while dragging
        };

        const onDragEnd = (e) => {
            const node = e.target;
            const lyr = dragCtxRef.current.layer;
            if (lyr && lyr.listening) lyr.listening(true);
            if (dragCtxRef.current.cached) {
                try { node.clearCache(); } catch { }
            }
            try { node.opacity(1); } catch { }

            dragCtxRef.current = { active: false, node: null, cached: false, disabledHit: false, layer: null };
            rafBatchDraw();
        };

        // 🧩 Attach listeners globally for all draggables
        stage.on('dragstart.smooth', onDragStart);
        stage.on('dragmove.smooth', onDragMove);
        stage.on('dragend.smooth', onDragEnd);

        return () => {
            stage.off('dragstart.smooth');
            stage.off('dragmove.smooth');
            stage.off('dragend.smooth');
        };
    }, [stageRef]);

    useEffect(() => {
        pagesRef.current = pages;
    }, [pages]);
    const activePageRef = useRef(activePageId);
    useEffect(() => {
        activePageRef.current = activePageId;
    }, [activePageId]);

    useEffect(() => {
        persistCanvasState({
            shapes: shapesRef.current,
            pages: pagesRef.current,
            activePageId: activePageRef.current,
        });
    }, [shapes, pages, activePageId, persistCanvasState]);

    useEffect(() => () => {
        persistCanvasState({
            shapes: shapesRef.current,
            pages: pagesRef.current,
            activePageId: activePageRef.current,
        });
    }, [persistCanvasState]);

    useEffect(() => {
        if (!pages.length) {
            const createdAt = Date.now();
            const defaultPageId = `page-${createdAt}`;
            const defaultPage = { id: defaultPageId, name: 'Page 1', createdAt };
            setPages([defaultPage]);
            setActivePageId(defaultPageId);
            return;
        }
        if (!pages.some((page) => page.id === activePageId)) {
            setActivePageId(pages[0].id);
        }
    }, [pages, activePageId]);

    useEffect(() => {
        setShapes((current) => {
            if (!Array.isArray(current) || current.length === 0) return current;
            const fallbackPageId = activePageRef.current || pagesRef.current[0]?.id;
            if (!fallbackPageId) return current;
            let changed = false;
            const patched = current.map((shape) => {
                if (!shape.pageId) {
                    changed = true;
                    return { ...shape, pageId: fallbackPageId };
                }
                return shape;
            });
            return changed ? patched : current;
        });
    }, [pages, activePageId]);

    const shapesOnActivePage = useMemo(() => {
        const fallbackPageId = activePageId || pages[0]?.id || null;
        if (!fallbackPageId) return shapes;
        return shapes.filter((shape) => (shape.pageId || fallbackPageId) === fallbackPageId);
    }, [shapes, activePageId, pages]);
    const activeShapesRef = useRef(shapesOnActivePage);
    useEffect(() => {
        activeShapesRef.current = shapesOnActivePage;
    }, [shapesOnActivePage]);

    useEffect(() => {
        setShapes(prev => {
            let changed = false;
            const next = prev.map(s => {
                if (s.type !== 'group') return s;
                const box = computeGroupBox(s, prev);
                if (!box) return s;
                const same =
                    Math.abs((s.x || 0) - box.x) < 0.001 &&
                    Math.abs((s.y || 0) - box.y) < 0.001 &&
                    Math.abs((s.width || 0) - box.width) < 0.001 &&
                    Math.abs((s.height || 0) - box.height) < 0.001;
                if (same) return s;
                changed = true;
                return { ...s, ...box };
            });
            return changed ? next : prev;
        });
    }, [shapesOnActivePage]);

    const pageShapeCounts = useMemo(() => {
        const counts = new Map();
        const fallbackPageId = pages[0]?.id || null;
        shapes.forEach((shape) => {
            const pageId = shape.pageId || fallbackPageId;
            if (!pageId) return;
            counts.set(pageId, (counts.get(pageId) || 0) + 1);
        });
        return counts;
    }, [shapes, pages]);


    // --- simple geometry utilities (stage space) ---
    const pointInRect = (px, py, cx, cy, w, h) => {
        const L = cx - w / 2, R = cx + w / 2;
        const T = cy - h / 2, B = cy + h / 2;
        return px >= L && px <= R && py >= T && py <= B;
    };

    const distSq = (x1, y1, x2, y2) => {
        const dx = x1 - x2, dy = y1 - y2;
        return dx * dx + dy * dy;
    };

    const pointNearSegment = (px, py, x1, y1, x2, y2, tol = 4) => {
        const vx = x2 - x1, vy = y2 - y1;
        const len2 = vx * vx + vy * vy;
        if (len2 === 0) return distSq(px, py, x1, y1) <= tol * tol;
        let t = ((px - x1) * vx + (py - y1) * vy) / len2;
        t = Math.max(0, Math.min(1, t));
        const qx = x1 + t * vx, qy = y1 + t * vy;
        return distSq(px, py, qx, qy) <= tol * tol;
    };

    const pointInPolygon = (px, py, vertices) => {
        if (!Array.isArray(vertices) || vertices.length < 3) return false;
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
            const xi = vertices[i].x;
            const yi = vertices[i].y;
            const xj = vertices[j].x;
            const yj = vertices[j].y;
            const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 0.00001) + xi;
            if (intersect) inside = !inside;
        }
        return inside;
    };

    const rectFromPoints = (start, end) => {
        if (!start || !end) return null;
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);
        return { x, y, width, height };
    };

    const rectsIntersect = (a, b) => {
        if (!a || !b) return false;
        if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
        const ax2 = a.x + a.width;
        const ay2 = a.y + a.height;
        const bx2 = b.x + b.width;
        const by2 = b.y + b.height;
        return ax2 >= b.x && bx2 >= a.x && ay2 >= b.y && by2 >= a.y;
    };

    const rectFromClientRect = (clientRect, toStageTransform) => {
        if (!clientRect) return null;
        if (!toStageTransform || typeof toStageTransform.point !== 'function') {
            return {
                x: clientRect.x,
                y: clientRect.y,
                width: clientRect.width,
                height: clientRect.height,
            };
        }
        const topLeft = toStageTransform.point({ x: clientRect.x, y: clientRect.y });
        const bottomRight = toStageTransform.point({
            x: clientRect.x + clientRect.width,
            y: clientRect.y + clientRect.height,
        });
        return rectFromPoints(topLeft, bottomRight);
    };

    // hit test against our shape model (axis-aligned containers)
    const pointInShape = (shape, px, py) => {
        if (!shape || shape.visible === false) return false;
        switch (shape.type) {
            case 'rectangle':
            case 'frame':
            case 'group':
                return pointInRect(px, py, shape.x || 0, shape.y || 0, shape.width || 0, shape.height || 0);
            case 'circle':
                return distSq(px, py, shape.x || 0, shape.y || 0) <= Math.pow(shape.radius || 0, 2);
            case 'ellipse': {
                const rx = Math.max(1, shape.radiusX || 0);
                const ry = Math.max(1, shape.radiusY || 0);
                const nx = (px - (shape.x || 0)) / rx;
                const ny = (py - (shape.y || 0)) / ry;
                return (nx * nx + ny * ny) <= 1;
            }
            case 'line':
            case 'path': {
                const ptsRaw = Array.isArray(shape.points) ? shape.points : [];
                const points = shape.type === 'path' ? getPathPoints(shape) : [];
                const tol = (shape.strokeWidth || 2) + 3;
                if (shape.type === 'line') {
                    for (let i = 0; i + 3 < ptsRaw.length; i += 2) {
                        if (pointNearSegment(px, py, ptsRaw[i], ptsRaw[i + 1], ptsRaw[i + 2], ptsRaw[i + 3], tol)) {
                            return true;
                        }
                    }
                    return false;
                }
                if (!points.length) return false;
                for (let i = 0; i < points.length - 1; i += 1) {
                    if (pointNearSegment(px, py, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, tol)) {
                        return true;
                    }
                }
                if (shape.closed && points.length > 2) {
                    const last = points[points.length - 1];
                    const first = points[0];
                    if (pointNearSegment(px, py, last.x, last.y, first.x, first.y, tol)) {
                        return true;
                    }
                    if (pointInPolygon(px, py, points)) {
                        return true;
                    }
                }
                return false;
            }
            case 'text': {
                // heuristic text box
                const w = Math.max(40, (String(shape.text || '').length || 4) * (shape.fontSize || 16) * 0.6);
                const h = Math.max(14, (shape.lineHeight || 1.2) * (shape.fontSize || 16));
                return pointInRect(px, py, shape.x || 0, shape.y || 0, w, h);
            }
            default:
                return false;
        }
    };

    // pick the topmost child on double-click — 3 passes: strict → visual → fallback
    const pickTopmostChildAtPoint = (container, px, py) => {
        const source = activeShapesRef.current;
        const valid = (s) => s && s.visible !== false && !s.locked && s.id !== container.id;

        // 1) true descendants under pointer (top-down)
        for (let i = source.length - 1; i >= 0; i--) {
            const s = source[i];
            if (!valid(s)) continue;
            if (!isDescendantOf(s.id, container.id, source)) continue;
            if (pointInShape(s, px, py)) return s.id;
        }

        // 2) legacy: any visible shape inside container bounds under pointer
        const bounds = {
            L: (container.x || 0) - (container.width || 0) / 2,
            R: (container.x || 0) + (container.width || 0) / 2,
            T: (container.y || 0) - (container.height || 0) / 2,
            B: (container.y || 0) + (container.height || 0) / 2,
        };
        const inside = (s) => (s.x || 0) >= bounds.L && (s.x || 0) <= bounds.R &&
            (s.y || 0) >= bounds.T && (s.y || 0) <= bounds.B;
        for (let i = source.length - 1; i >= 0; i--) {
            const s = source[i];
            if (!valid(s)) continue;
            if (!inside(s)) continue;
            if (pointInShape(s, px, py)) return s.id;
        }

        // 3) fallback: topmost true descendant (so drill-in always selects something)
        for (let i = source.length - 1; i >= 0; i--) {
            const s = source[i];
            if (!valid(s)) continue;
            if (isDescendantOf(s.id, container.id, source)) return s.id;
        }
        return null;
    };

    // Find last index matching a predicate
    const findLastIndex = (arr, pred) => {
        for (let i = arr.length - 1; i >= 0; i--) {
            if (pred(arr[i], i, arr)) return i;
        }
        return -1;
    };

    const frameLabelDragRef = useRef({ armed: false, start: null, frameId: null, evt: null });

    // Insert a new shape at the TOP of its parent (i.e., above siblings)
    // parentId null => top of root; otherwise top within that container
    const insertShapeAtTop = (prevShapes, shape) => {
        const parentKey = shape.parentId ?? null;
        const lastSibling = findLastIndex(prevShapes, s => (s.parentId ?? null) === parentKey);
        if (lastSibling === -1) {
            // no siblings yet for that parent — append
            return [...prevShapes, shape];
        }
        const next = [...prevShapes];
        next.splice(lastSibling + 1, 0, shape);
        return next;
    };

    // Move an existing shape to the TOP of its (possibly new) parent
    const moveShapeToParentTop = (prevShapes, shapeId, nextParentId) => {
        const idx = prevShapes.findIndex(s => s.id === shapeId);
        if (idx === -1) return prevShapes;
        const item = { ...prevShapes[idx], parentId: nextParentId ?? null };
        const without = [...prevShapes.slice(0, idx), ...prevShapes.slice(idx + 1)];
        return insertShapeAtTop(without, item);
    };

    // Tracks the "anchor" row for Shift-range selection in the panel
    const lastLayerAnchorIndexRef = useRef(null);

    // ---- Smooth drag (global) ----
    const dragRAFRef = useRef(0);            // active requestAnimationFrame id
    const lastDragUpdateRef = useRef(0);     // throttle state writes during drag
    const dragCtxRef = useRef({
        active: false,
        node: null,
        cached: false,
        disabledHit: false,
    });

    const rafBatchDraw = () => {
        if (dragRAFRef.current) return;
        dragRAFRef.current = requestAnimationFrame(() => {
            dragRAFRef.current = 0;
            // Batch-draw all layers at once (Konva Stage has batchDraw)
            stageRef.current?.batchDraw?.();
        });
    };

    // Build an array of the layer order *as shown in the panel*
    // (You already create layerList = [{shape, depth}, ...])
    const getLayerPanelIds = () => (layerList || []).map(({ shape }) => shape.id);

    // Select a contiguous range by panel rows
    const selectRangeByIndex = (startIdx, endIdx) => {
        const ids = getLayerPanelIds();
        if (!ids.length) return;
        const a = Math.max(0, Math.min(startIdx, endIdx));
        const b = Math.min(ids.length - 1, Math.max(startIdx, endIdx));
        const rangeIds = ids.slice(a, b + 1);
        setSelectedIds(rangeIds);
        setSelectedId(rangeIds[rangeIds.length - 1] ?? null); // last clicked becomes primary
    };

    // IDs to apply changes to: prefer multi, else single
    const getActiveSelectionIds = () =>
        selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);

    // Keep a Set for fast membership checks inside effects
    const selectionSetRef = useRef(new Set());
    useEffect(() => {
        selectionSetRef.current = new Set(getActiveSelectionIds());
    }, [selectedIds, selectedId]);

    // Normalize parent key (null for root)
    const parentKeyOf = (s) => (s?.parentId ?? null);

    // Reorder *siblings* for a given parent so that panel Top→Bottom
    // becomes canvas Bottom→Top (because later-drawn = on top).
    const reorderSiblingsToMatchPanel = (prevShapes, parentId, panelTopToBottomIds) => {
        const pkey = parentId ?? null;
        const sibSet = new Set(panelTopToBottomIds);

        // indices where these siblings currently live (to keep block location stable)
        const idxs = prevShapes
            .map((s, i) => ((parentKeyOf(s) === pkey && sibSet.has(s.id)) ? i : -1))
            .filter(i => i !== -1);

        if (idxs.length === 0) return prevShapes; // nothing to do

        const firstIdx = Math.min(...idxs);
        const bottomToTopIds = [...panelTopToBottomIds].reverse();

        // Build fast lookup for siblings by id
        const byId = {};
        for (const s of prevShapes) byId[s.id] = s;

        // Remove siblings from the array
        const withoutSibs = prevShapes.filter(s => !(parentKeyOf(s) === pkey && sibSet.has(s.id)));

        // Split at the original first sibling position (so block doesn’t jump across other parents)
        const before = withoutSibs.slice(0, firstIdx);
        const after = withoutSibs.slice(firstIdx);

        // Put siblings back in bottom→top order (so last drawn = panel top)
        const reorderedSibs = bottomToTopIds.map(id => byId[id]).filter(Boolean);

        return [...before, ...reorderedSibs, ...after];
    };

    // Convenience: apply the reorder with history entry
    const applyPanelOrderToCanvas = (parentId, panelTopToBottomIds) => {
        applyChange((prev) => reorderSiblingsToMatchPanel(prev, parentId, panelTopToBottomIds));
    };

    // Render a label above a frame (non-interactive)
    const renderFrameNameLabel = (frame) => {
        if (hasFrameAncestor(frame)) return null;
        const width = Math.max(1, frame.width || 1);
        const height = Math.max(1, frame.height || 1);
        // If your frame.x / frame.y are TOP-LEFT already, set useTopLeft = true.
        const useTopLeft = false; // flip to true if your data is top-left based

        // Current canvas zoom (you already pass this to <Stage scaleX/scaleY={scale}>)
        const s = Math.max(0.01, scale || 1);   // stage scale
        const inv = 1 / s;                      // inverse scale for constant-size UI

        // helper: snap a scene coordinate so it lands on whole pixels after Stage scale
        const snapSceneToPixel = (sceneCoord) => Math.round(sceneCoord * s) / s;

        const xLeft = (frame.x || 0) - (useTopLeft ? 0 : width / 2);
        const yTop = (frame.y || 0) - (useTopLeft ? 0 : height / 2);

        // visual metrics (in screen px)
        const fontSize = 11;
        const paddingXpx = 4;
        const hitHpx = fontSize + 8;
        const gapPx = 6;

        // convert pixel gap to scene units; snap for pan stability
        const labelYScene = snapSceneToPixel(yTop - (hitHpx + gapPx) * inv);

        const label = (frame.name?.trim()) || `Frame ${frame.id}`;

        return (
            <Group
                key={`frame-label-${frame.id}`}
                x={snapSceneToPixel(xLeft)}
                y={labelYScene}
                // Scale content inversely so it stays constant-size on screen
                scaleX={inv}
                scaleY={inv}
                onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'pointer'; }}
                onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                onMouseDown={(e) => {
                    e.cancelBubble = true;
                    selectSingle(frame.id);

                    const stage = e.target.getStage?.();
                    const pos = stage?.getPointerPosition?.() || null;

                    frameLabelDragRef.current = {
                        armed: true,
                        start: pos,
                        frameId: frame.id,
                        evt: e.evt, // save native event for startDrag later
                    };
                }}
            >
                {/* Transparent hit area for easy clicking */}
                <Rect
                    x={0}
                    y={0}
                    width={Math.max(100, width)}
                    height={hitHpx}
                    fill="rgba(0,0,0,0.001)"        // minimal alpha so it receives events
                    cornerRadius={4}
                    perfectDrawEnabled={false}
                    shadowForStrokeEnabled={false}
                />
                <Text
                    x={paddingXpx}
                    y={(hitHpx - fontSize) / 2 - 1} // vertically center text
                    width={width - paddingXpx}
                    text={label}
                    align="left"                   // ← left aligned as requested
                    fontFamily="Inter"
                    fontSize={fontSize}
                    fill="#334155"
                    listening={false}              // clicks go to the Rect, not the Text
                    perfectDrawEnabled={false}
                    shadowForStrokeEnabled={false}
                />
            </Group >
        );
    };

    useEffect(() => {
        const moveThreshold = 4;

        const handleMove = () => {
            const armed = frameLabelDragRef.current;
            if (!armed.armed || !armed.start) return;

            const stage = stageRef.current;
            const pos = stage?.getPointerPosition?.();
            if (!pos) return;

            const dx = pos.x - armed.start.x;
            const dy = pos.y - armed.start.y;
            if ((dx * dx + dy * dy) < (moveThreshold * moveThreshold)) return;

            const node = stage.findOne(`#shape-${armed.frameId}`);
            if (node && node.draggable && node.draggable()) {
                try { node.startDrag(armed.evt); } catch { }
            }
            frameLabelDragRef.current.armed = false; // disarm
        };

        const handleUp = () => {
            // mouse released without moving enough → just a click (selection already done)
            frameLabelDragRef.current = { armed: false, start: null, frameId: null, evt: null };
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, []);


    useEffect(() => {
        const moveThreshold = 4;

        const handleMove = () => {
            const armed = frameLabelDragRef.current;
            if (!armed.armed || !armed.start) return;

            const stage = stageRef.current;
            const pos = stage?.getPointerPosition?.();
            if (!pos) return;

            const dx = pos.x - armed.start.x;
            const dy = pos.y - armed.start.y;
            if ((dx * dx + dy * dy) < (moveThreshold * moveThreshold)) return;

            const node = stage.findOne(`#shape-${armed.frameId}`);
            if (node && node.draggable && node.draggable()) {
                try { node.startDrag(armed.evt); } catch { }
            }
            frameLabelDragRef.current.armed = false; // disarm
        };

        const handleUp = () => {
            // mouse released without moving enough → just a click (selection already done)
            frameLabelDragRef.current = { armed: false, start: null, frameId: null, evt: null };
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, []);

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
        const parentShape =
            parentId != null ? shapesRef.current.find((shape) => shape.id === parentId) : null;
        const resolvedPageId =
            overrides.pageId ??
            (parentShape && parentShape.pageId
                ? parentShape.pageId
                : activePageRef.current || pagesRef.current[0]?.id || null);
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
            pageId: resolvedPageId,
            ...overrides,
        };
        return shape;
    };

    const getShapeById = (id, source = activeShapesRef.current) => {
        if (id == null) return null;
        return source.find((shape) => shape.id === id) || null;
    };

    const updatePathShape = useCallback(
        (shapeId, mutator, options = {}) => {
            if (!shapeId || typeof mutator !== 'function') return;

            const applyUpdater = (source) =>
                source.map((shape) => {
                    if (shape.id !== shapeId || shape.type !== 'path') {
                        return shape;
                    }

                    const currentPoints = getPathPoints(shape);
                    const result = mutator(clonePathPoints(currentPoints), shape);
                    if (!result) {
                        return shape;
                    }

                    let nextShape;

                    if (Array.isArray(result)) {
                        nextShape = { ...shape, points: result };
                    } else if (typeof result === 'object') {
                        const nextPoints = Array.isArray(result.points)
                            ? result.points
                            : clonePathPoints(currentPoints);
                        const { points: _ignored, ...rest } = result;
                        nextShape = { ...shape, ...rest, points: nextPoints };
                    } else {
                        return shape;
                    }

                    // 👉 mark that this path has actually been edited via path ops
                    if (!shape._pathWasEdited) {
                        nextShape = { ...nextShape, _pathWasEdited: true };
                    }

                    if (nextShape.__pathCornerBase || Number(nextShape.cornerRadius) > 0) {
                        nextShape = { ...nextShape };
                        if (nextShape.__pathCornerBase) {
                            delete nextShape.__pathCornerBase;
                        }
                        if (Number.isFinite(nextShape.cornerRadius)) {
                            nextShape.cornerRadius = 0;
                        }
                    }

                    return nextShape;
                });

            if (options.commit) {
                const baseState = options.baseState || shapesRef.current;
                applyChange(applyUpdater, { baseState });
            } else {
                setShapes((prev) => applyUpdater(prev));
            }
        },
        [applyChange]
    );

    const setPathPointType = useCallback(
        (shapeId, index, nextType, options = {}) => {
            if (!shapeId || index == null) return;
            updatePathShape(
                shapeId,
                (pts) => {
                    if (!pts[index]) return pts;
                    const next = pts.slice();
                    const point = ensureHandlesForType({ ...pts[index], type: nextType });
                    if (nextType === PATH_NODE_TYPES.CORNER) {
                        delete point.handles;
                    }
                    next[index] = point;
                    return next;
                },
                options
            );
        },
        [updatePathShape]
    );

    const beginLineAnchorDrag = useCallback((shapeId, pointIndex) => {
        if (!shapeId) return;
        const shape = shapesRef.current.find((s) => s.id === shapeId && s.type === 'line');
        if (!shape) return;
        const basePoints = Array.isArray(shape.points) ? [...shape.points] : [];
        lineAnchorDragRef.current = {
            shapeId,
            pointIndex,
            basePoints,
            baseState: shapesRef.current.map((s) => ({ ...s })),
            hasChanged: false,
        };
    }, []);

    const updateLineAnchorFromPointer = useCallback((shapeId, pointIndex, pointer) => {
        if (!shapeId || !pointer) return;
        setShapes((prev) =>
            prev.map((shape) => {
                if (shape.id !== shapeId || shape.type !== 'line') return shape;
                const ctx = lineAnchorDragRef.current;
                const sourcePoints = ctx && ctx.shapeId === shapeId
                    ? ctx.basePoints
                    : Array.isArray(shape.points)
                        ? shape.points
                        : [];
                const nextPoints = sourcePoints.slice();
                const idx = pointIndex * 2;
                if (idx >= nextPoints.length) {
                    return shape;
                }
                const nextX = pointer.x;
                const nextY = pointer.y;
                if (ctx && ctx.shapeId === shapeId) {
                    const prevX = Number(sourcePoints[idx]);
                    const prevY = Number(sourcePoints[idx + 1]);
                    if (
                        !ctx.hasChanged &&
                        (Math.abs((Number.isFinite(prevX) ? prevX : 0) - nextX) > 0.01 ||
                            Math.abs((Number.isFinite(prevY) ? prevY : 0) - nextY) > 0.01)
                    ) {
                        ctx.hasChanged = true;
                    }
                    ctx.pointIndex = pointIndex;
                }
                nextPoints[idx] = nextX;
                nextPoints[idx + 1] = nextY;
                if (ctx && ctx.shapeId === shapeId) {
                    ctx.previewPoints = nextPoints;
                }
                return { ...shape, points: nextPoints, x: 0, y: 0 };
            })
        );
    }, []);

    const commitLineAnchorDrag = useCallback(() => {
        const ctx = lineAnchorDragRef.current;
        if (!ctx) return;
        lineAnchorDragRef.current = null;
        if (!ctx.hasChanged) {
            return;
        }
        const finalShape = shapesRef.current.find((s) => s.id === ctx.shapeId && s.type === 'line');
        const finalPoints = Array.isArray(finalShape?.points) ? finalShape.points : [];
        let changed = false;
        if (finalPoints.length !== ctx.basePoints.length) {
            changed = true;
        } else {
            for (let i = 0; i < finalPoints.length; i += 1) {
                if (Math.abs(finalPoints[i] - ctx.basePoints[i]) > 0.01) {
                    changed = true;
                    break;
                }
            }
        }
        if (!changed) {
            return;
        }
        const snapshot = shapesRef.current.map((shape) => ({ ...shape }));
        applyChange(snapshot, { baseState: ctx.baseState });
    }, [applyChange]);

    const movePathAnchor = useCallback(
        (shapeId, index, position, options = {}) => {
            if (!shapeId || index == null || !position) return;
            updatePathShape(
                shapeId,
                (pts) => {
                    if (!pts[index]) return pts;
                    const next = pts.slice();
                    const current = clonePathPoint(next[index]);
                    const dx = position.x - current.x;
                    const dy = position.y - current.y;
                    current.x = position.x;
                    current.y = position.y;
                    if (current.handles) {
                        if (current.handles.left) {
                            current.handles.left = {
                                x: current.handles.left.x + dx,
                                y: current.handles.left.y + dy,
                            };
                        }
                        if (current.handles.right) {
                            current.handles.right = {
                                x: current.handles.right.x + dx,
                                y: current.handles.right.y + dy,
                            };
                        }
                    }
                    next[index] = current;
                    return next;
                },
                options
            );
        },
        [updatePathShape]
    );

    const movePathHandle = useCallback(
        (shapeId, index, side, position, altKey = false, options = {}) => {
            if (!shapeId || index == null || !position || !side) return;
            updatePathShape(
                shapeId,
                (pts) => {
                    if (!pts[index]) return pts;
                    const next = pts.slice();
                    let point = ensureHandlesForType({ ...pts[index] });
                    if (point.type === PATH_NODE_TYPES.CORNER) {
                        point.type = altKey ? PATH_NODE_TYPES.DISCONNECTED : PATH_NODE_TYPES.SMOOTH;
                    }
                    point.handles = point.handles || {};
                    point.handles[side] = { x: position.x, y: position.y };
                    if (!altKey && point.type === PATH_NODE_TYPES.SMOOTH) {
                        point = updateHandleSymmetry(point, side);
                    }
                    next[index] = point;
                    return next;
                },
                options
            );
        },
        [updatePathShape]
    );

    const convertShapeToPath = useCallback(
        (shapeId) => {
            if (!shapeId) return null;
            const currentShapes = shapesRef.current;
            const index = currentShapes.findIndex((shape) => shape.id === shapeId);
            if (index === -1) return null;
            const shape = currentShapes[index];
            if (!shape || shape.type === 'path') return shape;
            if (!canConvertShapeToPath(shape)) return null;

            // 👉 capture the original geometry so we can restore it later
            const originalGeometry = {
                type: shape.type,
                x: shape.x,
                y: shape.y,
                width: shape.width,
                height: shape.height,
                radius: shape.radius,
                radiusX: shape.radiusX,
                radiusY: shape.radiusY,
                sides: shape.sides,
                cornerRadius: shape.cornerRadius,
                cornerRadii: shape.cornerRadii,
                cornerSmoothing: shape.cornerSmoothing,
                rotation: shape.rotation,
                points: Array.isArray(shape.points) ? [...shape.points] : undefined,
                closed: shape.closed,
            };

            const derived = shapeToPath(shape);
            if (!derived || !Array.isArray(derived.points) || derived.points.length === 0) {
                return null;
            }

            const nextPoints = derived.points.map((point) => clonePathPoint(point));
            let nextShape = {
                ...shape,
                type: 'path',
                points: nextPoints,
                closed:
                    derived.closed != null
                        ? derived.closed
                        : shape.type !== 'line' && nextPoints.length > 2,
                // 👉 metadata for restoring later
                __pathOriginal: originalGeometry,
                _pathWasEdited: false,
            };

            if (derived.lineCap) nextShape.lineCap = derived.lineCap;
            if (derived.lineJoin) nextShape.lineJoin = derived.lineJoin;

            // path no longer uses these, but we kept them inside __pathOriginal
            delete nextShape.width;
            delete nextShape.height;
            delete nextShape.radius;
            delete nextShape.radiusX;
            delete nextShape.radiusY;

            const nextState = currentShapes.map((s, idx) => (idx === index ? nextShape : s));
            applyChange(() => nextState, { baseState: currentShapes });
            return nextShape;
        },
        [applyChange]
    );


    const ensureAnchorEditableShape = useCallback(
        (shapeId) => {
            if (!shapeId) return null;
            const current = shapesRef.current.find((shape) => shape.id === shapeId) || null;
            if (!current) return null;
            if (current.type === 'path') {
                return current;
            }
            if (!canConvertShapeToPath(current)) {
                return null;
            }
            return convertShapeToPath(shapeId);
        },
        [convertShapeToPath]
    );

    const enterAnchorModeForShape = useCallback(
        (shapeId) => {
            if (!shapeId) return null;
            const editable = ensureAnchorEditableShape(shapeId);
            if (!editable) return null;
            const targetId = editable.id;
            setSelectedId(targetId);
            setSelectedIds([targetId]);
            setActivePathSelection((prev) => (prev?.shapeId === targetId ? prev : null));
            if (typeof onToolChange === 'function') {
                onToolChange('anchor');
            }
            pathInteractionRef.current = {
                shapeId: targetId,
                pendingPoint: null,
                draggingHandle: null,
                baseState: null,
                containerId: editable.parentId ?? null,
            };
            return editable;
        },
        [ensureAnchorEditableShape, onToolChange]
    );

    const getParentShape = (shape, source = activeShapesRef.current) => {
        if (!shape || shape.parentId == null) return null;
        return getShapeById(shape.parentId, source);
    };

    const getContainerAncestor = (shape, source = activeShapesRef.current) => {
        let current = shape;
        while (current) {
            if (isContainerShape(current)) return current;
            current = getParentShape(current, source);
        }
        return null;
    };

    const getContainerPathForId = (shapeId, source = activeShapesRef.current) => {
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

    const isDescendantOf = (shapeId, ancestorId, source = activeShapesRef.current) => {
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

    const findContainerAtPoint = (point, excludedIds = new Set(), source = activeShapesRef.current) => {
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

    // Remove any groups that have no children
    function pruneEmptyGroups(shapes) {
        const allGroupIds = new Set(shapes.filter(s => s.type === 'group').map(s => s.id));
        const hasChild = new Map([...allGroupIds].map(id => [id, false]));

        for (const s of shapes) {
            if (s.parentId && hasChild.has(s.parentId)) {
                hasChild.set(s.parentId, true);
            }
        }

        const keepIds = new Set();
        shapes.forEach(s => {
            if (s.type !== 'group') keepIds.add(s.id);
            else if (hasChild.get(s.id)) keepIds.add(s.id);
        });

        return shapes.filter(s => keepIds.has(s.id));
    }

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
            case 'path': {
                const points = getPathPoints(shape);
                const scaledPoints = points.map((point) => {
                    const nextPoint = clonePathPoint(point);
                    nextPoint.x = nextX + (point.x - prevX) * scaleX;
                    nextPoint.y = nextY + (point.y - prevY) * scaleY;
                    if (point.handles) {
                        nextPoint.handles = {};
                        if (point.handles.left) {
                            nextPoint.handles.left = {
                                x: nextX + (point.handles.left.x - prevX) * scaleX,
                                y: nextY + (point.handles.left.y - prevY) * scaleY,
                            };
                        }
                        if (point.handles.right) {
                            nextPoint.handles.right = {
                                x: nextX + (point.handles.right.x - prevX) * scaleX,
                                y: nextY + (point.handles.right.y - prevY) * scaleY,
                            };
                        }
                        if (!nextPoint.handles.left && !nextPoint.handles.right) {
                            delete nextPoint.handles;
                        }
                    }
                    return nextPoint;
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
    const MAX_SCALE = 256;
    const MIN_STAGE_WIDTH = 120;
    const MIN_STAGE_HEIGHT = 200;
    const [layerPanelWidth, setLayerPanelWidth] = useState(LAYER_PANEL_DEFAULT_WIDTH)
    const [pagesSectionHeight, setPagesSectionHeight] = useState(PAGES_SECTION_DEFAULT_HEIGHT)

    const [stageSize, setStageSize] = useState({ width: 800, height: 600 });

    const marqueeStateRef = useRef({ active: false, start: null, end: null });
    const [marqueeRect, setMarqueeRect] = useState(null);

    const resetMarquee = useCallback(() => {
        marqueeStateRef.current = { active: false, start: null, end: null };
        setMarqueeRect(null);
    }, []);

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

    useEffect(() => {
        const panel = sidePanelRef.current;
        if (!panel) return undefined;

        const updateHeightConstraints = () => {
            const rect = panel.getBoundingClientRect();
            const maxHeight = rect.height - LAYERS_SECTION_MIN_HEIGHT;
            const upperBound = Math.max(PAGES_SECTION_MIN_HEIGHT, maxHeight);
            setPagesSectionHeight((current) =>
                clampValue(current, PAGES_SECTION_MIN_HEIGHT, upperBound)
            );
        };

        updateHeightConstraints();
        window.addEventListener('resize', updateHeightConstraints);

        return () => {
            window.removeEventListener('resize', updateHeightConstraints);
        };
    }, [sidePanelRef, setPagesSectionHeight]);

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

    const selectedShape = useMemo(
        () => shapes.find((s) => s.id === selectedId) || null,
        [shapes, selectedId]
    );

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
            const cleaned = pruneEmptyGroups(next);
            // ---- no-op guards (stop churn/loops) ----
            if (next === prev) return;
            if (Array.isArray(prev) && Array.isArray(next) && prev.length === next.length) {
                let same = true;
                for (let i = 0; i < prev.length; i++) {
                    if (prev[i] !== next[i]) { same = false; break; }
                }
                if (same) return;
            }
            const baseState = options.baseState || prev;
            pastRef.current.push(baseState);
            if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
            futureRef.current = [];
            setShapes(cleaned);
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

    const generatePageName = useCallback(() => {
        const base = 'Page';
        const used = new Set();
        pagesRef.current.forEach((page) => {
            const match = /^Page\s+(\d+)$/.exec(page.name);
            if (match) {
                used.add(Number.parseInt(match[1], 10));
            }
        });
        let index = 1;
        while (used.has(index)) {
            index += 1;
        }
        return `${base} ${index}`;
    }, []);

    const handleAddPage = useCallback(() => {
        const createdAt = Date.now();
        const id = `page-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
        const name = generatePageName();
        const newPage = { id, name, createdAt };
        setPages((prev) => [...prev, newPage]);
        setActivePageId(newPage.id);
    }, [generatePageName]);

    const handleActivatePage = useCallback((pageId) => {
        if (!pageId || pageId === activePageRef.current) return;
        if (!pagesRef.current.some((page) => page.id === pageId)) return;
        setActivePageId(pageId);
    }, []);

    const handleRenamePage = useCallback((pageId, nextName) => {
        if (!pageId) return;
        const trimmed = nextName ? nextName.trim() : '';
        if (!trimmed) return;
        setPages((prev) => prev.map((page) => (page.id === pageId ? { ...page, name: trimmed } : page)));
    }, []);

    const handleReorderPages = useCallback((sourceId, targetId, placeAfter) => {
        if (!sourceId || !targetId || sourceId === targetId) return;
        setPages((prev) => {
            const sourceIndex = prev.findIndex((page) => page.id === sourceId);
            const targetIndex = prev.findIndex((page) => page.id === targetId);
            if (sourceIndex === -1 || targetIndex === -1) return prev;
            const updated = [...prev];
            const [item] = updated.splice(sourceIndex, 1);
            let insertIndex = updated.findIndex((page) => page.id === targetId);
            if (insertIndex === -1) {
                updated.splice(sourceIndex, 0, item);
                return updated;
            }
            if (placeAfter) insertIndex += 1;
            updated.splice(insertIndex, 0, item);
            return updated;
        });
    }, []);

    const makePageCopyName = useCallback((baseName) => {
        const existing = new Set(pagesRef.current.map((page) => page.name));
        let attempt = `${baseName} Copy`;
        let suffix = 2;
        while (existing.has(attempt)) {
            attempt = `${baseName} Copy ${suffix}`;
            suffix += 1;
        }
        return attempt;
    }, []);

    const handleDuplicatePage = useCallback(
        (pageId) => {
            const sourcePage = pagesRef.current.find((page) => page.id === pageId);
            if (!sourcePage) return;
            const createdAt = Date.now();
            const id = `page-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
            const name = makePageCopyName(sourcePage.name || 'Page');
            const newPage = { id, name, createdAt };
            setPages((prev) => [...prev, newPage]);

            const sourceShapes = shapesRef.current.filter((shape) => (shape.pageId || sourcePage.id) === sourcePage.id);
            if (sourceShapes.length) {
                const idMap = new Map();
                const clones = sourceShapes.map((shape) => {
                    const newId = allocateShapeId();
                    idMap.set(shape.id, newId);
                    return { ...shape, id: newId };
                });
                const remapped = clones.map((shape) => ({
                    ...shape,
                    parentId: shape.parentId != null ? idMap.get(shape.parentId) ?? null : null,
                    pageId: id,
                    name: shape.name ? `${shape.name} Copy` : shape.name,
                }));
                applyChange((prev) => [...prev, ...remapped]);
            }

            setActivePageId(id);
        },
        [allocateShapeId, applyChange, makePageCopyName]
    );

    // 🟢 Duplicate selected shapes (Ctrl/Cmd + D)
    function handleDuplicate() {
        if (!selectedIds?.length) return;

        setShapes(prev => {
            const now = Date.now();
            const clones = [];
            let maxId = Math.max(0, ...prev.map(s => s.id));

            selectedIds.forEach(id => {
                const src = prev.find(s => s.id === id);
                if (!src) return;

                maxId += 1;
                const baseName = src.name || `${src.type}-${src.id}`;
                const newName = baseName.endsWith('copy') ? `${baseName} 2` : `${baseName} copy`;

                clones.push({
                    ...src,
                    id: maxId,
                    name: newName,
                    x: (src.x ?? 0) + 20,    // slight offset so it’s visible
                    y: (src.y ?? 0) + 20,
                    selected: false,
                });
            });

            // push the new clones to the end
            return [...prev, ...clones];
        });

        // auto-select the duplicated shape(s)
        setSelectedIds(prev => {
            const all = shapesRef.current || [];
            const maxId = Math.max(0, ...all.map(s => s.id));
            return [maxId]; // select the newest one if only one; works fine for multiples too
        });
    }

    const handleDeletePage = useCallback(
        (pageId, { mode = null, targetPageId = null } = {}) => {
            const currentPages = pagesRef.current;
            if (!pageId || currentPages.length <= 1) {
                window.alert('Cannot delete the last remaining page.');
                return;
            }
            const remaining = currentPages.filter((page) => page.id !== pageId);
            if (!remaining.length) return;
            let resolvedMode = mode;
            let destinationId = targetPageId;
            if (!resolvedMode) {
                const fallback = destinationId && remaining.some((page) => page.id === destinationId)
                    ? destinationId
                    : remaining[0].id;
                const confirmMove = window.confirm('Move layers to another page?\nOK to move, Cancel to delete layers.');
                resolvedMode = confirmMove ? 'move' : 'delete';
                destinationId = fallback;
            }
            if (resolvedMode === 'move') {
                const fallback = destinationId && remaining.some((page) => page.id === destinationId)
                    ? destinationId
                    : remaining[0].id;
                destinationId = fallback;
                applyChange((prev) =>
                    prev.map((shape) =>
                        (shape.pageId === pageId ? { ...shape, pageId: destinationId } : shape)
                    )
                );
            } else {
                applyChange((prev) => prev.filter((shape) => shape.pageId !== pageId));
            }
            setPages((prev) => prev.filter((page) => page.id !== pageId));
            if (activePageRef.current === pageId) {
                const nextPageId = destinationId && destinationId !== pageId ? destinationId : remaining[0]?.id;
                if (nextPageId) {
                    setActivePageId(nextPageId);
                }
            }
        },
        [applyChange]
    );

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
        if (isSelectLikeTool || selectedId == null) return;
        if (isDrawingRef.current) return;
        setSelectedId(null);
    }, [isSelectLikeTool, selectedId, selectedTool]);

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

            if (e.key === 'Enter' && isSelectLikeTool) {
                const primaryId = selectedId ?? (selectedIds.length ? selectedIds[selectedIds.length - 1] : null);
                if (primaryId) {
                    const shape = shapesRef.current.find((s) => s.id === primaryId);
                    if (shape) {
                        if (shape.type === 'text') {
                            e.preventDefault();
                            openTextEditor(shape.id);
                            return;
                        }
                        if (shape.type === 'path' || canConvertShapeToPath(shape)) {
                            e.preventDefault();
                            enterAnchorModeForShape(primaryId);
                            return;
                        }
                    }
                }
            }

            if (e.key === 'Escape' && selectedTool === 'anchor') {
                e.preventDefault();
                if (typeof onToolChange === 'function') {
                    onToolChange('select');
                }
                setActivePathSelection(null);
                pathInteractionRef.current = {
                    shapeId: null,
                    pendingPoint: null,
                    draggingHandle: null,
                    baseState: null,
                    containerId: null,
                };
                return;
            }

            if ((e.key === 'Enter' || e.key === 'Escape') && selectedTool === 'path') {
                const state = pathInteractionRef.current;
                if (state && state.shapeId) {
                    e.preventDefault();
                    const shape = shapesRef.current.find(
                        (s) => s.id === state.shapeId && s.type === 'path'
                    );
                    if (shape && (!Array.isArray(shape.points) || shape.points.length <= 1)) {
                        applyChange((prev) => prev.filter((s) => s.id !== shape.id));
                        setSelectedId(null);
                        setSelectedIds([]);
                    }
                    setActivePathSelection(null);
                    pathInteractionRef.current = {
                        shapeId: null,
                        pendingPoint: null,
                        draggingHandle: null,
                        baseState: null,
                        containerId: null,
                    };
                }
                return;
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (activePathSelection && activePathSelection.shapeId != null) {
                    const { shapeId, index } = activePathSelection;
                    const shape = shapesRef.current.find(
                        (s) => s.id === shapeId && s.type === 'path'
                    );
                    if (shape) {
                        e.preventDefault();
                        const points = getPathPoints(shape);
                        if (index >= 0 && index < points.length) {
                            if (points.length <= 1) {
                                applyChange((prev) => prev.filter((s) => s.id !== shape.id));
                                setSelectedId(null);
                                setSelectedIds([]);
                            } else {
                                const closed = shape.closed === true && points.length > 3;
                                updatePathShape(
                                    shape.id,
                                    (pts) => ({
                                        points: pts.filter((_, idx) => idx !== index),
                                        closed: closed && pts.length - 1 >= 3,
                                    }),
                                    { commit: true }
                                );
                            }
                        }
                        setActivePathSelection(null);
                        return;
                    }
                }
                if (selectedIds.length || selectedId) {
                    e.preventDefault();
                    const idsToRemove = new Set(selectedIds.length ? selectedIds : [selectedId]);
                    applyChange((prev) => prev.filter((shape) => !idsToRemove.has(shape.id)));
                    setSelectedId(null);
                    setSelectedIds([]);
                    return;
                }
            }

            // 🟢 Duplicate (Ctrl/Cmd + D)
            if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleDuplicate();
                return;
            }

            // Copy
            if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
                if (!selectedIds?.length) return;
                e.preventDefault();
                const selectedShapes = shapesRef.current.filter(s => selectedIds.includes(s.id));
                clipboardRef.current = selectedShapes.map(s => ({ ...s }));
                cutPendingRef.current = null;
                clipboardMetaRef.current = { mode: 'copy' };
                return;
            }

            // Cut
            if ((e.key === 'x' || e.key === 'X') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (!selectedIds?.length) return;

                // 1) Put current selection in clipboard (shallow copies are fine)
                const selectedShapes = shapesRef.current.filter(s =>
                    selectedIds.includes(s.id)
                );
                clipboardRef.current = selectedShapes.map(s => ({ ...s }));

                // 2) Build a removal set that includes descendants (for groups/frames)
                const toRemove = new Set(selectedIds);
                const snapshot = shapesRef.current;
                selectedIds.forEach(id => {
                    collectDescendantIds(snapshot, id).forEach(cid => toRemove.add(cid));
                });

                // 3) Remove immediately in a single history entry
                applyChange(prev => prev.filter(s => !toRemove.has(s.id)));

                // 4) Clear selection (nothing remains on canvas)
                setSelectedIds([]);

                // 5) We don't need cutPendingRef anymore since originals are gone
                cutPendingRef.current = null;
                clipboardMetaRef.current = { mode: 'cut' };
                return;
            }

            // Paste
            if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const clip = clipboardRef.current;
                if (!clip || !clip.length) return;

                const newIds = [];
                const wasCut = clipboardMetaRef.current?.mode === 'cut'; // ✅ reliable

                applyChange((prev) => {
                    let next = [...prev];

                    // 1) Add clones (based on the latest prev, not shapesRef)
                    clip.forEach((shape) => {
                        const clones = cloneShape(shape, prev, { preserveName: wasCut }); // cut = preserve, copy = re-number
                        clones.forEach((clone) => {
                            // slight offset so paste is visible
                            clone.x = (clone.x || 0) + 20;
                            clone.y = (clone.y || 0) + 20;
                            next.push(clone);
                            newIds.push(clone.id);
                        });
                    });

                    // 2) If this was a cut, remove originals (and their descendants)
                    if (wasCut) {
                        const originals = new Set(cutPendingRef.current);
                        // also remove their descendants to avoid orphans
                        for (const id of Array.from(originals)) {
                            collectDescendantIds(prev, id).forEach((cid) => originals.add(cid));
                        }
                        next = next.filter((s) => !originals.has(s.id));
                    }

                    return next;
                });

                // 3) Clear cut flag and select the new clones
                if (wasCut) { clipboardMetaRef.current = { mode: 'copy' }; }
                setSelectedIds(newIds);
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
            if (e.key === 'Enter') {
                const primaryId = selectedId != null ? selectedId : selectedIds[selectedIds.length - 1];
                const primaryShape = getShapeById(primaryId, shapesRef.current);
                if (primaryShape && isContainerShape(primaryShape) && !primaryShape.locked) {
                    e.preventDefault();
                    const path = getContainerPathForId(primaryShape.id, shapesRef.current);
                    setActiveContainerPath([null, ...path]);
                    const snapshot = shapesRef.current;
                    let childId = null;
                    for (let index = snapshot.length - 1; index >= 0; index -= 1) {
                        const candidate = snapshot[index];
                        if (candidate.parentId === primaryShape.id && candidate.visible !== false) {
                            childId = candidate.id;
                            break;
                        }
                    }
                    const nextId = childId ?? primaryShape.id;
                    setSelectedId(nextId);
                    setSelectedIds([nextId]);
                    const panelIds = getLayerPanelIds();
                    const anchorIndex = panelIds.indexOf(nextId);
                    lastLayerAnchorIndexRef.current = anchorIndex >= 0 ? anchorIndex : null;
                }
                return;
            }
            if (!ctrlOrMeta) return;

            if ((e.key === 'g' || e.key === 'G') && (e.ctrlKey || e.metaKey)) {
                console.log("not bad");
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey) {
                    ungroupSelectedLayers();
                } else {
                    groupSelectedLayers();
                }
                return;
            }

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
    }, [
        activePathSelection,
        applyChange,
        getLayerPanelIds,
        groupSelectedLayers,
        selectedTool,
        redo,
        selectedId,
        selectedIds,
        setActivePathSelection,
        shapesRef,
        undo,
        ungroupSelectedLayers,
        updatePathShape,
        enterAnchorModeForShape,
        onToolChange,
    ]);

    useEffect(() => {
        if (!selectedId) {
            setActivePathSelection(null);
            return;
        }
        const shape = shapesRef.current.find((s) => s.id === selectedId);
        if (!shape || shape.type !== 'path') {
            setActivePathSelection(null);
        }
    }, [selectedId, shapes]);

    useEffect(() => {
        if (selectedTool !== 'anchor') return;
        const primaryId = selectedId ?? (selectedIds.length ? selectedIds[selectedIds.length - 1] : null);
        if (!primaryId) return;
        enterAnchorModeForShape(primaryId);
    }, [enterAnchorModeForShape, selectedId, selectedIds, selectedTool]);

    useEffect(() => {
        if (selectedTool !== 'path' && selectedTool !== 'anchor') {
            pathInteractionRef.current = {
                shapeId: null,
                pendingPoint: null,
                draggingHandle: null,
                baseState: null,
                containerId: null,
            };
        }
    }, [selectedTool]);

    useEffect(() => {
        const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
        if (!ids.length) return;

        // Only apply on shapes that can have fills
        const supportsFill = new Set([
            'rectangle',
            'circle',
            'ellipse',
            'polygon',
            'roundedPolygon',
            'text',
            'frame',
            'path',
        ]);
        const idsSet = new Set(ids);

        // Respect live-preview metadata (prevents color ping-pong)
        const meta = fillStyle?.meta || null;
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

        // If this effect is firing due to simple selection-sync (no meta), ignore it
        if (!meta) return;

        // Target style to apply
        const targetGradient =
            resolvedFillType === 'gradient' && resolvedFillGradient
                ? normalizeGradient(resolvedFillGradient)
                : null;

        const updater = (source) =>
            source.map((s) => {
                if (!idsSet.has(s.id) || !supportsFill.has(s.type)) return s;

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

        if (isPreview) {
            // Begin/continue preview without pushing history
            if (
                !fillPreviewRef.current ||
                fillPreviewRef.current.interactionId !== interactionId
            ) {
                fillPreviewRef.current = {
                    interactionId,
                    baseState: shapesRef.current,
                    isPreview: true,
                };
            } else {
                fillPreviewRef.current.isPreview = true;
            }
            setShapes((prev) => updater(prev));
            return;
        }

        if (isFinalizing) {
            // Commit preview as a single history entry
            const baseState = fillPreviewRef.current?.baseState || shapesRef.current;
            fillPreviewRef.current = null;
            applyChange(updater, { baseState });
            return;
        }

        // Non-preview, user-initiated direct change (with meta) -> record normally
        applyChange(updater);
    }, [
        applyChange,
        fillStyle?.meta,
        resolvedFillColor,
        resolvedFillGradient,
        resolvedFillType,
        selectedIds,
        selectedId
    ]);

    useEffect(() => {
        const prevStrokeVersion = strokeWidthVersionRef.current;
        strokeWidthVersionRef.current = strokeWidthVersion;

        // Active selection (multi preferred, else single)
        const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
        if (!ids.length) return;

        // Shapes that can have stroke
        const supportsStroke = new Set([
            'rectangle',
            'circle',
            'ellipse',
            'polygon',
            'roundedPolygon',
            'line',
            'path',
            'text',
            'frame',
        ]);
        const selectedSet = new Set(ids);

        // Desired stroke from the panel
        const desiredStroke = resolvedStrokeColor;                     // string like '#000000'
        const desiredType = resolvedStrokeType;                      // e.g., 'solid'
        const desiredWidth = typeof strokeWidth === 'number' ? strokeWidth : 0;

        const strokeMeta = strokeStyle && typeof strokeStyle === 'object' ? strokeStyle.meta || null : null;
        const versionChanged = prevStrokeVersion !== strokeWidthVersion;
        const shouldApply = Boolean(strokeMeta) || versionChanged;
        if (!shouldApply) return;

        const computeTargetStrokeWidth = (shape) => {
            if (!shape) return desiredWidth;
            if (desiredWidth <= 0 && (shape.type === 'line' || shape.type === 'path')) {
                const currentWidth = typeof shape.strokeWidth === 'number' ? shape.strokeWidth : 0;
                return currentWidth > 0 ? currentWidth : 1;
            }
            return desiredWidth;
        };

        // Quick no-op guard: if nothing would change, bail
        const needsChange = (() => {
            const src = shapesRef.current;
            for (let i = 0; i < src.length; i++) {
                const s = src[i];
                if (!selectedSet.has(s.id) || !supportsStroke.has(s.type)) continue;
                const curWidth = typeof s.strokeWidth === 'number' ? s.strokeWidth : 0;
                const targetWidth = computeTargetStrokeWidth(s);
                const curStroke = typeof s.stroke === 'string' ? s.stroke : null;
                const curType = typeof s.strokeType === 'string' ? s.strokeType : 'solid';
                if (curWidth !== targetWidth || curStroke !== desiredStroke || curType !== desiredType) {
                    return true;
                }
            }
            return false;
        })();
        if (!needsChange) return;

        if (strokeTxnRef.current) return; // avoid re-entrancy bursts
        strokeTxnRef.current = true;

        // Commit change to all selected stroke-capable shapes
        applyChange((prev) =>
            prev.map((s) => {
                if (!selectedSet.has(s.id) || !supportsStroke.has(s.type)) return s;
                return {
                    ...s,
                    stroke: desiredStroke,
                    strokeType: desiredType,
                    strokeWidth: computeTargetStrokeWidth(s),
                };
            })
        );
        setTimeout(() => { strokeTxnRef.current = false; }, 0);
    }, [
        applyChange,
        resolvedStrokeColor,   // color from panel
        resolvedStrokeType,    // 'solid' etc.
        strokeWidth,           // numeric width
        selectedIds, selectedId,
        strokeStyle?.meta
    ]);

    useEffect(() => {
        if (!shapePropertyRequest) return;
        const { version, targetId, payload } = shapePropertyRequest;
        if (!targetId || !payload || !payload.type) {
            if (typeof onShapePropertyRequestHandled === 'function') {
                onShapePropertyRequestHandled(version ?? null, false);
            }
            return;
        }

        const applyForShape = (shape) => {
            const { type, value } = payload;
            switch (type) {
                case 'position': {
                    const nextX = Number.isFinite(value?.x) ? value.x : shape.x;
                    const nextY = Number.isFinite(value?.y) ? value.y : shape.y;
                    if (shape.type === 'path') {
                        const dx = (Number.isFinite(nextX) ? nextX : 0) - (shape.x || 0);
                        const dy = (Number.isFinite(nextY) ? nextY : 0) - (shape.y || 0);
                        if (!dx && !dy) return shape;
                        const points = translatePathPoints(getPathPoints(shape), dx, dy);
                        return { ...shape, x: nextX, y: nextY, points };
                    }
                    if (isPolygonLikeShape(shape)) {
                        if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return shape;
                        if (shape.x === nextX && shape.y === nextY) return shape;
                        const sides = Math.max(3, Math.floor(shape.sides || 5));
                        const points = buildRegularPolygonPoints(
                            { x: nextX, y: nextY },
                            shape.radius || 0,
                            sides,
                            shape.rotation || 0
                        );
                        return { ...shape, x: nextX, y: nextY, points };
                    }
                    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
                        return shape;
                    }
                    if (shape.x === nextX && shape.y === nextY) return shape;
                    return { ...shape, x: nextX, y: nextY };
                }
                case 'dimensions': {
                    const width = Number.isFinite(value?.width) ? Math.max(0, value.width) : null;
                    const height = Number.isFinite(value?.height) ? Math.max(0, value.height) : null;
                    if (width == null || height == null) return shape;
                    if (shape.type === 'rectangle' || shape.type === 'frame' || shape.type === 'group') {
                        if (shape.width === width && shape.height === height) return shape;
                        return { ...shape, width, height };
                    }
                    if (shape.type === 'circle') {
                        const radius = Math.max(1, Math.min(width, height) / 2);
                        if (shape.radius === radius) return shape;
                        return { ...shape, radius };
                    }
                    if (shape.type === 'ellipse') {
                        const radiusX = Math.max(1, width / 2);
                        const radiusY = Math.max(1, height / 2);
                        if (shape.radiusX === radiusX && shape.radiusY === radiusY) return shape;
                        return { ...shape, radiusX, radiusY };
                    }
                    if (shape.type === 'line') {
                        const bounds = getLineBoundingBox(shape.points);
                        if (!bounds) return shape;
                        const currentWidth = Math.max(0, bounds.right - bounds.left);
                        const currentHeight = Math.max(0, bounds.bottom - bounds.top);
                        const targetWidth = Math.max(0, width);
                        const targetHeight = Math.max(0, height);
                        if (
                            Math.abs(currentWidth - targetWidth) < 0.001 &&
                            Math.abs(currentHeight - targetHeight) < 0.001
                        ) {
                            return shape;
                        }
                        const centerX = (bounds.left + bounds.right) / 2;
                        const centerY = (bounds.top + bounds.bottom) / 2;
                        const halfWidth = targetWidth / 2;
                        const halfHeight = targetHeight / 2;
                        const nextPoints = [];
                        for (let i = 0; i < shape.points.length; i += 2) {
                            const px = Number(shape.points[i]);
                            const py = Number(shape.points[i + 1]);
                            if (!Number.isFinite(px) || !Number.isFinite(py)) {
                                nextPoints.push(px, py);
                                continue;
                            }
                            const tx = currentWidth > 0 ? (px - bounds.left) / currentWidth : 0.5;
                            const ty = currentHeight > 0 ? (py - bounds.top) / currentHeight : 0.5;
                            const nextX = targetWidth > 0 ? centerX - halfWidth + tx * targetWidth : centerX;
                            const nextY = targetHeight > 0 ? centerY - halfHeight + ty * targetHeight : centerY;
                            nextPoints.push(nextX, nextY);
                        }
                        return { ...shape, points: nextPoints };
                    }
                    if (isPolygonLikeShape(shape)) {
                        const radius = Math.max(1, Math.max(width, height) / 2);
                        if (shape.radius === radius) return shape;
                        const sides = Math.max(3, Math.floor(shape.sides || 5));
                        const points = buildRegularPolygonPoints({ x: shape.x || 0, y: shape.y || 0 }, radius, sides, shape.rotation || 0);
                        const nextCornerRadius = clampValue(Number(shape.cornerRadius) || 0, 0, radius);
                        return { ...shape, radius, cornerRadius: nextCornerRadius, points };
                    }
                    if (shape.type === 'path') {
                        const points = getPathPoints(shape);
                        if (!points.length) return shape;
                        const bounds = getPointsBoundingBox(points);
                        if (!bounds) return shape;
                        const currentWidth = Math.max(0, bounds.right - bounds.left);
                        const currentHeight = Math.max(0, bounds.bottom - bounds.top);
                        const targetWidth = Math.max(0, width);
                        const targetHeight = Math.max(0, height);
                        if (
                            Math.abs(currentWidth - targetWidth) < 0.001 &&
                            Math.abs(currentHeight - targetHeight) < 0.001
                        ) {
                            return shape;
                        }
                        const centerX = (bounds.left + bounds.right) / 2;
                        const centerY = (bounds.top + bounds.bottom) / 2;
                        const halfWidth = targetWidth / 2;
                        const halfHeight = targetHeight / 2;
                        const nextPoints = points.map((point) => {
                            const ratioX = currentWidth > 0 ? (point.x - bounds.left) / currentWidth : 0.5;
                            const ratioY = currentHeight > 0 ? (point.y - bounds.top) / currentHeight : 0.5;
                            const nextPoint = clonePathPoint(point);
                            nextPoint.x = targetWidth > 0 ? centerX - halfWidth + ratioX * targetWidth : centerX;
                            nextPoint.y = targetHeight > 0 ? centerY - halfHeight + ratioY * targetHeight : centerY;
                            if (point.handles) {
                                nextPoint.handles = {};
                                if (point.handles.left) {
                                    const handleRatioX =
                                        currentWidth > 0 ? (point.handles.left.x - bounds.left) / currentWidth : 0.5;
                                    const handleRatioY =
                                        currentHeight > 0 ? (point.handles.left.y - bounds.top) / currentHeight : 0.5;
                                    nextPoint.handles.left = {
                                        x:
                                            targetWidth > 0
                                                ? centerX - halfWidth + handleRatioX * targetWidth
                                                : centerX,
                                        y:
                                            targetHeight > 0
                                                ? centerY - halfHeight + handleRatioY * targetHeight
                                                : centerY,
                                    };
                                }
                                if (point.handles.right) {
                                    const handleRatioX =
                                        currentWidth > 0 ? (point.handles.right.x - bounds.left) / currentWidth : 0.5;
                                    const handleRatioY =
                                        currentHeight > 0 ? (point.handles.right.y - bounds.top) / currentHeight : 0.5;
                                    nextPoint.handles.right = {
                                        x:
                                            targetWidth > 0
                                                ? centerX - halfWidth + handleRatioX * targetWidth
                                                : centerX,
                                        y:
                                            targetHeight > 0
                                                ? centerY - halfHeight + handleRatioY * targetHeight
                                                : centerY,
                                    };
                                }
                                if (!nextPoint.handles.left && !nextPoint.handles.right) {
                                    delete nextPoint.handles;
                                }
                            }
                            return nextPoint;
                        });
                        return { ...shape, points: nextPoints };
                    }
                    return shape;
                }
                case 'arc': {
                    if (shape.type !== 'circle' && shape.type !== 'ellipse') {
                        return shape;
                    }
                    const startRaw = Number(value?.start);
                    const sweepRaw = Number(value?.sweep);
                    const ratioRaw = Number(value?.ratio);
                    const start = Number.isFinite(startRaw)
                        ? ((startRaw % FULL_ARC_SWEEP) + FULL_ARC_SWEEP) % FULL_ARC_SWEEP
                        : 0;
                    const sweep = Number.isFinite(sweepRaw) ? clampValue(sweepRaw, 0, FULL_ARC_SWEEP) : FULL_ARC_SWEEP;
                    const ratio = Number.isFinite(ratioRaw) ? clampValue(ratioRaw, 0, ARC_RATIO_MAX) : 0;
                    if (
                        shape.arcStart === start &&
                        shape.arcSweep === sweep &&
                        shape.arcRatio === ratio
                    ) {
                        return shape;
                    }
                    return { ...shape, arcStart: start, arcSweep: sweep, arcRatio: ratio };
                }
                case 'rotation': {
                    if (!Number.isFinite(value)) return shape;
                    const nextRotation = value % 360;
                    if (shape.rotation === nextRotation) return shape;
                    if (isPolygonLikeShape(shape)) {
                        const sides = Math.max(3, Math.floor(shape.sides || 5));
                        const points = buildRegularPolygonPoints({ x: shape.x || 0, y: shape.y || 0 }, shape.radius || 0, sides, nextRotation);
                        return { ...shape, rotation: nextRotation, points };
                    }
                    return { ...shape, rotation: nextRotation };
                }
                case 'opacity': {
                    if (!Number.isFinite(value)) return shape;
                    const nextOpacity = clampValue(value, 0, 1);
                    if (shape.opacity === nextOpacity) return shape;
                    return { ...shape, opacity: nextOpacity };
                }
                case 'cornerRadius': {
                    if (
                        shape.type === 'rectangle' ||
                        shape.type === 'frame' ||
                        shape.type === 'group'
                    ) {
                        if (value && typeof value === 'object') {
                            const details = {
                                topLeft: Math.max(0, Number(value.topLeft) || 0),
                                topRight: Math.max(0, Number(value.topRight) || 0),
                                bottomRight: Math.max(0, Number(value.bottomRight) || 0),
                                bottomLeft: Math.max(0, Number(value.bottomLeft) || 0),
                            };
                            const current = shape.cornerRadius || {};
                            const same =
                                current.topLeft === details.topLeft &&
                                current.topRight === details.topRight &&
                                current.bottomRight === details.bottomRight &&
                                current.bottomLeft === details.bottomLeft;
                            if (same) return shape;
                            return { ...shape, cornerRadius: details };
                        }
                        const nextRadius = Math.max(0, Number(value) || 0);
                        if (shape.cornerRadius === nextRadius) return shape;
                        return { ...shape, cornerRadius: nextRadius };
                    }
                    if (isPolygonLikeShape(shape)) {
                        const nextRadius = Math.max(0, Number(value) || 0);
                        if (shape.cornerRadius === nextRadius) return shape;
                        return { ...shape, cornerRadius: nextRadius };
                    }
                    if (shape.type === 'path') {
                        const extractRadius = (input) => {
                            if (input && typeof input === 'object') {
                                const candidates = [
                                    input.topLeft,
                                    input.topRight,
                                    input.bottomRight,
                                    input.bottomLeft,
                                ];
                                for (let i = 0; i < candidates.length; i += 1) {
                                    const candidate = Number(candidates[i]);
                                    if (Number.isFinite(candidate)) {
                                        return candidate;
                                    }
                                }
                                return 0;
                            }
                            const numeric = Number(input);
                            return Number.isFinite(numeric) ? numeric : 0;
                        };

                        const requestedRadius = Math.max(0, extractRadius(value));
                        const basePoints = shape.__pathCornerBase
                            ? clonePathPoints(shape.__pathCornerBase)
                            : getPathPoints(shape);

                        if (!shape.closed || basePoints.length < 3) {
                            if (shape.cornerRadius === requestedRadius) return shape;
                            return { ...shape, cornerRadius: requestedRadius };
                        }

                        if (requestedRadius <= 0.0001) {
                            const restoreSource = shape.__pathCornerBase || basePoints;
                            const restored = clonePathPoints(restoreSource);
                            if (
                                shape.cornerRadius <= 0.0001 &&
                                !shape.__pathCornerBase
                            ) {
                                return shape;
                            }
                            const nextShape = {
                                ...shape,
                                cornerRadius: 0,
                                points: restored,
                            };
                            if (shape.__pathCornerBase) {
                                delete nextShape.__pathCornerBase;
                            }
                            return nextShape;
                        }

                        const baseForStore = shape.__pathCornerBase
                            ? clonePathPoints(shape.__pathCornerBase)
                            : clonePathPoints(basePoints);
                        const roundedPoints = roundPathCorners(baseForStore, requestedRadius);

                        if (
                            shape.cornerRadius === requestedRadius &&
                            Array.isArray(shape.points) &&
                            shape.points.length === roundedPoints.length
                        ) {
                            let unchanged = true;
                            for (let i = 0; i < roundedPoints.length; i += 1) {
                                const a = shape.points[i];
                                const b = roundedPoints[i];
                                if (!a || !b) {
                                    unchanged = false;
                                    break;
                                }
                                if (
                                    Math.abs((a.x || 0) - (b.x || 0)) > 0.0001 ||
                                    Math.abs((a.y || 0) - (b.y || 0)) > 0.0001
                                ) {
                                    unchanged = false;
                                    break;
                                }
                            }
                            if (unchanged && shape.__pathCornerBase) {
                                return shape;
                            }
                        }

                        const nextShape = {
                            ...shape,
                            cornerRadius: requestedRadius,
                            points: roundedPoints,
                            __pathCornerBase: baseForStore,
                        };
                        if (!shape._pathWasEdited) {
                            nextShape._pathWasEdited = true;
                        }
                        return nextShape;
                    }
                    return shape;
                }
                case 'cornerSmoothing': {
                    if (!Number.isFinite(value)) return shape;
                    const nextSmoothing = clampValue(value, 0, 1);
                    if (shape.cornerSmoothing === nextSmoothing) return shape;
                    return { ...shape, cornerSmoothing: nextSmoothing };
                }
                case 'polygonSides': {
                    if (!isPolygonLikeShape(shape)) return shape;
                    const sides = Math.max(3, Math.floor(value));
                    if (shape.sides === sides) return shape;
                    const points = buildRegularPolygonPoints({ x: shape.x || 0, y: shape.y || 0 }, shape.radius || 0, sides, shape.rotation || 0);
                    return { ...shape, sides, points };
                }
                case 'radius': {
                    const nextRadius = Math.max(0, Number(value) || 0);
                    if (!Number.isFinite(nextRadius)) return shape;

                    // 1) Plain polygon
                    if (isPolygonLikeShape(shape)) {
                        if (shape.radius === nextRadius) return shape;

                        const sides = Math.max(3, Math.floor(shape.sides || 5));
                        const points = buildRegularPolygonPoints(
                            { x: shape.x || 0, y: shape.y || 0 },
                            nextRadius,
                            sides,
                            shape.rotation || 0
                        );
                        const nextCornerRadius = clampValue(Number(shape.cornerRadius) || 0, 0, nextRadius);

                        return {
                            ...shape,
                            radius: nextRadius,
                            cornerRadius: nextCornerRadius,
                            points,
                        };
                    }

                    // 2) Path that still remembers its original shape
                    if (shape.type === 'path' && shape.__pathOriginal && !shape._pathWasEdited) {
                        const points = getPathPoints(shape);
                        if (!points.length) return shape;

                        const bounds = getPointsBoundingBox(points);
                        if (!bounds) return shape;

                        const width = Math.max(0, bounds.right - bounds.left);
                        const height = Math.max(0, bounds.bottom - bounds.top);
                        const currentRadius = Math.max(width, height) / 2;
                        if (currentRadius <= 0) return shape;

                        const scale = nextRadius / currentRadius;
                        if (!Number.isFinite(scale) || Math.abs(scale - 1) < 0.0001) {
                            return shape;
                        }

                        const centerX = (bounds.left + bounds.right) / 2;
                        const centerY = (bounds.top + bounds.bottom) / 2;

                        const nextPoints = points.map((pt) => {
                            const next = clonePathPoint(pt);
                            const dx = pt.x - centerX;
                            const dy = pt.y - centerY;
                            next.x = centerX + dx * scale;
                            next.y = centerY + dy * scale;
                            return next;
                        });

                        return {
                            ...shape,
                            points: nextPoints,
                        };
                    }

                    return shape;
                }
                default:
                    return shape;
            }
        };

        let didApply = false;
        applyChange((prev) =>
            prev.map((shape) => {
                if (shape.id !== targetId) return shape;
                const nextShape = applyForShape(shape);
                if (nextShape !== shape) {
                    didApply = true;
                }
                return nextShape;
            })
        );

        if (typeof onShapePropertyRequestHandled === 'function') {
            onShapePropertyRequestHandled(version, didApply);
        }
    }, [
        applyChange,
        onShapePropertyRequestHandled,
        shapePropertyRequest,
    ]);

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
        const targetName = targetNode && typeof targetNode.name === 'function' ? targetNode.name() : '';
        const containerIdFromTarget = (() => {
            if (!['frame', 'group'].includes(targetName)) return null;
            if (!targetNode || typeof targetNode.id !== 'function') return null;
            const idValue = targetNode.id();
            const match = /^shape-(\d+)$/.exec(idValue || '');
            if (!match) return null;
            const parsed = Number(match[1]);
            return Number.isFinite(parsed) ? parsed : null;
        })();
        const clickedOnEmpty = targetNode === stage;
        const shiftKey = !!(e?.evt?.shiftKey || e?.shiftKey);

        if (isSelectLikeTool && clickedOnEmpty) {
            setSelectedId(null);
            setSelectedIds([]);
            const pointer = getCanvasPointer();
            if (!pointer) return;
            marqueeStateRef.current = { active: true, start: pointer, end: pointer };
            setMarqueeRect({ x: pointer.x, y: pointer.y, width: 0, height: 0 });
            setStageCursor('crosshair');
            return;
        }

        if (!shiftKey) {
            resetMarquee();
        }

        if (selectedTool === 'path') {
            const pointer = getCanvasPointer();
            if (!pointer) return;
            const effectiveStrokeWidth = typeof strokeWidth === 'number' && strokeWidth > 0 ? strokeWidth : 1;
            const tolerance = 8 / Math.max(scale || 1, 0.01);
            const altKey = !!(e?.evt?.altKey || e?.altKey);
            const activeState = pathInteractionRef.current;
            const activeShapeId = activeState.shapeId;
            const containerId = containerIdFromTarget ?? undefined;
            const existingShape =
                activeShapeId != null ? shapesRef.current.find((shape) => shape.id === activeShapeId) : null;
            let targetPathShape = existingShape;
            if (!targetPathShape && selectedId) {
                const candidate = shapesRef.current.find((shape) => shape.id === selectedId && shape.type === 'path');
                if (candidate) targetPathShape = candidate;
            }
            if (!targetPathShape) {
                const hitShapeId = (() => {
                    if (!targetNode || typeof targetNode.id !== 'function') return null;
                    const idValue = targetNode.id();
                    const match = /^shape-(\d+)$/.exec(idValue || '');
                    if (!match) return null;
                    const parsed = Number(match[1]);
                    return Number.isFinite(parsed) ? parsed : null;
                })();
                if (hitShapeId != null) {
                    const candidate = shapesRef.current.find((shape) => shape.id === hitShapeId);
                    if (candidate) {
                        if (candidate.type === 'path') {
                            targetPathShape = candidate;
                        } else if (canConvertShapeToPath(candidate)) {
                            const converted = convertShapeToPath(candidate.id);
                            if (converted) {
                                targetPathShape = converted;
                                setSelectedId(converted.id);
                                setSelectedIds([converted.id]);
                                setActivePathSelection(null);
                                pathInteractionRef.current = {
                                    shapeId: converted.id,
                                    pendingPoint: null,
                                    draggingHandle: null,
                                    baseState: null,
                                    containerId: containerId ?? null,
                                };
                                return;
                            }
                        }
                    }
                }
            }

            if (!existingShape && targetPathShape) {
                const points = getPathPoints(targetPathShape);
                if (points.length >= 1) {
                    let bestIndex = -1;
                    let bestDist = tolerance;
                    for (let i = 0; i < points.length - 1; i += 1) {
                        const dist = distanceToSegment(pointer, points[i], points[i + 1]);
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestIndex = i;
                        }
                    }
                    if (targetPathShape.closed && points.length > 2) {
                        const dist = distanceToSegment(pointer, points[points.length - 1], points[0]);
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestIndex = points.length - 1;
                        }
                    }
                    if (bestIndex >= 0 && points.length < MAX_POINTS_PER_PATH) {
                        updatePathShape(
                            targetPathShape.id,
                            (pts) => {
                                const next = pts.slice();
                                next.splice(bestIndex + 1, 0, createPathPoint({ x: pointer.x, y: pointer.y }));
                                const stillClosed = targetPathShape.closed && next.length > 2;
                                return { points: next, closed: stillClosed };
                            },
                            { commit: true }
                        );
                        setActivePathSelection({ shapeId: targetPathShape.id, index: bestIndex + 1 });
                        return;
                    }
                }
            }

            if (!existingShape && targetPathShape) {
                if (!selectedIds.includes(targetPathShape.id)) {
                    setSelectedId(targetPathShape.id);
                    setSelectedIds([targetPathShape.id]);
                }
            }

            if (!existingShape) {
                const fillColor =
                    resolvedFillType === 'gradient'
                        ? getGradientFirstColor(resolvedFillGradient, resolvedFillColor)
                        : resolvedFillColor;
                const newShape = createShape('path', {
                    parentId: containerId,
                    points: [createPathPoint({ x: pointer.x, y: pointer.y })],
                    closed: false,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: effectiveStrokeWidth,
                    fill: fillColor,
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                });
                applyChange((prev) => insertShapeAtTop(prev, newShape));
                pathInteractionRef.current = {
                    shapeId: newShape.id,
                    pendingPoint: { index: 0, start: pointer, hasDragged: false, altKey },
                    draggingHandle: null,
                    baseState: null,
                    containerId: containerId ?? null,
                };
                setSelectedId(newShape.id);
                setSelectedIds([newShape.id]);
                setActivePathSelection({ shapeId: newShape.id, index: 0 });
                return;
            }

            const points = getPathPoints(existingShape);
            const firstPoint = points[0];
            if (points.length > 1 && firstPoint && distanceBetween(firstPoint, pointer) <= tolerance) {
                updatePathShape(existingShape.id, (pts) => ({ points: pts, closed: true }));
                pathInteractionRef.current = {
                    shapeId: null,
                    pendingPoint: null,
                    draggingHandle: null,
                    baseState: null,
                    containerId: null,
                };
                setActivePathSelection(null);
                return;
            }

            if (points.length >= MAX_POINTS_PER_PATH) {
                return;
            }

            updatePathShape(existingShape.id, (pts) => ({
                points: [...pts, createPathPoint({ x: pointer.x, y: pointer.y })],
                closed: false,
            }));
            pathInteractionRef.current = {
                shapeId: existingShape.id,
                pendingPoint: { index: points.length, start: pointer, hasDragged: false, altKey },
                draggingHandle: null,
                baseState: null,
                containerId: activeState.containerId ?? containerId ?? null,
            };
            setActivePathSelection({ shapeId: existingShape.id, index: points.length });
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
        if (clickedOnEmpty) {
            setSelectedId(null);
            setSelectedIds([]);
            lastLayerAnchorIndexRef.current = null;
        }

        // start drag-create for supported tools
        const dragTools = ['rectangle', 'circle', 'ellipse', 'polygon', 'roundedPolygon', 'line', 'frame', 'group'];
        if (dragTools.includes(selectedTool)) {
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
                    fill: '#d9d9d9',
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                });
            } else if (selectedTool === 'polygon') {
                const sides = 5;
                newShape = createShape('polygon', {
                    ...baseProps,
                    radius: 1,
                    sides,
                    cornerRadius: 0,
                    fill: '#d9d9d9',
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                    points: buildRegularPolygonPoints({ x: pos.x, y: pos.y }, 1, sides, baseProps.rotation || 0),
                });
            } else if (selectedTool === 'roundedPolygon') {
                const sides = 5;
                const defaultCorner = 8;
                newShape = createShape('roundedPolygon', {
                    ...baseProps,
                    radius: 1,
                    sides,
                    cornerRadius: defaultCorner,
                    fill: '#d9d9d9',
                    fillType: resolvedFillType,
                    fillGradient: resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                    stroke: resolvedStrokeColor,
                    strokeType: resolvedStrokeType,
                    strokeWidth: strokeWidth || 0,
                    points: buildRegularPolygonPoints({ x: pos.x, y: pos.y }, 1, sides, baseProps.rotation || 0),
                });
            } else if (selectedTool === 'circle') {
                newShape = createShape('circle', {
                    ...baseProps,
                    radius: 1,
                    arcStart: 0,
                    arcSweep: FULL_ARC_SWEEP,
                    arcRatio: 0,
                    fill: '#d9d9d9',
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
                    arcStart: 0,
                    arcSweep: FULL_ARC_SWEEP,
                    arcRatio: 0,
                    fill: '#d9d9d9',
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
                    fill: '#ffffff',
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
            newShape.name = getNextName(newShape.type);
            currentDrawingIdRef.current = newShape.id;
            drawingStartRef.current = pos;
            isDrawingRef.current = true;
            applyChange((prev) => insertShapeAtTop(prev, newShape));
            selectSingle(newShape.id);
            return;
        }

        // fall back to click-to-create (text or simple click behavior)
        // Only add a shape when clicking on empty stage (not on an existing shape)
        if (selectedTool === 'text') {
            const pointerPos = getCanvasPointer();
            if (!pointerPos) return;

            // 🧩 Detect if pointer is over a frame/group
            const dropTarget = findContainerAtPoint(pointerPos, new Set(), shapesRef.current);
            const parentId = dropTarget ? dropTarget.id : null;

            const newShape = createShape('text', {
                x: pointerPos.x,
                y: pointerPos.y,
                text: 'Text',
                parentId, // top-level text over any frame/group
                fill: '#000000  ',
                fillType: resolvedFillType,
                fillGradient:
                    resolvedFillType === 'gradient' ? resolvedFillGradient : null,
                stroke: resolvedStrokeColor,
                strokeType: resolvedStrokeType,
                strokeWidth: strokeWidth || 0,
                rotation: 0,
                fontFamily: resolvedTextOptions.fontFamily,
                fontStyle: resolvedTextOptions.fontStyle,
                fontSize: resolvedTextOptions.fontSize,
                lineHeight: resolvedTextOptions.lineHeight,
                letterSpacing: resolvedTextOptions.letterSpacing,
            });
            newShape.name = getNextName(newShape.type);
            applyChange((prev) => insertShapeAtTop(prev, newShape));
            pendingTextEditRef.current = newShape.id;
            setSelectedId(newShape.id);
            if (typeof onToolChange === 'function') onToolChange('select');
            // ⬆️ They ensure the text immediately enters edit mode and tool switches back
            return;
        }
        // Other tools: only add when clicking on empty canvas
        if (!clickedOnEmpty) return;
        const pointerPos = getCanvasPointer();
        if (!pointerPos) return;
    };


    // handle mouse move for panning (hand tool) and drawing
    const handleStageMouseMove = () => {
        const stage = stageRef.current;
        if (!stage) return;
        if (selectedTool === 'path') {
            const pointer = getCanvasPointer();
            const state = pathInteractionRef.current;
            if (pointer && state && state.shapeId && state.pendingPoint) {
                const { index, start, altKey } = state.pendingPoint;
                const dx = pointer.x - start.x;
                const dy = pointer.y - start.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= MIN_SEGMENT_LENGTH) {
                    state.pendingPoint.hasDragged = true;
                    updatePathShape(state.shapeId, (pts) => {
                        if (!pts[index]) return pts;
                        const next = pts.map((point, idx) => {
                            if (idx !== index && idx !== index - 1) {
                                return point;
                            }
                            if (idx === index) {
                                const current = ensureHandlesForType({
                                    ...point,
                                    type: altKey ? PATH_NODE_TYPES.DISCONNECTED : PATH_NODE_TYPES.SMOOTH,
                                });
                                const anchor = { x: current.x, y: current.y };
                                current.handles = current.handles || {};
                                current.handles.left = { x: anchor.x - dx, y: anchor.y - dy };
                                current.handles.right = { x: anchor.x + dx, y: anchor.y + dy };
                                if (!altKey && current.type === PATH_NODE_TYPES.SMOOTH) {
                                    const mirrored = updateHandleSymmetry(current, 'right');
                                    return mirrored;
                                }
                                return current;
                            }
                            if (idx === index - 1) {
                                const previous = ensureHandlesForType({
                                    ...point,
                                    type: altKey ? PATH_NODE_TYPES.DISCONNECTED : PATH_NODE_TYPES.SMOOTH,
                                });
                                previous.handles = previous.handles || {};
                                previous.handles.right = { x: previous.x + dx, y: previous.y + dy };
                                if (!altKey && previous.type === PATH_NODE_TYPES.SMOOTH) {
                                    return updateHandleSymmetry(previous, 'right');
                                }
                                return previous;
                            }
                            return point;
                        });
                        return next;
                    });
                }
            }
        }
        if (marqueeStateRef.current.active) {
            const pointer = getCanvasPointer();
            if (!pointer) return;
            marqueeStateRef.current.end = pointer;
            const rect = rectFromPoints(marqueeStateRef.current.start, pointer);
            setMarqueeRect(rect);
            return;
        }
        // if we are drawing, update the temporary shape
        if (isDrawingRef.current) {
            const pos = getCanvasPointer();
            const start = drawingStartRef.current;
            const id = currentDrawingIdRef.current;
            if (!pos || !start || id == null) return;

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
                    if (isPolygonLikeShape(s)) {
                        const dx = pos.x - start.x;
                        const dy = pos.y - start.y;
                        const radius = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                        const sides = Math.max(3, Math.floor(s.sides || 5));
                        const cornerRadius = clampValue(Number(s.cornerRadius) || 0, 0, radius);
                        return {
                            ...s,
                            radius,
                            cornerRadius,
                            points: buildRegularPolygonPoints({ x: s.x || start.x, y: s.y || start.y }, radius, sides, s.rotation || 0),
                        };
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
        if (lineAnchorDragRef.current) {
            commitLineAnchorDrag();
        }
        if (selectedTool === 'path') {
            const state = pathInteractionRef.current;
            if (state && state.shapeId && state.pendingPoint) {
                const { index, hasDragged } = state.pendingPoint;
                updatePathShape(state.shapeId, (pts) => {
                    if (!pts[index]) return pts;
                    const next = pts.map((point, idx) => {
                        if (idx !== index) return point;
                        const updated = clonePathPoint(point);
                        if (!hasDragged) {
                            updated.type = PATH_NODE_TYPES.CORNER;
                            delete updated.handles;
                        }
                        return updated;
                    });
                    return next;
                }, { commit: true });
                state.pendingPoint = null;
            }
        }
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
                    if (s.type === 'rectangle') keep = s.width >= 5 && s.height >= 0;
                    else if (s.type === 'frame' || s.type === 'group') keep = s.width >= 5 && s.height >= 0;
                    else if (s.type === 'circle') keep = s.radius >= 0;
                    else if (s.type === 'ellipse') keep = s.radiusX >= 0 && s.radiusY >= 0;
                    else if (isPolygonLikeShape(s)) keep = s.radius >= 0;
                    else if (s.type === 'line') keep = !(Math.abs(s.points[0] - s.points[2]) < 2 && Math.abs(s.points[1] - s.points[3]) < 2);
                    else if (s.type === 'path') keep = getPathPoints(s).length > 1;
                    if (!keep) removed = true;
                    return keep;
                });
                return next;
            });
            if (!removed && selectedTool !== 'path' && !isSelectLikeTool) {
                if (typeof onToolChange === 'function') onToolChange('select');
            }

            // If we just created a frame successfully, reparent any shapes fully covered by it
            if (!removed) {
                const frame = shapesRef.current.find((s) => s.id === id);
                if (frame && frame.type === 'frame' && (frame.width || 0) > 0 && (frame.height || 0) > 0) {
                    const frameBounds = getContainerBounds(frame); // uses center-based x/y
                    if (frameBounds) {
                        applyChange((prev) => {
                            const onSamePage = (s) => (s.pageId || frame.pageId) === frame.pageId;
                            return prev.map((s) => {
                                if (s.id === frame.id) return s;
                                if (!onSamePage(s)) return s;
                                if (s.visible === false || s.locked) return s;

                                // Optional: if you want to exclude containers from being auto-adopted, uncomment:
                                // if (isContainerShape(s)) return s;

                                const bb = getShapeBoundingBox(s);
                                if (!bb) return s;

                                const fullyInside =
                                    bb.left >= frameBounds.left &&
                                    bb.right <= frameBounds.right &&
                                    bb.top >= frameBounds.top &&
                                    bb.bottom <= frameBounds.bottom;

                                if (!fullyInside) return s;

                                // IMPORTANT: your model keeps absolute coordinates for children.
                                // So we ONLY change parentId; we DO NOT offset x/y.
                                return { ...s, parentId: frame.id };
                            });
                        });
                    }
                }
            }

            return;
        }

        if (marqueeStateRef.current.active) {
            const { start, end } = marqueeStateRef.current;
            resetMarquee();
            if (!start || !end) {
                if (isSelectLikeTool) setStageCursor('default');
                return;
            }
            const rect = rectFromPoints(start, end);
            if (!rect || rect.width < 2 || rect.height < 2) {
                if (isSelectLikeTool) setStageCursor('default');
                return;
            }

            const ctrlLike = !!(e?.evt?.metaKey || e?.evt?.ctrlKey || e?.metaKey || e?.ctrlKey);
            const stageToLocal = (() => {
                const absolute = stage.getAbsoluteTransform();
                if (!absolute || typeof absolute.copy !== 'function') return null;
                const copy = absolute.copy();
                if (typeof copy.invert === 'function') {
                    copy.invert();
                    return copy;
                }
                return null;
            })();
            const hits = [];
            const shapesSnapshot = shapesRef.current;
            const currentPageId = activePageRef.current;
            for (let i = 0; i < shapesSnapshot.length; i += 1) {
                const shape = shapesSnapshot[i];
                if (!shape || shape.visible === false || shape.locked) continue;
                if (currentPageId && (shape.pageId || currentPageId) !== currentPageId) continue;
                const node = stage.findOne(`#shape-${shape.id}`);
                if (!node) continue;
                const clientRect = node.getClientRect({ skipTransform: false });
                const shapeRect = rectFromClientRect(clientRect, stageToLocal);
                if (!shapeRect) continue;
                if (rectsIntersect(rect, shapeRect)) {
                    hits.push(shape.id);
                }
            }

            if (ctrlLike) {
                if (hits.length) {
                    setSelectedIds((prev) => {
                        const set = new Set(prev);
                        hits.forEach((id) => {
                            if (set.has(id)) set.delete(id);
                            else set.add(id);
                        });
                        const next = Array.from(set);
                        const nextPrimary = next.length ? next[next.length - 1] : null;
                        setSelectedId(nextPrimary);
                        if (nextPrimary != null) {
                            const panelIds = getLayerPanelIds();
                            const idx = panelIds.indexOf(nextPrimary);
                            lastLayerAnchorIndexRef.current = idx >= 0 ? idx : null;
                        } else {
                            lastLayerAnchorIndexRef.current = null;
                        }
                        return next;
                    });
                }
            } else {
                setSelectedIds(hits);
                setSelectedId(hits.length ? hits[hits.length - 1] : null);
                const panelIds = getLayerPanelIds();
                const primaryId = hits.length ? hits[hits.length - 1] : null;
                if (primaryId != null) {
                    const idx = panelIds.indexOf(primaryId);
                    lastLayerAnchorIndexRef.current = idx >= 0 ? idx : null;
                } else {
                    lastLayerAnchorIndexRef.current = null;
                }
            }
            if (isSelectLikeTool) setStageCursor('default');
            return;
        }

        // otherwise stop panning
        if (selectedTool !== 'hand') return;
        if (!isPanningRef.current) return;
        isPanningRef.current = false;
        const container = stage.container();
        if (container) container.style.cursor = 'grab';
    };

    const handleStageDoubleClick = (e) => {
        const stage = stageRef.current;
        if (!stage) return;
        // ✅ ignore dbl-clicks that originated on any node other than the stage
        if (e?.target && e.target !== stage) {
            e.cancelBubble = true;
            return;
        }
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

        if (isSelectLikeTool) {
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

        if (!isSelectLikeTool) {
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
        const enabledAnchors = [
            'top-left',
            'top-center',
            'top-right',
            'middle-right',
            'bottom-right',
            'bottom-center',
            'bottom-left',
            'middle-left',
        ];
        const transformerConfig = {
            rotationEnabled: false,
            enabledAnchors,
            hitStrokeWidth: 24,
            keepRatio: false,
            centeredScaling: false,
        };
        if (node) {
            if (typeof tr.nodes === 'function') {
                tr.nodes([node]);
                if (typeof tr.setAttrs === 'function') {
                    tr.setAttrs(transformerConfig);
                }
            }
        } else if (typeof tr.nodes === 'function') {
            tr.nodes([]);
        }
        const trLayer = typeof tr.getLayer === 'function' ? tr.getLayer() : null;
        if (trLayer && typeof trLayer.batchDraw === 'function') trLayer.batchDraw();
        // prefer multi-select if present; else fall back to single
        const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);

        tr.nodes(nodes);
        if (typeof tr.setAttrs === 'function') {
            tr.setAttrs(transformerConfig);
        }

        // Build the raw selected id list (supports single or multi-select)
        const rawIds = selectedIds?.length ? selectedIds : (selectedId ? [selectedId] : []);

        // Map to shape models from your store/ref
        const allShapes = (shapesRef?.current || shapes) || [];
        const selShapes = rawIds
            .map(id => allShapes.find(sh => sh.id === id))
            .filter(Boolean);

        // Partition selection into lines vs others
        const lineShapes = selShapes.filter(s => s.type === 'line');
        const otherShapes = selShapes.filter(s => s.type !== 'line');

        // Decide which shapes get a Transformer attached
        let attachIds = [];
        if (otherShapes.length > 0) {
            // If any non-line is selected, show transformer for those (hide it for lines)
            attachIds = otherShapes.map(s => s.id);
        } else if (lineShapes.length > 1) {
            // Only when more than one line is selected
            attachIds = lineShapes.map(s => s.id);
        } else {
            // Single line or empty selection: no transformer box
            attachIds = [];
        }

        // Resolve nodes and attach
        const nodes = attachIds
            .map(id => stage.findOne(`#shape-${id}`))
            .filter(Boolean);

        if (typeof tr.nodes === 'function') tr.nodes(nodes);
        if (typeof tr.setAttrs === 'function') tr.setAttrs(transformerConfig);
        tr.getLayer()?.batchDraw?.();


        tr.getLayer()?.batchDraw?.();
    }, [selectedIds, selectedId, shapes, selectedTool]);

    const handleDragMove = (id, e) => {
        const targetNode = e?.target;
        const x = typeof targetNode?.x === 'function' ? targetNode.x() : 0;
        const y = typeof targetNode?.y === 'function' ? targetNode.y() : 0;
        const snap = dragSnapshotRef.current;
        const current = shapesRef.current.find((s) => s.id === id) || null;

        if (snap && snap.id === id && snap.type === 'path') {
            let dx = x - snap.startX;
            let dy = y - snap.startY;
            const stage = stageRef.current;
            const pointer = stage?.getPointerPosition?.() || null;
            if (pointer && snap.startPointer) {
                dx = pointer.x - snap.startPointer.x;
                dy = pointer.y - snap.startPointer.y;
                snap.lastPointer = { x: pointer.x, y: pointer.y };
            }
            snap.dx = dx;
            snap.dy = dy;
            const translated = translatePathPoints(snap.basePoints, dx, dy);
            setShapes((prev) =>
                prev.map((s) =>
                    s.id === id
                        ? { ...s, points: translated, x: (snap.baseX || 0) + dx, y: (snap.baseY || 0) + dy }
                        : s
                )
            );
            if (targetNode && typeof targetNode.position === 'function') {
                targetNode.position({ x: snap.startX, y: snap.startY });
            }
            return;
        }

        if (snap && snap.id === id && snap.type === 'line') {
            let dx = x - snap.startX;
            let dy = y - snap.startY;
            const stage = stageRef.current;
            const pointer = stage?.getPointerPosition?.() || null;
            if (pointer && snap.startPointer) {
                dx = pointer.x - snap.startPointer.x;
                dy = pointer.y - snap.startPointer.y;
                snap.lastPointer = { x: pointer.x, y: pointer.y };
            }
            snap.dx = dx;
            snap.dy = dy;
            const translated = translateLinePoints(snap.basePoints, dx, dy);
            setShapes((prev) =>
                prev.map((s) =>
                    s.id === id
                        ? { ...s, points: translated, x: 0, y: 0 }
                        : s
                )
            );
            if (targetNode && typeof targetNode.position === 'function') {
                targetNode.position({ x: snap.startX, y: snap.startY });
            }
            return;
        }

        if (snap && snap.id === id && snap.type === 'container' && current && isContainerShape(current)) {
            const dx = x - snap.startX;
            const dy = y - snap.startY;
            setShapes((prev) =>
                prev.map((s) => {
                    if (s.id === id) {
                        return { ...s, x, y };
                    }
                    if (snap.childPos?.has(s.id)) {
                        const base = snap.childPos.get(s.id);
                        let nextShape = { ...s, x: base.x + dx, y: base.y + dy };
                        if (snap.pathChildPoints?.has(s.id)) {
                            const basePoints = snap.pathChildPoints.get(s.id);
                            nextShape = {
                                ...nextShape,
                                points: translatePathPoints(basePoints, dx, dy),
                            };
                        }
                        return nextShape;
                    }
                    return s;
                })
            );
            return;
        }

        setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)));
    };

    const handleDragEnd = (id, e) => {
        const targetNode = e?.target;
        const x = typeof targetNode?.x === 'function' ? targetNode.x() : 0;
        const y = typeof targetNode?.y === 'function' ? targetNode.y() : 0;
        const snap = dragSnapshotRef.current;
        if (snap && snap.id === id && snap.type === 'path') {
            let dx = snap.dx != null ? snap.dx : x - snap.startX;
            let dy = snap.dy != null ? snap.dy : y - snap.startY;
            if (snap.startPointer && snap.lastPointer) {
                dx = snap.lastPointer.x - snap.startPointer.x;
                dy = snap.lastPointer.y - snap.startPointer.y;
            }
            const translated = translatePathPoints(snap.basePoints, dx, dy);
            applyChange(
                (prev) =>
                    prev.map((s) =>
                        s.id === id
                            ? { ...s, points: translated, x: (snap.baseX || 0) + dx, y: (snap.baseY || 0) + dy }
                            : s
                    ),
                { baseState: snap.baseState }
            );
            if (targetNode && typeof targetNode.position === 'function') {
                targetNode.position({ x: snap.startX, y: snap.startY });
            }
            dragSnapshotRef.current = null;
            return;
        }

        if (snap && snap.id === id && snap.type === 'line') {
            let dx = snap.dx != null ? snap.dx : x - snap.startX;
            let dy = snap.dy != null ? snap.dy : y - snap.startY;
            if (snap.startPointer && snap.lastPointer) {
                dx = snap.lastPointer.x - snap.startPointer.x;
                dy = snap.lastPointer.y - snap.startPointer.y;
            }
            const translated = translateLinePoints(snap.basePoints, dx, dy);
            applyChange(
                (prev) =>
                    prev.map((s) =>
                        s.id === id
                            ? { ...s, points: translated, x: 0, y: 0 }
                            : s
                    ),
                { baseState: snap.baseState }
            );
            if (targetNode && typeof targetNode.position === 'function') {
                targetNode.position({ x: snap.startX, y: snap.startY });
            }
            dragSnapshotRef.current = null;
            return;
        }

        const snapshotShapes = shapesRef.current;
        const current = snapshotShapes.find((shape) => shape.id === id) || null;
        const pointer = getCanvasPointer();
        const dropPoint = pointer || { x, y };
        const excludedIds = new Set([id]);
        if (current) {
            collectDescendantIds(snapshotShapes, id).forEach((childId) => excludedIds.add(childId));
        }
        const dropTarget = findContainerAtPoint(dropPoint, excludedIds, snapshotShapes);
        const nextParentId = dropTarget ? dropTarget.id : null;
        const previousParentId = current?.parentId ?? null;

        const dxFromSnapshot = snap && snap.id === id && snap.type === 'container' ? x - snap.startX : 0;
        const dyFromSnapshot = snap && snap.id === id && snap.type === 'container' ? y - snap.startY : 0;

        applyChange(
            (prev) => {
                let positioned = prev.map((s) => {
                    if (s.id === id) {
                        return { ...s, x, y };
                    }
                    if (snap && snap.id === id && snap.type === 'container' && snap.childPos?.has(s.id)) {
                        const base = snap.childPos.get(s.id);
                        let nextShape = { ...s, x: base.x + dxFromSnapshot, y: base.y + dyFromSnapshot };
                        if (snap.pathChildPoints?.has(s.id)) {
                            const basePoints = snap.pathChildPoints.get(s.id);
                            nextShape = {
                                ...nextShape,
                                points: translatePathPoints(basePoints, dxFromSnapshot, dyFromSnapshot),
                            };
                        }
                        return nextShape;
                    }
                    return s;
                });

                if (current && nextParentId !== previousParentId) {
                    return moveShapeToParentTop(positioned, id, nextParentId);
                }
                return positioned;
            },
            snap && snap.id === id ? { baseState: snap.baseState } : undefined
        );
        // Clear snapshot after finishing
        if (dragSnapshotRef.current && dragSnapshotRef.current.id === id) {
            dragSnapshotRef.current = null;
        }
    };

    // NEW: multi-select state. We'll still keep selectedId as the "primary".
    const [selectedIds, setSelectedIds] = useState([]);

    useEffect(() => {
        if (selectedTool !== 'path') return;
        const ids = selectedIds.length ? selectedIds : selectedId != null ? [selectedId] : [];
        if (!ids.length) return;
        let convertedAny = false;
        ids.forEach((id) => {
            const shape = shapesRef.current.find((s) => s.id === id);
            if (shape && shape.type !== 'path' && canConvertShapeToPath(shape)) {
                const result = convertShapeToPath(id);
                if (result) {
                    convertedAny = true;
                }
            }
        });
        if (convertedAny) {
            setActivePathSelection(null);
            pathInteractionRef.current = {
                shapeId: null,
                pendingPoint: null,
                draggingHandle: null,
                baseState: null,
                containerId: null,
            };
        }
    }, [selectedTool, selectedId, selectedIds, convertShapeToPath]);

    useEffect(() => {
        if (selectedTool !== 'select') return;

        // when switching to Select, restore any auto-converted paths
        // that were never actually edited in path mode
        applyChange((prev) => {
            let changed = false;

            const next = prev.map((shape) => {
                // only care about paths that remember their original shape
                if (shape.type !== 'path' || !shape.__pathOriginal) {
                    return shape;
                }

                // if user edited this path, keep it as a path
                if (shape._pathWasEdited) {
                    return shape;
                }

                const orig = shape.__pathOriginal || {};
                let reverted = {
                    ...shape,
                    ...orig,
                    type: orig.type || shape.type,
                    x: orig.x != null ? orig.x : shape.x,
                    y: orig.y != null ? orig.y : shape.y,
                    // only keep points when the original needed them
                    points: Array.isArray(orig.points) ? [...orig.points] : orig.points,
                };

                // For non-path shapes that don't use points (rect/circle/ellipse),
                // remove path-specific geometry fields.
                if (
                    orig.type === 'rectangle' ||
                    orig.type === 'circle' ||
                    orig.type === 'ellipse'
                ) {
                    delete reverted.points;
                    delete reverted.closed;
                }

                // clean up metadata
                delete reverted.__pathOriginal;
                delete reverted._pathWasEdited;
                delete reverted.__pathCornerBase;

                changed = true;
                return reverted;
            });

            return changed ? next : prev;
        });
    }, [selectedTool, applyChange]);

    useEffect(() => {
        setSelectedId(null);
        setSelectedIds([]);
        setActiveContainerPath([null]);
        setCollapsedContainers(new Set());
    }, [activePageId]);

    useEffect(() => {
        const handlePageShortcuts = (event) => {
            const target = event.target;
            if (
                target &&
                (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
            ) {
                return;
            }
            const ctrlOrMeta = event.metaKey || event.ctrlKey;
            if (!ctrlOrMeta) return;
            const key = event.key.toLowerCase();
            if (event.shiftKey && key === 'n') {
                event.preventDefault();
                handleAddPage();
                return;
            }
            if (key === 'p') {
                event.preventDefault();
                const pageList = pagesRef.current;
                if (!Array.isArray(pageList) || pageList.length === 0) return;
                const promptLabel = pageList
                    .map((page, index) => `${index + 1}. ${page.name}`)
                    .join('\n');
                const response = window.prompt(`Switch to page:\n${promptLabel}`);
                if (!response) return;
                const trimmed = response.trim();
                if (!trimmed) return;
                const numeric = Number.parseInt(trimmed, 10);
                if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= pageList.length) {
                    handleActivatePage(pageList[numeric - 1].id);
                    return;
                }
                const match = pageList.find(
                    (page) => page.name && page.name.toLowerCase() === trimmed.toLowerCase()
                );
                if (match) {
                    handleActivatePage(match.id);
                }
            }
        };
        window.addEventListener('keydown', handlePageShortcuts);
        return () => window.removeEventListener('keydown', handlePageShortcuts);
    }, [handleAddPage, handleActivatePage]);

    // Helper: make a single selection (resets multi-select)
    function selectSingle(id) {
        setSelectedId(id || null);
        setSelectedIds(id ? [id] : []);
    }

    // Helper: toggle an id in the multi-select set
    const toggleSelect = (id) => {
        setSelectedIds((prev) => {
            const set = new Set(prev);
            if (set.has(id)) set.delete(id);
            else set.add(id);

            const arr = Array.from(set);
            // Keep "primary" aligned to most-recently toggled
            setSelectedId(arr.length ? id : null);
            return arr;
        });
    };

    const groupSelectedLayers = useCallback(() => {
        const ids = selectedIds.length >= 2 ? selectedIds : selectedId != null ? [selectedId] : [];
        if (ids.length < 1) return;
        const shapes = shapesRef.current;
        const idSet = new Set(ids);
        const selection = shapes.filter((shape) => idSet.has(shape.id));
        if (selection.length < 1) return;
        const parentIds = new Set(selection.map((shape) => shape.parentId ?? null));
        if (parentIds.size !== 1) return;
        const pageIds = new Set(selection.map((shape) => shape.pageId));
        if (pageIds.size !== 1) return;

        const bounds = unionBoundingBoxes(selection.map((shape) => getShapeBoundingBox(shape)).filter(Boolean));
        if (!bounds) return;

        const width = Math.max(1, bounds.right - bounds.left);
        const height = Math.max(1, bounds.bottom - bounds.top);
        const x = bounds.left + width / 2;
        const y = bounds.top + height / 2;

        const parentId = selection[0].parentId ?? null;
        const pageId = selection[0].pageId;
        const newGroup = {
            ...createShape('group', {
                parentId,
                pageId,
                x,
                y,
                width,
                height,
                clipChildren: false,
            }),
        };

        const orderedSelection = shapes.filter((shape) => idSet.has(shape.id));
        const selectionSet = new Set(orderedSelection.map((shape) => shape.id));
        const updatedChildren = orderedSelection.map((shape) => ({ ...shape, parentId: newGroup.id }));
        const baseState = shapes.map((shape) => ({ ...shape }));

        applyChange(
            (prev) => {
                const result = [];
                let inserted = false;
                let insertionIndex = -1;
                for (let index = 0; index < prev.length; index += 1) {
                    const shape = prev[index];
                    if (selectionSet.has(shape.id) && index > insertionIndex) {
                        insertionIndex = index;
                    }
                }

                prev.forEach((shape, index) => {
                    if (!inserted && index === insertionIndex) {
                        inserted = true;
                        result.push({ ...newGroup });
                        updatedChildren.forEach((child) => {
                            result.push({ ...child });
                        });
                    }
                    if (selectionSet.has(shape.id)) {
                        return;
                    }
                    result.push(shape);
                });

                if (!inserted) {
                    result.push({ ...newGroup });
                    updatedChildren.forEach((child) => {
                        result.push({ ...child });
                    });
                }

                return result;
            },
            { baseState }
        );

        setSelectedIds([newGroup.id]);
        setSelectedId(newGroup.id);
        lastLayerAnchorIndexRef.current = getLayerPanelIds().indexOf(newGroup.id);
    }, [applyChange, createShape, getLayerPanelIds, selectedId, selectedIds]);

    const ungroupSelectedLayers = useCallback(() => {
        const ids = selectedIds.length ? selectedIds : selectedId != null ? [selectedId] : [];
        if (!ids.length) return;
        const shapes = shapesRef.current;
        const groupShapes = ids
            .map((id) => shapes.find((shape) => shape.id === id && shape.type === 'group'))
            .filter(Boolean);
        if (!groupShapes.length) return;

        const groupIds = new Set(groupShapes.map((shape) => shape.id));
        const parentLookup = new Map(groupShapes.map((shape) => [shape.id, shape.parentId ?? null]));
        const childIdSet = new Set();
        shapes.forEach((shape) => {
            if (shape.parentId != null && parentLookup.has(shape.parentId)) {
                childIdSet.add(shape.id);
            }
        });

        const baseState = shapes.map((shape) => ({ ...shape }));
        applyChange(
            (prev) =>
                prev
                    .filter((shape) => !groupIds.has(shape.id))
                    .map((shape) => {
                        const parentId = shape.parentId ?? null;
                        if (parentLookup.has(parentId)) {
                            return { ...shape, parentId: parentLookup.get(parentId) };
                        }
                        return shape;
                    }),
            { baseState }
        );

        if (groupIds.size) {
            setCollapsedContainers((prev) => {
                if (!prev.size) return prev;
                const next = new Set(prev);
                let changed = false;
                groupIds.forEach((id) => {
                    if (next.delete(id)) changed = true;
                });
                return changed ? next : prev;
            });
        }

        const nextSelection = Array.from(childIdSet);
        if (nextSelection.length) {
            setSelectedIds(nextSelection);
            const primary = nextSelection[nextSelection.length - 1];
            setSelectedId(primary);
            lastLayerAnchorIndexRef.current = getLayerPanelIds().indexOf(primary);
        } else {
            setSelectedIds([]);
            setSelectedId(null);
            lastLayerAnchorIndexRef.current = null;
        }

        setActiveContainerPath((current) => {
            if (!Array.isArray(current)) return [null];
            const filtered = current.filter((id) => id == null || !groupIds.has(id));
            return filtered.length ? filtered : [null];
        });
    }, [applyChange, getLayerPanelIds, selectedId, selectedIds]);

    // Keep multi-select in sync when something else sets selectedId
    useEffect(() => {
        if (selectedId == null) {
            setSelectedIds([]);
        } else if (selectedIds.length === 0) {
            setSelectedIds([selectedId]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);


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
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            const uniformScale = Math.max(scaleX, scaleY);
            let baseRadius;
            if (typeof node.radius === 'function') {
                baseRadius = node.radius();
            } else if (typeof node.outerRadius === 'function') {
                baseRadius = node.outerRadius();
            } else {
                baseRadius = Number(node.getAttr('radius'));
            }
            if (!Number.isFinite(baseRadius) || baseRadius <= 0) {
                baseRadius = shape.radius || 0;
            }
            const newRadius = Math.max(1, baseRadius * uniformScale);
            const rotation = node.rotation() || 0;
            node.scaleX(1);
            node.scaleY(1);
            applyChange((prev) =>
                prev.map((s) =>
                    s.id === id
                        ? { ...s, radius: newRadius, x: node.x(), y: node.y(), rotation: snapAngle(rotation) }
                        : s
                )
            );
        } else if (shape.type === 'ellipse') {
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            let baseRadiusX;
            let baseRadiusY;
            if (typeof node.radiusX === 'function' && typeof node.radiusY === 'function') {
                baseRadiusX = node.radiusX();
                baseRadiusY = node.radiusY();
            } else {
                baseRadiusX = Number(node.getAttr('radiusX'));
                baseRadiusY = Number(node.getAttr('radiusY'));
            }
            if (!Number.isFinite(baseRadiusX) || baseRadiusX <= 0) {
                baseRadiusX = shape.radiusX || 0;
            }
            if (!Number.isFinite(baseRadiusY) || baseRadiusY <= 0) {
                baseRadiusY = shape.radiusY || 0;
            }
            const newRadiusX = Math.max(1, baseRadiusX * scaleX);
            const newRadiusY = Math.max(1, baseRadiusY * scaleY);
            const rotation = node.rotation() || 0;
            node.scaleX(1);
            node.scaleY(1);
            applyChange((prev) =>
                prev.map((s) =>
                    s.id === id
                        ? {
                              ...s,
                              radiusX: newRadiusX,
                              radiusY: newRadiusY,
                              x: node.x(),
                              y: node.y(),
                              rotation: snapAngle(rotation),
                          }
                        : s
                )
            );
        } else if (isPolygonLikeShape(shape)) {
            const scaleVal = node.scaleX();
            const newRadius = Math.max(1, node.radius() * scaleVal);
            const rotation = node.rotation() || 0;
            node.scaleX(1);
            node.scaleY(1);
            const sides = Math.max(3, Math.floor(shape.sides || 5));
            const snappedRotation = snapAngle(rotation);
            const updatedPoints = buildRegularPolygonPoints(
                { x: node.x(), y: node.y() },
                newRadius,
                sides,
                snappedRotation
            );
            applyChange((prev) =>
                prev.map((s) =>
                    s.id === id
                        ? {
                              ...s,
                              radius: newRadius,
                              cornerRadius: clampValue(Number(s.cornerRadius) || 0, 0, newRadius),
                              x: node.x(),
                              y: node.y(),
                              rotation: snappedRotation,
                              points: updatedPoints,
                          }
                        : s
                )
            );
        } else if (shape.type === 'line') {
            const rotation = node.rotation() || 0;
            const transform = typeof node.getTransform === 'function' ? node.getTransform().copy() : null;
            if (!transform) return;
            const rawPoints = typeof node.points === 'function' ? node.points() : [];
            const mappedPoints = [];
            for (let i = 0; i + 1 < rawPoints.length; i += 2) {
                const px = Number(rawPoints[i]);
                const py = Number(rawPoints[i + 1]);
                const mapped = transform.point({ x: Number.isFinite(px) ? px : 0, y: Number.isFinite(py) ? py : 0 });
                mappedPoints.push(mapped.x, mapped.y);
            }
            if (typeof node.position === 'function') {
                node.position({ x: 0, y: 0 });
            }
            if (typeof node.scaleX === 'function') node.scaleX(1);
            if (typeof node.scaleY === 'function') node.scaleY(1);
            applyChange((prev) =>
                prev.map((s) =>
                    s.id === id
                        ? { ...s, points: mappedPoints, rotation: snapAngle(rotation), x: 0, y: 0 }
                        : s
                )
            );
        } else if (shape.type === 'path') {
            const transform = typeof node.getTransform === 'function' ? node.getTransform().copy() : null;
            if (!transform) return;
            const mapPoint = (pt) => {
                const mapped = transform.point({ x: pt.x, y: pt.y });
                const nextPoint = clonePathPoint(pt) || createPathPoint({ x: mapped.x, y: mapped.y });
                nextPoint.x = mapped.x;
                nextPoint.y = mapped.y;
                if (pt.handles) {
                    nextPoint.handles = {};
                    if (pt.handles.left) {
                        const left = transform.point({ x: pt.handles.left.x, y: pt.handles.left.y });
                        nextPoint.handles.left = left;
                    }
                    if (pt.handles.right) {
                        const right = transform.point({ x: pt.handles.right.x, y: pt.handles.right.y });
                        nextPoint.handles.right = right;
                    }
                    if (!nextPoint.handles.left && !nextPoint.handles.right) {
                        delete nextPoint.handles;
                    }
                }
                return nextPoint;
            };
            const basePoints = getPathPoints(shape);
            const nextPoints = basePoints.map(mapPoint);
            node.position({ x: 0, y: 0 });
            node.scaleX(1);
            node.scaleY(1);
            node.rotation(0);
            applyChange((prev) =>
                prev.map((s) => (s.id === id ? { ...s, points: nextPoints } : s))
            );
        } else if (shape.type === 'text') {
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            const newWidth = Math.max(1, node.width() * scaleX);
            const newHeight = Math.max(1, node.height() * scaleY);
            const rotation = node.rotation() || 0;
            node.scaleX(1);
            node.scaleY(1);
            applyChange((prev) =>
                prev.map((s) =>
                    s.id === id
                        ? {
                            ...s,
                            x: node.x(),
                            y: node.y(),
                            width: newWidth,
                            height: newHeight,
                            rotation: snapAngle(rotation),
                        }
                        : s
                )
            )
        }
    };

    // Inline text editing: create a textarea overlay over the clicked Text node
    const openTextEditor = (shapeId) => {
        const stage = stageRef.current;
        if (!stage) return;
        const shape = shapesRef.current.find((s) => s.id === shapeId && s.type === 'text');
        if (!shape) return;
        const host = stageContainerRef.current || stage.container();
        if (!host) return;
        const textNode = stage.findOne(`#shape-${shape.id}`);
        if (!textNode) return;

        selectSingle(shape.id)

        const originalText = typeof shape.text === 'string' ? shape.text : '';
        const originalHeight =
            typeof shape.height === 'number'
                ? Math.max(1, shape.height)
                : Math.max(1, typeof textNode.height === 'function' ? textNode.height() : 0);
        const beforeState = shapesRef.current.map((s) => ({ ...s }));

        // create textarea and style it
        const textarea = document.createElement('textarea');
        textarea.value = originalText;
        textarea.setAttribute('aria-label', 'Edit text');
        textarea.setAttribute('spellcheck', 'false');
        textarea.setAttribute('autocapitalize', 'off');
        textarea.setAttribute('autocomplete', 'off');
        textarea.setAttribute('autocorrect', 'off');
        textarea.style.position = 'absolute';
        textarea.style.border = '1px solid transparent';
        textarea.style.padding = '0';
        textarea.style.margin = '0';
        textarea.style.background = 'transparent';
        textarea.style.outline = 'none';
        textarea.style.resize = 'none';
        textarea.style.whiteSpace = 'pre-wrap';
        textarea.style.overflowWrap = 'break-word';
        textarea.style.wordBreak = 'break-word';
        textarea.style.overflow = 'hidden';
        textarea.style.userSelect = 'text';
        textarea.style.pointerEvents = 'auto';

        const fontFamily = shape.fontFamily || (typeof textNode.fontFamily === 'function' ? textNode.fontFamily() : 'Inter');
        const fontStyle = shape.fontStyle || (typeof textNode.fontStyle === 'function' ? textNode.fontStyle() : 'normal');
        const isItalic = typeof fontStyle === 'string' && fontStyle.toLowerCase().includes('italic');
        const isBold = typeof fontStyle === 'string' &&
            (fontStyle.toLowerCase().includes('bold') || fontStyle.toLowerCase().includes('700'));
        textarea.style.fontFamily = fontFamily;
        textarea.style.fontStyle = isItalic ? 'italic' : 'normal';
        textarea.style.fontWeight = isBold ? 'bold' : 'normal';

        const fontSize =
            typeof shape.fontSize === 'number'
                ? shape.fontSize
                : typeof textNode.fontSize === 'function'
                    ? textNode.fontSize()
                    : 16;
        const lineHeightValue =
            typeof shape.lineHeight === 'number'
                ? shape.lineHeight
                : typeof textNode.lineHeight === 'function'
                    ? textNode.lineHeight()
                    : 1.2;
        const letterSpacingValue =
            typeof shape.letterSpacing === 'number'
                ? shape.letterSpacing
                : typeof textNode.letterSpacing === 'function'
                    ? textNode.letterSpacing()
                    : 0;
        const textAlignValue =
            typeof shape.align === 'string'
                ? shape.align
                : typeof textNode.align === 'function'
                    ? textNode.align()
                    : 'left';
        textarea.style.textAlign = textAlignValue;

        const fillColor = (() => {
            if (typeof shape.fill === 'string' && shape.fill.trim()) return shape.fill;
            const gradient = shape.fillGradient;
            if (gradient && Array.isArray(gradient.stops) && gradient.stops.length) {
                const first = gradient.stops.find((stop) => typeof stop.color === 'string' && stop.color.trim());
                if (first) return first.color;
            }
            return '#000000';
        })();
        textarea.style.color = fillColor;
        textarea.style.caretColor = fillColor;

        const rotation =
            typeof shape.rotation === 'number'
                ? shape.rotation
                : typeof textNode.rotation === 'function'
                    ? textNode.rotation()
                    : 0;

        let currentWidth =
            typeof shape.width === 'number'
                ? Math.max(1, shape.width)
                : Math.max(1, typeof textNode.width === 'function' ? textNode.width() : 0);
        let currentHeight = Math.max(1, originalHeight);
        const minLineHeight = Math.max(1, fontSize * lineHeightValue);

        const previousCursor = host.style.cursor;
        host.style.cursor = 'text';

        if (typeof textNode.hide === 'function') {
            textNode.hide();
            textNode.getLayer?.()?.batchDraw?.();
        }

        host.appendChild(textarea);

        const applyLayout = () => {
            const stageScaleX = stage.scaleX() || 1;
            const stageScaleY = stage.scaleY() || 1;
            const stageX = stage.x() || 0;
            const stageY = stage.y() || 0;
            const textPos = typeof textNode.getAbsolutePosition === 'function'
                ? textNode.getAbsolutePosition()
                : { x: shape.x || 0, y: shape.y || 0 };
            const displayWidth = Math.max(1, currentWidth * stageScaleX);
            const displayHeight = Math.max(1, currentHeight * stageScaleY);
            textarea.style.left = `${stageX + textPos.x * stageScaleX}px`;
            textarea.style.top = `${stageY + textPos.y * stageScaleY}px`;
            textarea.style.width = `${displayWidth}px`;
            textarea.style.height = `${displayHeight}px`;
            textarea.style.minHeight = `${minLineHeight * stageScaleY}px`;
            textarea.style.fontSize = `${fontSize * stageScaleY}px`;
            textarea.style.lineHeight = `${Math.max(minLineHeight, fontSize * lineHeightValue) * stageScaleY}px`;
            textarea.style.letterSpacing = `${letterSpacingValue * stageScaleX}px`;
            textarea.style.transformOrigin = 'top left';
            textarea.style.transform = `rotate(${rotation}deg)`;
        };

        const updateHeightFromContent = () => {
            const stageScaleY = stage.scaleY() || 1;
            textarea.style.height = 'auto';
            const minDisplayHeight = Math.max(minLineHeight * stageScaleY, textarea.scrollHeight);
            currentHeight = Math.max(1, minDisplayHeight / stageScaleY);
            textarea.style.height = `${minDisplayHeight}px`;
            return currentHeight;
        };

        const applyValue = (value, height = currentHeight) => {
            const nextHeight = Math.max(1, height);
            setShapes((prev) =>
                prev.map((s) =>
                    s.id === shape.id
                        ? {
                            ...s,
                            text: value,
                            height: nextHeight,
                        }
                        : s
                )
            );
        };

        const focusTextarea = () => {
            applyLayout();
            updateHeightFromContent();
            applyLayout();
            textarea.focus();
            if (typeof textarea.setSelectionRange === 'function') {
                const length = textarea.value.length;
                textarea.setSelectionRange(length, length);
            } else {
                textarea.select?.();
            }
        };

        let cancelled = false;
        let committed = false;

        const cleanup = () => {
            textarea.removeEventListener('input', onInput);
            textarea.removeEventListener('keydown', onKeyDown);
            textarea.removeEventListener('blur', onBlur);
            if (textarea.parentNode) textarea.parentNode.removeChild(textarea);
            if (typeof textNode.show === 'function') {
                textNode.show();
                textNode.getLayer?.()?.batchDraw?.();
            }
            stage.batchDraw?.();
            host.style.cursor = previousCursor;
        };

        const commit = (finalHeight = currentHeight) => {
            if (committed || cancelled) return;
            committed = true;
            const value = textarea.value;
            const normalizedHeight = Math.max(1, finalHeight);
            applyValue(value, normalizedHeight);
            const textChanged = value !== originalText;
            const heightChanged = Math.abs(normalizedHeight - originalHeight) > 0.01;
            if (textChanged || heightChanged) {
                pastRef.current.push(beforeState);
                if (pastRef.current.length > HISTORY_LIMIT) pastRef.current.shift();
                futureRef.current = [];
            }
            cleanup();
        };

        const cancel = () => {
            if (committed || cancelled) return;
            cancelled = true;
            if (originalText !== textarea.value || Math.abs(currentHeight - originalHeight) > 0.01) {
                setShapes((prev) =>
                    prev.map((s) =>
                        s.id === shape.id
                            ? {
                                ...s,
                                text: originalText,
                                height: originalHeight,
                            }
                            : s
                    )
                );
            }
            cleanup();
        };

        const onInput = () => {
            if (cancelled || committed) return;
            const measuredHeight = updateHeightFromContent();
            applyLayout();
            applyValue(textarea.value, measuredHeight);
        };

        const onKeyDown = (evt) => {
            if (evt.key === 'Enter' && !evt.shiftKey) {
                evt.preventDefault();
                const measuredHeight = updateHeightFromContent();
                applyLayout();
                commit(measuredHeight);
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                cancel();
            } else if (evt.key === 'Tab') {
                evt.preventDefault();
                const measuredHeight = updateHeightFromContent();
                applyLayout();
                commit(measuredHeight);
            }
            evt.stopPropagation();
        };

        const onBlur = () => {
            if (cancelled || committed) return;
            const measuredHeight = updateHeightFromContent();
            applyLayout();
            commit(measuredHeight);
        };

        textarea.addEventListener('input', onInput);
        textarea.addEventListener('keydown', onKeyDown);
        textarea.addEventListener('blur', onBlur);

        focusTextarea();
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
    const clipboardRef = useRef(null);
    const cutPendingRef = useRef(null);
    const clipboardMetaRef = useRef({ mode: 'cut' }); // 'copy' | 'cut'

    const gradientDragRef = useRef({ active: false, shapeId: null, type: null, stopIndex: null, before: null });





    // Initialize counters from current doc once (so numbering continues from what exists)
    useEffect(() => {
        nameCounters.clear();
        for (const s of shapesRef.current || []) {
            const key = String(s.type || 'Shape');
            const label = formatTypeLabel(key);
            // allow multi-digit suffixes
            const m = typeof s.name === 'string' ? s.name.match(new RegExp(`^${label} (\\d+)$`)) : null;
            const nextIdx = m ? parseInt(m[1], 10) + 1 : 0;
            nameCounters.set(key, Math.max(nameCounters.get(key) ?? 0, nextIdx));
        }
    }, []);

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

        if (nearCorner && isSelectLikeTool) {
            // show rotation cursor when hovering a corner in select mode
            setStageCursor('crosshair');
        } else {
            // restore based on tool
            if (selectedTool === 'hand') {
                setStageCursor(isPanningRef.current ? 'grabbing' : 'grab');
            } else if (isSelectLikeTool) {
                setStageCursor('default');
            } else {
                setStageCursor('crosshair');
            }
        }
    };

    const handleShapeMouseLeave = () => {
        if (selectedTool === 'hand') {
            setStageCursor(isPanningRef.current ? 'grabbing' : 'grab');
        } else if (isSelectLikeTool) {
            setStageCursor('default');
        } else {
            setStageCursor('crosshair');
        }
    };

    const handleShapeClick = (shape, event) => {
        if (!shape) return;
        try {
            if (event && typeof event.cancelBubble !== 'undefined') {
                event.cancelBubble = true;
            }
        } catch { }
        if (!isSelectLikeTool) return;
        if (shape?.locked) return;

        const shift = !!(event?.evt?.shiftKey || event?.shiftKey);
        const ctrlLike = !!(event?.evt?.metaKey || event?.evt?.ctrlKey || event?.metaKey || event?.ctrlKey);

        if (selectedTool === 'anchor') {
            enterAnchorModeForShape(shape.id);
            return;
        }

        if (shift || ctrlLike) {
            // Toggle this shape in the multi-select set
            toggleSelect(shape.id);
            return;
        }

        if (isContainerShape(shape)) {
            setSelectedId(shape.id);
            setSelectedIds([shape.id]);
            return;
        }
        const containerAncestor = getContainerAncestor(shape);
        if (containerAncestor) {
            setSelectedId(containerAncestor.id);
            setSelectedIds([containerAncestor.id]);
            return;
        }
        selectSingle(shape.id);
        lastLayerAnchorIndexRef.current = getLayerPanelIds().indexOf(shape.id);
    };

    // Helper: extract shape id (number) from a Konva node's id: "shape-123"
    const getShapeIdFromNode = (node) => {
        if (!node || typeof node.id !== 'function') return null;
        const idValue = node.id();
        const m = /^shape-(\d+)$/.exec(idValue || '');
        if (!m) return null;
        const n = Number(m[1]);
        return Number.isFinite(n) ? n : null;
    };

    const handleShapeDoubleClick = (shape, event) => {
        if (!shape) return;
        if (shape.locked) return;
        if (event && typeof event.cancelBubble !== 'undefined') event.cancelBubble = true;
        try { event?.target?.stopDrag?.(); } catch { } // kill any drag that may have started
        if (!isSelectLikeTool) return;

        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition?.() || null;

        if (isContainerShape(shape)) {
            // enter the container scope
            const path = getContainerPathForId(shape.id, shapesRef.current);
            setActiveContainerPath([null, ...path]);

            // pick a child immediately
            let childId = null;
            if (pointer) {
                childId = pickTopmostChildAtPoint(shape, pointer.x, pointer.y);
            }
            setSelectedId(childId ?? shape.id);

            // Make absolutely sure no drag continues from the dblclick gesture
            try { event?.target?.stopDrag?.(); } catch { }

            return;
        }

        // non-container: jump to its nearest container (if any)
        const containerAncestor = getContainerAncestor(shape, shapesRef.current);
        if (containerAncestor) {
            const path = getContainerPathForId(containerAncestor.id, shapesRef.current);
            setActiveContainerPath([null, ...path]);
        }
        if (shape.type === 'text') {
            openTextEditor(shape.id);
            return;
        }

        if (shape.type === 'path' || canConvertShapeToPath(shape)) {
            enterAnchorModeForShape(shape.id);
        } else {
            selectSingle(shape.id);
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

    const normalizeArcAttributes = (shape) => {
        const rawStart = Number(shape?.arcStart);
        const rawSweep = Number(shape?.arcSweep);
        const rawRatio = Number(shape?.arcRatio);
        const start = Number.isFinite(rawStart)
            ? ((rawStart % FULL_ARC_SWEEP) + FULL_ARC_SWEEP) % FULL_ARC_SWEEP
            : 0;
        const sweep = Number.isFinite(rawSweep) ? clampValue(rawSweep, 0, FULL_ARC_SWEEP) : FULL_ARC_SWEEP;
        const ratio = Number.isFinite(rawRatio) ? clampValue(rawRatio, 0, ARC_RATIO_MAX) : 0;
        return { start, sweep, ratio };
    };

    const shouldRenderArcForShape = (shape, radiusX, radiusY) => {
        if (!shape || radiusX <= 0 || radiusY <= 0) {
            return false;
        }
        const { sweep, ratio } = normalizeArcAttributes(shape);
        return sweep < FULL_ARC_SWEEP - 0.001 || ratio > ARC_EPSILON;
    };

    const drawArcPath = (ctx, radiusX, radiusY, start, sweep, ratio) => {
        const startRad = toRadians(start);
        const sweepRad = toRadians(sweep);
        if (sweepRad <= ARC_EPSILON) {
            const startX = radiusX * Math.cos(startRad);
            const startY = radiusY * Math.sin(startRad);
            ctx.moveTo(startX, startY);
            return;
        }

        const fullSweep = sweepRad >= Math.PI * 2 - ARC_EPSILON;
        const hasHole = ratio > ARC_EPSILON;
        const innerRadiusX = radiusX * ratio;
        const innerRadiusY = radiusY * ratio;

        if (fullSweep) {
            ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2, false);
            if (hasHole) {
                ctx.moveTo(innerRadiusX, 0);
                ctx.ellipse(0, 0, innerRadiusX, innerRadiusY, 0, 0, Math.PI * 2, true);
            }
            return;
        }

        const endRad = startRad + sweepRad;
        const startX = radiusX * Math.cos(startRad);
        const startY = radiusY * Math.sin(startRad);
        ctx.moveTo(startX, startY);
        ctx.ellipse(0, 0, radiusX, radiusY, 0, startRad, endRad, false);

        if (hasHole) {
            const innerEndX = innerRadiusX * Math.cos(endRad);
            const innerEndY = innerRadiusY * Math.sin(endRad);
            ctx.lineTo(innerEndX, innerEndY);
            ctx.ellipse(0, 0, innerRadiusX, innerRadiusY, 0, endRad, startRad, true);
        } else {
            ctx.lineTo(0, 0);
        }
    };

    const renderArcShape = (shape, radiusX, radiusY, commonProps, fillProps) => {
        const { start, sweep, ratio } = normalizeArcAttributes(shape);
        if (sweep <= ARC_EPSILON) {
            return null;
        }

        return (
            <Shape
                {...commonProps}
                x={shape.x}
                y={shape.y}
                rotation={shape.rotation || 0}
                {...fillProps}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
                radiusX={radiusX}
                radiusY={radiusY}
                arcStart={start}
                arcSweep={sweep}
                arcRatio={ratio}
                perfectDrawEnabled={false}
                sceneFunc={(ctx, node) => {
                    ctx.save();
                    ctx.beginPath();
                    drawArcPath(ctx, radiusX, radiusY, start, sweep, ratio);
                    ctx.closePath();
                    ctx.fillStrokeShape(node);
                    ctx.restore();
                }}
            />
        );
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
        const isSelectable = isSelectLikeTool;
        const isLocked = !!shape.locked;
        const canDragThis = isSelectable && !isLocked && Array.isArray(selectedIds) && selectedIds.includes(shape.id); // ✅ drag only if selected
        const commonProps = {
            key: shape.id,
            id: `shape-${shape.id}`,
            name: 'shape',
            draggable: canDragThis,
            listening: true,
            onClick: (e) => handleShapeClick(shape, e),
            onTap: (e) => handleShapeClick(shape, e),
            onDblClick: (e) => handleShapeDoubleClick(shape, e),
            onDblTap: (e) => handleShapeDoubleClick(shape, e),

            onDragStart: (e) => {
                if (!canDragThis) { try { e.cancelBubble = true; e.target.stopDrag(); } catch { }; return; }
                handleDragStart(shape.id, e);
            },

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
                const isSelected = Array.isArray(selectedIds) && selectedIds.includes(shape.id);
                return (
                    <Rect
                        {...commonProps}
                        name="group"
                        x={shape.x}
                        y={shape.y}
                        width={shape.width || 0}
                        height={shape.height || 0}
                        offset={{ x: (shape.width || 0) / 2, y: (shape.height || 0) / 2 }}
                        strokeEnabled={isSelected}
                        stroke={shape.stroke || 'rgba(100,116,139,0.9)'}
                        strokeWidth={shape.strokeWidth || 1}
                        dash={[6, 4]}
                        // groups don’t paint a fill (Figma-like behavior)
                        fillEnabled={false}
                        // but make selection easy
                        hitStrokeWidth={24}
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
                        cornerRadius={Math.max(0, shape.cornerRadius || 0)}
                        {...fillProps}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        rotation={shape.rotation || 0}
                    />
                );
            case 'circle': {
                const radius = Math.max(0, shape.radius || 0);
                if (shouldRenderArcForShape(shape, radius, radius)) {
                    return renderArcShape(shape, radius, radius, commonProps, fillProps);
                }
                return (
                    <Circle
                        {...commonProps}
                        x={shape.x}
                        y={shape.y}
                        radius={radius}
                        {...fillProps}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        rotation={shape.rotation || 0}
                    />
                );
            }
            case 'ellipse': {
                const radiusX = Math.max(0, shape.radiusX || 0);
                const radiusY = Math.max(0, shape.radiusY || 0);
                if (shouldRenderArcForShape(shape, radiusX, radiusY)) {
                    return renderArcShape(shape, radiusX, radiusY, commonProps, fillProps);
                }
                return (
                    <Ellipse
                        {...commonProps}
                        x={shape.x}
                        y={shape.y}
                        radiusX={radiusX}
                        radiusY={radiusY}
                        {...fillProps}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        rotation={shape.rotation || 0}
                    />
                );
            }
            case 'polygon':
            case 'roundedPolygon': {
                const radius = Math.max(1, shape.radius || 0);
                const sides = Math.max(3, Math.floor(shape.sides || 5));
                return (
                    <RegularPolygon
                        {...commonProps}
                        x={shape.x}
                        y={shape.y}
                        radius={radius}
                        sides={sides}
                        cornerRadius={Math.max(0, shape.cornerRadius || 0)}
                        {...fillProps}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth}
                        rotation={shape.rotation || 0}
                    />
                );
            }
            case 'line': {
                const points = Array.isArray(shape.points) ? shape.points : [];
                const hitWidth = Math.max(8, (shape.strokeWidth || 1) * 2);
                const dashArray = Array.isArray(shape.dash) ? shape.dash : undefined;
                return (
                    <Line
                        {...commonProps}
                        x={shape.x || 0}
                        y={shape.y || 0}
                        points={points}
                        stroke={shape.stroke}
                        strokeWidth={shape.strokeWidth || 1}
                        lineCap={shape.lineCap || 'round'}
                        lineJoin={shape.lineJoin || 'round'}
                        dash={dashArray}
                        dashEnabled={Array.isArray(dashArray) && dashArray.length > 0}
                        hitStrokeWidth={hitWidth}
                        tension={shape.tension || 0}
                        bezier={shape.bezier || false}
                        rotation={shape.rotation || 0}
                    />
                );
            }
            case 'path': {
                const pathPoints = getPathPoints(shape);
                const pathData = buildSvgPath(pathPoints, !!shape.closed);
                const strokeColor =
                    typeof shape.stroke === 'string' && shape.stroke.trim().length
                        ? shape.stroke
                        : '#000000';
                const strokeWidth =
                    typeof shape.strokeWidth === 'number' && shape.strokeWidth > 0
                        ? shape.strokeWidth
                        : 1;
                const pathFillProps = shape.closed ? fillProps : { fillEnabled: false };
                return (
                    <Path
                        {...commonProps}
                        data={pathData}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeEnabled={strokeWidth > 0}
                        lineCap={shape.lineCap || 'round'}
                        lineJoin={shape.lineJoin || 'round'}
                        {...pathFillProps}
                    />
                );
            }
            case 'text':
                return (
                    <Text
                        {...commonProps}
                        x={shape.x}
                        y={shape.y}
                        width={typeof shape.width === 'number' ? Math.max(1, shape.width) : undefined}
                        height={typeof shape.height === 'number' ? Math.max(1, shape.height) : undefined}
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
                        wrap="word"
                        listening={true}
                        onDblClick={() => openTextEditor(shape.id)}
                    />
                );
            default:
                return null;
        }
    };

    const renderGradientHandles = () => {
        if (!showGradientHandles) return null;
        const allowHandleVisibility = selectedTool === 'select' || selectedTool === 'hand';
        if (!allowHandleVisibility) return null;
        const canEditGradientHandles = selectedTool === 'select';
        if (!selectedId) return null;
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
            const localPoint = inverseTransform.point(pointer);
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
                            if (!canEditGradientHandles) return
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
        path: 'Path',
        text: 'Text',
    };

    // Map of shapes for quick parent lookups
    const shapesById = React.useMemo(() => {
        const m = new Map();
        shapes.forEach(s => m.set(s.id, s));
        return m;
    }, [shapes]);

    // Returns true if the shape has any frame as an ancestor
    const hasFrameAncestor = React.useCallback((shape) => {
        let pid = shape.parentId ?? null;
        while (pid != null) {
            const p = shapesById.get(pid);
            if (!p) break;
            if (p.type === 'frame') return true;
            pid = p.parentId ?? null;
        }
        return false;
    }, [shapesById]);

    const childrenMap = useMemo(() => {
        const map = new Map();
        map.set(null, []);
        shapesOnActivePage.forEach((shape) => {
            map.set(shape.id, []);
        });
        for (let i = shapesOnActivePage.length - 1; i >= 0; i -= 1) {
            const shape = shapesOnActivePage[i];
            const key = shape.parentId ?? null;
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key).push(shape);
        }
        return map;
    }, [shapesOnActivePage]);

    const [collapsedContainers, setCollapsedContainers] = useState(() => new Set());

    const layerList = useMemo(() => {
        const result = [];
        const visit = (parentId, depth) => {
            const siblings = childrenMap.get(parentId) || [];
            siblings.forEach((shape) => {
                result.push({ shape, depth });
                if (isContainerShape(shape) && !collapsedContainers.has(shape.id)) {
                    visit(shape.id, depth + 1);
                }
            });
        };
        visit(null, 0);
        return result;
    }, [childrenMap, collapsedContainers]);

    const getChildrenForRendering = useCallback(
        (parentId) => {
            const siblings = childrenMap.get(parentId) || [];
            if (siblings.length <= 1) {
                return siblings;
            }
            return [...siblings].reverse();
        },
        [childrenMap]
    );

    const renderShapeTree = (shape) => {
        if (!shape || shape.visible === false) {
            return null;
        }
        const node = renderShapeNode(shape);
        if (!isContainerShape(shape)) {
            return node;
        }
        const children = getChildrenForRendering(shape.id);
        const clipContent = shape.type === 'frame' && shape.clipContent || (shape.type === 'group' && shape.clipChildren);
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

    const renderLineHandles = () => {
        const allowHandles = selectedTool === 'line' || isSelectLikeTool;
        if (!allowHandles) return null;
        const ids = new Set(selectedIds.length ? selectedIds : selectedId != null ? [selectedId] : []);
        if (currentDrawingIdRef.current != null) {
            ids.add(currentDrawingIdRef.current);
        }
        if (!ids.size) return null;
        const stage = stageRef.current;
        const stageScale = stage ? stage.scaleX() || 1 : scale || 1;
        const radius = Math.max(4, 6 / stageScale);
        const stroke = Math.max(1, 2 / stageScale);
        const handlesInteractive = selectedTool !== 'line';
        const handles = [];
        for (let i = 0; i < shapesOnActivePage.length; i += 1) {
            const shape = shapesOnActivePage[i];
            if (!shape || shape.type !== 'line') continue;
            if (shape.visible === false || shape.locked) continue;
            if (!ids.has(shape.id)) continue;
            const points = Array.isArray(shape.points) ? shape.points : [];
            for (let j = 0; j + 1 < points.length; j += 2) {
                const x = Number(points[j]);
                const y = Number(points[j + 1]);
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                const pointIndex = j / 2;
                handles.push(
                    <Circle
                        key={`line-handle-${shape.id}-${pointIndex}`}
                        x={x}
                        y={y}
                        radius={radius}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth={stroke}
                        draggable={handlesInteractive}
                        listening={handlesInteractive}
                        hitStrokeWidth={Math.max(radius * 2, 16 / stageScale)}
                        onMouseDown={(evt) => {
                            if (!handlesInteractive) return;
                            evt.cancelBubble = true;
                            beginLineAnchorDrag(shape.id, pointIndex);
                        }}
                        onTouchStart={(evt) => {
                            if (!handlesInteractive) return;
                            evt.cancelBubble = true;
                            beginLineAnchorDrag(shape.id, pointIndex);
                        }}
                        onDragStart={(evt) => {
                            if (!handlesInteractive) return;
                            evt.cancelBubble = true;
                            beginLineAnchorDrag(shape.id, pointIndex);
                        }}
                        onDragMove={(evt) => {
                            if (!handlesInteractive) return;
                            evt.cancelBubble = true;
                            const pointer = getCanvasPointer();
                            if (!pointer) return;
                            updateLineAnchorFromPointer(shape.id, pointIndex, pointer);
                        }}
                        onDragEnd={(evt) => {
                            if (!handlesInteractive) return;
                            evt.cancelBubble = true;
                            const pointer = getCanvasPointer();
                            if (pointer) {
                                updateLineAnchorFromPointer(shape.id, pointIndex, pointer);
                            }
                            commitLineAnchorDrag();
                        }}
                    />
                );
            }
        }
        if (!handles.length) return null;
        return (
            <Group key="line-handle-layer" listening={handlesInteractive}>
                {handles}
            </Group>
        );
    };

    const renderPathEditor = () => {
        const allowEditing = selectedTool === 'path' || selectedTool === 'anchor';
        if (!allowEditing) return null;
        const primaryShape = selectedId
            ? shapes.find((s) => s.id === selectedId && s.type === 'path')
            : null;
        if (!primaryShape) return null;
        const points = getPathPoints(primaryShape);
        if (!points.length) return null;
        const selectedPointIndex =
            activePathSelection && activePathSelection.shapeId === primaryShape.id
                ? activePathSelection.index
                : null;
        const elements = [];
        const handleColor = '#38bdf8';
        const anchorColor = '#2563eb';
        const stageScale = stageRef.current ? stageRef.current.scaleX() : scale;
        const zoomSafeScale = stageScale || 1;
        const anchorSize = 8 / zoomSafeScale;
        const handleRadius = 4 / zoomSafeScale;

        const beginDrag = (shapeId, payload) => {
            pathHandleDragRef.current = {
                shapeId,
                baseState: shapesRef.current,
                ...payload,
            };
        };

        const endDrag = () => {
            pathHandleDragRef.current = null;
        };

        points.forEach((point, index) => {
            const anchorKey = `anchor-${primaryShape.id}-${index}`;
            if (point.handles?.left) {
                const left = point.handles.left;
                elements.push(
                    <Line
                        key={`handle-line-left-${anchorKey}`}
                        points={[point.x, point.y, left.x, left.y]}
                        stroke="#94a3b8"
                        strokeWidth={1}
                        dash={[4, 4]}
                        listening={false}
                    />
                );
                elements.push(
                    <Circle
                        key={`handle-left-${anchorKey}`}
                        x={left.x}
                        y={left.y}
                        radius={handleRadius}
                        fill="#ffffff"
                        stroke={handleColor}
                        strokeWidth={1}
                        draggable
                        onMouseDown={(evt) => {
                            evt.cancelBubble = true;
                            beginDrag(primaryShape.id, { index, side: 'left', type: 'handle' });
                        }}
                        onDragMove={(evt) => {
                            evt.cancelBubble = true;
                            movePathHandle(
                                primaryShape.id,
                                index,
                                'left',
                                { x: evt.target.x(), y: evt.target.y() },
                                !!evt.evt?.altKey
                            );
                        }}
                        onDragEnd={(evt) => {
                            evt.cancelBubble = true;
                            const baseState = pathHandleDragRef.current?.baseState || shapesRef.current;
                            movePathHandle(
                                primaryShape.id,
                                index,
                                'left',
                                { x: evt.target.x(), y: evt.target.y() },
                                !!evt.evt?.altKey,
                                { commit: true, baseState }
                            );
                            endDrag();
                        }}
                    />
                );
            }
            if (point.handles?.right) {
                const right = point.handles.right;
                elements.push(
                    <Line
                        key={`handle-line-right-${anchorKey}`}
                        points={[point.x, point.y, right.x, right.y]}
                        stroke="#94a3b8"
                        strokeWidth={1}
                        dash={[4, 4]}
                        listening={false}
                    />
                );
                elements.push(
                    <Circle
                        key={`handle-right-${anchorKey}`}
                        x={right.x}
                        y={right.y}
                        radius={handleRadius}
                        fill="#ffffff"
                        stroke={handleColor}
                        strokeWidth={1}
                        draggable
                        onMouseDown={(evt) => {
                            evt.cancelBubble = true;
                            beginDrag(primaryShape.id, { index, side: 'right', type: 'handle' });
                        }}
                        onDragMove={(evt) => {
                            evt.cancelBubble = true;
                            movePathHandle(
                                primaryShape.id,
                                index,
                                'right',
                                { x: evt.target.x(), y: evt.target.y() },
                                !!evt.evt?.altKey
                            );
                        }}
                        onDragEnd={(evt) => {
                            evt.cancelBubble = true;
                            const baseState = pathHandleDragRef.current?.baseState || shapesRef.current;
                            movePathHandle(
                                primaryShape.id,
                                index,
                                'right',
                                { x: evt.target.x(), y: evt.target.y() },
                                !!evt.evt?.altKey,
                                { commit: true, baseState }
                            );
                            endDrag();
                        }}
                    />
                );
            }

            const isSelected = selectedPointIndex === index;
            elements.push(
                <Rect
                    key={`anchor-node-${anchorKey}`}
                    x={point.x}
                    y={point.y}
                    width={anchorSize}
                    height={anchorSize}
                    offset={{ x: anchorSize / 2, y: anchorSize / 2 }}
                    fill={isSelected ? anchorColor : '#ffffff'}
                    stroke={anchorColor}
                    strokeWidth={isSelected ? 2 : 1}
                    cornerRadius={2}
                    draggable
                    onMouseDown={(evt) => {
                        evt.cancelBubble = true;
                        setActivePathSelection({ shapeId: primaryShape.id, index });
                        if (evt.evt?.altKey) {
                            const nextType =
                                point.type === PATH_NODE_TYPES.CORNER
                                    ? PATH_NODE_TYPES.SMOOTH
                                    : PATH_NODE_TYPES.CORNER;
                            setPathPointType(primaryShape.id, index, nextType, { commit: true });
                        }
                    }}
                    onDragStart={(evt) => {
                        evt.cancelBubble = true;
                        beginDrag(primaryShape.id, { index, type: 'anchor' });
                    }}
                    onDragMove={(evt) => {
                        evt.cancelBubble = true;
                        movePathAnchor(primaryShape.id, index, { x: evt.target.x(), y: evt.target.y() });
                    }}
                    onDragEnd={(evt) => {
                        evt.cancelBubble = true;
                        const baseState = pathHandleDragRef.current?.baseState || shapesRef.current;
                        movePathAnchor(
                            primaryShape.id,
                            index,
                            { x: evt.target.x(), y: evt.target.y() },
                            { commit: true, baseState }
                        );
                        endDrag();
                    }}
                />
            );
        });

        return <Group key={`path-editor-${primaryShape.id}`}>{elements}</Group>;
    };

    const renderCornerRadiusHandles = () => {
        if (!isSelectLikeTool) return null;
        if (!selectedId) return null;

        const shape = shapes.find((s) => s.id === selectedId);
        if (!shape) return null;

        // ✅ Only allow shapes we support, but don't require cornerRadius to already exist
        const supportsCornerRadius =
            shape.type === 'rectangle' ||
            isPolygonLikeShape(shape);
        if (!supportsCornerRadius) return null;

        const stageScale = stageRef.current ? stageRef.current.scaleX() : scale;
        const zoomSafeScale = stageScale || 1;
        const handleRadius = 6 / zoomSafeScale;

        if (shape.type === 'rectangle') {
            const width = Math.max(0, shape.width || 0);
            const height = Math.max(0, shape.height || 0);
            if (!width || !height) return null;
            const halfW = width / 2;
            const halfH = height / 2;
            const maxRadius = Math.min(halfW, halfH);
            const currentRadiusRaw = typeof shape.cornerRadius === 'number' ? shape.cornerRadius : 0;
            const currentRadius = clampValue(currentRadiusRaw, 0, maxRadius);
            const insetBase = Math.min(maxRadius, Math.max(currentRadius, 12 / zoomSafeScale));
            const rotation = Number.isFinite(shape.rotation) ? (shape.rotation * Math.PI) / 180 : 0;
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);
            const center = { x: shape.x || 0, y: shape.y || 0 };
            const toGlobal = (local) => ({
                x: center.x + local.x * cos - local.y * sin,
                y: center.y + local.x * sin + local.y * cos,
            });
            const toLocal = (global) => {
                const dx = global.x - center.x;
                const dy = global.y - center.y;
                return {
                    x: dx * cos + dy * sin,
                    y: -dx * sin + dy * cos,
                };
            };
            const updateCornerRadius = (nextRadius, { commit = false } = {}) => {
                const clamped = clampValue(nextRadius, 0, maxRadius);
                if (commit) {
                    applyChange((prev) =>
                        prev.map((s) => (s.id === shape.id ? { ...s, cornerRadius: clamped } : s))
                    );
                } else {
                    setShapes((prev) =>
                        prev.map((s) => (s.id === shape.id ? { ...s, cornerRadius: clamped } : s))
                    );
                }
                return clamped;
            };

            const handleConfigs = [
                { key: 'top-left', sx: -1, sy: -1 },
                { key: 'top-right', sx: 1, sy: -1 },
                { key: 'bottom-right', sx: 1, sy: 1 },
                { key: 'bottom-left', sx: -1, sy: 1 },
            ];

            return (
                <Group key={`corner-radius-${shape.id}`} listening={true}>
                    {handleConfigs.map(({ key, sx, sy }) => {
                        const local = {
                            x: sx * (halfW - insetBase),
                            y: sy * (halfH - insetBase),
                        };
                        const position = toGlobal(local);
                        return (
                            <Circle
                                key={`corner-radius-handle-${shape.id}-${key}`}
                                x={position.x}
                                y={position.y}
                                radius={handleRadius}
                                fill="#1d4ed8"
                                stroke="#ffffff"
                                strokeWidth={1 / zoomSafeScale}
                                draggable
                                onDragMove={(evt) => {
                                    evt.cancelBubble = true;
                                    const stage = evt.target.getStage();
                                    const pointer = stage?.getPointerPosition();
                                    if (!pointer) return;
                                    const localPointer = toLocal(pointer);
                                    const corner = { x: sx * halfW, y: sy * halfH };
                                    const dx = Math.abs(corner.x - localPointer.x);
                                    const dy = Math.abs(corner.y - localPointer.y);
                                    const candidate = Math.min(dx, dy);
                                    const applied = updateCornerRadius(candidate, { commit: false });
                                    const inset = Math.min(maxRadius, Math.max(applied, 12 / zoomSafeScale));
                                    const updatedLocal = {
                                        x: sx * (halfW - inset),
                                        y: sy * (halfH - inset),
                                    };
                                    const updatedGlobal = toGlobal(updatedLocal);
                                    evt.target.absolutePosition(updatedGlobal);
                                }}
                                onDragEnd={(evt) => {
                                    evt.cancelBubble = true;
                                    const stage = evt.target.getStage();
                                    const pointer = stage?.getPointerPosition();
                                    if (!pointer) return;
                                    const localPointer = toLocal(pointer);
                                    const corner = { x: sx * halfW, y: sy * halfH };
                                    const dx = Math.abs(corner.x - localPointer.x);
                                    const dy = Math.abs(corner.y - localPointer.y);
                                    const candidate = Math.min(dx, dy);
                                    const applied = updateCornerRadius(candidate, { commit: true });
                                    const inset = Math.min(maxRadius, Math.max(applied, 12 / zoomSafeScale));
                                    const updatedLocal = {
                                        x: sx * (halfW - inset),
                                        y: sy * (halfH - inset),
                                    };
                                    const updatedGlobal = toGlobal(updatedLocal);
                                    evt.target.absolutePosition(updatedGlobal);
                                }}
                            />
                        );
                    })}
                </Group>
            );
        }

        if (isPolygonLikeShape(shape)) {
            const radius = Math.max(0, shape.radius || 0);
            if (!radius) return null;
            const sides = Math.max(3, Math.floor(shape.sides || 5));
            const maxRadius = radius;
            const currentRadius = clampValue(Number(shape.cornerRadius) || 0, 0, maxRadius);
            const center = { x: shape.x || 0, y: shape.y || 0 };

            const vertices = buildRegularPolygonPoints(center, radius, sides, shape.rotation || 0);

            const updateCornerRadius = (nextRadius, { commit = false } = {}) => {
                const clamped = clampValue(nextRadius, 0, maxRadius);
                if (commit) {
                    applyChange((prev) =>
                        prev.map((s) => (s.id === shape.id ? { ...s, cornerRadius: clamped } : s))
                    );
                } else {
                    setShapes((prev) =>
                        prev.map((s) => (s.id === shape.id ? { ...s, cornerRadius: clamped } : s))
                    );
                }
                return clamped;
            };

            const handleNodes = [];
            for (let index = 0; index < vertices.length; index += 2) {
                const vx = vertices[index];
                const vy = vertices[index + 1];
                if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
                const vec = { x: vx - center.x, y: vy - center.y };
                const length = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
                if (!length) continue;
                const unit = { x: vec.x / length, y: vec.y / length };
                handleNodes.push({ key: index / 2, unit, vertexLength: length });
            }

            if (!handleNodes.length) return null;

            const node = handleNodes[0];
            const inset = Math.min(maxRadius, Math.max(currentRadius, 12 / zoomSafeScale));
            const distance = Math.max(0, node.vertexLength - inset);
            const baseX = center.x + node.unit.x * distance;
            const baseY = center.y + node.unit.y * distance;

            return (
                <Group key={`corner-radius-${shape.id}`} listening={true}>
                    <Circle
                        key={`corner-radius-handle-${shape.id}-${node.key}`}
                        x={baseX}
                        y={baseY}
                        radius={handleRadius}
                        fill="#1d4ed8"
                        stroke="#ffffff"
                        strokeWidth={1 / zoomSafeScale}
                        draggable
                        onDragMove={(evt) => {
                            evt.cancelBubble = true;
                            const stage = evt.target.getStage();
                            const pointer = stage?.getPointerPosition();
                            if (!pointer) return;

                            const dx = pointer.x - center.x;
                            const dy = pointer.y - center.y;
                            const pointerLength = Math.sqrt(dx * dx + dy * dy);

                            const candidate = clampValue(radius - pointerLength, 0, maxRadius);
                            const applied = updateCornerRadius(candidate, { commit: false });
                            const inset = Math.min(maxRadius, Math.max(applied, 12 / zoomSafeScale));
                            const distance = Math.max(0, node.vertexLength - inset);

                            evt.target.absolutePosition({
                                x: center.x + node.unit.x * distance,
                                y: center.y + node.unit.y * distance,
                            });
                        }}
                        onDragEnd={(evt) => {
                            evt.cancelBubble = true;
                            const stage = evt.target.getStage();
                            const pointer = stage?.getPointerPosition();
                            if (!pointer) return;

                            const dx = pointer.x - center.x;
                            const dy = pointer.y - center.y;
                            const pointerLength = Math.sqrt(dx * dx + dy * dy);

                            const candidate = clampValue(radius - pointerLength, 0, maxRadius);
                            const applied = updateCornerRadius(candidate, { commit: true });
                            const inset = Math.min(maxRadius, Math.max(applied, 12 / zoomSafeScale));
                            const distance = Math.max(0, node.vertexLength - inset);

                            evt.target.absolutePosition({
                                x: center.x + node.unit.x * distance,
                                y: center.y + node.unit.y * distance,
                            });
                        }}
                    />
                </Group>
            );
        }


        return null;
    };

    const toggleLayerCollapse = useCallback((shapeId) => {
        if (shapeId == null) return;
        setCollapsedContainers((prev) => {
            const next = new Set(prev);
            if (next.has(shapeId)) {
                next.delete(shapeId);
            } else {
                next.add(shapeId);
            }
            return next;
        });
    }, []);

    const [draggedLayerId, setDraggedLayerId] = useState(null);
    const [dragOverLayerId, setDragOverLayerId] = useState(null);
    const [dragOverZone, setDragOverZone] = useState(null);
    const isDraggingLayer = draggedLayerId != null;

    const reorderLayers = (sourceId, targetId, dropType) => {
        if (!sourceId || !targetId || sourceId === targetId) return;
        applyChange((prev) => {
            const sourceIndex = prev.findIndex((shape) => shape.id === sourceId);
            const targetIndex = prev.findIndex((shape) => shape.id === targetId);
            if (sourceIndex === -1 || targetIndex === -1) return prev;
            const sourceShape = prev[sourceIndex];
            const targetShape = prev[targetIndex];
            if (sourceShape.pageId !== targetShape.pageId) {
                return prev;
            }
            const sourceSubtreeIds = new Set([
                sourceShape.id,
                ...collectDescendantIds(prev, sourceShape.id),
            ]);
            if (sourceSubtreeIds.has(targetId)) {
                return prev;
            }
            const subtree = prev.filter((shape) => sourceSubtreeIds.has(shape.id));
            const remaining = prev.filter((shape) => !sourceSubtreeIds.has(shape.id));
            const baseInsertIndex = remaining.findIndex((shape) => shape.id === targetId);
            if (baseInsertIndex === -1) {
                return prev;
            }

            const normalizedDrop = dropType === 'inside' || dropType === 'before' || dropType === 'after'
                ? dropType
                : 'after';

            let insertIndex = baseInsertIndex;
            let nextParentId = sourceShape.parentId ?? null;

            if (normalizedDrop === 'inside') {
                if (!isContainerShape(targetShape) || targetShape.locked) {
                    return prev;
                }
                nextParentId = targetShape.id;
                insertIndex += 1;
            } else if (normalizedDrop === 'after') {
                nextParentId = targetShape.parentId ?? null;
                insertIndex += 1;
                while (insertIndex < remaining.length) {
                    const candidate = remaining[insertIndex];
                    if (isDescendantOf(candidate.id, targetId, prev)) {
                        insertIndex += 1;
                    } else {
                        break;
                    }
                }
            } else if (normalizedDrop === 'before') {
                nextParentId = targetShape.parentId ?? null;
            }

            const updatedSubtree = subtree.map((shape) => {
                if (shape.id === sourceShape.id) {
                    return { ...shape, parentId: nextParentId };
                }
                return shape;
            });

            const result = [
                ...remaining.slice(0, insertIndex),
                ...updatedSubtree,
                ...remaining.slice(insertIndex),
            ];
            return result;
        });
    };

    const handleLayerDrop = (event, targetId) => {
        event.preventDefault();
        if (!draggedLayerId || !targetId) return;

        const bounds = event.currentTarget.getBoundingClientRect();
        const relativeY = bounds.height ? (event.clientY - bounds.top) / bounds.height : 0.5;
        let dropType = 'after';
        if (relativeY < 0.25) dropType = 'before';
        else if (relativeY > 0.75) dropType = 'after';
        else dropType = 'inside';
        const targetShape = shapesRef.current.find((shape) => shape.id === targetId) || null;
        if (dropType === 'inside' && (!targetShape || !isContainerShape(targetShape) || targetShape.locked)) {
            dropType = 'after';
        }
        reorderLayers(draggedLayerId, targetId, dropType);
        if (dropType === 'inside') {
            setCollapsedContainers((prev) => {
                const next = new Set(prev);
                next.delete(targetId);
                return next;
            });
        }
        setDraggedLayerId(null);
        setDragOverLayerId(null);
        setDragOverZone(null);
    };

    const handleLayerDragEnd = () => {
        setDraggedLayerId(null);
        setDragOverLayerId(null);
        setDragOverZone(null);
    };


    const handleLayerSelect = (shapeId, event) => {
        const isCtrlLike = Boolean(event?.metaKey || event?.ctrlKey);
        const isShift = Boolean(event?.shiftKey);

        // If you were dragging a layer, ignore clicks that end the drag
        if (isDraggingLayer) return;

        const ids = getLayerPanelIds();
        const clickedIndex = ids.indexOf(shapeId);

        // First selection in a session sets the anchor
        if (lastLayerAnchorIndexRef.current == null || (!isShift && !isCtrlLike)) {
            lastLayerAnchorIndexRef.current = clickedIndex;
        }

        if (isShift && lastLayerAnchorIndexRef.current != null) {
            // Range select: from anchor to clicked
            selectRangeByIndex(lastLayerAnchorIndexRef.current, clickedIndex);
            return;
        }

        if (isCtrlLike) {
            // Toggle membership
            toggleSelect(shapeId);
            // Update anchor to this row so next Shift uses it
            lastLayerAnchorIndexRef.current = ids.indexOf(shapeId);
            return;
        }
        selectSingle(shapeId);
        lastLayerAnchorIndexRef.current = clickedIndex;
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
    }, [scale, stagePos]);

    const handlePagesSectionResizeStart = useCallback(
        (event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) {
                return;
            }
            const panelElement = sidePanelRef.current;
            if (!panelElement) return;
            if (typeof event.clientY !== 'number') return;

            event.preventDefault();
            event.stopPropagation();

            const handleElement = event.currentTarget;
            const pointerId = event.pointerId;
            const startY = event.clientY;
            const startHeight = pagesSectionHeight;

            const applyHeight = (clientY) => {
                if (typeof clientY !== 'number') return;
                const delta = clientY - startY;
                const rect = panelElement.getBoundingClientRect();
                const maxHeight = rect.height - LAYERS_SECTION_MIN_HEIGHT;
                const minHeight = PAGES_SECTION_MIN_HEIGHT;
                const nextHeight = clampValue(
                    startHeight + delta,
                    minHeight,
                    Math.max(minHeight, maxHeight)
                );
                setPagesSectionHeight((current) =>
                    Math.abs(current - nextHeight) < 0.5 ? current : nextHeight
                );
            };

            const handlePointerMove = (moveEvent) => {
                applyHeight(moveEvent.clientY);
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
        [pagesSectionHeight, sidePanelRef]
    );

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

    return (
        <div style={{ display: 'flex', height: '100%' }}>
            <LayersPanel
                ref={sidePanelRef}
                width={layerPanelWidth}
                minWidth={LAYER_PANEL_MIN_WIDTH}
                maxWidth={LAYER_PANEL_MAX_WIDTH}
            >
                <div
                    style={{
                        flex: '0 0 auto',
                        height: pagesSectionHeight,
                        minHeight: PAGES_SECTION_MIN_HEIGHT,
                        borderBottom: '1px solid #e5e7eb',
                        overflow: 'hidden',
                    }}
                >
                    <PagesPanel
                        pages={pages}
                        activePageId={activePageId}
                        counts={pageShapeCounts}
                        onActivate={handleActivatePage}
                        onAdd={handleAddPage}
                        onRename={handleRenamePage}
                        onDuplicate={handleDuplicatePage}
                        onDelete={(pageId) => handleDeletePage(pageId)}
                        onReorder={handleReorderPages}
                        style={{ height: '100%' }}
                    />
                </div>
                <div
                    role="separator"
                    aria-orientation="horizontal"
                    onPointerDown={handlePagesSectionResizeStart}
                    style={{
                        flex: '0 0 auto',
                        height: 1,
                        padding: '0',
                        cursor: 'row-resize',
                        display: 'flex',
                        alignItems: 'stretch',
                        touchAction: 'none',
                        background: 'transparent',
                    }}
                >
                    <div
                        style={{
                            flex: 1,
                            borderTop: '1px solid #dfe3eb',
                            borderBottom: '1px solid #dfe3eb',
                            background: '#f3f5f9',
                        }}
                    />
                </div>
                <div
                    style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        background: '#fdfdfd',
                    }}
                >
                    <div
                        style={{
                            padding: '12px 12px 8px',
                            fontWeight: 600,
                            fontSize: 14,
                            color: '#555',
                            borderBottom: '1px solid #eaeaea',
                        }}
                    >
                        Layers
                    </div>
                    <div
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '8px 12px 12px',
                        }}
                    >
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
                                        reorderLayers(draggedLayerId, topShapeId, 'before');
                                        setDraggedLayerId(null);
                                        setDragOverLayerId(null);
                                        setDragOverZone(null);
                                    }}
                                    style={{
                                        height: isDraggingLayer ? 12 : 0,
                                        margin: isDraggingLayer ? '0 0 8px' : 0,
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
                                    const isSelected = selectedIds.includes(shape.id);
                                    const swatchColor = shape.fill || shape.stroke || '#ccc';
                                    const isDragged = shape.id === draggedLayerId;
                                    const isDragOver =
                                        shape.id === dragOverLayerId && draggedLayerId !== dragOverLayerId;
                                    const isContainer = isContainerShape(shape);
                                    const isCollapsed = isContainer && collapsedContainers.has(shape.id);
                                    const indent = depth * 16;

                                    return (
                                        <div
                                            key={shape.id}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                marginBottom: 4,
                                                paddingLeft: indent,
                                            }}
                                        >
                                            {isContainer ? (
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        toggleLayerCollapse(shape.id);
                                                    }}
                                                    style={{
                                                        width: 18,
                                                        height: 18,
                                                        border: 'none',
                                                        background: 'transparent',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: '#64748b',
                                                        fontSize: 10,
                                                    }}
                                                    aria-label={isCollapsed ? 'Expand layer' : 'Collapse layer'}
                                                >
                                                    <span
                                                        style={{
                                                            display: 'inline-block',
                                                            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                                                            transition: 'transform 0.12s ease',
                                                        }}
                                                    >
                                                        ▶
                                                    </span>
                                                </button>
                                            ) : (
                                                <span style={{ width: 18 }} />
                                            )}
                                            <button
                                                type="button"
                                                onClick={(e) => handleLayerSelect(shape.id, e)}
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
                                                        setDragOverLayerId((current) =>
                                                            current === shape.id ? null : current
                                                        );
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
                                        if (!isDraggingLayer || layerList.length === 0) return;
                                        event.preventDefault();
                                        const bottomShapeId = layerList[layerList.length - 1]?.shape?.id;
                                        if (!bottomShapeId) return;
                                        reorderLayers(draggedLayerId, bottomShapeId, 'after');
                                        setDraggedLayerId(null);
                                        setDragOverLayerId(null);
                                        setDragOverZone(null);
                                    }}
                                    style={{
                                        height: isDraggingLayer ? 12 : 0,
                                        margin: isDraggingLayer ? '8px 0 0' : 0,
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
                    </div>
                </div>
            </LayersPanel>

            <div
                role="separator"
                aria-orientation="vertical"
                onPointerDown={handleLayerResizeStart}
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
                    dragDistance={4}   // ✅ small buffer so tiny movements during dblclick don't start a drag
                    onWheel={handleWheel}
                    onMouseMove={handleStageMouseMove}
                    onMouseUp={handleStageMouseUp}
                    onDblClick={(e) => handleStageDoubleClick(e)}
                >
                    <Layer>
                        {getChildrenForRendering(null).map((shape) => renderShapeTree(shape))}

                        <Transformer
                            ref={trRef}
                            rotationEnabled={false}
                            rotateEnabled={false}
                            rotationAnchorOffset={-9999}
                            enabledAnchors={[
                                'top-left',
                                'top-center',
                                'top-right',
                                'middle-right',
                                'bottom-right',
                                'bottom-center',
                                'bottom-left',
                                'middle-left',
                            ]}
                            hitStrokeWidth={24}
                            keepRatio={false}
                            centeredScaling={false}
                        />
                    </Layer>
                    {/* Frame name labels: separate layer so they aren't clipped by frames */}
                    <Layer listening={true}>
                        {shapesOnActivePage
                            .filter((s) => s.type === 'frame' && s.visible !== false && (s.width || 0) > 0 && (s.height || 0) > 0)
                            .map(renderFrameNameLabel)}
                    </Layer>
                    <Layer listening={false}>
                        {marqueeRect && marqueeRect.width > 0 && marqueeRect.height > 0 && (
                            <Rect
                                x={marqueeRect.x}
                                y={marqueeRect.y}
                                width={marqueeRect.width}
                                height={marqueeRect.height}
                                stroke="#4d90fe"
                                strokeWidth={1}
                                dash={[6, 4]}
                                fill="rgba(77, 144, 254, 0.12)"
                                listening={false}
                                shadowForStrokeEnabled={false}
                                perfectDrawEnabled={false}
                            />
                        )}
                    </Layer>
                    <Layer listening={selectedTool === 'line' || isSelectLikeTool}>
                        {renderLineHandles()}
                    </Layer>
                    <Layer listening={selectedTool === 'path' || isSelectLikeTool}>
                        {renderPathEditor()}
                    </Layer>
                    <Layer listening={isSelectLikeTool}>{renderCornerRadiusHandles()}</Layer>
                    <Layer listening={isSelectLikeTool}>{renderGradientHandles()}</Layer>
                    <PixelGrid
                        scale={scale}
                        stagePos={stagePos}
                        viewport={{
                            width: stageSize.width,
                            height: stageSize.height
                        }}
                        minScaleToShow={8} // visible at 800%
                    //color={isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.22)"}
                    />
                </Stage>
                {/* Zoom percentage display */}
                <div
                    style={{
                        position: 'absolute',
                        right: 12,
                        bottom: 12,
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        padding: '4px 10px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontFamily: 'Inter, sans-serif',
                        zIndex: 20,
                        pointerEvents: 'none',
                        userSelect: 'none',
                    }}
                >
                    {Math.round(scale * 100)}%
                </div>
            </div>


        </div>
    );
}

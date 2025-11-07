import React, { useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import { Stage, Layer, Rect, Circle, Ellipse, Group, Line, Text, Transformer } from 'react-konva';
import PagesPanel from './PagesPanel';
import LayersPanel from './LayersPanel';
import PropertiesPanel from './PropertiesPanel';
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
const PAGES_SECTION_MIN_HEIGHT = 140;
const LAYERS_SECTION_MIN_HEIGHT = 180;
const PAGES_SECTION_DEFAULT_HEIGHT = 220;

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
        case 'line':
        case 'pen': {
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
    useEffect(() => {
        pagesRef.current = pages;
    }, [pages]);
    const activePageRef = useRef(activePageId);
    useEffect(() => {
        activePageRef.current = activePageId;
    }, [activePageId]);

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
            case 'pen': {
                const pts = Array.isArray(shape.points) ? shape.points : [];
                const tol = (shape.strokeWidth || 2) + 3;
                for (let i = 0; i + 3 < pts.length; i += 2) {
                    if (pointNearSegment(px, py, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], tol)) return true;
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
         const width = Math.max(1, frame.width || 1);
         const height = Math.max(1, frame.height || 1);
         // If your frame.x / frame.y are TOP-LEFT already, set useTopLeft = true.
        const useTopLeft = false; // flip to true if your data is top-left based

        // Current canvas zoom (you already pass this to <Stage scaleX/scaleY={scale}>)
        const s = Math.max(0.01, scale || 1);   // stage scale
        const inv = 1 / s;                      // inverse scale for constant-size UI

         const xLeft = (frame.x || 0) - (useTopLeft ? 0 : width / 2);
         const yTop = (frame.y || 0) - (useTopLeft ? 0 : height / 2);
         const label = (frame.name?.trim()) || `Frame ${frame.id}`;
      
             // visual metrics
             const fontSize = 11;
         const paddingX = 4;                   // extra breathing room for text
         const hitWidth = Math.max(80, width); // wider click target than text
         const hitHeight = fontSize + 6;       // tall enough to be easy to click
         const labelY = yTop - (hitHeight + 0);// sits slightly above top edge
      
             return (
                   <Group
                        key= {`frame-label-${frame.id}`}
                        x={ xLeft }
                     y={labelY}
                     // Scale content inversely so it stays constant-size on screen
                     scaleX={inv}
                     scaleY={inv}
                        onMouseEnter={ (e) => { e.target.getStage().container().style.cursor = 'pointer'; } }
                        onMouseLeave={ (e) => { e.target.getStage().container().style.cursor = 'default'; } }
                        onMouseDown={
                            (e) => {
                                    e.cancelBubble = true;          // don't let it fall through
                                selectSingle(frame.id)        // your existing select handler
                                const nativeEvt = e.evt;
                                requestAnimationFrame(() => {
                                    const stage = stageRef.current;
                                    if (!stage) return;
                                    const node = stage.findOne(`#shape-${frame.id}`); // ← use existing ids
                                    if (node && node.draggable && node.draggable()) {
                                        try { node.startDrag(nativeEvt); } catch { }
                                    }
                                });
                        }}
              >
             {/* Transparent hit area for easy clicking */ }
       <Rect
x={ 0 }
           y={ 0 }
           width={ hitWidth }
           height={ hitHeight }
           fill="rgba(0,0,0,0.001)"        // minimal alpha so it receives events
       cornerRadius={ 4 }
         />
       <Text
x={ paddingX }
           y={ (hitHeight - fontSize) / 2 - 1 } // vertically center text
           width={ width - paddingX }
           text={ label }
           align="left"                   // ← left aligned as requested
       fontFamily="Inter"
           fontSize={ fontSize }
           fill="#334155"
       listening={ false }              // clicks go to the Rect, not the Text
         />
           </Group >
             );
   };


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
            if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedIds.length || selectedId)) {
                e.preventDefault();
                const idsToRemove = new Set(selectedIds.length ? selectedIds : [selectedId]);
                applyChange((prev) => prev.filter((shape) => !idsToRemove.has(shape.id)));
                setSelectedId(null);
                setSelectedIds([]);
                setSelectedId(null);
                return;
            }
            // 🟢 Duplicate (Ctrl/Cmd + D)
            if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleDuplicate();
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
        getLayerPanelIds,
        groupSelectedLayers,
        redo,
        selectedId,
        selectedIds,
        undo,
        ungroupSelectedLayers,
    ]);

    useEffect(() => {
        const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
        if (!ids.length) return;

        // Only apply on shapes that can have fills
        const supportsFill = new Set(['rectangle', 'circle', 'ellipse', 'text', 'frame']);
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
        // Active selection (multi preferred, else single)
        const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
        if (!ids.length) return;

        // Shapes that can have stroke
        const supportsStroke = new Set(['rectangle', 'circle', 'ellipse', 'line', 'pen', 'text', 'frame']);
        const selectedSet = new Set(ids);

        // Desired stroke from the panel
        const desiredStroke = resolvedStrokeColor;                     // string like '#000000'
        const desiredType = resolvedStrokeType;                      // e.g., 'solid'
        const desiredWidth = typeof strokeWidth === 'number' ? strokeWidth : 0;

        // Quick no-op guard: if nothing would change, bail
        const needsChange = (() => {
            const src = shapesRef.current;
            for (let i = 0; i < src.length; i++) {
                const s = src[i];
                if (!selectedSet.has(s.id) || !supportsStroke.has(s.type)) continue;
                const curWidth = typeof s.strokeWidth === 'number' ? s.strokeWidth : 0;
                const curStroke = typeof s.stroke === 'string' ? s.stroke : null;
                const curType = typeof s.strokeType === 'string' ? s.strokeType : 'solid';
                if (curWidth !== desiredWidth || curStroke !== desiredStroke || curType !== desiredType) {
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
                    strokeWidth: desiredWidth,
                };
            })
        );
        setTimeout(() => { strokeTxnRef.current = false; }, 0);
    }, [
        applyChange,
        resolvedStrokeColor,   // color from panel
        resolvedStrokeType,    // 'solid' etc.
        strokeWidth,           // numeric width
        selectedIds, selectedId
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

        if (selectedTool === 'select' && clickedOnEmpty) {
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

        // PEN tool: begin freehand stroke anywhere
        if (selectedTool === 'pen') {
            const effectiveStrokeWidth = typeof strokeWidth === 'number' && strokeWidth > 0 ? strokeWidth : 1;
            const pos = getCanvasPointer();
            if (!pos) return;
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
            isDrawingRef.current = true;
            currentDrawingIdRef.current = newShape.id;
            drawingStartRef.current = pos;
            setSelectedId(null);
            currentDrawingIdRef.current = newShape.id;
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
        const dragTools = ['rectangle', 'circle', 'ellipse', 'line', 'frame', 'group'];
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
            applyChange((prev) => insertShapeAtTop(prev, newShape));
            selectSingle(newShape.id);
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
            applyChange((prev) => insertShapeAtTop(prev, newShape));
            pendingTextEditRef.current = newShape.id;
            setSelectedId(newShape.id);
            if (typeof onToolChange === 'function') onToolChange('select');
        }
    };

    
    // handle mouse move for panning (hand tool) and drawing
    const handleStageMouseMove = () => {
        const stage = stageRef.current;
        if (!stage) return;
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

            // If using PEN, append points to the active stroke and return
            if (selectedTool === 'pen') {
                setShapes((prev) => prev.map((s) => {
                       if (s.id !== id || s.type !== 'pen') return s;
                       const pts = s.points || [];
                       const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
                       if (lx != null && ly != null) {
                             const dx = pos.x - lx, dy = pos.y - ly;
                             if (dx * dx + dy * dy < 0.25) return s; // <0.5px
                           }
                       return { ...s, points: [...pts, pos.x, pos.y] };
                     }));
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

        if (marqueeStateRef.current.active) {
            const { start, end } = marqueeStateRef.current;
            resetMarquee();
            if (!start || !end) {
                if (selectedTool === 'select') setStageCursor('default');
                return;
            }
            const rect = rectFromPoints(start, end);
            if (!rect || rect.width < 2 || rect.height < 2) {
                if (selectedTool === 'select') setStageCursor('default');
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
            if (selectedTool === 'select') setStageCursor('default');
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
        const nodes = ids
            .map((id) => stage.findOne(`#shape-${id}`))
            .filter(Boolean);

        tr.nodes(nodes);
        if (typeof tr.setAttrs === 'function') {
            tr.setAttrs(transformerConfig);
        }
        tr.getLayer()?.batchDraw?.();
    }, [selectedIds, selectedId, shapes, selectedTool]);

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
            // update this node and its descendants’ positions
            let positioned = prev.map((s) => {
                if (s.id === id) return { ...s, x, y };
                if (current && isContainerShape(current) && isDescendantOf(s.id, id, prev)) {
                    return { ...s, x: (s.x || 0) + deltaX, y: (s.y || 0) + deltaY };
                }
                return s;
            });

            // if parent changed, move this node to TOP of new parent’s stack
            if (current && nextParentId !== previousParentId) {
                return moveShapeToParentTop(positioned, id, nextParentId);
            }
            return positioned;
        });
    };

    // NEW: multi-select state. We'll still keep selectedId as the "primary".
    const [selectedIds, setSelectedIds] = useState([]);

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
    const selectSingle = (id) => {
        setSelectedId(id || null);
        setSelectedIds(id ? [id] : []);
    };

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
        try {
            if (event && typeof event.cancelBubble !== 'undefined') {
                event.cancelBubble = true;
            }
        } catch { }
        if (selectedTool !== 'select') return;
        if (shape?.locked) return;

        const shift = !!(event?.evt?.shiftKey || event?.shiftKey);
        const ctrlLike = !!(event?.evt?.metaKey || event?.evt?.ctrlKey || event?.metaKey || event?.ctrlKey);
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
        if (selectedTool !== 'select') return;

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
        selectSingle(shape.id);
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
        const isSelectable = selectedTool === 'select';
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
            onDragStart: (e) => { if (!canDragThis) { try { e.cancelBubble = true; e.target.stopDrag(); } catch { } } }, // ✅ guard
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
        pen: 'Pen',
        text: 'Text',
    };

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
                    <Layer listening={selectedTool === 'select'}>{renderGradientHandles()}</Layer>
                </Stage>
            </div>


        </div>
    );
}

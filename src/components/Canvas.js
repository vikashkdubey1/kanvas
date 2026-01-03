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

const normalizeStyleList = (styles, fallbackList, { allowEmpty = true } = {}) => {
    const list = Array.isArray(styles)
        ? [...styles]
        : styles
            ? [styles]
            : [];
    if (Array.isArray(styles)) {
        return list;
    }
    if (!allowEmpty && list.length === 0) {
        return [...fallbackList];
    }
    return list.length ? list : [...fallbackList];
};

const parseColorToRgba = (value, fallback = { r: 217, g: 217, b: 217, a: 1 }) => {
    if (typeof value === 'string') {
        const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hexMatch) {
            const hex = hexMatch[1];
            const isShort = hex.length === 3;
            const r = parseInt(isShort ? hex[0] + hex[0] : hex.slice(0, 2), 16);
            const g = parseInt(isShort ? hex[1] + hex[1] : hex.slice(2, 4), 16);
            const b = parseInt(isShort ? hex[2] + hex[2] : hex.slice(4, 6), 16);
            return { r, g, b, a: 1 };
        }
        const rgbaMatch = value.match(/rgba?\s*\(([^)]+)\)/i);
        if (rgbaMatch) {
            const parts = rgbaMatch[1]
                .split(',')
                .map((p) => Number.parseFloat(p.trim()))
                .filter((n) => Number.isFinite(n));
            const [r, g, b, a = 1] = parts;
            if (parts.length >= 3) {
                return { r: clampValue(r, 0, 255), g: clampValue(g, 0, 255), b: clampValue(b, 0, 255), a: clampValue(a, 0, 1) };
            }
        }
    }
    return fallback;
};

const colorFromStyle = (style, fallbackColor = '#d9d9d9') => {
    if (!style) {
        const fb = parseColorToRgba(fallbackColor);
        return { ...fb };
    }
    if (style.type === 'gradient') {
        const gradient = normalizeGradient(style.value);
        const stop = gradient.stops?.[0];
        const color = getGradientFirstColor(gradient, fallbackColor);
        const base = parseColorToRgba(color, parseColorToRgba(fallbackColor));
        const opacity = typeof stop?.opacity === 'number' ? clampValue(stop.opacity, 0, 1) : 1;
        return { ...base, a: opacity };
    }
    const base = parseColorToRgba(style.value, parseColorToRgba(fallbackColor));
    return { ...base };
};

// Return alpha for a style entry (solid or gradient). Defaults to 1.
const getStyleAlpha = (style) => {
    const rgba = colorFromStyle(style);
    return clampValue(rgba.a ?? 1, 0, 1);
};

// Pick the first visible style (alpha > 0) from a list (top-first). Returns both style and color.
const pickVisibleStyle = (styles, fallbackColor) => {
    const list = Array.isArray(styles)
        ? styles.filter((entry) => entry && !entry?.meta?.hidden)
        : styles
            ? [styles].filter((entry) => entry && !entry?.meta?.hidden)
            : [];
    for (let i = 0; i < list.length; i += 1) {
        const style = list[i];
        const alpha = getStyleAlpha(style);
        const hasAlpha = typeof alpha === 'number' && alpha > 0.0001;
        if (!hasAlpha) continue;
        if (style.type === 'gradient') {
            const gradient = normalizeGradient(style.value);
            return { style, color: getGradientFirstColor(gradient, fallbackColor) };
        }
        return { style, color: normalizeColor(style.value, fallbackColor) };
    }
    return { style: null, color: fallbackColor };
};

const compositeStyles = (styles, fallbackColor) => {
    const list = Array.isArray(styles)
        ? styles.filter((entry) => entry && !entry?.meta?.hidden)
        : styles
            ? [styles].filter((entry) => entry && !entry?.meta?.hidden)
            : [];
    if (!list.length) {
        return 'rgba(0,0,0,0)';
    }
    let acc = colorFromStyle({ type: 'solid', value: fallbackColor });
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const cur = colorFromStyle(list[i], fallbackColor);
        const a = clampValue(cur.a ?? 1, 0, 1);
        const inv = 1 - a;
        acc = {
            r: Math.round(cur.r * a + acc.r * inv),
            g: Math.round(cur.g * a + acc.g * inv),
            b: Math.round(cur.b * a + acc.b * inv),
            a: clampValue(a + acc.a * inv, 0, 1),
        };
    }
    return `rgba(${acc.r},${acc.g},${acc.b},${acc.a})`;
};

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
            // If polygon has actual points (real geometry), use bounding box of those points
            console.log("Shape bounding box");
            if (Array.isArray(shape.points) && shape.points.length > 0) {
                const bounds = getPointsBoundingBox(
                    shape.points.map(p => ({ x: p.x, y: p.y }))
                );
                if (bounds) {
                    return {
                        width: Math.max(0, bounds.right - bounds.left),
                        height: Math.max(0, bounds.bottom - bounds.top),
                    };
                    
                }
            }

            // Fallback: old behavior (radius based)
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

function buildRegularPolygonPoints(center, radius, sides, rotationDegrees = 0) {
    const resolvedSides = clampValue(Math.floor(sides || 0), 3, 60);
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

const MAX_POLYGON_SIDES = 60;

const RoundedRegularPolygon = ({
    x = 0,
    y = 0,
    radius = 0,
    sides = 3,
    cornerRadius = 0,
    rotation = 0,
    ...shapeProps
}) => {
    const clampedSides = Math.max(3, Math.min(MAX_POLYGON_SIDES, Math.floor(sides || 0)));
    const resolvedRadius = Math.max(0, radius || 0);
    const resolvedCornerRadius = Math.max(0, cornerRadius || 0);

    return (
        <Shape
            x={x}
            y={y}
            rotation={rotation}
            {...shapeProps}
            sceneFunc={(ctx, shape) => {
                if (clampedSides < 3 || resolvedRadius <= 0) {
                    return;
                }

                // Draw around (0, 0); Konva applies node rotation.
                const points = buildRegularPolygonPoints(
                    { x: 0, y: 0 },
                    resolvedRadius,
                    clampedSides,
                    0
                );

                const total = points.length / 2;
                if (total < 3) {
                    return;
                }

                ctx.beginPath();

                if (resolvedCornerRadius <= 0) {
                    // Sharp-corner polygon
                    ctx.moveTo(points[0], points[1]);
                    for (let i = 1; i < total; i += 1) {
                        const px = points[i * 2];
                        const py = points[i * 2 + 1];
                        ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.fillStrokeShape(shape);
                    return;
                }

                const getPoint = (index) => {
                    const idx = ((index % total) + total) % total;
                    return {
                        x: points[idx * 2],
                        y: points[idx * 2 + 1],
                    };
                };

                const distance = (a, b) => {
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    return Math.sqrt(dx * dx + dy * dy) || 0;
                };

                const moveTowards = (from, to, by) => {
                    const dist = distance(from, to);
                    if (!dist) return { x: from.x, y: from.y };
                    const t = by / dist;
                    return {
                        x: from.x + (to.x - from.x) * t,
                        y: from.y + (to.y - from.y) * t,
                    };
                };

                for (let i = 0; i < total; i += 1) {
                    const p0 = getPoint(i - 1);
                    const p1 = getPoint(i);
                    const p2 = getPoint(i + 1);

                    const d01 = distance(p1, p0);
                    const d12 = distance(p2, p1);

                    const r = Math.min(resolvedCornerRadius, d01 / 2, d12 / 2);

                    const p1a = moveTowards(p1, p0, r);
                    const p1b = moveTowards(p1, p2, r);

                    if (i === 0) {
                        ctx.moveTo(p1a.x, p1a.y);
                    } else {
                        ctx.lineTo(p1a.x, p1a.y);
                    }

                    ctx.arcTo(p1.x, p1.y, p1b.x, p1b.y, r);
                }

                ctx.closePath();
                ctx.fillStrokeShape(shape);
            }}
        />
    );
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
    alignRequest = null,
    onAlignRequestHandled = null,
}) {
    const primaryFillStyle = Array.isArray(fillStyle) ? fillStyle[0] : fillStyle;
    const primaryStrokeStyle = Array.isArray(strokeStyle) ? strokeStyle[0] : strokeStyle;

    const normalizedFillStyles = useMemo(
        () => normalizeStyleList(fillStyle, [{ type: 'solid', value: '#d9d9d9' }]),
        [fillStyle]
    );
    const visibleFill = useMemo(
        () => pickVisibleStyle(normalizedFillStyles, '#d9d9d9'),
        [normalizedFillStyles]
    );
    const resolvedFillType = visibleFill.style?.type || 'solid';
    const resolvedFillGradient = useMemo(
        () =>
            resolvedFillType === 'gradient'
                ? normalizeGradient(visibleFill.style?.value)
                : null,
        [resolvedFillType, visibleFill.style?.value]
    );
    const resolvedFillColor = useMemo(
        () => compositeStyles(normalizedFillStyles, 'rgba(0,0,0,0)'),
        [normalizedFillStyles]
    );

    const normalizedStrokeStyles = useMemo(
        () => normalizeStyleList(strokeStyle, [{ type: 'solid', value: '#000000' }]),
        [strokeStyle]
    );
    const visibleStroke = useMemo(
        () => pickVisibleStyle(normalizedStrokeStyles, '#000000'),
        [normalizedStrokeStyles]
    );
    const resolvedStrokeType = visibleStroke.style?.type || 'solid';
    const resolvedStrokeColor = useMemo(
        () => compositeStyles(normalizedStrokeStyles, 'rgba(0,0,0,0)'),
        [normalizedStrokeStyles]
    );
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
    const [measurementOverlay, setMeasurementOverlay] = useState(null);

    useEffect(() => {
        const handleKeyUp = (e) => {
            if (!e.altKey && measurementOverlay) {
                setMeasurementOverlay(null);
            }
        };
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [measurementOverlay]);


    const [shapes, setShapes] = useState([]);
    const shapesRef = useRef(shapes);
    // Keep id counter ahead of any numeric ids already in state (e.g., after loading persisted data)
    useEffect(() => {
        const maxId = shapes.reduce((max, shape) => {
            const val = typeof shape?.id === 'number' && Number.isFinite(shape.id) ? shape.id : max;
            return val > max ? val : max;
        }, 0);
        if (maxId + 1 > idCounterRef.current) {
            idCounterRef.current = maxId + 1;
        }
    }, [shapes]);

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

    // Insert a new shape at the TOP of its parent (i.e., before existing siblings)
    // parentId null => top of root; otherwise top within that container
    const insertShapeAtTop = (prevShapes, shape) => {
        const parentKey = shape.parentId ?? null;
        const firstSibling = prevShapes.findIndex((s) => (s.parentId ?? null) === parentKey);
        if (firstSibling === -1) {
            // no siblings yet for that parent — append
            return [...prevShapes, shape];
        }
        const next = [...prevShapes];
        next.splice(firstSibling, 0, shape);
        return next;
    };

    const insertShapeAboveSibling = (prevShapes, shape, anchorId) => {
        const parentKey = shape.parentId ?? null;
        if (anchorId != null) {
            const anchorIndex = prevShapes.findIndex((s) => s.id === anchorId);
            if (anchorIndex >= 0 && (prevShapes[anchorIndex].parentId ?? null) === parentKey) {
                const next = [...prevShapes];
                next.splice(anchorIndex, 0, shape); // place directly above the anchor
                return next;
            }
        }
        return insertShapeAtTop(prevShapes, shape);
    };

    const getInsertAnchorForParent = (parentId) => {
        const lastSelectedId = selectedIds?.length ? selectedIds[selectedIds.length - 1] : selectedId;
        if (!lastSelectedId) return null;
        const anchorShape = getShapeById(lastSelectedId, shapesRef.current);
        if (anchorShape && (anchorShape.parentId ?? null) === (parentId ?? null)) {
            return anchorShape.id;
        }
        return null;
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

    const focusNextLayer = (direction = 1) => {
        const ids = getLayerPanelIds();
        if (!ids.length) return null;
        const primary = selectedId ?? (selectedIds.length ? selectedIds[selectedIds.length - 1] : null);
        const currentIndex = primary != null ? ids.indexOf(primary) : -1;
        const nextIndex = (currentIndex + direction + ids.length) % ids.length;
        const nextId = ids[nextIndex];
        selectSingle(nextId);
        lastLayerAnchorIndexRef.current = nextIndex;
        if (typeof onToolChange === 'function') onToolChange('select');
        return nextId;
    };

    const focusNextTextLayerEdit = (currentId, direction = 1) => {
        const textIds = (layerList || [])
            .map(({ shape }) => shape)
            .filter((shape) => shape.type === 'text')
            .map((shape) => shape.id);
        if (!textIds.length) return;
        if (textIds.length === 1 && textIds[0] === currentId) return;
        const currentIndex = currentId != null ? textIds.indexOf(currentId) : -1;
        const nextIndex = (currentIndex + direction + textIds.length) % textIds.length;
        const nextId = textIds[nextIndex];
        setSelectedId(nextId);
        setSelectedIds([nextId]);
        requestAnimationFrame(() => openTextEditor(nextId));
    };

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
    const activeTextEditIdRef = useRef(null);
    const lastFillStylesRef = useRef(null);
    const lastStrokeStylesRef = useRef(null);

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
            type === 'frame'
                ? null
                : overrides.parentId !== undefined
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
            fillStyles: normalizeStyleList(
                overrides.fillStyles ?? fillStyle,
                [{ type: 'solid', value: '#d9d9d9' }],
                { allowEmpty: false }
            ),
            strokeStyles: normalizeStyleList(
                overrides.strokeStyles ?? strokeStyle,
                [{ type: 'solid', value: '#000000' }],
                { allowEmpty: true }
            ),
            layoutWidthMode: overrides.layoutWidthMode || 'fixed',
            layoutHeightMode: overrides.layoutHeightMode || 'fixed',
            ...overrides,
        };
        return shape;
    };

    const getShapeById = (id, source = activeShapesRef.current) => {
        if (id == null) return null;
        return source.find((shape) => shape.id === id) || null;
    };

    const getContainerIdAtPoint = (point) => {
        if (!point) return null;
        const container = findContainerAtPoint(point, new Set(), activeShapesRef.current);
        return container ? container.id : null;
    };

    const applyAutoLayoutForParent = (source, parentId) => {
        const parent = source.find((s) => s.id === parentId);
        if (!parent || parent.layout !== 'auto') return source;
        const children = source.filter((s) => s.parentId === parentId && s.visible !== false);
        if (!children.length) return source;

        const layoutFlow = parent.layoutFlow || 'stack';
        const axis = parent.layoutAxis === 'horizontal' ? 'horizontal' : 'vertical';
        const spacing = Number.isFinite(parent.layoutSpacing) ? parent.layoutSpacing : 8;
        const padRaw = parent.layoutPadding;
        const pad =
            typeof padRaw === 'number'
                ? { top: padRaw, right: padRaw, bottom: padRaw, left: padRaw }
                : {
                    top: Number.isFinite(padRaw?.top) ? padRaw.top : 12,
                    right: Number.isFinite(padRaw?.right) ? padRaw.right : 12,
                    bottom: Number.isFinite(padRaw?.bottom) ? padRaw.bottom : 12,
                    left: Number.isFinite(padRaw?.left) ? padRaw.left : 12,
                };
        const alignCross = parent.layoutAlignCross || parent.layoutAlign || 'start'; // cross-axis
        const alignMain = parent.layoutAlignMain || 'start'; // along flow axis
        const parentMainMode = axis === 'vertical' ? parent.layoutHeightMode || 'fixed' : parent.layoutWidthMode || 'fixed';
        const parentCrossMode = axis === 'vertical' ? parent.layoutWidthMode || 'fixed' : parent.layoutHeightMode || 'fixed';

        // Split auto-positioned vs absolute children
        const orderMap = new Map();
        source.forEach((s, idx) => orderMap.set(s.id, idx));

        const autoChildren = children
            .filter((c) => (c.layoutPositioning || 'auto') === 'auto')
            .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
        const absoluteChildren = children.filter((c) => (c.layoutPositioning || 'auto') === 'absolute');

        const childDims = children.map((child) => {
            const dim = getShapeDimensions(child);
            return {
                id: child.id,
                width: dim.width || 0,
                height: dim.height || 0,
                shape: child,
            };
        });

        const padMain = axis === 'vertical' ? pad.top + pad.bottom : pad.left + pad.right;
        const padCross = axis === 'vertical' ? pad.left + pad.right : pad.top + pad.bottom;

        const parentMainFixed =
            axis === 'vertical'
                ? Math.max(0, (parent.height || 0) - padMain)
                : Math.max(0, (parent.width || 0) - padMain);
        const parentCrossFixed =
            axis === 'vertical'
                ? Math.max(0, (parent.width || 0) - padCross)
                : Math.max(0, (parent.height || 0) - padCross);

        if (layoutFlow === 'grid') {
            const colGap = Number.isFinite(parent.layoutGridColumnGap) ? parent.layoutGridColumnGap : spacing;
            const rowGap = Number.isFinite(parent.layoutGridRowGap) ? parent.layoutGridRowGap : spacing;
            const colsFromParent = Math.max(1, Math.floor(parent.layoutGridColumns || 0));
            const cols = colsFromParent > 0 ? colsFromParent : Math.max(1, Math.ceil(Math.sqrt(autoChildren.length || 1)));
            const requestedRows = Math.max(1, Math.floor(parent.layoutGridRows || 0));
            let rows = requestedRows > 0 ? requestedRows : Math.max(1, Math.ceil(autoChildren.length / cols));
            const neededCells = autoChildren.length;
            if (neededCells > rows * cols) {
                rows = Math.max(rows, Math.ceil(neededCells / cols));
            }
            const parentInnerWidth = Math.max(0, (parent.width || 0) - pad.left - pad.right);
            const parentInnerHeight = Math.max(0, (parent.height || 0) - pad.top - pad.bottom);
            const colMode = parent.layoutGridColumnMode || 'fixed';
            const rowMode = parent.layoutGridRowMode || 'fixed';

            const dims = autoChildren.map((child) => {
                const dim = getShapeDimensions(child);
                return { id: child.id, width: dim.width || 0, height: dim.height || 0, shape: child };
            });

            const colWidths = new Array(cols).fill(0);
            const rowHeights = new Array(rows).fill(0);
            const maxChildWidth = Math.max(0, ...dims.map((d) => d.width));
            const maxChildHeight = Math.max(0, ...dims.map((d) => d.height));
            const baseColWidth = (() => {
                if (colMode === 'fill') {
                    const totalGap = Math.max(0, cols - 1) * colGap;
                    return cols > 0 ? Math.max(0, (parentInnerWidth - totalGap) / cols) : 0;
                }
                if (colMode === 'hug') {
                    return Math.max(1, maxChildWidth || 1);
                }
                return Math.max(0, (parentInnerWidth - Math.max(0, cols - 1) * colGap) / cols);
            })();
            const baseRowHeight = (() => {
                if (rowMode === 'fill') {
                    const totalGap = Math.max(0, rows - 1) * rowGap;
                    return rows > 0 ? Math.max(0, (parentInnerHeight - totalGap) / rows) : 0;
                }
                if (rowMode === 'hug') {
                    return Math.max(1, maxChildHeight || 1);
                }
                return Math.max(0, (parentInnerHeight - Math.max(0, rows - 1) * rowGap) / rows);
            })();
            autoChildren.forEach((child, idx) => {
                const dim = dims.find((d) => d.id === child.id) || { width: 0, height: 0 };
                const row = Math.floor(idx / cols);
                const col = idx % cols;
                colWidths[col] = Math.max(colWidths[col], dim.width, baseColWidth);
                rowHeights[row] = Math.max(rowHeights[row], dim.height, baseRowHeight);
            });
            // ensure empty columns/rows still get base size
            for (let c = 0; c < cols; c += 1) {
                colWidths[c] = Math.max(colWidths[c], baseColWidth);
            }
            for (let r = 0; r < rows; r += 1) {
                rowHeights[r] = Math.max(rowHeights[r], baseRowHeight);
            }

            const contentWidth =
                colWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, cols - 1) * colGap;
            const contentHeight =
                rowHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, rows - 1) * rowGap;

            const newWidth =
                (parent.layoutWidthMode || 'fixed') === 'hug'
                    ? contentWidth + pad.left + pad.right
                    : parent.width || contentWidth + pad.left + pad.right;
            const newHeight =
                (parent.layoutHeightMode || 'fixed') === 'hug'
                    ? contentHeight + pad.top + pad.bottom
                    : parent.height || contentHeight + pad.top + pad.bottom;

            const startX = parent.x - newWidth / 2 + pad.left;
            const startY = parent.y - newHeight / 2 + pad.top;

            const colOffsets = [];
            colWidths.reduce((acc, w, idx) => {
                colOffsets[idx] = acc;
                return acc + w + colGap;
            }, 0);
            const rowOffsets = [];
            rowHeights.reduce((acc, h, idx) => {
                rowOffsets[idx] = acc;
                return acc + h + rowGap;
            }, 0);

            const updated = new Map();
            autoChildren.forEach((child, idx) => {
                const row = Math.floor(idx / cols);
                const col = idx % cols;
                const width = colWidths[col] || 0;
                const height = rowHeights[row] || 0;
                const x = startX + (colOffsets[col] || 0) + width / 2;
                const y = startY + (rowOffsets[row] || 0) + height / 2;
                updated.set(child.id, { x, y });
            });

            let changed = false;
            const result = source.map((s) => {
                if (s.id === parentId) {
                    const same =
                        Math.abs((s.width || 0) - newWidth) < 0.001 &&
                        Math.abs((s.height || 0) - newHeight) < 0.001;
                    changed = changed || !same;
                    return { ...s, width: newWidth, height: newHeight };
                }
                if (updated.has(s.id)) {
                    const pos = updated.get(s.id);
                    const same =
                        Math.abs((s.x || 0) - pos.x) < 0.001 &&
                        Math.abs((s.y || 0) - pos.y) < 0.001;
                    changed = changed || !same;
                    return {
                        ...s,
                        x: pos.x,
                        y: pos.y,
                        layoutPositioning: 'auto',
                    };
                }
                return s;
            });
            return changed ? result : source;
        }

        // Resolve sizes for auto children (stack flow)
        const autoEntries = autoChildren.map((child) => {
            const dim = childDims.find((d) => d.id === child.id) || { width: 0, height: 0 };
            const mainMode = (axis === 'vertical' ? child.layoutHeightMode : child.layoutWidthMode) || 'fixed';
            const crossMode = (axis === 'vertical' ? child.layoutWidthMode : child.layoutHeightMode) || 'fixed';
            const intrinsicMain = axis === 'vertical' ? dim.height : dim.width;
            const intrinsicCross = axis === 'vertical' ? dim.width : dim.height;
            let mainSize = intrinsicMain;
            let crossSize = intrinsicCross;

            if (mainMode === 'fixed') {
                mainSize = axis === 'vertical' ? (child.height || intrinsicMain) : (child.width || intrinsicMain);
            }
            // hug uses intrinsicMain (already)
            const entry = {
                id: child.id,
                mainMode,
                crossMode,
                intrinsicMain,
                intrinsicCross,
                mainSize,
                crossSize,
            };
            return entry;
        });

        const mainSpacingCount = Math.max(0, autoEntries.length - 1);
        const spacingTotal = mainSpacingCount * spacing;

        const sumFixedMain = autoEntries.reduce((sum, entry) => {
            if (entry.mainMode === 'fill') return sum;
            return sum + entry.mainSize;
        }, 0);
        const maxCrossNonFill = autoEntries.reduce((max, entry) => {
            if (entry.crossMode === 'fill') return max;
            return Math.max(max, entry.crossSize);
        }, 0);
        const fillCount = autoEntries.filter((e) => e.mainMode === 'fill').length;

        // Determine parent main/cross inner sizes
        let innerMain = parentMainFixed;
        let innerCross = parentCrossFixed;

        // If parent hugs main axis, compute after sizes; still need base available for fill resolution
        if (parentMainMode === 'hug') {
            const totalMain = sumFixedMain + spacingTotal + autoEntries
                .filter((e) => e.mainMode === 'fill')
                .reduce((sum, e) => sum + e.intrinsicMain, 0);
            innerMain = totalMain;
        }
        if (parentCrossMode === 'hug') {
            const crossUsed = Math.max(maxCrossNonFill, ...autoEntries.map((e) => e.crossSize));
            innerCross = crossUsed;
        }

        // Resolve fill sizes along main axis when parent is fixed
        if (fillCount > 0 && parentMainMode !== 'hug') {
            const availableMain = Math.max(0, innerMain - sumFixedMain - spacingTotal);
            const fillShare = availableMain / fillCount;
            autoEntries.forEach((entry) => {
                if (entry.mainMode === 'fill') {
                    entry.mainSize = fillShare;
                }
            });
        } else {
            // If parent hugs, fill behaves like hug (use intrinsic)
            autoEntries.forEach((entry) => {
                if (entry.mainMode === 'fill') {
                    entry.mainSize = entry.intrinsicMain;
                }
            });
        }

        // Resolve cross fill/stretch via align = stretch
        autoEntries.forEach((entry) => {
            if (entry.crossMode === 'fill' || alignCross === 'stretch') {
                entry.crossSize = innerCross;
            }
        });

        const totalContentMain =
            autoEntries.reduce((sum, e) => sum + e.mainSize, 0) + spacingTotal;
        const newInnerMain =
            parentMainMode === 'hug' ? totalContentMain : innerMain;
        const newInnerCross =
            parentCrossMode === 'hug'
                ? Math.max(
                    innerCross,
                    autoEntries.reduce((max, e) => Math.max(max, e.crossSize), 0)
                )
                : innerCross;

        const newWidth =
            axis === 'vertical'
                ? newInnerCross + pad.left + pad.right
                : newInnerMain + pad.left + pad.right;
        const newHeight =
            axis === 'vertical'
                ? newInnerMain + pad.top + pad.bottom
                : newInnerCross + pad.top + pad.bottom;

        const startMain = axis === 'vertical' ? parent.y - newHeight / 2 + pad.top : parent.x - newWidth / 2 + pad.left;
        const startCross = axis === 'vertical' ? parent.x - newWidth / 2 + pad.left : parent.y - newHeight / 2 + pad.top;

        const extraMain = newInnerMain - totalContentMain;
        let offsetMain = 0;
        const spacingStep = spacing;
        if (extraMain > 0) {
            if (alignMain === 'center') {
                offsetMain = extraMain / 2;
            } else if (alignMain === 'end') {
                offsetMain = extraMain;
            }
        }

        const updated = new Map();
        autoEntries.forEach((entry, idx) => {
            const mainCenter = startMain + offsetMain + entry.mainSize / 2;
            let crossOffset = 0;
            if (alignCross === 'center') {
                crossOffset = (newInnerCross - entry.crossSize) / 2;
            } else if (alignCross === 'end') {
                crossOffset = newInnerCross - entry.crossSize;
            } else if (alignCross === 'stretch') {
                crossOffset = 0;
            } else {
                crossOffset = 0; // start
            }
            const crossCenter = startCross + crossOffset + entry.crossSize / 2;

            const nextX = axis === 'vertical' ? crossCenter : mainCenter;
            const nextY = axis === 'vertical' ? mainCenter : crossCenter;

            // Only position children; do not resize them
            updated.set(entry.id, { x: nextX, y: nextY });

            offsetMain += entry.mainSize + spacingStep;
        });

        let changed = false;
        const result = source.map((s) => {
            if (s.id === parentId) {
                const nextParent = {
                    ...s,
                    width: newWidth,
                    height: newHeight,
                };
                const same =
                    Math.abs((s.width || 0) - newWidth) < 0.001 &&
                    Math.abs((s.height || 0) - newHeight) < 0.001;
                changed = changed || !same;
                return nextParent;
            }
            if (updated.has(s.id)) {
                const pos = updated.get(s.id);
                const same =
                    Math.abs((s.x || 0) - pos.x) < 0.001 &&
                    Math.abs((s.y || 0) - pos.y) < 0.001;
                changed = changed || !same;
                return { ...s, x: pos.x, y: pos.y };
            }
            return s;
        });
        return changed ? result : source;
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
        (shapeId, options = {}) => {
            if (!shapeId) return null;

            const currentShapes = shapesRef.current;
            const index = currentShapes.findIndex((s) => s.id === shapeId);
            if (index === -1) return null;

            const shape = currentShapes[index];
            if (!shape) return null;

            // Already a path? nothing to do
            if (shape.type === 'path') {
                return shape;
            }

            // Save original geometry (for potential revert / reference)
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

            let derived = null;

            // 🔹 SPECIAL CASE: polygon / roundedPolygon
            if (shape.type === 'polygon' || shape.type === 'roundedPolygon') {
                const radius = Math.max(0, shape.radius || 0);
                const sides = clampValue(Math.floor(shape.sides || 5), 3, 60);
                const rotation = shape.rotation || 0;
                const center = { x: shape.x || 0, y: shape.y || 0 };

                if (!radius || sides < 3) return null;

                // Build vertices exactly like the render code (with real rotation)
                const flatPoints = buildRegularPolygonPoints(
                    center,
                    radius,
                    sides,
                    rotation
                );
                if (!Array.isArray(flatPoints) || flatPoints.length < 6) return null;

                let basePoints = [];
                for (let i = 0; i + 1 < flatPoints.length; i += 2) {
                    const px = flatPoints[i];
                    const py = flatPoints[i + 1];
                    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

                    basePoints.push({
                        x: px,
                        y: py,
                        type: PATH_NODE_TYPES.CORNER,
                        handles: undefined,
                    });
                }
                if (basePoints.length < 3) return null;

                // If this was a rounded polygon, clamp the radius the SAME way
                // as the RoundedRegularPolygon drawing logic and round the path.
                if (
                    shape.type === 'roundedPolygon' &&
                    Number.isFinite(shape.cornerRadius) &&
                    shape.cornerRadius > 0 &&
                    typeof roundPathCorners === 'function'
                ) {
                    try {
                        const total = basePoints.length;
                        const distance = (a, b) => {
                            const dx = (b.x || 0) - (a.x || 0);
                            const dy = (b.y || 0) - (a.y || 0);
                            return Math.sqrt(dx * dx + dy * dy) || 0;
                        };

                        let maxAllowed = shape.cornerRadius;

                        for (let i = 0; i < total; i += 1) {
                            const prev = basePoints[(i - 1 + total) % total];
                            const cur = basePoints[i];
                            const next = basePoints[(i + 1) % total];

                            const d01 = distance(cur, prev);
                            const d12 = distance(next, cur);
                            const localLimit = Math.min(d01 / 2, d12 / 2);
                            if (localLimit > 0) {
                                maxAllowed = Math.min(maxAllowed, localLimit);
                            }
                        }

                        const effectiveRadius = Math.max(0, maxAllowed);
                        if (effectiveRadius > 0) {
                            const rounded = roundPathCorners(basePoints, effectiveRadius, {
                                closed: true,
                            });
                            if (Array.isArray(rounded) && rounded.length >= 3) {
                                basePoints = rounded;
                            }
                        }
                    } catch {
                        // fall back to sharp corners
                    }
                }

                derived = {
                    points: basePoints,
                    closed: true,
                    lineJoin: 'miter',
                };
            } else {
                // Default behavior for non-polygon shapes (rect, ellipse, etc.)
                derived = shapeToPath(shape);

                // Bonus: preserve rounded rects when entering edit mode
                if (
                    derived &&
                    shape.type === 'rectangle' &&
                    Number.isFinite(shape.cornerRadius) &&
                    shape.cornerRadius > 0 &&
                    Array.isArray(derived.points) &&
                    typeof roundPathCorners === 'function'
                ) {
                    try {
                        const roundedPoints = roundPathCorners(
                            derived.points,
                            shape.cornerRadius,
                            { closed: derived.closed !== false }
                        );
                        if (Array.isArray(roundedPoints) && roundedPoints.length >= 3) {
                            derived = { ...derived, points: roundedPoints };
                        }
                    } catch {
                        // ignore if rounding fails
                    }
                }
            }

            if (!derived || !Array.isArray(derived.points) || derived.points.length === 0) {
                return null;
            }

            const nextPoints = derived.points.map((p) => ({
                x: typeof p.x === 'number' ? p.x : 0,
                y: typeof p.y === 'number' ? p.y : 0,
                type: p.type || PATH_NODE_TYPES.CORNER,
                handles: p.handles || undefined,
            }));

            let nextShape = {
                ...shape,
                type: 'path',
                points: nextPoints,
                closed:
                    derived.closed != null
                        ? derived.closed
                        : shape.type !== 'line' && nextPoints.length > 2,
                __pathOriginal: originalGeometry,
                _pathWasEdited: false,
            };

            if (derived.lineCap) nextShape.lineCap = derived.lineCap;
            if (derived.lineJoin) nextShape.lineJoin = derived.lineJoin;

            // Width/height/radius no longer drive rendering for paths
            delete nextShape.width;
            delete nextShape.height;
            delete nextShape.radius;
            delete nextShape.radiusX;
            delete nextShape.radiusY;

            const nextState = currentShapes.map((s, idx) =>
                idx === index ? nextShape : s
            );
            applyChange(() => nextState, { baseState: currentShapes });

            return nextShape;
        },
        [applyChange, shapeToPath]
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

            // make sure we have a path to edit (will convert polygons too)
            const editable = ensureAnchorEditableShape(shapeId);
            if (!editable) return null;

            const targetId = editable.id;

            // snapshot current shapes so Esc can revert
            const beforeEdit = shapesRef.current.map((s) => ({ ...s }));

            setSelectedId(targetId);
            setSelectedIds([targetId]);
            setActivePathSelection((prev) =>
                prev?.shapeId === targetId ? prev : null
            );

            // ✅ this is how your canvas changes tools
            if (typeof onToolChange === 'function') {
                onToolChange('anchor');
            }

            pathInteractionRef.current = {
                shapeId: targetId,
                pendingPoint: null,
                draggingHandle: null,
                baseState: beforeEdit,
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
        // Only translate children when their container is scaled; keep their size unchanged
        const prevX = prevContainer?.x || 0;
        const prevY = prevContainer?.y || 0;
        const nextX = nextContainer?.x || 0;
        const nextY = nextContainer?.y || 0;
        const dx = nextX - prevX;
        const dy = nextY - prevY;
        const updated = {
            ...shape,
            x: (shape.x || 0) + dx,
            y: (shape.y || 0) + dy,
        };

        if (shape.type === 'line') {
            const points = Array.isArray(shape.points) ? [...shape.points] : [];
            const translated = points.map((value, index) => (index % 2 === 0 ? value + dx : value + dy));
            return { ...updated, points: translated };
        }
        if (shape.type === 'path') {
            const points = getPathPoints(shape).map((point) => {
                const nextPoint = clonePathPoint(point);
                nextPoint.x = point.x + dx;
                nextPoint.y = point.y + dy;
                if (point.handles) {
                    nextPoint.handles = {};
                    if (point.handles.left) {
                        nextPoint.handles.left = { x: point.handles.left.x + dx, y: point.handles.left.y + dy };
                    }
                    if (point.handles.right) {
                        nextPoint.handles.right = { x: point.handles.right.x + dx, y: point.handles.right.y + dy };
                    }
                    if (!nextPoint.handles.left && !nextPoint.handles.right) {
                        delete nextPoint.handles;
                    }
                }
                return nextPoint;
            });
            return { ...updated, points };
        }
        return updated;
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

        const makeDuplicateName = (originalName, takenNames) => {
            const base = (originalName || 'Layer').trim();
            const root = base.replace(/\s+copy(?:\s+\d+)?$/i, '') || base;
            let candidate = `${root} copy`;
            let counter = 2;
            while (takenNames.has(candidate)) {
                candidate = `${root} copy ${counter}`;
                counter += 1;
            }
            takenNames.add(candidate);
            return candidate;
        };

        const newSelection = [];
        applyChange((prev) => {
            const takenNames = new Set(prev.map((s) => s.name).filter(Boolean));
            let maxId = Math.max(0, ...prev.map((s) => (typeof s.id === 'number' ? s.id : 0)));
            const selectedSet = new Set(selectedIds);
            const next = [];
            const parentIds = new Set();

            for (let i = 0; i < prev.length; i += 1) {
                const shape = prev[i];
                next.push(shape); // keep original in place
                if (selectedSet.has(shape.id)) {
                    maxId += 1;
                    const clone = {
                        ...shape,
                        id: maxId,
                        name: makeDuplicateName(shape.name, takenNames),
                        x: (shape.x ?? 0) + 20, // slight offset so it’s visible
                        y: (shape.y ?? 0) + 20,
                        selected: false,
                    };
                    next.push(clone); // place clone above original
                    newSelection.push(clone.id);
                    if (clone.parentId != null) parentIds.add(clone.parentId);
                }
            }

            let withLayout = next;
            parentIds.forEach((pid) => {
                withLayout = applyAutoLayoutForParent(withLayout, pid);
            });
            return withLayout;
        }, { baseState: shapesRef.current });

        const primary = newSelection[newSelection.length - 1] ?? null;
        setSelectedIds(newSelection);
        setSelectedId(primary);
        if (typeof onToolChange === 'function') onToolChange('select');
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
        if (shape) {
            const parent = shape.parentId != null ? shapes.find((s) => s.id === shape.parentId) : null;
            const siblings =
                parent != null
                    ? shapes.filter((s) => s.parentId === parent.id && s.id !== shape.id).map((s) => ({ ...s }))
                    : [];
            const selectionIds = selectedIds.length ? [...selectedIds] : [shape.id];
            onSelectionChange({ shape: { ...shape, __parent: parent ? { ...parent } : null, __siblings: siblings }, selectedIds: selectionIds });
        } else {
            onSelectionChange(null);
        }
    }, [selectedId, shapes, onSelectionChange]);

    useEffect(() => {
        fillPreviewRef.current = null;
    }, [selectedId]);

    // keyboard shortcuts
    useEffect(() => {
        const isTypingInFormField = (target) => {
            if (!target) return false;
            const tag = target.tagName ? target.tagName.toLowerCase() : '';
            if (['input', 'textarea', 'select', 'option', 'button'].includes(tag)) return true;
            if (target.isContentEditable) return true;
            if (typeof target.closest === 'function' && target.closest('[contenteditable=\"true\"]')) return true;
            return false;
        };

        const onKeyDown = (e) => {
            if (isTypingInFormField(e.target)) return;

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
                const state = pathInteractionRef.current;
                if (state && state.baseState) {
                    // revert shapes to the state before anchor editing started
                    setShapes(state.baseState);
                }

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

                e.preventDefault();
                return;
            }

            if ((e.key === 'Enter' || e.key === 'Escape') && selectedTool === 'path') {
                const state = pathInteractionRef.current;
                if (!state || !state.shapeId) return;

                e.preventDefault();

                if (e.key === 'Escape' && state.baseState) {
                    // User cancels path editing/drawing -> revert
                    setShapes(state.baseState);
                } else {
                    // existing behavior for committing / cleaning up
                    const shape = shapesRef.current.find((s) => s.id === state.shapeId);
                    if (shape && shape.type === 'path') {
                        const points = getPathPoints(shape);
                        if (!points || points.length <= 1) {
                            // delete useless path
                            applyChange((prev) => prev.filter((s) => s.id !== shape.id));
                        }
                    }
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
                    const parentIds = new Set();
                    const snapshot = shapesRef.current;
                    // include descendants so containers remove their children
                    [...idsToRemove].forEach((id) => {
                        collectDescendantIds(snapshot, id).forEach((cid) => idsToRemove.add(cid));
                    });
                    [...idsToRemove]
                        .map((id) => getShapeById(id, snapshot))
                        .filter(Boolean)
                        .forEach((s) => {
                            if (s.parentId != null) parentIds.add(s.parentId);
                        });
                    applyChange((prev) => {
                        const filtered = prev.filter((shape) => !idsToRemove.has(shape.id));
                        let next = filtered;
                        parentIds.forEach((pid) => {
                            next = applyAutoLayoutForParent(next, pid);
                        });
                        return next;
                    });
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
            if (e.key === 'Tab' && selectedTool === 'select') {
                if (activeTextEditIdRef.current) return;
                e.preventDefault();
                e.stopPropagation();
                const direction = e.shiftKey ? -1 : 1;
                focusNextLayer(direction);
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

    const lastFillSelectionSigRef = useRef(null);
    const lastStrokeSelectionSigRef = useRef(null);

    useEffect(() => {
        const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
        if (!ids.length) return;
        const fillSig = JSON.stringify(normalizedFillStyles);
        const selectionSig = JSON.stringify(ids);
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

        // Only apply on shapes that can have fills
        const meta = primaryFillStyle?.meta || null;
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

        // Target style to apply
        const targetGradient =
            resolvedFillType === 'gradient' && resolvedFillGradient
                ? normalizeGradient(resolvedFillGradient)
                : null;
        const nextFillStyles = normalizedFillStyles;

        // Meta-less updates are UI syncs from selection; ignore as edits
        if (!meta) {
            lastFillStylesRef.current = fillSig;
            lastFillSelectionSigRef.current = selectionSig;
            return;
        }

        const updater = (source) =>
            source.map((s) => {
                if (!idsSet.has(s.id) || !supportsFill.has(s.type)) return s;

                if (targetGradient) {
                    return {
                        ...s,
                        fillStyles: nextFillStyles,
                        fill: getGradientFirstColor(targetGradient, resolvedFillColor),
                        fillType: 'gradient',
                        fillGradient: targetGradient,
                    };
                }
                return {
                    ...s,
                    fillStyles: nextFillStyles,
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
            lastFillStylesRef.current = fillSig;
            return;
        }

        if (isFinalizing) {
            // Commit preview as a single history entry
            const baseState = fillPreviewRef.current?.baseState || shapesRef.current;
            fillPreviewRef.current = null;
            applyChange((prev) => {
                const next = updater(prev);
                const parentId = ids[0] ? getShapeById(ids[0], prev)?.parentId : null;
                return parentId != null ? applyAutoLayoutForParent(next, parentId) : next;
            }, { baseState });
            lastFillStylesRef.current = fillSig;
            return;
        }

        // Non-preview path: avoid churn if nothing would change
        const needsChange = (() => {
            const src = shapesRef.current;
            for (let i = 0; i < src.length; i += 1) {
                const s = src[i];
                if (!idsSet.has(s.id) || !supportsFill.has(s.type)) continue;
                const curStyles = Array.isArray(s.fillStyles) ? s.fillStyles : [];
                const sameStyles =
                    curStyles.length === normalizedFillStyles.length &&
                    curStyles.every((entry, idx) => JSON.stringify(entry) === JSON.stringify(normalizedFillStyles[idx]));
                if (!sameStyles) return true;
            }
            return false;
        })();
        if (needsChange) {
            applyChange((prev) => {
                const next = updater(prev);
                const parentId = ids[0] ? getShapeById(ids[0], prev)?.parentId : null;
                return parentId != null ? applyAutoLayoutForParent(next, parentId) : next;
            });
        }
        lastFillStylesRef.current = fillSig;
        lastFillSelectionSigRef.current = selectionSig;
    }, [
        applyChange,
        primaryFillStyle?.meta,
        resolvedFillColor,
        resolvedFillGradient,
        resolvedFillType,
        normalizedFillStyles,
        selectedIds,
        selectedId
    ]);

    useEffect(() => {
        const prevStrokeVersion = strokeWidthVersionRef.current;
        strokeWidthVersionRef.current = strokeWidthVersion;

        // Active selection (multi preferred, else single)
        const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
        if (!ids.length) return;
        const strokeSig = JSON.stringify(normalizedStrokeStyles);
        const selectionSig = JSON.stringify(ids);

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
        const desiredStrokeStyles = normalizedStrokeStyles;

        const strokeMeta = strokeStyle && typeof strokeStyle === 'object' ? strokeStyle.meta || null : null;
        const versionChanged = prevStrokeVersion !== strokeWidthVersion;
        const stylesChanged = strokeSig !== lastStrokeStylesRef.current;
        const shouldApply = Boolean(strokeMeta) || versionChanged || stylesChanged;
        if (!shouldApply) return;

        // Meta-less updates are UI syncs from selection; ignore as edits
        if (!strokeMeta && !versionChanged && !stylesChanged) {
            lastStrokeStylesRef.current = strokeSig;
            lastStrokeSelectionSigRef.current = selectionSig;
            return;
        }

        const computeTargetStrokeWidth = (shape) => {
            if (!shape) return desiredWidth;

            // Lines must stay visible → keep minimum width 1
            if (shape.type === 'line' && desiredWidth <= 0) {
                const currentWidth =
                    typeof shape.strokeWidth === 'number' ? shape.strokeWidth : 0;
                return currentWidth > 0 ? currentWidth : 1;
            }

            // Paths (and others) can go down to 0
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
                const curStyles = Array.isArray(s.strokeStyles) ? s.strokeStyles : [];
                const needsStyles =
                    curStyles.length !== desiredStrokeStyles.length ||
                    curStyles.some((entry, idx) => JSON.stringify(entry) !== JSON.stringify(desiredStrokeStyles[idx]));
                if (curWidth !== targetWidth || curStroke !== desiredStroke || curType !== desiredType || needsStyles) {
                    return true;
                }
            }
            return false;
        })();
        if (!needsChange) return;

        if (strokeTxnRef.current) return; // avoid re-entrancy bursts
        strokeTxnRef.current = true;

        // Commit change to all selected stroke-capable shapes
        applyChange((prev) => {
            const next = prev.map((s) => {
                if (!selectedSet.has(s.id) || !supportsStroke.has(s.type)) return s;
                return {
                    ...s,
                    strokeStyles: desiredStrokeStyles,
                    stroke: desiredStroke,
                    strokeType: desiredType,
                    strokeWidth: computeTargetStrokeWidth(s),
                };
            });
            const parentId = ids[0] ? getShapeById(ids[0], prev)?.parentId : null;
            return parentId != null ? applyAutoLayoutForParent(next, parentId) : next;
        });
        setTimeout(() => { strokeTxnRef.current = false; }, 0);
        lastStrokeStylesRef.current = strokeSig;
        lastStrokeSelectionSigRef.current = selectionSig;
    }, [
        applyChange,
        resolvedStrokeColor,   // color from panel
        resolvedStrokeType,    // 'solid' etc.
        strokeWidth,           // numeric width
        selectedIds, selectedId,
        strokeStyle?.meta,
        normalizedStrokeStyles
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
                        const sides = clampValue(Math.floor(shape.sides || 5), 3, 60);
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
                        const sides = clampValue(Math.floor(shape.sides || 5), 3, 60);
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
                case 'layout': {
                    if (!value || (shape.type !== 'frame' && shape.type !== 'group')) return shape;
                    const next = { ...shape };
                    next.layout = value.enabled ? 'auto' : null;
                    if (value.axis) next.layoutAxis = value.axis;
                    if (value.flow) next.layoutFlow = value.flow;
                    if (value.spacing !== undefined) {
                        const spacingValue = Number.isFinite(value.spacing) ? value.spacing : shape.layoutSpacing ?? 8;
                        next.layoutSpacing = spacingValue;
                    }
                    if (value.padding !== undefined) {
                        if (typeof value.padding === 'number') {
                            next.layoutPadding = value.padding;
                        } else {
                            next.layoutPadding = {
                                top: value.padding.top ?? shape.layoutPadding?.top ?? 12,
                                right: value.padding.right ?? shape.layoutPadding?.right ?? 12,
                                bottom: value.padding.bottom ?? shape.layoutPadding?.bottom ?? 12,
                                left: value.padding.left ?? shape.layoutPadding?.left ?? 12,
                            };
                        }
                    }
                    if (value.align) {
                        next.layoutAlign = value.align;
                        next.layoutAlignCross = value.alignCross || value.align;
                    }
                    if (value.alignCross) next.layoutAlignCross = value.alignCross;
                    if (value.alignMain) next.layoutAlignMain = value.alignMain;
                    if (value.flow === 'grid' || next.layoutFlow === 'grid') {
                        if (value.gridColumns !== undefined) {
                            const num = Number(value.gridColumns);
                            next.layoutGridColumns = Number.isFinite(num) ? Math.max(1, Math.floor(num)) : next.layoutGridColumns;
                        }
                        if (value.gridRows !== undefined) {
                            const num = Number(value.gridRows);
                            next.layoutGridRows = Number.isFinite(num) ? Math.max(1, Math.floor(num)) : next.layoutGridRows;
                        }
                        if (value.gridColumnGap !== undefined) {
                            const num = Number(value.gridColumnGap);
                            next.layoutGridColumnGap = Number.isFinite(num) ? Math.max(0, num) : next.layoutGridColumnGap;
                        }
                        if (value.gridRowGap !== undefined) {
                            const num = Number(value.gridRowGap);
                            next.layoutGridRowGap = Number.isFinite(num) ? Math.max(0, num) : next.layoutGridRowGap;
                        }
                        if (value.gridColumnMode) next.layoutGridColumnMode = value.gridColumnMode;
                        if (value.gridRowMode) next.layoutGridRowMode = value.gridRowMode;
                        if (!value.widthMode) next.layoutWidthMode = 'hug';
                        if (!value.heightMode) next.layoutHeightMode = 'hug';
                    }
                    if (value.widthMode) next.layoutWidthMode = value.widthMode;
                    if (value.heightMode) next.layoutHeightMode = value.heightMode;
                    if (Number.isFinite(value.width)) next.width = value.width;
                    if (Number.isFinite(value.height)) next.height = value.height;
                    if (typeof value.clipContent === 'boolean') {
                        if (shape.type === 'frame') {
                            next.clipContent = value.clipContent;
                        } else if (shape.type === 'group') {
                            next.clipChildren = value.clipContent;
                        }
                    }
                    next.layoutAxis = next.layoutAxis || shape.layoutAxis || 'vertical';
                    if (!Number.isFinite(next.layoutSpacing)) {
                        next.layoutSpacing = Number.isFinite(shape.layoutSpacing) ? shape.layoutSpacing : 8;
                    }
                    if (next.layoutPadding === undefined) {
                        next.layoutPadding =
                            shape.layoutPadding !== undefined
                                ? shape.layoutPadding
                                : { top: 12, right: 12, bottom: 12, left: 12 };
                    }
                    if (!next.layoutWidthMode) next.layoutWidthMode = shape.layoutWidthMode || 'fixed';
                    if (!next.layoutHeightMode) next.layoutHeightMode = shape.layoutHeightMode || 'fixed';
                    return next;
                }
                case 'layoutChild': {
                    const next = { ...shape };
                    if (value?.widthMode) next.layoutWidthMode = value.widthMode;
                    if (value?.heightMode) next.layoutHeightMode = value.heightMode;
                    if (value?.width != null) next.width = value.width;
                    if (value?.height != null) next.height = value.height;
                    return next;
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
                        const sides = clampValue(Math.floor(shape.sides || 5), 3, 60);
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
                    const sides = clampValue(Math.floor(value), 3, 60);
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

                        const sides = clampValue(Math.floor(shape.sides || 5), 3, 60);
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
        const targetShapeCurrent = shapesRef.current.find((s) => s.id === targetId) || null;
        const autoLayoutParentId =
            payload.type === 'layout'
                ? targetId
                : targetShapeCurrent && targetShapeCurrent.parentId != null
                    ? targetShapeCurrent.parentId
                    : null;

        applyChange((prev) => {
            const mapped = prev.map((shape) => {
                if (shape.id !== targetId) return shape;
                const nextShape = applyForShape(shape);
                if (nextShape !== shape) {
                    didApply = true;
                }
                return nextShape;
            });
            return autoLayoutParentId != null ? applyAutoLayoutForParent(mapped, autoLayoutParentId) : mapped;
        });

        if (typeof onShapePropertyRequestHandled === 'function') {
            onShapePropertyRequestHandled(version, didApply);
        }
    }, [
        applyChange,
        onShapePropertyRequestHandled,
        shapePropertyRequest,
    ]);

    useEffect(() => {
        if (!alignRequest) return;
        const { version, mode } = alignRequest;
        const finish = (ok = false) => {
            if (typeof onAlignRequestHandled === 'function') {
                onAlignRequestHandled(version ?? null, ok);
            }
        };

        const ids = selectedIds.length ? selectedIds : selectedId != null ? [selectedId] : [];
        if (!mode || ids.length < 2) {
            finish(false);
            return;
        }
        const idSet = new Set(ids);
        const current = shapesRef.current.filter((s) => idSet.has(s.id));
        const alignable = current
            .map((shape) => {
                if (!shape || shape.locked) return null;
                const parent =
                    shape.parentId != null
                        ? shapesRef.current.find((candidate) => candidate.id === shape.parentId)
                        : null;
                const isAutoChild =
                    parent && parent.layout === 'auto' && (shape.layoutPositioning || 'auto') === 'auto';
                if (isAutoChild) return null;
                const box = getShapeBoundingBox(shape);
                if (!box) return null;
                return { shape, box, parent };
            })
            .filter(Boolean);

        if (alignable.length < 2) {
            finish(false);
            return;
        }

        const bounds = unionBoundingBoxes(alignable.map((entry) => entry.box));
        if (!bounds) {
            finish(false);
            return;
        }

        const deltas = new Map();
        const modeParts = (() => {
            switch (mode) {
                case 'top-left':
                    return { h: 'left', v: 'top' };
                case 'top-center':
                    return { h: 'center', v: 'top' };
                case 'top-right':
                    return { h: 'right', v: 'top' };
                case 'middle-left':
                case 'left':
                    return { h: 'left', v: 'middle' };
                case 'center':
                    return { h: 'center', v: 'middle' };
                case 'middle-right':
                case 'right':
                    return { h: 'right', v: 'middle' };
                case 'bottom-left':
                    return { h: 'left', v: 'bottom' };
                case 'bottom-center':
                    return { h: 'center', v: 'bottom' };
                case 'bottom-right':
                    return { h: 'right', v: 'bottom' };
                case 'top':
                    return { h: null, v: 'top' };
                case 'bottom':
                    return { h: null, v: 'bottom' };
                case 'middle':
                    return { h: null, v: 'middle' };
                default:
                    return { h: null, v: null };
            }
        })();
        alignable.forEach(({ shape, box }) => {
            let dx = 0;
            let dy = 0;
            if (modeParts.h === 'left') {
                dx = bounds.left - box.left;
            } else if (modeParts.h === 'right') {
                dx = bounds.right - box.right;
            } else if (modeParts.h === 'center') {
                dx = (bounds.left + bounds.right) / 2 - (box.left + box.right) / 2;
            }
            if (modeParts.v === 'top') {
                dy = bounds.top - box.top;
            } else if (modeParts.v === 'bottom') {
                dy = bounds.bottom - box.bottom;
            } else if (modeParts.v === 'middle') {
                dy = (bounds.top + bounds.bottom) / 2 - (box.top + box.bottom) / 2;
            }
            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
                deltas.set(shape.id, { dx, dy });
            }
        });

        if (!deltas.size) {
            finish(true);
            return;
        }

        applyChange((prev) => {
            let changed = false;
            const parentIds = new Set();
            const next = prev.map((shape) => {
                const delta = deltas.get(shape.id);
                if (!delta) return shape;
                const { dx, dy } = delta;
                if (!dx && !dy) return shape;

                let updated = shape;
                if (shape.type === 'path') {
                    const points = translatePathPoints(getPathPoints(shape), dx, dy);
                    updated = { ...shape, x: (shape.x || 0) + dx, y: (shape.y || 0) + dy, points };
                } else if (shape.type === 'line') {
                    const points = translateLinePoints(Array.isArray(shape.points) ? shape.points : [], dx, dy);
                    updated = { ...shape, points, x: (shape.x || 0) + dx, y: (shape.y || 0) + dy };
                } else {
                    updated = { ...shape, x: (shape.x || 0) + dx, y: (shape.y || 0) + dy };
                }

                if (updated !== shape) {
                    changed = true;
                    if (updated.parentId != null) {
                        const parent = prev.find((s) => s.id === updated.parentId);
                        if (parent && parent.layout === 'auto') {
                            parentIds.add(parent.id);
                        }
                    }
                }
                return updated;
            });

            let withLayout = next;
            parentIds.forEach((pid) => {
                withLayout = applyAutoLayoutForParent(withLayout, pid);
            });

            return changed ? withLayout : prev;
        });

        finish(true);
    }, [alignRequest, applyChange, onAlignRequestHandled, selectedId, selectedIds]);

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
                const insertAnchor = getInsertAnchorForParent(containerId ?? null);
                applyChange((prev) => {
                    const next = insertShapeAboveSibling(prev, newShape, insertAnchor);
                    const parentId = containerId ?? null;
                    return parentId != null ? applyAutoLayoutForParent(next, parentId) : next;
                });
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
        const dragTools = ['rectangle', 'ellipse', 'roundedPolygon', 'line', 'frame'];
        if (dragTools.includes(selectedTool)) {
            const pos = getCanvasPointer();
            if (!pos) return;
            const pointerContainerId =
                containerIdFromTarget != null ? containerIdFromTarget : getContainerIdAtPoint(pos);
            const baseProps = {
                x: pos.x,
                y: pos.y,
                rotation: 0,
                parentId: selectedTool === 'frame' ? null : pointerContainerId ?? undefined,
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
                    parentId: pointerContainerId ?? undefined,
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
            const insertAnchor = getInsertAnchorForParent(newShape.parentId ?? null);
            applyChange((prev) => {
                const next = insertShapeAboveSibling(prev, newShape, insertAnchor);
                const parentId = newShape.parentId ?? null;
                return parentId != null ? applyAutoLayoutForParent(next, parentId) : next;
            });
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
            const insertAnchor = getInsertAnchorForParent(parentId ?? null);
            applyChange((prev) => {
                const next = insertShapeAboveSibling(prev, newShape, insertAnchor);
                return parentId != null ? applyAutoLayoutForParent(next, parentId) : next;
            });
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
    const handleStageMouseMove = (e) => {
        const stage = stageRef.current;
        if (!stage) return;
        const evt = e?.evt;
        const altKey = !!(evt?.altKey);
        const metaAlt = altKey && (!!evt?.metaKey || !!evt?.ctrlKey);

        // distance measurement overlay
        if (altKey && isSelectLikeTool) {
            const baseId = selectedIds?.length ? selectedIds[selectedIds.length - 1] : selectedId;
            const baseShape = getShapeById(baseId, shapesRef.current);
            if (baseShape) {
                const pointer = getCanvasPointer();
                const pickTarget = () => {
                    if (!pointer) return null;
                    // If meta+alt and base is container, prefer its descendants
                    if (metaAlt && isContainerShape(baseShape)) {
                        const childId = pickTopmostChildAtPoint(baseShape, pointer.x, pointer.y);
                        if (childId != null) return getShapeById(childId, shapesRef.current);
                    }
                    // otherwise topmost visible shape under pointer (excluding base)
                    for (let i = shapesRef.current.length - 1; i >= 0; i -= 1) {
                        const s = shapesRef.current[i];
                        if (!s || s.id === baseId) continue;
                        if (s.visible === false || s.locked) continue;
                        if (s.pageId && s.pageId !== activePageId) continue;
                        if (pointInShape(s, pointer.x, pointer.y)) {
                            return s;
                        }
                    }
                    return null;
                };
                        const targetShape = pickTarget();
                        if (targetShape) {
                            const baseBox = getShapeBoundingBox(baseShape);
                            const targetBox = getShapeBoundingBox(targetShape);
                            if (baseBox && targetBox) {
                                const baseContainsTarget =
                                    baseBox.left <= targetBox.left &&
                                    baseBox.right >= targetBox.right &&
                                    baseBox.top <= targetBox.top &&
                                    baseBox.bottom >= targetBox.bottom;
                                const targetContainsBase =
                                    targetBox.left <= baseBox.left &&
                                    targetBox.right >= baseBox.right &&
                                    targetBox.top <= baseBox.top &&
                                    targetBox.bottom >= baseBox.bottom;
                                if (baseContainsTarget || targetContainsBase) {
                                    const outer = baseContainsTarget ? baseBox : targetBox;
                                    const inner = baseContainsTarget ? targetBox : baseBox;
                                    const midY = (inner.top + inner.bottom) / 2;
                                    const midX = (inner.left + inner.right) / 2;
                                    const leftGap = Math.max(0, inner.left - outer.left);
                                    const rightGap = Math.max(0, outer.right - inner.right);
                                    const topGap = Math.max(0, inner.top - outer.top);
                                    const bottomGap = Math.max(0, outer.bottom - inner.bottom);
                                    setMeasurementOverlay({
                                        type: 'contain',
                                        baseId,
                                        targetId: targetShape.id,
                                        sides: {
                                            left: { x1: outer.left, y1: midY, x2: inner.left, y2: midY, dist: Math.round(leftGap) },
                                            right: { x1: inner.right, y1: midY, x2: outer.right, y2: midY, dist: Math.round(rightGap) },
                                            top: { x1: midX, y1: outer.top, x2: midX, y2: inner.top, dist: Math.round(topGap) },
                                            bottom: { x1: midX, y1: inner.bottom, x2: midX, y2: outer.bottom, dist: Math.round(bottomGap) },
                                        },
                                    });
                                    return;
                                }
                                const h = (() => {
                                    const overlapYTop = Math.max(baseBox.top, targetBox.top);
                                    const overlapYBottom = Math.min(baseBox.bottom, targetBox.bottom);
                                    const midY = overlapYTop <= overlapYBottom
                                        ? (overlapYTop + overlapYBottom) / 2
                                : (Math.min(baseBox.bottom, targetBox.bottom) + Math.max(baseBox.top, targetBox.top)) / 2;
                            // gap left/right
                            let gap = 0;
                            let x1 = 0;
                            let x2 = 0;
                            if (targetBox.left >= baseBox.right) {
                                gap = targetBox.left - baseBox.right;
                                x1 = baseBox.right;
                                x2 = targetBox.left;
                            } else if (baseBox.left >= targetBox.right) {
                                gap = baseBox.left - targetBox.right;
                                x1 = targetBox.right;
                                x2 = baseBox.left;
                            } else {
                                // overlap in X: measure side-to-side smallest offset
                                const gapLeft = Math.abs(targetBox.left - baseBox.left);
                                const gapRight = Math.abs(targetBox.right - baseBox.right);
                                if (gapLeft <= gapRight) {
                                    gap = gapLeft;
                                    x1 = Math.min(baseBox.left, targetBox.left);
                                    x2 = Math.max(baseBox.left, targetBox.left);
                                } else {
                                    gap = gapRight;
                                    x1 = Math.min(baseBox.right, targetBox.right);
                                    x2 = Math.max(baseBox.right, targetBox.right);
                                }
                            }
                            return {
                                x1,
                                y1: midY,
                                x2,
                                y2: midY,
                                dist: Math.max(0, Math.round(gap)),
                            };
                        })();
                        const v = (() => {
                            const overlapXLeft = Math.max(baseBox.left, targetBox.left);
                            const overlapXRight = Math.min(baseBox.right, targetBox.right);
                            const midX = overlapXLeft <= overlapXRight
                                ? (overlapXLeft + overlapXRight) / 2
                                : (Math.min(baseBox.right, targetBox.right) + Math.max(baseBox.left, targetBox.left)) / 2;
                            let gap = 0;
                            let y1 = 0;
                            let y2 = 0;
                            if (targetBox.top >= baseBox.bottom) {
                                gap = targetBox.top - baseBox.bottom;
                                y1 = baseBox.bottom;
                                y2 = targetBox.top;
                            } else if (baseBox.top >= targetBox.bottom) {
                                gap = baseBox.top - targetBox.bottom;
                                y1 = targetBox.bottom;
                                y2 = baseBox.top;
                            } else {
                                const gapTop = Math.abs(targetBox.top - baseBox.top);
                                const gapBottom = Math.abs(targetBox.bottom - baseBox.bottom);
                                if (gapTop <= gapBottom) {
                                    gap = gapTop;
                                    y1 = Math.min(baseBox.top, targetBox.top);
                                    y2 = Math.max(baseBox.top, targetBox.top);
                                } else {
                                    gap = gapBottom;
                                    y1 = Math.min(baseBox.bottom, targetBox.bottom);
                                    y2 = Math.max(baseBox.bottom, targetBox.bottom);
                                }
                            }
                            return {
                                x1: midX,
                                y1,
                                x2: midX,
                                y2,
                                dist: Math.max(0, Math.round(gap)),
                            };
                        })();
                        const showH = h.dist > 0;
                        const showV = v.dist > 0;
                        setMeasurementOverlay({
                            baseId,
                            targetId: targetShape.id,
                            horizontal: h,
                            vertical: v,
                            showH,
                            showV,
                            type: 'gap',
                        });
                    } else {
                        setMeasurementOverlay(null);
                    }
                } else {
                    setMeasurementOverlay(null);
                }
            } else {
                setMeasurementOverlay(null);
            }
        } else {
            if (measurementOverlay) setMeasurementOverlay(null);
        }
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

        if (!isSelectLikeTool || selectedTool === 'anchor') {
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
        const reflowAutoAncestors = (state, ids) => {
            if (!ids || !ids.length) return state;
            const queue = [...ids.filter(Boolean)];
            const visited = new Set();
            let nextState = state;
            while (queue.length) {
                const pid = queue.shift();
                if (visited.has(pid)) continue;
                visited.add(pid);
                nextState = applyAutoLayoutForParent(nextState, pid);
                const parentShape = nextState.find((s) => s.id === pid);
                const ancestorId = parentShape?.parentId;
                if (ancestorId != null) {
                    const ancestor = nextState.find((s) => s.id === ancestorId);
                    if (ancestor?.layout === 'auto') {
                        queue.push(ancestorId);
                    }
                }
            }
            return nextState;
        };

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
            const parentId = shape.parentId;
            const reflowTargets = [];
            if (shape.layout === 'auto') reflowTargets.push(id);
            if (parentId != null) reflowTargets.push(parentId);
            applyChange((prev) => {
                const mapped = prev.map((s) => {
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
                });
                return reflowAutoAncestors(mapped, reflowTargets);
            });
        } else if (shape.type === 'rectangle') {
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            const newWidth = Math.max(5, node.width() * scaleX);
            const newHeight = Math.max(5, node.height() * scaleY);
            const rotation = node.rotation() || 0;
            // reset scale back to1
            node.scaleX(1);
            node.scaleY(1);
            const parentId = shape.parentId;
            const reflowTargets = [];
            if (shape.layout === 'auto') reflowTargets.push(id);
            if (parentId != null) reflowTargets.push(parentId);
            applyChange((prev) => {
                const mapped = prev.map((s) =>
                    s.id === id
                        ? { ...s, width: newWidth, height: newHeight, x: node.x(), y: node.y(), rotation: snapAngle(rotation) }
                        : s
                );
                return reflowAutoAncestors(mapped, reflowTargets);
            });
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
            const parentId = shape.parentId;
            const reflowTargets = [];
            if (shape.layout === 'auto') reflowTargets.push(id);
            if (parentId != null) reflowTargets.push(parentId);
            applyChange((prev) => {
                const mapped = prev.map((s) =>
                    s.id === id
                        ? { ...s, radius: newRadius, x: node.x(), y: node.y(), rotation: snapAngle(rotation) }
                        : s
                );
                return reflowAutoAncestors(mapped, reflowTargets);
            });
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
            const parentId = shape.parentId;
            const reflowTargets = [];
            if (shape.layout === 'auto') reflowTargets.push(id);
            if (parentId != null) reflowTargets.push(parentId);
            applyChange((prev) => {
                const mapped = prev.map((s) =>
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
                );
                return reflowAutoAncestors(mapped, reflowTargets);
            });
        } else if (isPolygonLikeShape(shape)) {
            const scaleVal = node.scaleX();

            let baseRadius;
            if (typeof node.radius === 'function') {
                baseRadius = node.radius();
            } else {
                baseRadius = Number(node.getAttr('radius')) || shape.radius || 0;
            }

            if (!Number.isFinite(baseRadius) || baseRadius <= 0) {
                baseRadius = shape.radius || 0;
            }

            const newRadius = Math.max(1, baseRadius * scaleVal);
            const rotation = node.rotation() || 0;
            node.scaleX(1);
            node.scaleY(1);

            const sides = clampValue(Math.floor(shape.sides || 5), 3, 60);
            let snappedRotation = rotation;
            if (Math.abs(node.scaleX() - 1) > 0.001 || Math.abs(node.scaleY() - 1) > 0.001) {
                snappedRotation = snapAngle(rotation);
            }
            const updatedPoints = buildRegularPolygonPoints(
                { x: node.x(), y: node.y() },
                newRadius,
                sides,
                snappedRotation
            );

            const parentId = shape.parentId;
            const reflowTargets = [];
            if (shape.layout === 'auto') reflowTargets.push(id);
            if (parentId != null) reflowTargets.push(parentId);
            applyChange((prev) => {
                const mapped = prev.map((s) =>
                    s.id === id
                        ? {
                            ...s,
                            radius: newRadius,
                            x: node.x(),
                            y: node.y(),
                            rotation: snappedRotation,
                            points: updatedPoints,
                        }
                        : s
                );
                return reflowAutoAncestors(mapped, reflowTargets);
            });
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
            const parentId = shape.parentId;
            const reflowTargets = [];
            if (shape.layout === 'auto') reflowTargets.push(id);
            if (parentId != null) reflowTargets.push(parentId);
            applyChange((prev) => {
                const mapped = prev.map((s) =>
                    s.id === id
                        ? { ...s, points: mappedPoints, rotation: snapAngle(rotation), x: 0, y: 0 }
                        : s
                );
                return reflowAutoAncestors(mapped, reflowTargets);
            });
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
            const parentId = shape.parentId;
            const reflowTargets = [];
            if (shape.layout === 'auto') reflowTargets.push(id);
            if (parentId != null) reflowTargets.push(parentId);
            applyChange((prev) => {
                const mapped = prev.map((s) => (s.id === id ? { ...s, points: nextPoints } : s));
                return reflowAutoAncestors(mapped, reflowTargets);
            });
        } else if (shape.type === 'text') {
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            const newWidth = Math.max(1, node.width() * scaleX);
            const newHeight = Math.max(1, node.height() * scaleY);
            const rotation = node.rotation() || 0;
            node.scaleX(1);
            node.scaleY(1);
            const parentId = shape.parentId;
            const reflowTargets = [];
            if (shape.layout === 'auto') reflowTargets.push(id);
            if (parentId != null) reflowTargets.push(parentId);
            applyChange((prev) => {
                const mapped = prev.map((s) =>
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
                );
                return reflowAutoAncestors(mapped, reflowTargets);
            });
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

        selectSingle(shape.id);
        activeTextEditIdRef.current = shape.id;

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
            activeTextEditIdRef.current = null;
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
                focusNextTextLayerEdit(shape.id, evt.shiftKey ? -1 : 1);
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
            setSelectedIds([childId ?? shape.id]);

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
            // Only select on double-click; text edit via Enter or toolbar
            selectSingle(shape.id);
            setSelectedIds([shape.id]);
            return;
        }

        // Non-container children: just select on double-click (no edit mode)
        selectSingle(shape.id);
        setSelectedIds([shape.id]);
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
                    const frameWidth = shape.width || 0;
                    const frameHeight = shape.height || 0;
                    const halfW = frameWidth / 2;
                    const halfH = frameHeight / 2;
                    const left = (shape.x || 0) - halfW;
                    const top = (shape.y || 0) - halfH;
                    const frameSelected = Array.isArray(selectedIds) && selectedIds.includes(shape.id);
                    const gridLines = [];
                    if (frameSelected && shape.layout === 'auto' && shape.layoutFlow === 'grid') {
                        const cols = Math.max(1, Math.floor(shape.layoutGridColumns || 1));
                        let rows = Math.max(1, Math.floor(shape.layoutGridRows || 1));
                        const colGap = Number.isFinite(shape.layoutGridColumnGap) ? Math.max(0, shape.layoutGridColumnGap) : 0;
                        const rowGap = Number.isFinite(shape.layoutGridRowGap) ? Math.max(0, shape.layoutGridRowGap) : 0;
                        const padRaw = shape.layoutPadding;
                        const pad =
                            typeof padRaw === 'number'
                            ? { top: padRaw, right: padRaw, bottom: padRaw, left: padRaw }
                                : {
                                    top: Number.isFinite(padRaw?.top) ? padRaw.top : 12,
                                    right: Number.isFinite(padRaw?.right) ? padRaw.right : 12,
                                    bottom: Number.isFinite(padRaw?.bottom) ? padRaw.bottom : 12,
                                    left: Number.isFinite(padRaw?.left) ? padRaw.left : 12,
                                };
                        const innerWidth = Math.max(0, frameWidth - pad.left - pad.right);
                        const innerHeight = Math.max(0, frameHeight - pad.top - pad.bottom);

                        const children = childrenMap.get(shape.id) || [];
                        const autoKids = children.filter((c) => (c.layoutPositioning || 'auto') === 'auto' && c.visible !== false);
                        const dims = autoKids.map((child) => {
                            const dim = getShapeDimensions(child);
                            return { id: child.id, width: dim.width || 0, height: dim.height || 0 };
                        });

                        const colMode = shape.layoutGridColumnMode || 'fixed';
                        const rowMode = shape.layoutGridRowMode || 'fixed';
                        const colWidths = new Array(cols).fill(0);
                        const rowHeights = new Array(rows).fill(0);
                        const maxChildWidth = Math.max(0, ...dims.map((d) => d.width));
                        const maxChildHeight = Math.max(0, ...dims.map((d) => d.height));
                        const baseColWidth =
                            colMode === 'fill'
                                ? (cols > 0 ? Math.max(0, (innerWidth - Math.max(0, cols - 1) * colGap) / cols) : 0)
                                : colMode === 'hug'
                                    ? Math.max(1, maxChildWidth || 1)
                                    : Math.max(0, (innerWidth - Math.max(0, cols - 1) * colGap) / cols);
                        const baseRowHeight =
                            rowMode === 'fill'
                                ? (rows > 0 ? Math.max(0, (innerHeight - Math.max(0, rows - 1) * rowGap) / rows) : 0)
                                : rowMode === 'hug'
                                    ? Math.max(1, maxChildHeight || 1)
                                    : Math.max(0, (innerHeight - Math.max(0, rows - 1) * rowGap) / rows);
                        autoKids.forEach((child, idx) => {
                            const dim = dims.find((d) => d.id === child.id) || { width: 0, height: 0 };
                            const row = Math.floor(idx / cols);
                            const col = idx % cols;
                            colWidths[col] = Math.max(colWidths[col], dim.width, baseColWidth);
                            rowHeights[row] = Math.max(rowHeights[row], dim.height, baseRowHeight);
                        });
                        const neededRows = Math.ceil((autoKids.length || 1) / cols);
                        if (neededRows > rows) {
                            const extra = neededRows - rows;
                            for (let i = 0; i < extra; i += 1) {
                                rowHeights.push(baseRowHeight);
                            }
                            rows = neededRows;
                        }

                        // Fallback to uniform cells when no children
                        if (!autoKids.length) {
                            const totalColGap = Math.max(0, cols - 1) * colGap;
                            const totalRowGap = Math.max(0, rows - 1) * rowGap;
                            const cellW = cols > 0 ? (innerWidth - totalColGap) / cols : innerWidth;
                            const cellH = rows > 0 ? (innerHeight - totalRowGap) / rows : innerHeight;
                            colWidths.fill(Math.max(cellW, baseColWidth));
                            rowHeights.fill(Math.max(cellH, baseRowHeight));
                        }
                        for (let c = 0; c < cols; c += 1) colWidths[c] = Math.max(colWidths[c], baseColWidth);
                        for (let r = 0; r < rows; r += 1) rowHeights[r] = Math.max(rowHeights[r], baseRowHeight);

                        const startX = left + pad.left;
                        const startY = top + pad.top;

                        const colOffsets = [];
                        colWidths.reduce((acc, w, idx) => {
                            colOffsets[idx] = acc;
                            return acc + w + colGap;
                        }, 0);
                        const rowOffsets = [];
                        rowHeights.reduce((acc, h, idx) => {
                            rowOffsets[idx] = acc;
                            return acc + h + rowGap;
                        }, 0);

                        const strokeColor = '#7aa7ff';
                        // division lines at gap centers
                        for (let c = 1; c < cols; c += 1) {
                            const xPos = startX + (colOffsets[c] || 0) - colGap / 2;
                            gridLines.push(
                                <Line
                                    key={`frame-grid-col-${shape.id}-${c}`}
                                    points={[xPos, top + pad.top, xPos, top + pad.top + innerHeight]}
                                    stroke={strokeColor}
                                    strokeWidth={1}
                                    listening={false}
                                />
                            );
                        }
                        for (let r = 1; r < rows; r += 1) {
                            const yPos = startY + (rowOffsets[r] || 0) - rowGap / 2;
                            gridLines.push(
                                <Line
                                    key={`frame-grid-row-${shape.id}-${r}`}
                                    points={[left + pad.left, yPos, left + pad.left + innerWidth, yPos]}
                                    stroke={strokeColor}
                                    strokeWidth={1}
                                    listening={false}
                                />
                            );
                        }
                    }
                    return (
                        <>
                            <Rect
                                {...commonProps}
                                name="frame"
                                x={shape.x}
                                y={shape.y}
                                width={frameWidth}
                                height={frameHeight}
                                offset={{ x: frameWidth / 2, y: frameHeight / 2 }}
                                {...fillProps}
                                stroke={shape.stroke || '#1f2937'}
                                strokeWidth={shape.strokeWidth || 1}
                            />
                            {gridLines}
                        </>
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
                const sides = clampValue(Math.floor(shape.sides || 5), 3, 60);
                const cornerRadius = Math.max(0, shape.cornerRadius || 0);
                return (
                    <RoundedRegularPolygon
                        {...commonProps}
                        x={shape.x}
                        y={shape.y}
                        radius={radius}
                        sides={sides}
                        cornerRadius={cornerRadius}
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
                const rawstrokeWidth =
                    typeof shape.strokeWidth === 'number' ? shape.strokeWidth : 0;
                const strokeWidth = rawstrokeWidth < 0 ? 0 : rawstrokeWidth;
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
        for (let i = 0; i < shapesOnActivePage.length; i += 1) {
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
            const sides = clampValue(Math.floor(shape.sides || 5), 3, 60);
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

    const getLayerDropZone = (event, { canDropInside = true } = {}) => {
        const bounds = event?.currentTarget?.getBoundingClientRect?.();
        if (!bounds) return 'after';
        const relativeY = bounds.height ? (event.clientY - bounds.top) / bounds.height : 0.5;
        if (relativeY <= 0) return 'before';
        if (relativeY >= 1) return 'after';
        if (!canDropInside) return relativeY < 0.5 ? 'before' : 'after';
        if (relativeY < 0.25) return 'before';
        if (relativeY > 0.75) return 'after';
        return 'inside';
    };

    const handleLayerDrop = (event, targetId) => {
        event.preventDefault();
        if (!draggedLayerId || !targetId) return;

        const targetIndex = layerList.findIndex((entry) => entry.shape.id === targetId);
        const targetShape = shapesRef.current.find((shape) => shape.id === targetId) || null;
        const canDropInside = !!(targetShape && isContainerShape(targetShape) && !targetShape.locked);

        let dropType = getLayerDropZone(event, { canDropInside });
        if (dropType === 'inside' && (!targetShape || !isContainerShape(targetShape) || targetShape.locked)) {
            dropType = getLayerDropZone(event, { canDropInside: false });
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
                                {isDraggingLayer && (
                                    <div
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            setDragOverLayerId(null);
                                            setDragOverZone('top');
                                        }}
                                        onDragEnter={(event) => {
                                            event.preventDefault();
                                            setDragOverLayerId(null);
                                            setDragOverZone('top');
                                        }}
                                        onDragLeave={(event) => {
                                            setDragOverZone((zone) => (zone === 'top' ? null : zone));
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            const topShapeId = layerList[0]?.shape?.id;
                                            if (!draggedLayerId || !topShapeId) return;
                                            reorderLayers(draggedLayerId, topShapeId, 'before');
                                            setDraggedLayerId(null);
                                            setDragOverLayerId(null);
                                            setDragOverZone(null);
                                        }}
                                        style={{
                                            position: 'relative',
                                            height: 10,
                                            marginBottom: 6,
                                            pointerEvents: 'auto',
                                        }}
                                    >
                                        {dragOverZone === 'top' && (
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    inset: '3px 4px auto 4px',
                                                    height: 4,
                                                    borderRadius: 999,
                                                    background: '#4d90fe',
                                                    boxShadow: '0 0 0 1px #c7d7ff',
                                                    pointerEvents: 'none',
                                                }}
                                            />
                                        )}
                                    </div>
                                )}
                                {layerList.map(({ shape, depth }, index) => {
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
                                    const isDropBefore = isDragOver && dragOverZone === 'before';
                                    const isDropAfter = isDragOver && dragOverZone === 'after';
                                    const dropBackground = isDragOver && dragOverZone === 'inside';
                                    const canDropInside = isContainer && !shape.locked;

                                    return (
                                        <div
                                            key={shape.id}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                marginBottom: 4,
                                                paddingLeft: indent,
                                                position: 'relative',
                                            }}
                                        >
                                            {isDropBefore && (
                                                <div
                                                    style={{
                                                        position: 'absolute',
                                                        top: -2,
                                                        left: 6,
                                                        right: 6,
                                                        height: 4,
                                                        borderRadius: 999,
                                                        background: '#4d90fe',
                                                        boxShadow: '0 0 0 1px #c7d7ff',
                                                        pointerEvents: 'none',
                                                    }}
                                                />
                                            )}
                                            {isDropAfter && (
                                                <div
                                                    style={{
                                                        position: 'absolute',
                                                        bottom: -2,
                                                        left: 6,
                                                        right: 6,
                                                        height: 4,
                                                        borderRadius: 999,
                                                        background: '#4d90fe',
                                                        boxShadow: '0 0 0 1px #c7d7ff',
                                                        pointerEvents: 'none',
                                                    }}
                                                />
                                            )}
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
                                                    setDragOverZone(getLayerDropZone(event, { canDropInside }));
                                                }}
                                                onDragEnter={(event) => {
                                                    event.preventDefault();
                                                    setDragOverLayerId(shape.id);
                                                    setDragOverZone(getLayerDropZone(event, { canDropInside }));
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
                                                        : dropBackground
                                                            ? '#eaf1ff'
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
                                {isDraggingLayer && (
                                    <div
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            setDragOverLayerId(null);
                                            setDragOverZone('bottom');
                                        }}
                                        onDragEnter={(event) => {
                                            event.preventDefault();
                                            setDragOverLayerId(null);
                                            setDragOverZone('bottom');
                                        }}
                                        onDragLeave={() => {
                                            setDragOverZone((zone) => (zone === 'bottom' ? null : zone));
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            const bottomShapeId = layerList[layerList.length - 1]?.shape?.id;
                                            if (!draggedLayerId || !bottomShapeId) return;
                                            reorderLayers(draggedLayerId, bottomShapeId, 'after');
                                            setDraggedLayerId(null);
                                            setDragOverLayerId(null);
                                            setDragOverZone(null);
                                        }}
                                        style={{
                                            position: 'relative',
                                            height: 10,
                                            marginTop: 6,
                                            pointerEvents: 'auto',
                                        }}
                                    >
                                        {dragOverZone === 'bottom' && (
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    inset: 'auto 4px 3px 4px',
                                                    height: 4,
                                                    borderRadius: 999,
                                                    background: '#4d90fe',
                                                    boxShadow: '0 0 0 1px #c7d7ff',
                                                    pointerEvents: 'none',
                                                }}
                                            />
                                        )}
                                    </div>
                                )}
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
                            //rotationEnabled={false}
                            rotateEnabled={false}
                            //rotationAnchorOffset={-9999}
                            resizeEnabled={true}
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
                    {measurementOverlay && (
                        <Layer listening={false}>
                            {measurementOverlay.type === 'contain' ? (
                                <>
                                    {['left', 'right'].map((side) => {
                                        const data = measurementOverlay.sides[side];
                                        if (!data || data.dist < 0) return null;
                                        return (
                                            <React.Fragment key={side}>
                                                <Line
                                                    points={[data.x1, data.y1, data.x2, data.y2]}
                                                    stroke="#ef4444"
                                                    strokeWidth={1.5}
                                                    listening={false}
                                                    dash={[4, 4]}
                                                />
                                                <Text
                                                    x={(data.x1 + data.x2) / 2 - 16}
                                                    y={data.y1 - 16}
                                                    text={`${data.dist}px`}
                                                    fontSize={12}
                                                    fill="#ef4444"
                                                    listening={false}
                                                />
                                            </React.Fragment>
                                        );
                                    })}
                                    {['top', 'bottom'].map((side) => {
                                        const data = measurementOverlay.sides[side];
                                        if (!data || data.dist < 0) return null;
                                        return (
                                            <React.Fragment key={side}>
                                                <Line
                                                    points={[data.x1, data.y1, data.x2, data.y2]}
                                                    stroke="#ef4444"
                                                    strokeWidth={1.5}
                                                    listening={false}
                                                    dash={[4, 4]}
                                                />
                                                <Text
                                                    x={data.x1 + 8}
                                                    y={(data.y1 + data.y2) / 2 - 6}
                                                    text={`${data.dist}px`}
                                                    fontSize={12}
                                                    fill="#ef4444"
                                                    listening={false}
                                                />
                                            </React.Fragment>
                                        );
                                    })}
                                </>
                            ) : (
                                <>
                                    {measurementOverlay.showH && measurementOverlay.horizontal.dist >= 0 && (
                                        <>
                                            <Line
                                                points={[
                                                    measurementOverlay.horizontal.x1,
                                                    measurementOverlay.horizontal.y1,
                                                    measurementOverlay.horizontal.x2,
                                                    measurementOverlay.horizontal.y2,
                                                ]}
                                                stroke="#ef4444"
                                                strokeWidth={1.5}
                                                listening={false}
                                                dash={[4, 4]}
                                            />
                                            <Text
                                                x={(measurementOverlay.horizontal.x1 + measurementOverlay.horizontal.x2) / 2 - 16}
                                                y={measurementOverlay.horizontal.y1 - 16}
                                                text={`${measurementOverlay.horizontal.dist}px`}
                                                fontSize={12}
                                                fill="#ef4444"
                                                listening={false}
                                            />
                                        </>
                                    )}
                                    {measurementOverlay.showV && measurementOverlay.vertical.dist >= 0 && (
                                        <>
                                            <Line
                                                points={[
                                                    measurementOverlay.vertical.x1,
                                                    measurementOverlay.vertical.y1,
                                                    measurementOverlay.vertical.x2,
                                                    measurementOverlay.vertical.y2,
                                                ]}
                                                stroke="#ef4444"
                                                strokeWidth={1.5}
                                                listening={false}
                                                dash={[4, 4]}
                                            />
                                            <Text
                                                x={measurementOverlay.vertical.x1 + 8}
                                                y={(measurementOverlay.vertical.y1 + measurementOverlay.vertical.y2) / 2 - 6}
                                                text={`${measurementOverlay.vertical.dist}px`}
                                                fontSize={12}
                                                fill="#ef4444"
                                                listening={false}
                                            />
                                        </>
                                    )}
                                </>
                            )}
                        </Layer>
                    )}
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

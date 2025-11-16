const PATH_NODE_TYPES = {
    CORNER: 'corner',
    SMOOTH: 'smooth',
    DISCONNECTED: 'disconnected',
};

export const MIN_SEGMENT_LENGTH = 0.5;
export const MAX_POINTS_PER_PATH = 500;

export const PathNodeTypes = PATH_NODE_TYPES;

export const createPathPoint = ({ x = 0, y = 0, type = PATH_NODE_TYPES.CORNER, handles } = {}) => {
    const next = {
        x,
        y,
        type,
    };
    if (handles && (handles.left || handles.right)) {
        next.handles = {};
        if (handles.left) {
            next.handles.left = { x: handles.left.x, y: handles.left.y };
        }
        if (handles.right) {
            next.handles.right = { x: handles.right.x, y: handles.right.y };
        }
    }
    return next;
};

export const clonePathPoint = (point) => {
    if (!point) return null;
    const clone = {
        x: point.x,
        y: point.y,
        type: point.type || PATH_NODE_TYPES.CORNER,
    };
    if (point.handles) {
        clone.handles = {};
        if (point.handles.left) {
            clone.handles.left = { x: point.handles.left.x, y: point.handles.left.y };
        }
        if (point.handles.right) {
            clone.handles.right = { x: point.handles.right.x, y: point.handles.right.y };
        }
    }
    return clone;
};

export const clonePathPoints = (points) => {
    if (!Array.isArray(points)) return [];
    return points.map((point) => clonePathPoint(point));
};

export const translatePathPoints = (points, dx = 0, dy = 0) => {
    if (!Array.isArray(points)) return [];
    return points.map((point) => {
        const next = clonePathPoint(point);
        next.x += dx;
        next.y += dy;
        if (next.handles) {
            if (next.handles.left) {
                next.handles.left = {
                    x: next.handles.left.x + dx,
                    y: next.handles.left.y + dy,
                };
            }
            if (next.handles.right) {
                next.handles.right = {
                    x: next.handles.right.x + dx,
                    y: next.handles.right.y + dy,
                };
            }
            if (!next.handles.left && !next.handles.right) {
                delete next.handles;
            }
        }
        return next;
    });
};

export const getHandle = (point, side) => {
    if (!point || !point.handles) return null;
    const handle = point.handles[side];
    return handle ? { x: handle.x, y: handle.y } : null;
};

const hasCurveBetween = (a, b) => {
    if (!a || !b) return false;
    const aHandle = getHandle(a, 'right');
    const bHandle = getHandle(b, 'left');
    if (!aHandle && !bHandle) return false;
    return (
        (aHandle && (aHandle.x !== a.x || aHandle.y !== a.y)) ||
        (bHandle && (bHandle.x !== b.x || bHandle.y !== b.y))
    );
};

export const buildSvgPath = (points = [], closed = false) => {
    if (!Array.isArray(points) || points.length === 0) return '';
    const commands = [];
    const first = points[0];
    commands.push(`M ${first.x} ${first.y}`);
    for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const current = points[i];
        if (hasCurveBetween(prev, current)) {
            const cp1 = getHandle(prev, 'right') || { x: prev.x, y: prev.y };
            const cp2 = getHandle(current, 'left') || { x: current.x, y: current.y };
            commands.push(`C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${current.x} ${current.y}`);
        } else {
            commands.push(`L ${current.x} ${current.y}`);
        }
    }
    if (closed && points.length > 1) {
        const last = points[points.length - 1];
        if (hasCurveBetween(last, first)) {
            const cp1 = getHandle(last, 'right') || { x: last.x, y: last.y };
            const cp2 = getHandle(first, 'left') || { x: first.x, y: first.y };
            commands.push(`C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${first.x} ${first.y}`);
            commands.push('Z');
        } else {
            commands.push(`L ${first.x} ${first.y}`);
            commands.push('Z');
        }
    }
    return commands.join(' ');
};

export const distanceBetween = (a, b) => {
    if (!a || !b) return 0;
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    return Math.sqrt(dx * dx + dy * dy);
};

export const distanceToSegment = (point, a, b) => {
    if (!point || !a || !b) return Infinity;
    const ax = a.x;
    const ay = a.y;
    const bx = b.x;
    const by = b.y;
    const px = point.x;
    const py = point.y;
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) {
        return distanceBetween(point, a);
    }
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    const clamped = Math.max(0, Math.min(1, t));
    const cx = ax + clamped * dx;
    const cy = ay + clamped * dy;
    return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
};

const clamp = (value, min, max) => {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
};

const PATH_ROUNDING_EPSILON = 0.0001;
const HANDLE_FACTOR = 4 / 3;

export const roundPathCorners = (points = [], radius = 0) => {
    if (!Array.isArray(points) || points.length < 3) {
        return clonePathPoints(points);
    }

    const requestedRadius = Math.max(0, Number(radius) || 0);
    if (requestedRadius <= PATH_ROUNDING_EPSILON) {
        return clonePathPoints(points);
    }

    const count = points.length;
    const rounded = [];

    for (let index = 0; index < count; index += 1) {
        const prev = points[(index - 1 + count) % count];
        const current = points[index];
        const next = points[(index + 1) % count];

        if (!prev || !current || !next) {
            continue;
        }

        if (current.handles && (current.handles.left || current.handles.right)) {
            rounded.push(clonePathPoint(current));
            continue;
        }

        const incoming = distanceBetween(current, prev);
        const outgoing = distanceBetween(current, next);
        if (incoming < PATH_ROUNDING_EPSILON || outgoing < PATH_ROUNDING_EPSILON) {
            rounded.push(clonePathPoint(current));
            continue;
        }

        const maxRadius = Math.min(requestedRadius, incoming / 2, outgoing / 2);
        if (!Number.isFinite(maxRadius) || maxRadius <= PATH_ROUNDING_EPSILON) {
            rounded.push(clonePathPoint(current));
            continue;
        }

        const dirPrev = {
            x: (prev.x - current.x) / incoming,
            y: (prev.y - current.y) / incoming,
        };
        const dirNext = {
            x: (next.x - current.x) / outgoing,
            y: (next.y - current.y) / outgoing,
        };

        const tangentIn = { x: -dirPrev.x, y: -dirPrev.y };
        const tangentOut = { x: dirNext.x, y: dirNext.y };
        const dot = clamp(tangentIn.x * tangentOut.x + tangentIn.y * tangentOut.y, -1, 1);
        const angle = Math.acos(dot);

        if (!Number.isFinite(angle) || angle < PATH_ROUNDING_EPSILON) {
            rounded.push(clonePathPoint(current));
            continue;
        }

        const handleLength = maxRadius * HANDLE_FACTOR * Math.tan(angle / 4);

        const startPoint = createPathPoint({
            x: current.x + dirPrev.x * maxRadius,
            y: current.y + dirPrev.y * maxRadius,
            type: PATH_NODE_TYPES.DISCONNECTED,
        });

        const endPoint = createPathPoint({
            x: current.x + dirNext.x * maxRadius,
            y: current.y + dirNext.y * maxRadius,
            type: PATH_NODE_TYPES.DISCONNECTED,
        });

        if (Number.isFinite(handleLength) && Math.abs(handleLength) > PATH_ROUNDING_EPSILON) {
            startPoint.handles = {
                right: {
                    x: startPoint.x + tangentIn.x * handleLength,
                    y: startPoint.y + tangentIn.y * handleLength,
                },
            };

            endPoint.handles = {
                left: {
                    x: endPoint.x - tangentOut.x * handleLength,
                    y: endPoint.y - tangentOut.y * handleLength,
                },
            };
        }

        rounded.push(startPoint, endPoint);
    }

    return rounded;
};

export const addHandle = (point, side, coords) => {
    const next = clonePathPoint(point);
    next.handles = next.handles || {};
    if (coords) {
        next.handles[side] = { x: coords.x, y: coords.y };
    } else {
        delete next.handles[side];
    }
    if (!next.handles.left && !next.handles.right) {
        delete next.handles;
    }
    return next;
};

export const ensureHandlesForType = (point) => {
    const next = clonePathPoint(point);
    if (next.type === PATH_NODE_TYPES.CORNER) {
        delete next.handles;
        return next;
    }
    next.handles = next.handles || {};
    if (next.type === PATH_NODE_TYPES.SMOOTH) {
        if (!next.handles.left) {
            next.handles.left = { x: next.x - 40, y: next.y };
        }
        if (!next.handles.right) {
            next.handles.right = { x: next.x + 40, y: next.y };
        }
    }
    return next;
};

export const updateHandleSymmetry = (point, movedSide) => {
    if (!point) return point;
    if (point.type !== PATH_NODE_TYPES.SMOOTH) {
        return point;
    }
    const next = clonePathPoint(point);
    next.handles = next.handles || {};
    const otherSide = movedSide === 'left' ? 'right' : 'left';
    const movedHandle = next.handles[movedSide];
    if (!movedHandle) {
        delete next.handles[otherSide];
    } else {
        const dx = movedHandle.x - next.x;
        const dy = movedHandle.y - next.y;
        next.handles[otherSide] = { x: next.x - dx, y: next.y - dy };
    }
    return next;
};

export const PATH_NODE_TYPE_LIST = [
    PATH_NODE_TYPES.CORNER,
    PATH_NODE_TYPES.SMOOTH,
    PATH_NODE_TYPES.DISCONNECTED,
];

const ELLIPSE_KAPPA = 0.5522847498307936;

const rotatePointAround = (point, center, angle) => {
    if (!point || !center || !Number.isFinite(angle)) return point;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
    };
};

const rotatePathPoint = (point, center, angle) => {
    if (!point || Math.abs(angle) < 0.000001) {
        return point;
    }
    const rotated = clonePathPoint(point);
    const pivot = center || { x: 0, y: 0 };
    const anchor = rotatePointAround({ x: rotated.x, y: rotated.y }, pivot, angle);
    rotated.x = anchor.x;
    rotated.y = anchor.y;
    if (rotated.handles) {
        if (rotated.handles.left) {
            rotated.handles.left = rotatePointAround(rotated.handles.left, pivot, angle);
        }
        if (rotated.handles.right) {
            rotated.handles.right = rotatePointAround(rotated.handles.right, pivot, angle);
        }
        if (!rotated.handles.left && !rotated.handles.right) {
            delete rotated.handles;
        }
    }
    return rotated;
};

const buildRectanglePath = (shape) => {
    const width = Math.max(0, shape.width || 0);
    const height = Math.max(0, shape.height || 0);
    if (!width || !height) return null;
    const center = { x: shape.x || 0, y: shape.y || 0 };
    const halfW = width / 2;
    const halfH = height / 2;
    const corners = [
        createPathPoint({ x: center.x - halfW, y: center.y - halfH, type: PATH_NODE_TYPES.CORNER }),
        createPathPoint({ x: center.x + halfW, y: center.y - halfH, type: PATH_NODE_TYPES.CORNER }),
        createPathPoint({ x: center.x + halfW, y: center.y + halfH, type: PATH_NODE_TYPES.CORNER }),
        createPathPoint({ x: center.x - halfW, y: center.y + halfH, type: PATH_NODE_TYPES.CORNER }),
    ];
    const rotation = Number.isFinite(shape.rotation) ? (shape.rotation * Math.PI) / 180 : 0;
    const rotated = rotation ? corners.map((pt) => rotatePathPoint(pt, center, rotation)) : corners;
    return {
        points: rotated,
        closed: true,
        lineJoin: shape.lineJoin || 'miter',
    };
};

const buildEllipsePath = (shape, radiusX, radiusY) => {
    if (!radiusX || !radiusY) return null;
    const center = { x: shape.x || 0, y: shape.y || 0 };
    const top = createPathPoint({
        x: center.x,
        y: center.y - radiusY,
        type: PATH_NODE_TYPES.SMOOTH,
        handles: {
            left: { x: center.x - radiusX * ELLIPSE_KAPPA, y: center.y - radiusY },
            right: { x: center.x + radiusX * ELLIPSE_KAPPA, y: center.y - radiusY },
        },
    });
    const right = createPathPoint({
        x: center.x + radiusX,
        y: center.y,
        type: PATH_NODE_TYPES.SMOOTH,
        handles: {
            left: { x: center.x + radiusX, y: center.y - radiusY * ELLIPSE_KAPPA },
            right: { x: center.x + radiusX, y: center.y + radiusY * ELLIPSE_KAPPA },
        },
    });
    const bottom = createPathPoint({
        x: center.x,
        y: center.y + radiusY,
        type: PATH_NODE_TYPES.SMOOTH,
        handles: {
            left: { x: center.x + radiusX * ELLIPSE_KAPPA, y: center.y + radiusY },
            right: { x: center.x - radiusX * ELLIPSE_KAPPA, y: center.y + radiusY },
        },
    });
    const left = createPathPoint({
        x: center.x - radiusX,
        y: center.y,
        type: PATH_NODE_TYPES.SMOOTH,
        handles: {
            left: { x: center.x - radiusX, y: center.y + radiusY * ELLIPSE_KAPPA },
            right: { x: center.x - radiusX, y: center.y - radiusY * ELLIPSE_KAPPA },
        },
    });
    const rotation = Number.isFinite(shape.rotation) ? (shape.rotation * Math.PI) / 180 : 0;
    const nodes = [top, right, bottom, left];
    const rotated = rotation ? nodes.map((pt) => rotatePathPoint(pt, center, rotation)) : nodes;
    return {
        points: rotated,
        closed: true,
        lineJoin: shape.lineJoin || 'round',
    };
};

const buildLinePath = (shape) => {
    if (!Array.isArray(shape.points) || shape.points.length < 4) return null;
    const nodes = [];
    for (let i = 0; i < shape.points.length - 1; i += 2) {
        const x = shape.points[i];
        const y = shape.points[i + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        nodes.push(createPathPoint({ x, y, type: PATH_NODE_TYPES.CORNER }));
    }
    if (nodes.length < 2) return null;
    return {
        points: nodes,
        closed: false,
        lineCap: shape.lineCap || 'round',
        lineJoin: shape.lineJoin || 'miter',
    };
};

const buildPolygonPath = (shape) => {
    if (!Array.isArray(shape.points) || shape.points.length < 6) return null;
    const baseX = shape.x || 0;
    const baseY = shape.y || 0;
    const nodes = [];
    for (let i = 0; i < shape.points.length - 1; i += 2) {
        let px = shape.points[i];
        let py = shape.points[i + 1];
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        if (shape.absolute === false) {
            px += baseX;
            py += baseY;
        }
        nodes.push(createPathPoint({ x: px, y: py, type: PATH_NODE_TYPES.CORNER }));
    }
    if (nodes.length < 3) return null;
    const rotation = Number.isFinite(shape.rotation) ? (shape.rotation * Math.PI) / 180 : 0;
    const center = { x: shape.x || 0, y: shape.y || 0 };
    const rotated = rotation ? nodes.map((pt) => rotatePathPoint(pt, center, rotation)) : nodes;
    return {
        points: rotated,
        closed: true,
        lineJoin: shape.lineJoin || 'miter',
    };
};

const buildStarPath = (shape) => {
    const numPoints = Math.max(2, Math.floor(shape.numPoints || 0));
    const outerRadius = Math.max(0, shape.outerRadius || shape.radius || 0);
    if (!numPoints || !outerRadius) return null;
    const innerRadius = Math.max(0, shape.innerRadius || outerRadius / 2);
    const center = { x: shape.x || 0, y: shape.y || 0 };
    const baseRotation = Number.isFinite(shape.rotation) ? (shape.rotation * Math.PI) / 180 : 0;
    const step = Math.PI / numPoints;
    const nodes = [];
    for (let i = 0; i < numPoints * 2; i += 1) {
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const angle = baseRotation + i * step - Math.PI / 2;
        nodes.push(
            createPathPoint({
                x: center.x + Math.cos(angle) * radius,
                y: center.y + Math.sin(angle) * radius,
                type: PATH_NODE_TYPES.CORNER,
            })
        );
    }
    return {
        points: nodes,
        closed: true,
        lineJoin: shape.lineJoin || 'miter',
    };
};

export const canConvertShapeToPath = (shape) => {
    if (!shape) return false;
    switch (shape.type) {
        case 'rectangle':
            return Math.max(0, shape.width || 0) > 0 && Math.max(0, shape.height || 0) > 0;
        case 'circle':
            return Math.max(0, shape.radius || 0) > 0;
        case 'ellipse':
            return Math.max(0, shape.radiusX || 0) > 0 && Math.max(0, shape.radiusY || 0) > 0;
        case 'line':
            return Array.isArray(shape.points) && shape.points.length >= 4;
        case 'polygon':
            return Array.isArray(shape.points) && shape.points.length >= 6;
        case 'star':
            return (
                (Math.max(0, shape.outerRadius || shape.radius || 0) > 0 &&
                    Math.max(2, Math.floor(shape.numPoints || 0)) >= 2) ||
                (Array.isArray(shape.points) && shape.points.length >= 6)
            );
        default:
            return false;
    }
};

export const shapeToPath = (shape) => {
    if (!shape) return null;
    switch (shape.type) {
        case 'rectangle':
            return buildRectanglePath(shape);
        case 'circle':
            return buildEllipsePath(shape, Math.max(0, shape.radius || 0), Math.max(0, shape.radius || 0));
        case 'ellipse':
            return buildEllipsePath(
                shape,
                Math.max(0, shape.radiusX || 0),
                Math.max(0, shape.radiusY || 0)
            );
        case 'line':
            return buildLinePath(shape);
        case 'polygon':
            return buildPolygonPath(shape);
        case 'star':
            if (Array.isArray(shape.points) && shape.points.length >= 6) {
                return buildPolygonPath(shape);
            }
            return buildStarPath(shape);
        default:
            return null;
    }
};

export default PATH_NODE_TYPES;

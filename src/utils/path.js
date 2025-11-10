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

export default PATH_NODE_TYPES;

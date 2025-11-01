const HEX_REGEX = /^#([0-9a-f]{6})$/i;

const clamp = (value, min, max) => {
    if (Number.isNaN(value)) return min;
    return Math.min(Math.max(value, min), max);
};

const normalizeColor = (value, fallback = '#000000') => {
    if (typeof value === 'string' && HEX_REGEX.test(value)) {
        return value.toLowerCase();
    }
    return fallback;
};

const normalizeStops = (stops, fallbackStops) => {
    if (!Array.isArray(stops) || stops.length < 2) return fallbackStops;
    const normalized = stops
        .slice(0, 4)
        .map((stop, index) => {
            const fallbackStop = fallbackStops[index] || fallbackStops[fallbackStops.length - 1];
            const color = normalizeColor(stop?.color, fallbackStop.color);
            const position = clamp(
                typeof stop?.position === 'number' ? stop.position : fallbackStop.position,
                0,
                1
            );
            return { color, position };
        });

    if (normalized.length < 2) {
        return fallbackStops;
    }

    normalized.sort((a, b) => a.position - b.position);
    normalized[0] = { ...normalized[0], position: 0 };
    normalized[normalized.length - 1] = { ...normalized[normalized.length - 1], position: 1 };

    return normalized;
};

export const DEFAULT_GRADIENT = {
    angle: 135,
    stops: [
        { position: 0, color: '#6366f1' },
        { position: 1, color: '#f97316' },
    ],
};

export const normalizeGradient = (value, fallback = DEFAULT_GRADIENT) => {
    if (!value || typeof value !== 'object') return { ...fallback, stops: [...fallback.stops] };
    const angleSource = typeof value.angle === 'number' ? value.angle : fallback.angle;
    const angle = ((angleSource % 360) + 360) % 360;
    const stops = normalizeStops(value.stops, fallback.stops);
    return { angle, stops };
};

export const gradientToCss = (gradient) => {
    const normalized = normalizeGradient(gradient);
    const stops = normalized.stops
        .map((stop) => `${stop.color} ${Math.round(stop.position * 100)}%`)
        .join(', ');
    return `linear-gradient(${normalized.angle}deg, ${stops})`;
};

export const gradientStopsEqual = (a, b) => {
    const first = normalizeGradient(a);
    const second = normalizeGradient(b);
    if (first.stops.length !== second.stops.length) return false;
    if (first.angle !== second.angle) return false;
    return first.stops.every((stop, index) => {
        const other = second.stops[index];
        return stop.color === other.color && stop.position === other.position;
    });
};

export const getGradientFirstColor = (gradient, fallback = '#000000') => {
    const normalized = normalizeGradient(gradient, DEFAULT_GRADIENT);
    return normalized.stops[0]?.color || fallback;
};

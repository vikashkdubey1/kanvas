const HEX_REGEX = /^#([0-9a-f]{6})$/i;

const SUPPORTED_TYPES = ['linear', 'radial', 'angular', 'diamond'];
export const GRADIENT_TYPES = [...SUPPORTED_TYPES];

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

const normalizeOpacity = (value, fallback = 1) => {
    const numeric = typeof value === 'number' ? value : fallback;
    if (!Number.isFinite(numeric)) return clamp(fallback, 0, 1);
    return clamp(numeric, 0, 1);
};

const normalizeStops = (stops, fallbackStops) => {
    if (!Array.isArray(stops) || stops.length < 2) {
        return fallbackStops.map((stop) => ({ ...stop }));
    }

    const normalized = stops
        .slice(0, 8)
        .map((stop, index) => {
            const fallbackStop = fallbackStops[index] || fallbackStops[fallbackStops.length - 1];
            const color = normalizeColor(stop?.color, fallbackStop.color);
            const position = clamp(
                typeof stop?.position === 'number' ? stop.position : fallbackStop.position,
                0,
                1
            );
            const opacity = normalizeOpacity(stop?.opacity, fallbackStop.opacity ?? 1);
            return { color, position, opacity };
        })
        .filter((stop, index, array) => {
            // guard against NaN entries
            if (typeof stop.position !== 'number' || Number.isNaN(stop.position)) {
                return false;
            }
            return true;
        });

    if (normalized.length < 2) {
        return fallbackStops.map((stop) => ({ ...stop }));
    }

    normalized.sort((a, b) => a.position - b.position);

    return normalized;
};

const hexToRgb = (hex) => {
    const match = HEX_REGEX.exec(hex);
    if (!match) return null;
    const int = parseInt(match[1], 16);
    return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255,
    };
};

const rgbToHex = (r, g, b) =>
    `#${[r, g, b]
        .map((channel) => {
            const clamped = clamp(Math.round(channel), 0, 255);
            return clamped.toString(16).padStart(2, '0');
        })
        .join('')}`;

const mixChannel = (a, b, t) => a + (b - a) * t;

const buildStopCssColor = (stop) => {
    const opacity = typeof stop.opacity === 'number' ? clamp(stop.opacity, 0, 1) : 1;
    if (opacity >= 1) {
        return stop.color;
    }
    const rgb = hexToRgb(stop.color);
    if (!rgb) return stop.color;
    const alpha = Math.round(opacity * 1000) / 1000;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

export const DEFAULT_GRADIENT = {
    type: 'linear',
    angle: 135,
    stops: [
        { position: 0, color: '#6366f1', opacity: 1 },
        { position: 1, color: '#f97316', opacity: 1 },
    ],
};

export const normalizeGradient = (value, fallback = DEFAULT_GRADIENT) => {
    if (!value || typeof value !== 'object') {
        return {
            type: fallback.type,
            angle: fallback.angle,
            stops: fallback.stops.map((stop) => ({ ...stop })),
        };
    }

    const typeSource = typeof value.type === 'string' ? value.type.toLowerCase() : fallback.type;
    const type = SUPPORTED_TYPES.includes(typeSource) ? typeSource : fallback.type;

    const angleSource = typeof value.angle === 'number' ? value.angle : fallback.angle;
    const angle = ((angleSource % 360) + 360) % 360;
    const stops = normalizeStops(value.stops, fallback.stops);

    return { type, angle, stops };
};

const stopsToCss = (stops) =>
    stops
        .map((stop) => `${buildStopCssColor(stop)} ${Math.round(stop.position * 100)}%`)
        .join(', ');

export const gradientToCss = (gradient) => {
    const normalized = normalizeGradient(gradient, DEFAULT_GRADIENT);
    const stops = stopsToCss(normalized.stops);
    switch (normalized.type) {
        case 'radial':
            return `radial-gradient(circle, ${stops})`;
        case 'angular':
            return `conic-gradient(from ${normalized.angle}deg at 50% 50%, ${stops})`;
        case 'diamond':
            return `conic-gradient(from ${normalized.angle + 45}deg at 50% 50%, ${stops})`;
        case 'linear':
        default:
            return `linear-gradient(${normalized.angle}deg, ${stops})`;
    }
};

export const gradientStopsEqual = (a, b) => {
    const first = normalizeGradient(a, DEFAULT_GRADIENT);
    const second = normalizeGradient(b, DEFAULT_GRADIENT);
    if (first.type !== second.type) return false;
    if (first.stops.length !== second.stops.length) return false;
    if (first.angle !== second.angle) return false;
    return first.stops.every((stop, index) => {
        const other = second.stops[index];
        return (
            stop.color === other.color &&
            stop.position === other.position &&
            (stop.opacity ?? 1) === (other.opacity ?? 1)
        );
    });
};

export const getGradientFirstColor = (gradient, fallback = '#000000') => {
    const normalized = normalizeGradient(gradient, DEFAULT_GRADIENT);
    return normalized.stops[0]?.color || fallback;
};

export const buildGradientColorStops = (gradient) => {
    const normalized = normalizeGradient(gradient, DEFAULT_GRADIENT);
    return normalized.stops.reduce((accumulator, stop) => {
        accumulator.push(stop.position);
        accumulator.push(buildStopCssColor(stop));
        return accumulator;
    }, []);
};

export const interpolateGradientColor = (stops, position) => {
    if (!Array.isArray(stops) || stops.length === 0) {
        return { color: DEFAULT_GRADIENT.stops[0].color, opacity: 1 };
    }

    const sorted = stops
        .map((stop) => ({
            color: normalizeColor(stop.color, DEFAULT_GRADIENT.stops[0].color),
            position: clamp(typeof stop.position === 'number' ? stop.position : 0, 0, 1),
            opacity: normalizeOpacity(stop.opacity, 1),
        }))
        .sort((a, b) => a.position - b.position);

    const clampedPosition = clamp(position, 0, 1);

    if (clampedPosition <= sorted[0].position) {
        return { ...sorted[0] };
    }

    const last = sorted[sorted.length - 1];
    if (clampedPosition >= last.position) {
        return { ...last };
    }

    let left = sorted[0];
    let right = last;
    for (let i = 0; i < sorted.length - 1; i += 1) {
        const current = sorted[i];
        const next = sorted[i + 1];
        if (clampedPosition >= current.position && clampedPosition <= next.position) {
            left = current;
            right = next;
            break;
        }
    }

    const span = right.position - left.position;
    const t = span === 0 ? 0 : (clampedPosition - left.position) / span;

    const leftRgb = hexToRgb(left.color) || hexToRgb(DEFAULT_GRADIENT.stops[0].color);
    const rightRgb = hexToRgb(right.color) || leftRgb;

    if (!leftRgb || !rightRgb) {
        return { color: left.color, opacity: mixChannel(left.opacity, right.opacity, t) };
    }

    const mixedColor = rgbToHex(
        mixChannel(leftRgb.r, rightRgb.r, t),
        mixChannel(leftRgb.g, rightRgb.g, t),
        mixChannel(leftRgb.b, rightRgb.b, t)
    );

    return {
        color: mixedColor,
        opacity: mixChannel(left.opacity, right.opacity, t),
    };
};

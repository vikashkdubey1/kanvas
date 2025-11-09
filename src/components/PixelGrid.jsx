// src/components/PixelGrid.js
import React, { useMemo } from "react";
import { Layer, Shape } from "react-konva";

/**
 * Draws a 1px screen-space grid where each cell equals 1 world px.
 * Works by ignoring Stage transforms and using step = scale (screen px per world px).
 */
const PixelGrid = ({
    // Stage transform:
    scale,            // world->screen (e.g., 1=100%, 8=800%)
    stagePos,         // { x, y } in SCREEN px (Stage props x/y)
    // Viewport size in SCREEN px (use Stage width/height)
    viewport,         // { width, height }
    minScaleToShow = 8,
    color = "rgba(0,0,0,0.05)",
}) => {
    if (!scale || scale < minScaleToShow) return null;

    // Screen-space step between lines = scale (screen px of 1 world px)
    const { step, offsetX, offsetY, cols, rows } = useMemo(() => {
        const step = Math.max(1, Math.floor(scale)); // screen pixels per world px
        // Stage is translated by stagePos.x/y (screen px). We want grid lines to land
        // on world integer coordinates, so we phase by stagePos modulo step.
        const mod = (a, b) => ((a % b) + b) % b;
        const offsetX = mod(stagePos.x, step);
        const offsetY = mod(stagePos.y, step);

        const cols = Math.ceil((viewport.width - offsetX) / step) + 1;
        const rows = Math.ceil((viewport.height - offsetY) / step) + 1;

        return { step, offsetX, offsetY, cols, rows };
    }, [scale, stagePos.x, stagePos.y, viewport.width, viewport.height]);

    return (
        <Layer
            listening={false}
            // Key trick: ignore Stage transforms so we draw in raw SCREEN pixels
            transformsEnabled="none"
        >
            <Shape
                listening={false}
                sceneFunc={(ctx, shape) => {
                    ctx.save();
                    ctx.lineWidth = 0.1;          // 1 real screen pixel
                    ctx.strokeStyle = color;

                    // Verticals
                    ctx.beginPath();
                    for (let i = 0; i < cols; i++) {
                        const x = offsetX + i * step + 0.5; // 0.5 to land on pixel center
                        ctx.moveTo(x, 0);
                        ctx.lineTo(x, viewport.height);
                    }
                    ctx.stroke();

                    // Horizontals
                    ctx.beginPath();
                    for (let j = 0; j < rows; j++) {
                        const y = offsetY + j * step + 0.5;
                        ctx.moveTo(0, y);
                        ctx.lineTo(viewport.width, y);
                    }
                    ctx.stroke();

                    ctx.restore();
                    ctx.fillStrokeShape(shape);
                }}
            />
        </Layer>
    );
};

export default PixelGrid;

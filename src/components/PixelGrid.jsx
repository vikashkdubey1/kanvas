// src/components/PixelGrid.js
import React, { useMemo } from "react";
import { Layer, Shape } from "react-konva";

const PixelGrid = ({
    scale,                 // Stage scale (1=100%, 8=800%, etc.)
    stagePos,              // Stage x/y in SCREEN px (exactly what you pass to <Stage x y>)
    viewport,              // { width, height } in SCREEN px (Stage size)
    minScaleToShow = 8,
    color = "rgba(0,0,0,1)",
}) => {
    if (!scale || scale < minScaleToShow) return null;

    // Convert the visible screen rect to WORLD coordinates using Stage transform.
    const { x0, x1, y0, y1, firstX, lastX, firstY, lastY } = useMemo(() => {
        // screen -> world: w = (screen - stagePos) / scale
        const x0 = (0 - stagePos.x) / scale;
        const y0 = (0 - stagePos.y) / scale;
        const x1 = (viewport.width - stagePos.x) / scale;
        const y1 = (viewport.height - stagePos.y) / scale;

        // Draw integer world coordinates that fall inside the view
        const firstX = Math.floor(x0);
        const lastX = Math.ceil(x1);
        const firstY = Math.floor(y0);
        const lastY = Math.ceil(y1);

        return { x0, x1, y0, y1, firstX, lastX, firstY, lastY };
    }, [scale, stagePos.x, stagePos.y, viewport.width, viewport.height]);

    // Make screen thickness ≈0.1px at 8× and thinner as zoom increases:
    // W_screen = k/scale, with k chosen so W_screen(8) = 0.1 => k = 0.8
    const desiredScreenPx = 0.8 / scale;
    // Convert to world units (Stage multiplies lineWidth by scale):
    const worldLineWidth = Math.max(desiredScreenPx / scale, 0.0005);

    return (
        <Layer listening={false}>
            <Shape
                listening={false}
                sceneFunc={(ctx, shape) => {
                    ctx.save();
                    ctx.lineWidth = worldLineWidth;
                    ctx.strokeStyle = color;

                    // Align to pixel centers in screen space => 0.5 screen px = 0.5/scale world units
                    const align = 0.5 / scale;

                    // Vertical lines at each integer X
                    ctx.beginPath();
                    for (let x = firstX; x <= lastX; x++) {
                        const wx = x + align;
                        ctx.moveTo(wx, y0);
                        ctx.lineTo(wx, y1);
                    }
                    ctx.stroke();

                    // Horizontal lines at each integer Y
                    ctx.beginPath();
                    for (let y = firstY; y <= lastY; y++) {
                        const wy = y + align;
                        ctx.moveTo(x0, wy);
                        ctx.lineTo(x1, wy);
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

import React, { useRef } from 'react';
import { Stage, Layer, Rect } from 'react-konva';

/**
 * Canvas is the central drawing surface for the application.
 * This simple example creates a single rectangle that can be
 * dragged around.  As you expand the app, you can add event
 * handlers for creating new shapes, selecting objects and
 * implementing zooming/panning.
 */
export default function Canvas({ selectedTool }) {
  // A reference to the stage can be used to control panning/zooming later.
  const stageRef = useRef(null);

  // For demonstration purposes, we display a single draggable rectangle.  In
  // a full implementation you would use `selectedTool` to decide how to
  // handle mouse events and create new shapes.  Here we simply log the
  // selected tool when it changes.
  React.useEffect(() => {
    console.log('Selected tool:', selectedTool);
  }, [selectedTool]);

  return (
    <Stage
      width={window.innerWidth}
      height={window.innerHeight - 40 /* subtract toolbar height */}
      ref={stageRef}
      style={{ background: '#fafafa' }}
    >
      <Layer>
        {/* Example rectangle; you can remove this once you start implementing your own objects */}
        <Rect
          x={50}
          y={50}
          width={100}
          height={100}
          fill="skyblue"
          draggable
        />
      </Layer>
    </Stage>
  );
}
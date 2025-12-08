import React from 'react';

export function TankVisualizer({ value, percentage, units, min, max, color }) {
  const range = max - min;
  const numMarks = 5;
  const scaleMarks = Array.from({ length: numMarks + 1 }, (_, i) => {
    const markValue = min + (range * i) / numMarks;
    const position = (i / numMarks) * 100;
    return {
      label: `${markValue.toFixed(1)} ${units}`,
      position: `${position}%`,
    };
  });

  return (
    <div className="tank-visualizer">
      <div className="tank-header">
        <p>Valor Actual</p>
        <p>
          <span>{value.toFixed(2)}</span> {units}
        </p>
      </div>
      <div className="tank-body">
        <div className="tank-scale">
          {scaleMarks.map((mark, index) => (
            <div key={index} className="scale-mark" style={{ bottom: mark.position }}>
              {mark.label}
            </div>
          ))}
        </div>
        <div
          className="water-level"
          style={{ height: `${percentage}%`, backgroundColor: color }}
        ></div>
      </div>
    </div>
  );
}

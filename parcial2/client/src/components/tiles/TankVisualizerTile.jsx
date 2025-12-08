import React, { useState } from 'react';
import { TankVisualizer } from '../TankVisualizer';
import { TileHeader } from './TileHeader';

function SettingsModal({ tile, onSave, onCancel, sourceOptions }) {
  const [title, setTitle] = useState(tile.title);
  const [sourceKey, setSourceKey] = useState(tile.sourceKey);
  const [sourceIndex, setSourceIndex] = useState(tile.sourceIndex || 0);
  const [units, setUnits] = useState(tile.units || 'cm');
  const [min, setMin] = useState(tile.min || 0);
  const [max, setMax] = useState(tile.max || 10);
  const [color, setColor] = useState(tile.color || '#007bff');

  const handleSave = () => {
    onSave({ ...tile, title, sourceKey, sourceIndex, units, min, max, color });
  };

  return (
    <div className="tile-settings-modal">
      <div className="modal-content">
        <h3>Configurar Widget: Tanque</h3>
        <label>
          Título:
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Fuente de datos (Etiqueta):
          <select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
            <option value="">-- Selecciona una fuente --</option>
            {sourceOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
        <label>
          Índice del dato (si es un array):
          <input type="number" value={sourceIndex} min="0" onChange={(e) => setSourceIndex(parseInt(e.target.value, 10))} />
        </label>
        <label>
          Unidades:
          <input type="text" value={units} onChange={(e) => setUnits(e.target.value)} />
        </label>
        <label>
          Valor Mínimo (para %):
          <input type="number" value={min} onChange={(e) => setMin(parseFloat(e.target.value))} />
        </label>
        <label>
          Valor Máximo (para %):
          <input type="number" value={max} onChange={(e) => setMax(parseFloat(e.target.value))} />
        </label>
        <label>
          Color del líquido:
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button onClick={handleSave}>Guardar</button>
          <button onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}


export function TankVisualizerTile({ id, title, data, sourceKey, sourceIndex, sourceOptions, onUpdate, onClose, units, min, max, color, isStatic }) {
  const [isSettingsOpen, setSettingsOpen] = useState(false);

  const lastData = data.length > 0 ? data[data.length - 1].y : 0;
  const value = Number(lastData);
  
  const range = (max ?? 10) - (min ?? 0);
  const percentage = range > 0 ? ((value - (min ?? 0)) / range) * 100 : 0;
  const clampedPercentage = Math.max(0, Math.min(100, percentage));

  const handleSaveSettings = (newConfig) => {
    onUpdate(id, newConfig);
    setSettingsOpen(false);
  };
  
  const toggleStatic = () => {
    onUpdate(id, { isStatic: !isStatic });
  };

  return (
    <div className="tile-base tank-tile">
      <TileHeader
        title={title}
        isStatic={isStatic}
        onToggleStatic={toggleStatic}
        onSettings={() => setSettingsOpen(true)}
        onClose={onClose}
      />
      <div className="tile-content">
        <TankVisualizer
          value={value}
          percentage={clampedPercentage}
          units={units || 'cm'}
          min={min ?? 0}
          max={max ?? 10}
          color={color || '#007bff'}
        />
      </div>
      {isSettingsOpen && (
        <SettingsModal
          tile={{ id, title, sourceKey, sourceIndex, units, min, max, color }}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
          sourceOptions={sourceOptions}
        />
      )}
    </div>
  );
}

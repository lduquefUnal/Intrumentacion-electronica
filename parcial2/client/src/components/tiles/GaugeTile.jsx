import React, { useState } from 'react';
import { Gauge } from '@mui/x-charts/Gauge';
import { TileHeader } from './TileHeader';

function SettingsModal({ tile, onSave, onCancel, sourceOptions }) {
  const [title, setTitle] = useState(tile.title || 'Medidor');
  const [sourceKey, setSourceKey] = useState(tile.sourceKey);
  const [sourceIndex, setSourceIndex] = useState(tile.sourceIndex || 0);
  const [min, setMin] = useState(tile.min || 0);
  const [max, setMax] = useState(tile.max || 100);

  const handleSave = () => {
    onSave({ ...tile, title, sourceKey, sourceIndex, min, max });
  };

  return (
    <div className="tile-settings-modal">
      <div className="modal-content">
        <h3>Configurar Widget: Medidor</h3>
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
          Valor Mínimo:
          <input type="number" value={min} onChange={(e) => setMin(parseFloat(e.target.value))} />
        </label>
        <label>
          Valor Máximo:
          <input type="number" value={max} onChange={(e) => setMax(parseFloat(e.target.value))} />
        </label>
        <div className="modal-actions">
          <button onClick={handleSave}>Guardar</button>
          <button onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export function GaugeTile({ id, title, data, sourceKey, sourceIndex, sourceOptions, onUpdate, onClose, min, max, isStatic }) {
  const [isSettingsOpen, setSettingsOpen] = useState(false);

  const lastValue = data.length > 0 ? data[data.length - 1].y : 0;

  const handleSaveSettings = (newConfig) => {
    onUpdate(id, newConfig);
    setSettingsOpen(false);
  };

  const toggleStatic = () => {
    onUpdate(id, { isStatic: !isStatic });
  };

  return (
    <div className="tile-base gauge-tile">
      <TileHeader
        title={title}
        isStatic={isStatic}
        onToggleStatic={toggleStatic}
        onSettings={() => setSettingsOpen(true)}
        onClose={onClose}
      />
      <div className="tile-content centered">
        <Gauge
          value={lastValue}
          valueMin={min || 0}
          valueMax={max || 100}
          startAngle={-110}
          endAngle={110}
          height={150}
        />
      </div>
      {isSettingsOpen && (
        <SettingsModal
          tile={{ id, title, sourceKey, sourceIndex, min, max }}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
          sourceOptions={sourceOptions}
        />
      )}
    </div>
  );
}

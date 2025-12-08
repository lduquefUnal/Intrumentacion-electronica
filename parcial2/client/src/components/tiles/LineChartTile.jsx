import React, { useState } from 'react';
import { Chart } from '../Chart';
import { TileHeader } from './TileHeader'; // 1. Importar

function SettingsModal({ tile, onSave, onCancel, sourceOptions }) {
  const [title, setTitle] = useState(tile.title);
  const [sourceKey, setSourceKey] = useState(tile.sourceKey);
  const [sourceIndex, setSourceIndex] = useState(tile.sourceIndex || 0);
  const [yLabel, setYLabel] = useState(tile.yLabel || 'Valor');
  const [window, setWindow] = useState(tile.window || 5000);

  const handleSave = () => {
    onSave({ ...tile, title, sourceKey, sourceIndex, yLabel, window });
  };

  return (
    <div className="tile-settings-modal">
      <div className="modal-content">
        <h3>Configurar Widget: Gráfico</h3>
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
          Etiqueta Eje Y:
          <input type="text" value={yLabel} onChange={(e) => setYLabel(e.target.value)} />
        </label>
        <label>
          Ventana de tiempo (ms):
          <input type="number" value={window} onChange={(e) => setWindow(parseInt(e.target.value, 10))} />
        </label>
        <div className="modal-actions">
          <button onClick={handleSave}>Guardar</button>
          <button onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}


export function LineChartTile({ id, title, data, sourceKey, sourceIndex, sourceOptions, onUpdate, onClose, yLabel, window, isStatic, globalTime }) {
  const [mode, setMode] = useState('continuo');
  const [isSettingsOpen, setSettingsOpen] = useState(false);

  const handleSaveSettings = (newConfig) => {
    onUpdate(id, newConfig);
    setSettingsOpen(false);
  };

  const toggleStatic = () => {
    onUpdate(id, { isStatic: !isStatic });
  };

  return (
    <div className="tile-base line-chart-tile">
      <TileHeader
        title={title}
        isStatic={isStatic}
        onToggleStatic={toggleStatic}
        onSettings={() => setSettingsOpen(true)}
        onClose={onClose}
      />
      <div className="tile-content">
        <Chart
          title={title}
          yLabel={yLabel || 'Valor'}
          data={data}
          mode={mode}
          onModeChange={() => setMode(m => m === 'continuo' ? 'absoluto' : 'continuo')}
          globalTime={globalTime}
          window={window || 5000}
        />
      </div>
      {isSettingsOpen && (
        <SettingsModal
          tile={{ id, title, sourceKey, sourceIndex, yLabel, window }}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
          sourceOptions={sourceOptions}
        />
      )}
    </div>
  );
}

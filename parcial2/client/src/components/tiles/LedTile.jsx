import React, { useState, useEffect } from 'react';
import { TileHeader } from './TileHeader';

function SettingsModal({ tile, onSave, onCancel, sourceOptions }) {
  const [title, setTitle] = useState(tile.title || 'Diodo LED');
  const [cmd, setCmd] = useState(tile.cmd || 'LED');
  const [valueOn, setValueOn] = useState(tile.valueOn || '1');
  const [valueOff, setValueOff] = useState(tile.valueOff || '0');
  const [sourceKey, setSourceKey] = useState(tile.sourceKey || '');
  const [sourceIndex, setSourceIndex] = useState(tile.sourceIndex || 0);

  const handleSave = () => {
    onSave({ ...tile, title, cmd, valueOn, valueOff, sourceKey, sourceIndex });
  };

  return (
    <div className="tile-settings-modal">
      <div className="modal-content">
        <h3>Configurar Widget: Diodo LED</h3>
        <label>
          Título del Widget:
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Comando a enviar (cmd):
          <input type="text" value={cmd} onChange={(e) => setCmd(e.target.value)} />
        </label>
        <label>
          Valor para ON:
          <input type="text" value={valueOn} onChange={(e) => setValueOn(e.target.value)} />
        </label>
        <label>
          Valor para OFF:
          <input type="text" value={valueOff} onChange={(e) => setValueOff(e.target.value)} />
        </label>
        <label>
          Fuente de datos (LED):
          <select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
            <option value="">-- Selecciona una fuente --</option>
            {sourceOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
        <label>
          Índice si la fuente es arreglo:
          <input
            type="number"
            value={sourceIndex}
            min="0"
            onChange={(e) => setSourceIndex(parseInt(e.target.value, 10))}
          />
        </label>
        <div className="modal-actions">
          <button onClick={handleSave}>Guardar</button>
          <button onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export function LedTile({
  id,
  title,
  data = [],
  sourceKey,
  sourceIndex,
  onUpdate,
  onClose,
  onSendCommand,
  cmd,
  valueOn,
  valueOff,
  isStatic,
  sourceOptions = []
}) {
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isOn, setIsOn] = useState(false);

  const parseBoolish = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'true' || v === 'on') return true;
      if (v === 'false' || v === 'off') return false;
      if (v === '1') return true;
      if (v === '0') return false;
    }
    return null;
  };

  useEffect(() => {
    if (!data || data.length === 0) return;
    const last = data[data.length - 1].y;
    const parsed = parseBoolish(last);
    if (parsed !== null) {
      setIsOn(parsed);
    }
  }, [data]);

  const handleSaveSettings = (newConfig) => {
    onUpdate(id, newConfig);
    setSettingsOpen(false);
  };

  const handleToggle = (nextState) => {
    setIsOn(nextState);
    if (onSendCommand && cmd) {
      const valueToSend = nextState ? (valueOn || '1') : (valueOff || '0');
      onSendCommand(cmd, valueToSend);
    } else {
      console.warn('Comando o función onSendCommand no definidos para este LED.');
    }
  };

  const toggleStatic = () => {
    onUpdate(id, { isStatic: !isStatic });
  };

  return (
    <div className="tile-base led-tile">
      <TileHeader
        title={title}
        isStatic={isStatic}
        onToggleStatic={toggleStatic}
        onSettings={() => setSettingsOpen(true)}
        onClose={onClose}
      />
      <div className="tile-content centered led-content">
        <div className={`led-indicator ${isOn ? 'on' : 'off'}`} aria-label={isOn ? 'LED encendido' : 'LED apagado'} />
        <div className="led-controls">
          <button className="led-btn on nodrag" onClick={() => handleToggle(true)}>ON</button>
          <button className="led-btn off nodrag" onClick={() => handleToggle(false)}>OFF</button>
        </div>
      </div>
      {isSettingsOpen && (
        <SettingsModal
          tile={{ id, title, cmd, valueOn, valueOff, sourceKey, sourceIndex }}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
          sourceOptions={sourceOptions}
        />
      )}
    </div>
  );
}

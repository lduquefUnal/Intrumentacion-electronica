import React, { useState } from 'react';
import { TileHeader } from './TileHeader';

function SettingsModal({ tile, onSave, onCancel }) {
  const [title, setTitle] = useState(tile.title || 'Slider');
  const [cmd, setCmd] = useState(tile.cmd || 'PWM');
  const [min, setMin] = useState(tile.min || 0);
  const [max, setMax] = useState(tile.max || 255);

  const handleSave = () => {
    onSave({ ...tile, title, cmd, min, max });
  };

  return (
    <div className="tile-settings-modal">
      <div className="modal-content">
        <h3>Configurar Widget: Slider</h3>
        <label>
          Título del Widget:
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Comando a enviar (cmd):
          <input type="text" value={cmd} onChange={(e) => setCmd(e.target.value)} />
        </label>
        <label>
          Valor Mínimo:
          <input type="number" value={min} onChange={(e) => setMin(parseInt(e.target.value, 10))} />
        </label>
        <label>
          Valor Máximo:
          <input type="number" value={max} onChange={(e) => setMax(parseInt(e.target.value, 10))} />
        </label>
        <div className="modal-actions">
          <button onClick={handleSave}>Guardar</button>
          <button onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}


export function ControlSliderTile({ id, title, onUpdate, onClose, onSendCommand, cmd, min = 0, max = 255, isStatic }) {
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [value, setValue] = useState(min);

  const handleSaveSettings = (newConfig) => {
    onUpdate(id, newConfig);
    setSettingsOpen(false);
  };
  
  const handleCommand = () => {
    if (onSendCommand && cmd) {
      onSendCommand(cmd, value);
    }
  };
  
  const toggleStatic = () => {
    onUpdate(id, { isStatic: !isStatic });
  };

  return (
    <div className="tile-base slider-tile">
      <TileHeader
        title={title}
        isStatic={isStatic}
        onToggleStatic={toggleStatic}
        onSettings={() => setSettingsOpen(true)}
        onClose={onClose}
      />
      <div className="tile-content centered" style={{ flexDirection: 'column', gap: '15px' }}>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => setValue(parseInt(e.target.value, 10))}
          onMouseUp={handleCommand}
          onTouchEnd={handleCommand}
          style={{ width: '80%' }}
          className="nodrag" // Asegura que el slider no inicie un arrastre
        />
        <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{value}</span>
      </div>
       {isSettingsOpen && (
        <SettingsModal
          tile={{ id, title, cmd, min, max }}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

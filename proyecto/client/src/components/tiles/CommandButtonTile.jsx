import React, { useState } from 'react';
import { TileHeader } from './TileHeader';

function SettingsModal({ tile, onSave, onCancel }) {
  const [title, setTitle] = useState(tile.title || 'Botón');
  const [cmd, setCmd] = useState(tile.cmd || 'CMD');
  const [valueOn, setValueOn] = useState(tile.valueOn || '1');
  const [valueOff, setValueOff] = useState(tile.valueOff || '0');

  const handleSave = () => {
    onSave({ ...tile, title, cmd, valueOn, valueOff });
  };

  return (
    <div className="tile-settings-modal">
      <div className="modal-content">
        <h3>Configurar Widget: Botón Toggle</h3>
        <label>
          Título del Widget:
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Comando a enviar (cmd):
          <input type="text" value={cmd} onChange={(e) => setCmd(e.target.value)} />
        </label>
        <label>
          Valor para ON (true):
          <input type="text" value={valueOn} onChange={(e) => setValueOn(e.target.value)} />
        </label>
        <label>
          Valor para OFF (false):
          <input type="text" value={valueOff} onChange={(e) => setValueOff(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button onClick={handleSave}>Guardar</button>
          <button onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export function CommandButtonTile({ id, title, onUpdate, onClose, onSendCommand, cmd, valueOn, valueOff, isStatic }) {
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isOn, setIsOn] = useState(false);

  const handleSaveSettings = (newConfig) => {
    onUpdate(id, newConfig);
    setSettingsOpen(false);
  };

  const handleClick = () => {
    const nextState = !isOn;
    setIsOn(nextState);
    if (onSendCommand && cmd) {
      const valueToSend = nextState ? (valueOn || '1') : (valueOff || '0');
      onSendCommand(cmd, valueToSend);
    } else {
      console.warn('Comando o función onSendCommand no definidos para este botón.');
    }
  };

  const toggleStatic = () => {
    onUpdate(id, { isStatic: !isStatic });
  };

  const buttonStyle = {
    backgroundColor: isOn ? '#28a745' : '#dc3545',
    borderColor: isOn ? '#28a745' : '#dc3545',
  };

  return (
    <div className="tile-base button-tile">
      <TileHeader
        title={title}
        isStatic={isStatic}
        onToggleStatic={toggleStatic}
        onSettings={() => setSettingsOpen(true)}
        onClose={onClose}
      />
      <div className="tile-content centered">
        <button className="command-button" onClick={handleClick} style={buttonStyle}>
          {title || 'Botón'}
        </button>
      </div>
      {isSettingsOpen && (
        <SettingsModal
          tile={{ id, title, cmd, valueOn, valueOff }}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

import React from 'react';

export function TileHeader({ title, isStatic, onToggleStatic, onSettings, onClose }) {
  return (
    // 'drag-handle' es la clase que usará react-grid-layout para mover el widget
    <header className="tile-header drag-handle">
      <h4 className="tile-title">{title}</h4>
      <div className="tile-controls">
        {/* 'nodrag' asegura que los clics en los botones no inicien un arrastre */}
        <button onClick={onToggleStatic} className="tile-button nodrag" title={isStatic ? 'Desanclar' : 'Anclar'}>
          {isStatic ? '📌' : '📍'}
        </button>
        <button onClick={onSettings} className="tile-button nodrag" title="Configuración">
          ⚙️
        </button>
        <button onClick={onClose} className="tile-button nodrag" title="Cerrar">
          ✕
        </button>
      </div>
    </header>
  );
}

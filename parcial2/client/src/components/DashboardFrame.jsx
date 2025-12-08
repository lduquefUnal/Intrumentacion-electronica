import React, { useState, useEffect, useRef } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { LineChartTile } from './tiles/LineChartTile';
import { GaugeTile } from './tiles/GaugeTile';
import { ControlSliderTile } from './tiles/ControlSliderTile';
import { CommandButtonTile } from './tiles/CommandButtonTile';
import { TankVisualizerTile } from './tiles/TankVisualizerTile';
import { FFTTile } from './tiles/FFTTile';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './tiles/tiles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

const TILE_TYPES = {
  line: LineChartTile,
  gauge: GaugeTile,
  slider: ControlSliderTile,
  button: CommandButtonTile,
  tank: TankVisualizerTile,
  fft: FFTTile,
};

const STORAGE_KEY = 'dashboard-tiles-v2';

export function DashboardFrame({ dataSources, globalTime, onSendCommand }) {
  const [tiles, setTiles] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.error('Error leyendo layout guardado:', e);
    }
    return [];
  });

  // Efecto para guardar en localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tiles));
    } catch (e) {
      console.error('Error guardando layout:', e);
    }
  }, [tiles]);

  // Efecto para asegurar que los tiles tengan un sourceKey válido
  useEffect(() => {
    const sourceKeys = Object.keys(dataSources);
    if (sourceKeys.length > 0 && tiles.length > 0) {
      const needsUpdate = tiles.some(tile => !tile.sourceKey || !sourceKeys.includes(tile.sourceKey));
      
      if (needsUpdate) {
        setTiles(prevTiles => 
          prevTiles.map(tile => {
            if (!tile.sourceKey || !sourceKeys.includes(tile.sourceKey)) {
              return { ...tile, sourceKey: sourceKeys[0] };
            }
            return tile;
          })
        );
      }
    }
  }, [dataSources]); // Se ejecuta SOLO si las fuentes cambian


  const addTile = (type) => {
    const sourceKeys = Object.keys(dataSources);
    if (sourceKeys.length === 0) {
      // No se pueden añadir widgets si no hay fuentes de datos
      alert("Por favor, espera a que se establezca una conexión de datos para añadir widgets.");
      return;
    }

    const id = String(Date.now());
    let newTile = {
      id,
      type,
      title: 'Nuevo Widget',
      sourceKey: sourceKeys[0], // Asignar la primera fuente de datos por defecto
      sourceIndex: 0,
      isStatic: false,
      i: id,
      x: (tiles.length * 4) % 12,
      y: Infinity,
      w: 4,
      h: 6,
    };

    if (type === 'tank') {
      newTile = { ...newTile, title: 'Tanque', units: 'cm', min: 0, max: 10, color: '#007bff', w: 3, h: 8 };
    }
    if (type === 'gauge') {
        newTile = { ...newTile, title: 'Medidor', min: 0, max: 100, w: 3, h: 5 };
    }
    if (type === 'button') {
        newTile = { ...newTile, title: 'Botón', cmd: 'CMD', valueOn: '1', valueOff: '0', w: 2, h: 2 };
    }
    if (type === 'fft') {
        newTile = { ...newTile, title: 'Análisis FFT', fftWindowSize: 1024, sampleRate: 50000, freqMin: 0, freqMax: 25000, h: 8 };
    }

    setTiles((prev) => [...prev, newTile]);
  };

  const removeTile = (id) => {
    setTiles((prev) => prev.filter((t) => t.id !== id));
  };

  const updateTile = (id, partial) => {
    setTiles((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...partial } : t))
    );
  };

  const handleLayoutChange = (newLayout) => {
    setTiles(prevTiles => {
      return prevTiles.map(tile => {
        const layoutItem = newLayout.find(l => l.i === tile.id);
        if (layoutItem) {
          return { ...tile, ...layoutItem };
        }
        return tile;
      });
    });
  };

  const sourceOptions = Object.keys(dataSources);
  const layout = tiles.map(({ i, x, y, w, h, isStatic }) => ({ i, x, y, w, h, static: isStatic }));
  const areDataSourcesAvailable = sourceOptions.length > 0;

  return (
    <div className="dashboard-frame">
      <aside className="catalog">
        <h3>Widgets</h3>
        {!areDataSourcesAvailable && (
          <span className="waiting-for-data">Esperando datos...</span>
        )}
        <button onClick={() => addTile('line')} disabled={!areDataSourcesAvailable}>+ Line Chart</button>
        <button onClick={() => addTile('gauge')} disabled={!areDataSourcesAvailable}>+ Gauge</button>
        <button onClick={() => addTile('slider')} disabled={!areDataSourcesAvailable}>+ Slider PWM</button>
        <button onClick={() => addTile('button')} disabled={!areDataSourcesAvailable}>+ Botón Toggle</button>
        <button onClick={() => addTile('tank')} disabled={!areDataSourcesAvailable}>+ Tanque</button>
        <button onClick={() => addTile('fft')} disabled={!areDataSourcesAvailable}>+ FFT Analyzer</button>
      </aside>

      <section className="tiles-area">
        <ResponsiveGridLayout
          className="layout"
          layouts={{ lg: layout }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={30}
          onLayoutChange={(currentLayout) => handleLayoutChange(currentLayout)}
          draggableHandle=".drag-handle"
          draggableCancel=".nodrag"
        >
          {tiles.map((tile) => {
            const TileComponent = TILE_TYPES[tile.type];
            if (!TileComponent) return null;

            const stream = dataSources[tile.sourceKey] || [];
            const processedData = stream.map(point => ({
              x: point.x,
              y: Array.isArray(point.y) ? point.y[tile.sourceIndex || 0] ?? 0 : point.y
            })).filter(p => p.y !== undefined);

            return (
              <div key={tile.id} className={tile.isStatic ? 'is-static' : ''}>
                <TileComponent
                  {...tile}
                  data={processedData}
                  globalTime={globalTime}
                  sourceOptions={sourceOptions}
                  onUpdate={updateTile}
                  onClose={() => removeTile(tile.id)}
                  onSendCommand={onSendCommand}
                />
              </div>
            );
          })}
        </ResponsiveGridLayout>
      </section>
    </div>
  );
}

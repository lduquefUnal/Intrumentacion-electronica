import React, { useState, useEffect, useRef } from 'react';
import { Chart } from '../Chart';
import { TileHeader } from './TileHeader';

function SettingsModal({ tile, onSave, onCancel, sourceOptions }) {
  const [title, setTitle] = useState(tile.title || 'Análisis FFT');
  const [sourceKey, setSourceKey] = useState(tile.sourceKey || '');
  const [fftWindowSize, setFftWindowSize] = useState(tile.fftWindowSize || 1024);
  const [sampleRate, setSampleRate] = useState(tile.sampleRate || 50000); // Frecuencia de muestreo en Hz
  const [freqMin, setFreqMin] = useState(tile.freqMin ?? 0);
  const [freqMax, setFreqMax] = useState(tile.freqMax ?? Math.floor((tile.sampleRate || 50000) / 2));

  const handleSave = () => {
    onSave({ ...tile, title, sourceKey, fftWindowSize, sampleRate, freqMin, freqMax });
  };

  return (
    <div className="tile-settings-modal">
      <div className="modal-content">
        <h3>Configurar Widget: FFT</h3>
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
          Puntos para FFT (potencia de 2):
          <input type="number" value={fftWindowSize} onChange={(e) => setFftWindowSize(parseInt(e.target.value, 10))} />
        </label>
         <label>
          Frecuencia de Muestreo (Hz):
          <input type="number" value={sampleRate} onChange={(e) => setSampleRate(parseInt(e.target.value, 10))} />
        </label>
        <label>
          Frecuencia mínima (Hz):
          <input type="number" value={freqMin} onChange={(e) => setFreqMin(parseInt(e.target.value, 10) || 0)} />
        </label>
        <label>
          Frecuencia máxima a mostrar (Hz):
          <input type="number" value={freqMax} onChange={(e) => setFreqMax(parseInt(e.target.value, 10) || 0)} />
        </label>
        <div className="modal-actions">
          <button onClick={handleSave}>Guardar</button>
          <button onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export function FFTTile({ id, title, data, sourceKey, sourceOptions, onUpdate, onClose, isStatic, fftWindowSize = 1024, sampleRate = 50000, freqMin = 0, freqMax }) {
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [fftResult, setFftResult] = useState(null);
  const workerRef = useRef(null);
  const pendingPayloadRef = useRef(null);
  const isBusyRef = useRef(false);

  const flushToWorker = () => {
    if (!workerRef.current || isBusyRef.current || !pendingPayloadRef.current) return;
    isBusyRef.current = true;
    const payload = pendingPayloadRef.current;
    pendingPayloadRef.current = null;
    console.log(`[FFT Tile: ${id}] SENDING payload to worker (${payload.signal.length} points, win=${payload.fftWindowSize}).`);
    workerRef.current.postMessage(payload);
  };

  // Effect for worker lifecycle management (with logging)
  useEffect(() => {
    console.log(`[FFT Tile: ${id}] CREATING new worker.`);
    workerRef.current = new Worker(new URL('../../workers/fft.worker.js', import.meta.url), { type: 'module' });

    workerRef.current.onmessage = (event) => {
      console.log(`[FFT Tile: ${id}] RECEIVED message from worker:`, event.data);
      if (event.data.error) {
        console.error(`[FFT Tile: ${id}] Worker error:`, event.data.error);
      } else {
        setFftResult(event.data);
      }
      isBusyRef.current = false;
      flushToWorker(); // Si había algo pendiente, envíalo ahora
    };
    workerRef.current.onerror = (err) => {
      console.error(`[FFT Tile: ${id}] Worker crashed:`, err.message || err);
      isBusyRef.current = false;
    };
    workerRef.current.onmessageerror = (err) => {
      console.error(`[FFT Tile: ${id}] Worker message error:`, err);
      isBusyRef.current = false;
    };

    // Cleanup function
    return () => {
      console.log(`[FFT Tile: ${id}] TERMINATING worker.`);
      workerRef.current.terminate();
    };
  }, [id]); // Runs once per tile instance

  // Effect for sending data to the worker (with logging)
  useEffect(() => {
    if (!workerRef.current) {
      console.log(`[FFT Tile: ${id}] Skipping postMessage: worker not ready.`);
      return;
    }
    if (!fftWindowSize || (fftWindowSize & (fftWindowSize - 1)) !== 0) {
      console.warn(`[FFT Tile: ${id}] Skipping postMessage: fftWindowSize (${fftWindowSize}) no es potencia de 2.`);
      return;
    }

    if (data && data.length > 0) {
      const signal = data.map(p => p.y);
      pendingPayloadRef.current = { signal, fftWindowSize };
      console.log(`[FFT Tile: ${id}] QUEUED ${signal.length} points for worker (window size: ${fftWindowSize}).`);
      flushToWorker();
    } else {
      console.log(`[FFT Tile: ${id}] Skipping postMessage: no data.`);
    }
  }, [data, fftWindowSize, id]); // Re-run when data or window size changes


  const handleSaveSettings = (newConfig) => {
    onUpdate(id, newConfig);
    setSettingsOpen(false);
  };

  const toggleStatic = () => {
    onUpdate(id, { isStatic: !isStatic });
  };
  
  const effectiveSampleRate = sampleRate || 50000;
  const effectiveFreqMin = Number.isFinite(freqMin) ? freqMin : 0;
  const effectiveFreqMax = Number.isFinite(freqMax) && freqMax > 0 ? freqMax : effectiveSampleRate / 2;

  const { spectrum, topFrequencies } = fftResult || {};
  
  const fftChartData = spectrum ? spectrum.map((magnitude, index) => ({
    x: index * (effectiveSampleRate / fftWindowSize), // Calculate frequency for each bin
    y: magnitude
  })).filter(point => point.x >= effectiveFreqMin && point.x <= effectiveFreqMax) : [];
  
  const topFreqsToDisplay = topFrequencies ? topFrequencies
    .map(peak => {
      const freqValue = peak.index * (effectiveSampleRate / fftWindowSize);
      return {
        ...peak,
        freqValue,
        frequency: freqValue.toFixed(2)
      };
    })
    .filter(peak => peak.freqValue >= effectiveFreqMin && peak.freqValue <= effectiveFreqMax) : [];

  return (
    <div className="tile-base fft-tile">
      <TileHeader
        title={title}
        isStatic={isStatic}
        onToggleStatic={toggleStatic}
        onSettings={() => setSettingsOpen(true)}
        onClose={onClose}
      />
      <div className="tile-content" style={{ flexDirection: 'column', gap: '10px' }}>
        <div style={{ textAlign: 'center', width: '100%' }}>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>Frecuencias Fundamentales:</p>
            {topFreqsToDisplay.length > 0 ? (
                 topFreqsToDisplay.map((f, i) => (
                    <p key={i} style={{ margin: 0, fontSize: '18px' }}>
                        {`#${i+1}: `}<strong>{f.frequency} Hz</strong>
                        {` (Mag: ${f.magnitude.toFixed(2)})`}
                    </p>
                 ))
            ) : (
                <p style={{ margin: 0, fontSize: '18px' }}>Calculando...</p>
            )}
        </div>
        <div style={{ flex: 1, width: '100%', height: '100%' }}>
            {spectrum && (
                <Chart
                    title={`Espectro de ${sourceKey}`}
                    yLabel="Magnitud"
                    xLabel="Frecuencia (Hz)"
                    data={fftChartData}
                    mode={'absoluto'}
                    chartType="bar"
                />
            )}
        </div>
      </div>
      {isSettingsOpen && (
        <SettingsModal
          tile={{ id, title, sourceKey, fftWindowSize, sampleRate }}
          onSave={handleSaveSettings}
          onCancel={() => setSettingsOpen(false)}
          sourceOptions={sourceOptions}
        />
      )}
    </div>
  );
}

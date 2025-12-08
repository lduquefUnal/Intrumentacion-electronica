// Chart.jsx
import React, { useState, useRef, useEffect } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

// Register all necessary components for Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

export function Chart({
  title,
  yLabel,
  xLabel = 'Tiempo (s)',
  data,
  mode,
  onModeChange,
  globalTime,
  window,
  fftData,
  chartType: controlledChartType,
}) {
  const chartRef = useRef(null);
  const [autoY, setAutoY] = useState(true);
  const [yMin, setYMin] = useState('0');
  const [yMax, setYMax] = useState('10');
  const [formula, setFormula] = useState('x');
  const [internalChartType, setInternalChartType] = useState('line');
  
  const chartType = controlledChartType || internalChartType;

  // This effect runs every time the data or settings change.
  // It updates the chart directly, without re-rendering the whole component.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // --- Data Transformation & Filtering ---
    let transformFn;
    try {
      transformFn = new Function('x', `return ${formula}`);
    } catch (err) {
      transformFn = (x) => x;
    }

    const chartMin = mode === 'continuo' ? globalTime?.current - window : data.length > 0 ? data[0].x : 0;
    const chartMax = mode === 'continuo' ? globalTime?.current : data.length > 0 ? data[data.length - 1].x : 0;
    
    // 1. Filter data to the visible window first
    const visibleData = data.filter(point => point.x >= chartMin && point.x <= chartMax);

    // 2. Then, transform only the visible data
    const transformedData = visibleData.map((point) => {
      let newY;
      try {
        newY = transformFn(point.y);
      } catch {
        newY = point.y;
      }
      return { x: point.x, y: newY };
    });

    // --- Chart Update ---
    // Update data
    chart.data.datasets[0].data = transformedData;
    chart.data.datasets[0].label = title;
    chart.data.datasets[0].type = chartType;

    // Update options
    chart.options.scales.x.min = chartMin;
    chart.options.scales.x.max = chartMax;
    chart.options.scales.x.title.text = xLabel;
    chart.options.scales.y.title.text = yLabel;
    
    if (autoY) {
        delete chart.options.scales.y.min;
        delete chart.options.scales.y.max;
    } else {
        chart.options.scales.y.min = Number(yMin);
        chart.options.scales.y.max = Number(yMax);
    }

    // Tell Chart.js to re-render
    chart.update('none'); // 'none' avoids animations between updates

  }, [data, title, yLabel, xLabel, mode, globalTime, window, formula, autoY, yMin, yMax, chartType]);

  // Initial options object. This is created only once.
  const initialOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false, // No animation on initial render
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: xLabel },
        ticks: {
          callback: xLabel === 'Tiempo (s)'
            ? (value) => (value / 1000).toFixed(1)
            : (value) => value.toFixed(1),
        },
      },
      y: {
        title: { display: true, text: yLabel },
      },
    },
    plugins: { 
        legend: { display: true },
        decimation: { // This plugin helps with performance by down-sampling data
            enabled: false,
            algorithm: 'lttb', // Largest-Triangle-Three-Buckets
            samples: 150, // Number of samples to draw
        }
    },
  };

  // Initial data object. Also created only once.
  const initialData = {
    datasets: [
      {
        label: title,
        borderColor: 'red',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        data: [],
        fill: false,
        tension: 0.1,
        pointRadius: 0.1,
        borderWidth: 1,
      },
    ],
  };

  const ChartComponent = chartType === 'bar' ? Bar : Line;

  return (
    <div className="chart-container" style={{ position: 'relative', height: '100%', width: '100%' }}>
      {/* Controles */}
      {!controlledChartType && (
        <div className="chart-controls">
            <label style={{ marginRight: '10px' }}>
                Tipo:&nbsp;
                <select value={internalChartType} onChange={(e) => setInternalChartType(e.target.value)}>
                <option value="line">Lineal</option>
                <option value="bar">Barras</option>
                </select>
            </label>
            <label style={{ marginRight: '10px' }}>
                Eje Y auto:&nbsp;
                <input type="checkbox" checked={autoY} onChange={(e) => setAutoY(e.target.checked)} />
            </label>
            {!autoY && (
                <>
                <label>Y mín:<input type="number" value={yMin} onChange={(e) => setYMin(e.target.value)} style={{ width: '60px' }} /></label>
                <label>Y máx:<input type="number" value={yMax} onChange={(e) => setYMax(e.target.value)} style={{ width: '60px' }} /></label>
                </>
            )}
            <label>
                Fórmula (y):&nbsp;
                <input type="text" value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="y*3.1+4" style={{ width: '100px' }}/>
            </label>
        </div>
      )}

      {/* The Chart component is now given the ref. It will not be re-rendered. */}
      <ChartComponent ref={chartRef} options={initialOptions} data={initialData} />

      {onModeChange && (
        <button onClick={onModeChange} className="chart-mode-toggle">
          Modo: {mode === 'continuo' ? 'Continuo' : 'Absoluto'}
        </button>
      )}

      {fftData && <div className="fft-info">{fftData}</div>}
    </div>
  );
}
const socket = io();
document.addEventListener("DOMContentLoaded", function () {
  // ...existing code...
  const sendBtn = document.getElementById('sendBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const statusDiv = document.getElementById('statusDiv');
  const errorDisplay = document.getElementById('errorDisplay');
  const waterLevelTank = document.getElementById('water-level-tank');
  const currentLevelEl = document.getElementById('current-level');
  const portSelector = document.getElementById('portSelector');
  const connectBtn = document.getElementById('connectBtn');
  const statusLed = document.getElementById('statusLed');
  const statusMsg = document.getElementById('statusMsg');
  const commandSelect = document.getElementById('commandSelect');
  const valueInput = document.getElementById('valueInput');
  let isPaused = false;
  let setPoint = 0.0;
  let error = 0.0;
  let globalTime = 0;
  let latestLevel = NaN;
  let latestCap_pF = NaN;
  // Ventana de tiempo y muestreo
  const sampleInterval = 1;
  const chartWindow = 300;
  const chartStep = 1000 / 30;
  const maxPoints = Math.ceil(chartWindow / sampleInterval);

  const chartDefs = [
    {
      id: 'chart1',
      label: 'Nivel del Agua (cm)',
      color: 'blue',
      yRange: { min: 0, max: 12 }
    }
  ];

  const charts = {};
  const dataBuffer = [];

  pauseBtn.addEventListener('click', () => {
    isPaused = true;
    pauseBtn.disabled = true;
    resumeBtn.disabled = false;
  });
  resumeBtn.addEventListener('click', () => {
    isPaused = false;
    pauseBtn.disabled = false;
    resumeBtn.disabled = true;
  });

  const chartConfig = (def) => ({
    type: 'line',
    data: {
      datasets: [
        {
          label: def.label,
          borderColor: def.color,
          data: [],
          fill: false,
          tension: 0.1,
          pointRadius: 0.1,
          showLine: true,
          borderWidth: 1
        },
        ...(def.id === 'chart1' ? [{
          label: 'SetPoint',
          borderColor: 'green',
          borderDash: [5, 5],
          data: [],
          fill: false,
          pointRadius: 0,
          tension: 0,
          borderWidth: 1
        }] : [])
      ]
    },
    options: {
      animation: false,
      responsive: true,
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: chartWindow,
          title: { display: true, text: 'Tiempo (ms)' }
        },
        y: {
          min: def.yRange.min,
          max: def.yRange.max,
          title: { display: true, text: def.label }
        }
      },
      plugins: { legend: { display: false } }
    }
  });

  chartDefs.forEach((def) => {
    const canvas = document.getElementById(def.id);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      charts[def.id] = new Chart(ctx, chartConfig(def));
    }
  });

  function updateTank(level) {
     if (waterLevelTank) {
    // tomar el máximo de la escala Y del chart si está disponible, si no usar 12
    const chart = charts['chart1'];
    const chartYMax = chart && chart.options && chart.options.scales && chart.options.scales.y && typeof chart.options.scales.y.max === 'number'
      ? chart.options.scales.y.max
      : 12;

    const val = Number(level);
    const percentage = isNaN(val) ? 0 : (val / chartYMax) * 100;
    waterLevelTank.style.height = `${Math.min(100, Math.max(0, percentage))}%`;
    waterLevelTank.style.backgroundColor = 'blue';
  }
  if (currentLevelEl) {
    const v = Number(level);
    currentLevelEl.textContent = isNaN(v) ? '---' : v.toFixed(2);
  }
  }

  // Nuevo: manejar ambos formatos: array de objetos (JSON) o string legacy
  socket.on('serialData', (payload) => {
    // Si el servidor ya envía un array de objetos
    if (Array.isArray(payload)) {
      for (const obj of payload) {
        const level = parseFloat(obj.CH);
        const currentSetPoint = parseFloat(obj.SP);
        const errVal = parseFloat(obj.err);

        if (!isNaN(level)) {
          dataBuffer.push(level);
          latestLevel = level;
        }
        if (!isNaN(currentSetPoint)) setPoint = currentSetPoint;
        if (!isNaN(errVal)) error = errVal;
       let capVal = NaN;
       if (obj.C !== undefined && obj.C !== null) capVal = parseFloat(obj.C);
       else if (obj.Ctxt) capVal = parseFloat(String(obj.Ctxt).replace(/[^\d.\-]/g, ''));
      if (!isNaN(capVal)) latestCap_pF = capVal;

        updateTank(level);
      }
      return;
    }

    // Si llega legacy como string "v,sp;v2,sp2;..."
    if (typeof payload === 'string') {
      const dataPoints = payload.trim().split(';');
      for (const point of dataPoints) {
        if (!point) continue;
        const values = point.split(',');
        if (values.length >= 2) {
          const level = parseFloat(values[0]);
          const currentSetPoint = parseFloat(values[1]);
          if (!isNaN(level)) dataBuffer.push(level);
          if (!isNaN(currentSetPoint)) setPoint = currentSetPoint;
          updateTank(level);
        }
      }
    }
  });

  socket.on('serialLine', (line) => {
    // opcional: mostrar/guardar línea cruda
    // console.log('raw:', line);
  });

  socket.on('commandResponse', (response) => {
    statusDiv.textContent = response;
    const isError = response.toLowerCase().startsWith('error');
    statusDiv.style.color = isError ? 'red' : 'green';
    statusDiv.style.backgroundColor = isError ? '#ffebee' : '#e8f5e9';
    setTimeout(() => {
      statusDiv.textContent = 'Conectado al servidor';
      statusDiv.style.color = 'green';
      statusDiv.style.backgroundColor = '#e8f5e9';
    }, 3000);
  });

  function updateCharts() {
    if (isPaused) {
      setTimeout(updateCharts, chartStep);
      return;
    }

    const start = performance.now();
    let time = globalTime;
    const chart = charts['chart1'];

    if (chart) {
      const dataset = chart.data.datasets[0];

      dataBuffer.forEach(val => {
        dataset.data.push({ x: time, y: val });
        time += sampleInterval;
      });

      dataBuffer.length = 0;

      while (dataset.data.length > maxPoints) {
        dataset.data.shift();
      }

      const setpointDataset = chart.data.datasets[1];
      setpointDataset.data = [
        { x: time - chartWindow, y: setPoint },
        { x: time, y: setPoint }
      ];

      chart.options.scales.x.min = time - chartWindow;
      chart.options.scales.x.max = time;

      chart.update('none');
    }

    globalTime = time;
        errorDisplay.textContent = isNaN(error) ? '---' : error.toFixed(2);
        // Mostrar error porcentual respecto al setPoint y capacitancia al lado
    let errPercent = NaN;
    if (!isNaN(setPoint) && setPoint !== 0 && !isNaN(latestLevel)) {
      errPercent = ((setPoint - latestLevel) / setPoint) * 100.0;
    }
    let errText = isNaN(errPercent) ? '---' : `${errPercent.toFixed(2)} %`;
    // Mostrar etiqueta "C:" junto al valor de capacitancia (usar "Capacitancia:" si prefieres)
    let capText = '';
    if (!isNaN(latestCap_pF)) {
      capText = ` · C: ${latestCap_pF.toFixed(2)} pF`;
    }
    errorDisplay.textContent = `${errText}${capText}`;

    const elapsed = performance.now() - start;
    setTimeout(updateCharts, Math.max(0, chartStep - elapsed));
  }

  // Envío de comandos (usa commandSelect y valueInput definidos arriba)
  function sendCommand() {
    if (!commandSelect) return;
    const cmdCode = commandSelect.value;
    const rawVal = valueInput ? String(valueInput.value).trim() : '';
    if (cmdCode === 'CUSTOM') {
      if (!rawVal) {
        statusDiv.textContent = 'Ingrese comando personalizado en el valor';
        statusDiv.style.color = 'red';
        return;
      }
      socket.emit('sendCommand', rawVal);
      statusDiv.textContent = `Enviando personalizado: ${rawVal}`;
      statusDiv.style.color = 'blue';
      return;
    }

    if (!rawVal) {
      statusDiv.textContent = 'Ingrese un valor para el comando seleccionado';
      statusDiv.style.color = 'red';
      return;
    }

    if (!/^-?\d+(\.\d+)?$/.test(rawVal)) {
      statusDiv.textContent = 'Valor inválido (use número)';
      statusDiv.style.color = 'red';
      return;
    }

    const cmd = `${cmdCode}=${rawVal}`;
    socket.emit('sendCommand', cmd);
    statusDiv.textContent = `Enviando: ${cmd}`;
    statusDiv.style.color = 'blue';
  }
  if (sendBtn) sendBtn.addEventListener('click', sendCommand);
  if (valueInput) valueInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendCommand(); });

  socket.on('connect', () => { statusDiv.textContent = 'Conectado al servidor'; statusDiv.style.color = 'green'; statusDiv.style.backgroundColor = '#e8f5e9'; });
  socket.on('disconnect', () => { statusDiv.textContent = 'Desconectado del servidor'; statusDiv.style.color = 'red'; statusDiv.style.backgroundColor = '#ffebee'; });

  // Manejo del selector de puertos y estado de conexión (ahora dentro DOMContentLoaded)
  function setStatus(connected,msg) {
    statusLed.style.background = connected ? 'green' : 'red';
    statusMsg.textContent = msg;
  }

  socket.on('portsList', (ports) => {
    portSelector.innerHTML = '';
    ports.forEach(port=> {
      const opt = document.createElement('option');
      opt.value = port;
      opt.textContent = port;
      portSelector.appendChild(opt);
    });
  });

  connectBtn.addEventListener('click', () => {
    const selectedPort = portSelector.value;
    if (selectedPort) {
      socket.emit('connectPort', selectedPort);
      setStatus(false,'Conectando...');
    }
  });

  socket.on('statusUpdate', (msg) => {
    if (msg.startsWith('Conectado')) {
      setStatus(true,msg);
    } else{
      setStatus(false,msg);
    }
  });

  setStatus(false,'Desconectado');

  // Iniciar bucle de actualización
  updateCharts();
});
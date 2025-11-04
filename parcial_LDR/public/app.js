const socket = io();
document.addEventListener("DOMContentLoaded", function () {
  // ...existing code...
  const sendBtn = document.getElementById('sendBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const statusDiv = document.getElementById('statusDiv');
  const estadoDisplay = document.getElementById('estadoDisplay');
  const thermometerLevel = document.getElementById('water-Temperatura-tank');
  const currentTemperaturaEl = document.getElementById('current-Temperatura');
  const portSelector = document.getElementById('portSelector');
  const connectBtn = document.getElementById('connectBtn');
  const statusLed = document.getElementById('statusLed');
  const statusMsg = document.getElementById('statusMsg');
  const commandSelect = document.getElementById('commandSelect');
  const valueInput = document.getElementById('valueInput');
  const estadoBtn = document.getElementById('estado');
  let isPaused = false;
  let setPoint = 0.0;
  let error = 0.0;
  let globalTime = 0;

  // Ventana de tiempo y muestreo
  const sampleInterval = 1;
  const chartWindow = 300;
  const chartStep = 1000 / 30;
  const maxPoints = Math.ceil(chartWindow / sampleInterval);

  const chartDefs = [
    {
      id: 'chart1',
      label: 'Temperatura °C',
      color: 'red',
      yRange: { min: 25, max: 60 }
    }
  ];

  const charts = {};
  const dataBuffer = [];
  const dataBufferPatron = [];
  
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
    labels: [], // Las etiquetas de tiempo van aquí
    datasets: [
      // Dataset 1: Setpoint
      {
        label: 'Setpoint (°C)',
        borderColor: 'red',
        borderDash: [5, 5], // Línea punteada
        data: [],
        fill: false,
        tension: 0.1,
        pointRadius: 0.1,
        borderWidth: 1
      },
      // Dataset 2: T. Patrón
      {
        label: 'T. Patrón (°C)',
        borderColor: 'blue',
        data: [],
        fill: false,
        tension: 0.1,
        pointRadius: 0.1,
        borderWidth: 1
      },
      // Dataset 3: T. a Calibrar
      {
        label: 'T. a Calibrar (°C)',
        borderColor: 'green',
        data: [],
        fill: false,
        tension: 0.1,
        pointRadius: 0.1,
        borderWidth: 1
      }
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
      plugins: { legend: { display: true } }
    }
  });

  chartDefs.forEach((def) => {
    const canvas = document.getElementById(def.id);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      charts[def.id] = new Chart(ctx, chartConfig(def));
    }
  });

function updateTankLevel(dutyCycle) {
  const tank = document.getElementById('water-level-tank');
  if (tank) {
    const percentage = dutyCycle; // Limitar entre 0 y 100
    tank.style.height = `${percentage}%`;
    tank.style.backgroundColor = 'blue';
  }
}

// Manejar el botón de estado
estadoBtn.addEventListener('click', () => {
  const newEstado = estadoDisplay.textContent === '1' ? 0 : 1; // Alternar entre 1 y 0
  socket.emit('sendCommand', `ESTADO=${newEstado}`);
  estadoDisplay.textContent = newEstado; // Actualizar visualmente
});

// Procesar los datos recibidos del servidor
socket.on('serialData', (payload) => {
  if (Array.isArray(payload)) {
    for (const obj of payload) {
      const adc_mV = parseFloat(obj.adc_mV);
      const estado = parseFloat(obj.estado);
      const dutyCycle = parseFloat(obj.dutyCycle);

      if (!isNaN(adc_mV)) {
        dataBuffer.push(adc_mV); // Solo graficar adc_mV
      }
      if (!isNaN(estado)) {
        estadoDisplay.textContent = estado; // Mostrar el estado actual
      }
      if (!isNaN(dutyCycle)) {
        updateTankLevel(dutyCycle); // Actualizar el nivel del tanque
      }
    }
  }
});
estadoBtn.addEventListener('click', () => {
  const newEstado = estadoDisplay.textContent === '1' ? 0 : 1; // Alternar entre 1 y 0
  socket.emit('sendCommand', `ESTADO=${newEstado}`); // Enviar el nuevo estado al ESP32
  estadoDisplay.textContent = newEstado; // Actualizar visualmente
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
    const adcDataset = chart.data.datasets[0]; // Línea del adc_mV

    const numPoints = dataBuffer.length;
    for (let i = 0; i < numPoints; i++) {
      const adcVal = dataBuffer[i];
      if (adcVal !== undefined) {
        adcDataset.data.push({ x: time, y: adcVal });
      }
      time += sampleInterval;
    }

    // Limpiar el buffer de datos ya procesados
    dataBuffer.length = 0;

    // Eliminar puntos viejos
    while (adcDataset.data.length > maxPoints) {
      adcDataset.data.shift();
    }

    // Actualizar los límites del eje X
    chart.options.scales.x.min = time - chartWindow;
    chart.options.scales.x.max = time;

    chart.update('none'); // Actualizar el gráfico sin animación
  }

  globalTime = time;

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
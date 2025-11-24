const socket = io();
document.addEventListener("DOMContentLoaded", function () {
  // ...existing code...
  const sendBtn = document.getElementById('sendBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const statusDiv = document.getElementById('statusDiv');
  const errorDisplay = document.getElementById('errorDisplay');
  const thermometerLevel = document.getElementById('water-level-tank');
  const currentTemperaturaEl = document.getElementById('current-level');
  const portSelector = document.getElementById('portSelector');
  const connectBtn = document.getElementById('connectBtn');
  const statusLed = document.getElementById('statusLed');
  const statusMsg = document.getElementById('statusMsg');
  const commandSelect = document.getElementById('commandSelect');
  const valueInput = document.getElementById('valueInput');
  const toggleModeBtn = document.getElementById('toggleModeBtn');
  let isPaused = false;
  let setPoint = 0.0;
  let error = 0.0;
  let globalTime = 0;
  let latestTemperatura = NaN;
  let chartMode = 'continuous'; // 'continuous' o 'absolute'

  // Ventana de tiempo y muestreo
  const sampleInterval = 15; // Intervalo de muestreo REAL del ESP32 en ms
  const chartWindow = 30000; // Ventana de 30 segundos (en ms)
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

  toggleModeBtn.addEventListener('click', () => {
    if (chartMode === 'continuous') {
      chartMode = 'absolute';
      toggleModeBtn.textContent = 'Modo: Absoluto';
    } else {
      chartMode = 'continuous';
      toggleModeBtn.textContent = 'Modo: Continuo';
    }
    // Forzar una actualización de la vista del gráfico al cambiar de modo
    const chart = charts['chart1'];
    if (chart) chart.update('none');
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
      // Dataset 2: T. a Calibrar
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
          title: { display: true, text: 'Tiempo (s)' },
          ticks: {
            // Formatear los ticks del eje X para mostrar segundos
            callback: function(value, index, values) {
              // El valor está en milisegundos, lo convertimos a segundos
              return (value / 1000).toFixed(1);
            }
          }
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

  function updateTemp(Temperatura) {
     if (thermometerLevel) {
    // tomar el máximo de la escala Y del chart si está disponible, si no usar 12
    const chart = charts['chart1'];
    const chartYMax = chart && chart.options && chart.options.scales && chart.options.scales.y && typeof chart.options.scales.y.max === 'number'
      ? chart.options.scales.y.max // Será 60
      : 60;
    const chartYMin = chart && chart.options && chart.options.scales && chart.options.scales.y && typeof chart.options.scales.y.min === 'number'
      ? chart.options.scales.y.min // Será 25
      : 25;

    const val = Number(Temperatura);
    const range = chartYMax - chartYMin;
    const correctedValue = val - chartYMin;
    
    const percentage = (isNaN(val) || range <= 0) ? 0 : (correctedValue / range) * 100;

    thermometerLevel.style.height = `${Math.min(100, Math.max(0, percentage))}%`;
    thermometerLevel.style.backgroundColor = 'red';
  }
  if (currentTemperaturaEl) {
    const v = Number(Temperatura);
    currentTemperaturaEl.textContent = isNaN(v) ? '---' : v.toFixed(2);
  }
  }

  // Nuevo: manejar ambos formatos: array de objetos (JSON) o string legacy
  socket.on('serialData', (payload) => {
    // Si el servidor ya envía un array de objetos
    if (Array.isArray(payload)) {
      for (const obj of payload) {
        const Temperatura = parseFloat(obj.TempTermist);
        const currentSetPoint = parseFloat(obj.SP);
        const errVal = parseFloat(obj.err);

        if (!isNaN(Temperatura)) {
          dataBuffer.push(Temperatura);
          latestTemperatura = Temperatura;
        }
        if (!isNaN(currentSetPoint)) setPoint = currentSetPoint;
        if (!isNaN(errVal)) error = errVal;

        updateTemp(Temperatura);
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
          const Temperatura = parseFloat(values[0]);
          const currentSetPoint = parseFloat(values[1]);
          if (!isNaN(Temperatura)) dataBuffer.push(Temperatura);
          if (!isNaN(currentSetPoint)) setPoint = currentSetPoint;
          updateTemp(Temperatura);
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
      // Asignar los datasets correctamente según tu chartConfig
      const setpointDataset = chart.data.datasets[0]; // Setpoint (rojo, dashed)
      const calibrarDataset = chart.data.datasets[1]; // T. a Calibrar (verde)

      // Procesar el buffer de datos de temperatura
      dataBuffer.forEach(tempTermistVal => {
        calibrarDataset.data.push({ x: time, y: tempTermistVal });
        time += sampleInterval;
      });

      // Limpiar los buffers de datos ya procesados
      dataBuffer.length = 0;

      // Eliminar puntos viejos de los datasets de datos
      if (chartMode === 'continuous') {
        while (calibrarDataset.data.length > maxPoints) {
          calibrarDataset.data.shift();
        }
      }

      // Actualizar el dataset del Setpoint (línea plana discontinua)
      // Usa la variable global 'setPoint'
      setpointDataset.data = [
        { x: time - chartWindow, y: setPoint },
        { x: time, y: setPoint }
      ];

      // Actualizar los límites del eje X para crear el efecto de scroll
      // 'time' está en milisegundos
      if (chartMode === 'continuous') {
        chart.options.scales.x.min = time - chartWindow;
        chart.options.scales.x.max = time;
      } else { // Modo absoluto
        chart.options.scales.x.min = 0;
        chart.options.scales.x.max = time;
      }

      chart.update('none'); // Actualizar el gráfico sin animación
    }

    globalTime = time;
        errorDisplay.textContent = isNaN(error) ? '---' : error.toFixed(2);
        // Mostrar error porcentual respecto al setPoint y capacitancia al lado
    let errPercent = NaN;
    if (!isNaN(setPoint) && setPoint !== 0 && !isNaN(latestTemperatura)) {
      errPercent = (setPoint - latestTemperatura) ;
    }
    let errText = isNaN(errPercent) ? '---' : `${errPercent.toFixed(2)} °C`;
    // Mostrar etiqueta "C:" junto al valor de capacitancia (usar "Capacitancia:" si prefieres)

    errorDisplay.textContent = `${errText}`;

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
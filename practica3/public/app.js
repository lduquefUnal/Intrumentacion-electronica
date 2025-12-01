const socket = io();
document.addEventListener("DOMContentLoaded", function () {
  // ...existing code...
  const sendBtn = document.getElementById('sendBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const statusDiv = document.getElementById('statusDiv');
  const tankLevel = document.getElementById('water-level-tank'); // Renombrado para claridad
  const currentValueEl = document.getElementById('current-level'); // Renombrado
  const currentVoltageEl = document.getElementById('current-voltage'); // Nuevo para el voltaje
  const portSelector = document.getElementById('portSelector');
  const connectBtn = document.getElementById('connectBtn');
  const statusLed = document.getElementById('statusLed');
  const statusMsg = document.getElementById('statusMsg');
  const commandSelect = document.getElementById('commandSelect');
  const valueInput = document.getElementById('valueInput');
  const fftDisplay = document.getElementById('fftDisplay');

  let isPaused = false;
  let globalTime = 0;

  // Ventana de tiempo y muestreo
  const chartWindow = 5000; // Ventana de 5 segundos (en ms) para ver más detalle
  // El intervalo de actualización del gráfico. No necesita ser igual al del ESP32.
  const chartStep = 1000 / 30;

  const chartDefs = [
    {
      id: 'chart1', // El ID del canvas en tu HTML
      label: 'mv onda AM (distancia)',
      color: 'red',
      yLabel: 'Amplitud (V)'
    },
    {
      id: 'chart2',
      label: 'Onda Serial',
      color: 'blue',
      yLabel: 'Valor'
    }
  ];

  const charts = {};
  const dataQueue = []; // Cola para almacenar los promedios recibidos
  const ondaDataQueue = []; // Cola para los datos de la nueva gráfica 'onda'
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
      {
        label: def.label,
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
          title: { display: true, text: def.yLabel }
        }
      },
      plugins: { legend: { display: true } }
    }
  });

  // Inicializar el gráfico
  chartDefs.forEach((def) => {
    const canvas = document.getElementById(def.id);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      charts[def.id] = new Chart(ctx, chartConfig(def));
    }
  }); 

  // Función para actualizar el tanque y el valor numérico
  function updateDisplay(avgVoltage) {
    const voltage = Number(avgVoltage);


    const distanceCm = 10 - (10 / 2.1) * voltage;

    // Asegurarse de que la distancia esté en el rango de 0 a 1000 cm para la visualización
    const clampedDistanceCm = Math.max(0, Math.min(10, distanceCm));

    if (tankLevel) {
      // El porcentaje de llenado del tanque se basa en la distancia en cm (0cm = 0%, 1000cm = 100%)
      const percentage = (clampedDistanceCm / 10) * 100;
      tankLevel.style.height = `${percentage}%`;
      // Cambiamos el color a azul para que parezca agua
      tankLevel.style.backgroundColor = 'blue';
    }
    if (currentValueEl) {
      // Mostrar la distancia calculada en centímetros
      currentValueEl.textContent = isNaN(distanceCm) ? '---' : clampedDistanceCm.toFixed(1);
    }
    if (currentVoltageEl) {
      // Mostrar el voltaje promedio recibido
      currentVoltageEl.textContent = isNaN(voltage) ? '---' : voltage.toFixed(3);
    }
  }

  // Escuchar el promedio de los datos de la onda AM
  socket.on('avgData', (avgValue) => {
    if (!isPaused) {
      dataQueue.push(avgValue);
    }
  });

  // Escuchar los datos de la nueva onda
  socket.on('ondaData', (data) => {
    if (!isPaused && Array.isArray(data)) {
      ondaDataQueue.push(...data); // Añadimos todos los puntos recibidos a la cola
    }
  });

  // Escuchar los datos de FFT y mostrarlos como texto
  socket.on('fftData', (data) => {
    if (!isPaused && fftDisplay && Array.isArray(data)) {
      const fftStrings = data.map(item => `F: ${item.f.toFixed(1)} Hz, M: ${item.m.toFixed(1)}`);
      fftDisplay.textContent = 'FFT: ' + fftStrings.join(' | ');
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
    const chart1 = charts['chart1'];
    const chart2 = charts['chart2'];

    if (chart1) {
      // Asignar los datasets correctamente según tu chartConfig
      const dataDataset = chart1.data.datasets[0]; // Dataset de la onda
      
      // Procesar la cola de promedios
      while (dataQueue.length > 0) {
        const avgValue = dataQueue.shift();
        updateDisplay(avgValue); // Actualizar el tanque con cada nuevo promedio
        dataDataset.data.push({ x: time, y: avgValue });
        time += chartStep; // Avanzamos el tiempo global con los datos de la primera gráfica
      }
      
      // Eliminar puntos viejos para mantener la ventana de visualización
      while (dataDataset.data.length > 0 && dataDataset.data[0].x < time - chartWindow) {
        dataDataset.data.shift();
      }

      // Actualizar los límites del eje X para crear el efecto de scroll
      chart1.options.scales.x.min = time - chartWindow;
      chart1.options.scales.x.max = time;

      chart1.update('none'); // Actualizar el gráfico sin animación
    }

    if (chart2) {
      const ondaDataset = chart2.data.datasets[0];
      ondaDataset.data = []; // Limpiamos los datos anteriores para redibujar el nuevo paquete
      let ondaTime = time - chartWindow; // Empezamos a dibujar desde el inicio de la ventana actual
      const step = chartWindow / Math.max(1, ondaDataQueue.length);

      while(ondaDataQueue.length > 0) {
        const value = ondaDataQueue.shift();
        ondaDataset.data.push({ x: ondaTime, y: value });
        ondaTime += step;
      }
      chart2.update('none');
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

    const value = parseFloat(rawVal);
    const cmd = `${cmdCode}=${value}`;
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
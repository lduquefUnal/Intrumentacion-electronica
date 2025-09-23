document.addEventListener("DOMContentLoaded", function () {
  const socket = io();
  const commandInput = document.getElementById('commandInput');
  const sendBtn = document.getElementById('sendBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const statusDiv = document.getElementById('statusDiv');
  const errorDisplay = document.getElementById('errorDisplay');
  const waterLevelTank = document.getElementById('water-level-tank'); // Nuevo elemento para el tanque

  let isPaused = false;
  let setPoint = 0.0; // Cambiado para el nivel de agua
  let error = 0.0;
  let globalTime = 0;

  // Ventana de tiempo y muestreo
  const sampleInterval = 1;
  const chartWindow = 300;
  const chartStep = 10;
  const maxPoints = Math.ceil(chartWindow / sampleInterval);

  // Definición de gráficos con rangos de eje Y específicos
  const chartDefs = [
    {
      id: 'chart1',
      label: 'Nivel del Agua (cm)', // Etiqueta para el gráfico histórico
      color: 'blue',
      yRange: { min: 0, max: 8 } // Rango para el nivel de agua (ajusta si es necesario)
    }
  ];

  const charts = {};
  const dataBuffer = []; // Un solo buffer para el nivel de agua

  // Botones pausa/reanudar
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

  // Generador de configuración de cada gráfico
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
        // Mantiene el SetPoint si lo necesitas en tu gráfica
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

  // Inicializar gráficos
  chartDefs.forEach((def, i) => {
    const canvas = document.getElementById(def.id);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      charts[def.id] = new Chart(ctx, chartConfig(def));
    }
  });

  // Función para actualizar la visualización del tanque
  function updateTank(level) {
    if (waterLevelTank) {
      const maxHeight = 8; // Altura máxima del tanque en cm, debe coincidir con el yRange
      const percentage = (level / maxHeight) * 100;
      waterLevelTank.style.height = `${Math.min(100, percentage)}%`; // Limita al 100%
      waterLevelTank.style.backgroundColor = 'blue'; // Color del líquido
    }
  }

  // Recibir datos serie
  socket.on('serialData', (line) => {
    // La línea recibida ahora debe ser algo como: "4.5,7.0;4.6,7.0;..."
    const dataPoints = line.trim().split(';');

    // Procesar cada punto de datos del lote
    for (const point of dataPoints) {
      if (point) {
        const values = point.split(',');

        // Asume que el ESP32 envía 2 valores: nivel_agua, setPoint
        if (values.length >= 2) {
          const level = parseFloat(values[0]);
          const currentSetPoint = parseFloat(values[1]);

          // Añadir el dato al buffer de la gráfica histórica
          if (!isNaN(level)) {
            dataBuffer.push(level);
          }

          // Actualizar la visualización del tanque y el SetPoint
          updateTank(level);
          setPoint = currentSetPoint;
        }
      }
    }
  });

  // Estado de comandos
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

  // Actualizar gráficos
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

      // Asigna un tiempo secuencial a cada nuevo dato del buffer
      dataBuffer.forEach(val => {
        dataset.data.push({ x: time, y: val });
        time += sampleInterval;
      });

      // Limpia el buffer después de usar los datos
      dataBuffer.length = 0; // Método más eficiente

      // Elimina los puntos viejos
      while (dataset.data.length > maxPoints) {
        dataset.data.shift();
      }

      // Actualiza la línea del SetPoint
      const setpointDataset = chart.data.datasets[1];
      setpointDataset.data = [
        { x: time - chartWindow, y: setPoint },
        { x: time, y: setPoint }
      ];

      // Mueve la ventana del eje X
      chart.options.scales.x.min = time - chartWindow;
      chart.options.scales.x.max = time;

      chart.update('none');
    }

    globalTime = time;

    // Actualiza el texto de error (si tu ESP32 aún lo envía)
    errorDisplay.textContent = error.toFixed(2);

    const elapsed = performance.now() - start;
    setTimeout(updateCharts, Math.max(0, chartStep - elapsed));
  }

  // Envío de comandos
  function sendCommand() {
    const cmd = commandInput.value.trim();
    if (!cmd) return;
    if (/^(FP|DC|AC|AM|SP|KP|KI|KD)=\d+(\.\d+)?$/i.test(cmd)) {
      socket.emit('sendCommand', cmd);
      commandInput.value = '';
      statusDiv.textContent = `Enviando: ${cmd}`;
      statusDiv.style.color = 'blue';
    } else {
      statusDiv.textContent = 'Formato inválido. Use: FP=1000, DC=100, etc.';
      statusDiv.style.color = 'red';
    }
  }
  sendBtn.addEventListener('click', sendCommand);
  commandInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') sendCommand();
  });

  // Conexión / desconexión
  socket.on('connect', () => { statusDiv.textContent = 'Conectado al servidor'; statusDiv.style.color = 'green'; statusDiv.style.backgroundColor = '#e8f5e9'; });
  socket.on('disconnect', () => { statusDiv.textContent = 'Desconectado del servidor'; statusDiv.style.color = 'red'; statusDiv.style.backgroundColor = '#ffebee'; });

  // Iniciar bucle de actualización
  updateCharts();
});
import React, { useState, useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import { Header } from './components/Header';
import { DashboardFrame } from './components/DashboardFrame';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// --- COMPONENTE INDICADOR LED ---
const StatusLed = ({ currentVal, limitVal }) => {
  // Protección: Si los valores no son números válidos, usar 0 y 4096 por defecto
  const safeCurrent = typeof currentVal === 'number' ? currentVal : 0;
  const safeLimit = typeof limitVal === 'number' ? limitVal : 4096;

  const isOverLimit = safeCurrent > safeLimit;

  const style = {
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    backgroundColor: isOverLimit ? '#ff4d4d' : '#4dff88',
    boxShadow: isOverLimit ? '0 0 15px #ff0000' : '0 0 15px #00ff00',
    border: '2px solid #fff',
    display: 'inline-block',
    marginLeft: '15px',
    verticalAlign: 'middle',
    transition: 'background-color 0.3s'
  };

  return (
    <div style={{ padding: '10px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#333' }}>
      <span>ESTADO LDR ({safeCurrent} / {safeLimit}): </span>
      <div style={style}></div>
      <span style={{ marginLeft: '10px', fontWeight: 'bold' }}>
        {isOverLimit ? "CORTE ACTIVO (BOMBILLO OFF)" : "NORMAL"}
      </span>
    </div>
  );
};

function App() {
  const {
    ports,
    selectedPort,
    setSelectedPort,
    status,
    commandResponse,
    isPaused,
    setIsPaused,
    dataStreams, 
    globalTime,
    connectPort,
    sendCommand
  } = useSocket();

  // Estados locales
  const [lastLDR, setLastLDR] = useState(0);
  const [currentLimit, setCurrentLimit] = useState(4096);

  // --- PROTECCIÓN CONTRA FALLOS DE CARGA ---
  // Creamos un objeto seguro. Si dataStreams es null, usamos arrays vacíos.
  // Esto evita que los gráficos "rompan" la imagen al recargar.
  const safeDataStreams = {
    temp_adc: [],
    pwm_duty: [],
    ldr_adc: [],
    ldr_voltage: [],
    ldr_limit: [],
    ...(dataStreams || {}) // Mezclamos con los datos reales si existen
  };

  // Efecto para actualizar el LED y el Límite visual
  useEffect(() => {
    // Verificamos que safeDataStreams tenga datos antes de intentar leer
    if (safeDataStreams.ldr_adc && safeDataStreams.ldr_adc.length > 0) {
      const ultimoValor = safeDataStreams.ldr_adc[safeDataStreams.ldr_adc.length - 1];
      setLastLDR(ultimoValor);
    }
    
    if (safeDataStreams.ldr_limit && safeDataStreams.ldr_limit.length > 0) {
        const limiteRecibido = safeDataStreams.ldr_limit[safeDataStreams.ldr_limit.length - 1];
        setCurrentLimit(limiteRecibido);
    }
  }, [dataStreams]); // Dependencia original para reaccionar a cambios reales

  return (
    <>
      <Header
        ports={ports}
        selectedPort={selectedPort}
        setSelectedPort={setSelectedPort}
        status={status}
        connectPort={connectPort}
        sendCommand={sendCommand}
        commandResponse={commandResponse}
        isPaused={isPaused}
        setIsPaused={setIsPaused}
      />
      
      {/* LED DE ESTADO */}
      <div style={{ width: '100%', textAlign: 'center', margin: '10px 0' }}>
        <StatusLed currentVal={lastLDR} limitVal={currentLimit} />
        <p style={{fontSize: '12px', color: '#666', marginTop: '5px'}}>
            Comando para ajustar límite: <b>LIMIT:2000</b>
        </p>
      </div>

      {/* Usamos safeDataStreams en lugar de dataStreams directo */}
      <DashboardFrame 
        dataSources={safeDataStreams} 
        globalTime={globalTime} 
        onSendCommand={sendCommand} 
      />
    </>
  );
}

export default App;
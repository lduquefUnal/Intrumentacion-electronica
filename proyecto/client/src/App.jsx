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

function App() {
  const {
    ports,
    selectedPort,
    setSelectedPort,
    status,
    commandResponse,
    isPaused,
    setIsPaused,
    dataStreams, // Obtener el nuevo estado
    globalTime,
    sampleRateHz,
    setSampleRateHz,
    connectPort,
    sendCommand
  } = useSocket();

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
        sampleRateHz={sampleRateHz}
        setSampleRateHz={setSampleRateHz}
      />

      {/* Pasar dataStreams directamente como dataSources */}
      <DashboardFrame dataSources={dataStreams} globalTime={globalTime} onSendCommand={sendCommand} />
    </>
  );
}

export default App;

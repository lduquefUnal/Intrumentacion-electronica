import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import FFT from 'fft.js';

const socket = io('http://localhost:4000', {
  transports: ['websocket', 'polling'],
});

const MAX_STREAM_LENGTH = 1000; // Para evitar que los arrays crezcan indefinidamente

export function useSocket() {
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [status, setStatus] = useState({ msg: 'Desconectado', connected: false });
  const [commandResponse, setCommandResponse] = useState('Conectado al servidor');
  const [isPaused, setIsPaused] = useState(false);
  const [dataStreams, setDataStreams] = useState({});
  const globalTime = useRef(0);

  useEffect(() => {
    socket.on('portsList', (ports) => {
      setPorts(ports);
      if (ports.length > 0) {
        setSelectedPort(ports[0]);
      }
    });

    socket.on('statusUpdate', (msg) => {
      if (msg.startsWith('Conectado')) {
        setStatus({ msg, connected: true });
      } else {
        setStatus({ msg, connected: false });
      }
    });

    socket.on('commandResponse', (response) => {
      setCommandResponse(response);
      setTimeout(() => setCommandResponse('Conectado al servidor'), 3000);
    });

    socket.on('data', (dataObject) => {
      if (isPaused || typeof dataObject !== 'object' || dataObject === null) return;

      // Debe coincidir con SAMPLE_RATE_HZ del firmware (ver nuevo.txt)
      const SAMPLE_RATE_HZ = 50000;
      const timeIncrementMs = 1000 / SAMPLE_RATE_HZ; // Time between each sample in the array

      setDataStreams(prevStreams => {
        const newStreams = { ...prevStreams };
        let latestTime = globalTime.current;

        for (const key in dataObject) {
          if (Object.hasOwnProperty.call(dataObject, key)) {
            const valueArray = dataObject[key];
            
            if (!Array.isArray(valueArray)) continue; // Process only arrays

            if (!newStreams[key]) {
              newStreams[key] = [];
            }
            
            // Unroll the array of samples into individual {x, y} points
            const newPoints = valueArray.map((y, index) => {
              const x = latestTime + (index * timeIncrementMs);
              return { x, y };
            });

            const combined = [...newStreams[key], ...newPoints];
            newStreams[key] = combined.slice(-MAX_STREAM_LENGTH * 10); // Keep a larger buffer for this type of data
            
            // Update globalTime to the timestamp of the last point in this packet
            if(newPoints.length > 0) {
                latestTime = newPoints[newPoints.length - 1].x;
            }
          }
        }
        
        globalTime.current = latestTime;
        return newStreams;
      });
    });

    return () => {
      socket.off('portsList');
      socket.off('statusUpdate');
      socket.off('commandResponse');
      socket.off('data');
    };
  }, [isPaused]);

  const connectPort = () => {
    if (selectedPort) {
      socket.emit('connectPort', selectedPort);
    }
  };

  const sendCommand = (cmd, value) => {
    const command = `${cmd}=${value}`;
    socket.emit('sendCommand', command);
  };

  return {
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
  };
}

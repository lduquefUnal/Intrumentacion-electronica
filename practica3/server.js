const express = require('express');
const http = require('http');
const path = require('path');
const { SerialPort, ReadlineParser } = require('serialport'); // SerialPort and ReadlineParser
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 4000;

let portSerial = null;
let parser = null;

// Servir archivos estáticos (index.html, style.css, app.js)
app.use(express.static(path.join(__dirname, 'public')));

// Cuando un cliente se conecta al websocket
io.on('connection', (socket) => {
  console.log('Cliente conectado');
  socket.emit('statusUpdate', 'Cliente conectado. Buscando puertos seriales...');

  // 1. Enviar la lista de puertos seriales al cliente
  SerialPort.list().then(ports => {
    socket.emit('portsList', ports.map(p => p.path));
  }).catch(err => {
    console.error('Error listando puertos:', err.message);
    socket.emit('statusUpdate', `Error listando puertos: ${err.message}`);
  });

  // 2. Manejar la solicitud del cliente para conectar a un puerto específico
  socket.on('connectPort', (portName) => {
    if (portSerial && portSerial.isOpen) {
      portSerial.close();
    }

    portSerial = new SerialPort({ path: portName, baudRate: 115200 }, (err) => {
      if (err) {
        console.error('Error abriendo puerto:', err.message);
        socket.emit('statusUpdate', `Error abriendo puerto: ${err.message}`);
        return;
      }
      
      // Conexión exitosa, configurar el parser
      parser = portSerial.pipe(new ReadlineParser({ delimiter: '\n' }));
      let serialBuffer = '';
      console.log(`Conectado al puerto serial: ${portName}`);
      socket.emit('statusUpdate', `Conectado al puerto serial: ${portName}`);
      

      parser.on('data', (line) => {
        serialBuffer += line.toString().trim();
        
        while (true) {
          const startBracket = serialBuffer.indexOf('{');
          const startArray = serialBuffer.indexOf('[');
          
          let startIdx;
          if (startBracket === -1 && startArray === -1) break;
          
          if (startBracket !== -1 && (startArray === -1 || startBracket < startArray)) {
            startIdx = startBracket;
          } else {
            startIdx = startArray;
          }

          if (startIdx > 0) {
            serialBuffer = serialBuffer.substring(startIdx);
          }

          try {
            const parsed = JSON.parse(serialBuffer);
            
            if (parsed.real) {
              const sum = parsed.real.reduce((acc, val) => acc + val, 0);
              const avg = parsed.real.length > 0 ? sum / parsed.real.length : 0;
              io.emit('avgData', avg);
            } else if (parsed.fft) {
              io.emit('fftData', parsed.fft);
            } else if (parsed.onda && Array.isArray(parsed.onda)) {
              io.emit('ondaData', parsed.onda);
            }
            
            io.emit('serialLine', serialBuffer);
            serialBuffer = ''; // Limpiar buffer después de un parseo exitoso
          } catch (e) {
            // Si JSON.parse falla, el JSON está incompleto. Salimos del bucle y esperamos más datos.
            break;
          }
        }
      });
    });
  });

  // 4. Recibir comandos y enviarlos por serial
  socket.on('sendCommand', (cmd) => {
    if (portSerial && portSerial.isOpen) {
      portSerial.write(cmd + '\n', (err) => {
        if (err) {
          console.error('Error enviando comando:', err.message);
          socket.emit('commandResponse', `Error: ${err.message}`);
        } else {
          socket.emit('commandResponse', `Comando "${cmd}" enviado.`);
        }
      });
    } else {
      socket.emit('commandResponse', 'Error: Puerto serial no está conectado.');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
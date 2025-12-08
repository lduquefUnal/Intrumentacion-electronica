// Este es el servidor backend para la aplicación.
// Si ves un error en el navegador que dice "WebSocket connection to 'ws://localhost:4000/socket.io/...' failed",
// es muy probable que este servidor no esté corriendo.
//
// Para iniciar el servidor, abre una nueva terminal, navega a la raíz de tu proyecto y ejecuta:
// node proyecto/client/server.cjs
//
// Deberías ver el mensaje "Servidor escuchando en http://localhost:4000" en la terminal.

const express = require('express');
const http = require('http');
const path = require('path');
const { SerialPort, ReadlineParser } = require('serialport');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173', // URL donde corre tu frontend
    methods: ['GET', 'POST'],
  },
});

const PORT = 4000;

let portSerial = null;
let parser = null;

// Servir archivos estáticos (index.html, style.css, app.js)
app.use(express.static(path.join(__dirname, 'public')));

// Función para listar puertos y emitir al cliente
const listAndEmitPorts = (socket) => {
  SerialPort.list().then(ports => {
    socket.emit('portsList', ports.map(p => p.path));
  }).catch(err => {
    console.error('Error listando puertos:', err.message);
    if (socket) {
      socket.emit('statusUpdate', `Error listando puertos: ${err.message}`);
    }
  });
};

// Cuando un cliente se conecta al websocket
io.on('connection', (socket) => {
  console.log('Cliente conectado');
  socket.emit('statusUpdate', 'Cliente conectado. Buscando puertos seriales...');

  listAndEmitPorts(socket);

  // El cliente solicita refrescar la lista de puertos
  socket.on('refreshPorts', () => {
    listAndEmitPorts(socket);
  });
  
  socket.on('connectPort', (portName) => {
    if (portSerial && portSerial.isOpen) {
      portSerial.close(() => {
        connectToPort(portName, socket);
      });
    } else {
      connectToPort(portName, socket);
    }
  });

  const connectToPort = (portName, socket) => {
    portSerial = new SerialPort({ path: portName, baudRate: 115200 }, (err) => {
      if (err) {
        console.error('Error abriendo puerto:', err.message);
        socket.emit('statusUpdate', `Error abriendo puerto: ${err.message}`);
        return;
      }
      
      console.log(`Conectado al puerto serial: ${portName}`);
      socket.emit('statusUpdate', `Conectado exitosamente a ${portName}`);
      socket.emit('connectionSuccess');

      let dataBuffer = '';
      portSerial.on('data', (chunk) => {
        dataBuffer += chunk.toString();
        let newlineIndex;

        while ((newlineIndex = dataBuffer.indexOf('\n')) !== -1) {
          const line = dataBuffer.substring(0, newlineIndex).trim();
          dataBuffer = dataBuffer.substring(newlineIndex + 1);

          if (line) {
            try {
              const parsed = JSON.parse(line);
              io.emit('data', parsed); // Emit data directly
            } catch (e) {
              const errorMsg = `Error al parsear JSON: ${e.message}. Recibido: "${line}"`;
              console.error(errorMsg);
              socket.emit('statusUpdate', errorMsg);
            }
          }
        }
      });
    });
  };

  socket.on('disconnectPort', () => {
    if (portSerial && portSerial.isOpen) {
      portSerial.close((err) => {
        if (err) {
          console.error('Error cerrando el puerto:', err.message);
          socket.emit('statusUpdate', `Error cerrando puerto: ${err.message}`);
        } else {
          console.log('Puerto desconectado.');
          socket.emit('statusUpdate', 'Puerto desconectado.');
        }
      });
    }
  });

  // Recibir comandos y enviarlos por serial
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

  socket.on('disconnect', () => {
    console.log('Cliente desconectado');
  });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
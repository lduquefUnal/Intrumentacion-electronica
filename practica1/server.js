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
        const rawLine = (typeof line === 'string') ? line.trim() : line.toString().trim();
        if (!rawLine) return;

        // Quitar prefijo tipo "16:21:54.220 -> " si aparece (monitor Arduino)
        const cleaned = rawLine.replace(/^\s*\d{1,2}:\d{2}:\d{2}\.\d+\s*->\s*/, '');

        // Acumular fragmentos y buscar JSON completo (array u objeto)
        serialBuffer += cleaned;

        // Extraer y parsear mientras haya JSON completo en el buffer
        while (true) {
          const idxArrStart = serialBuffer.indexOf('[');
          const idxObjStart = serialBuffer.indexOf('{');
          let startIdx = -1;
          let endIdx = -1;

          if (idxArrStart !== -1 && (idxObjStart === -1 || idxArrStart < idxObjStart)) {
            startIdx = idxArrStart;
            endIdx = serialBuffer.indexOf(']', startIdx);
          } else if (idxObjStart !== -1) {
            startIdx = idxObjStart;
            endIdx = serialBuffer.indexOf('}', startIdx);
          }

          if (startIdx === -1 || endIdx === -1) break; // no hay JSON completo aún

          const candidate = serialBuffer.substring(startIdx, endIdx + 1);
          try {
            const parsed = JSON.parse(candidate);
            const out = Array.isArray(parsed) ? parsed : [parsed];
            io.emit('serialData', out);
            io.emit('serialLine', candidate);
            // eliminar la parte procesada del buffer
            serialBuffer = serialBuffer.slice(endIdx + 1);
          } catch (e) {
            // JSON aún incompleto o malformado; esperar más datos
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
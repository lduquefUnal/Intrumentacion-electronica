import React, { useState } from 'react';

export function Header({
  ports,
  selectedPort,
  setSelectedPort,
  status,
  connectPort,
  sendCommand,
  commandResponse,
  isPaused,
  setIsPaused
}) {
  const [command, setCommand] = useState('FP');
  const [commandValue, setCommandValue] = useState('');

  const handleSendCommand = () => {
    sendCommand(command, commandValue);
  };

  return (
    <header className="banner">
      {/*
        NOTA: Para que esta imagen se muestre correctamente, el archivo 'Logo.png'
        debe estar en la carpeta 'public' en la raíz del proyecto 'client'.
        
        He creado la carpeta 'public' por ti. Por favor, mueve el archivo
        'proyecto/client/src/Logo.png' a 'proyecto/client/public/Logo.png'.
      */}
      <img src="/Logo.png" alt="Logo" className="logo" />
      <div className="branding">
        <h1>SISTEMA</h1>
        <h2>Monitor Onda AM y distancia</h2>
        <h3>2025-01</h3>
      </div>

      <div id="top-bar" className="top-bar-stacked">
        <h3>Puerto Serial</h3>
        <div className="input-group">
          <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}>
            {ports.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={connectPort}>Conectar</button>
          <button onClick={() => sendCommand('refreshPorts')}>Refrescar Conexión</button>
        </div>
        <div className="status-message" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <span id="statusLed" style={{ width: '15px', height: '15px', borderRadius: '50%', display: 'inline-block', background: status.connected ? 'green' : 'red' }}></span>
          <span>{status.msg}</span>
        </div>
      </div>

      <div className="command-container">
        <h3>Enviar Comando</h3>
        <div className="input-group" id="commandControls">
          <select value={command} onChange={e => setCommand(e.target.value)}>
            <option value="FP">Frec. Portadora (Hz)</option>
            <option value="FM">Frec. Moduladora (Hz)</option>
            <option value="IDX">Índice Modulación (0-1)</option>
            <option value="AC">Amplitud Portadora</option>
          </select>
          <input type="number" value={commandValue} onChange={e => setCommandValue(e.target.value)} placeholder="valor" step="any" style={{ width: '110px' }} />
          <button onClick={handleSendCommand}>Enviar</button>
        </div>
        <div className="status-message">{commandResponse}</div>
        <div id="controls">
          <button onClick={() => setIsPaused(true)} disabled={isPaused}>Pausa</button>
          <button onClick={() => setIsPaused(false)} disabled={!isPaused}>Continuar</button>
        </div>
      </div>
    </header>
  );
}

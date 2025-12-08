import FFT from 'fft.js';

console.log('[FFT Worker] Worker script initialized.');

self.onmessage = (event) => {
  const { signal, fftWindowSize } = event.data;
  console.log(`[FFT Worker] Received message: ${signal?.length || 0} points, window: ${fftWindowSize}`);

  const n = Number(fftWindowSize) || 0;
  if (n <= 0 || (n & (n - 1)) !== 0) {
    self.postMessage({ error: 'fftWindowSize debe ser potencia de 2 y > 0' });
    return;
  }

  if (!signal || signal.length === 0) {
    console.log('[FFT Worker] No signal data, returning.');
    return; // Do nothing if there's no signal
  }

  try {
    // Take the most recent data, up to the window size
    let buffer = signal.slice(-fftWindowSize);

    // Remove NaN/undefined to avoid breaking the FFT
    buffer = buffer.map(v => (Number.isFinite(v) ? v : 0));

    // If the buffer is smaller than the FFT window, pad it with zeros
    if (buffer.length < fftWindowSize) {
      const padding = Array(fftWindowSize - buffer.length).fill(0);
      buffer = buffer.concat(padding);
    }
    
    const f = new FFT(fftWindowSize);
    const out = f.createComplexArray();

    // Para señales reales usamos realTransform + completeSpectrum
    f.realTransform(out, buffer);
    f.completeSpectrum(out);

    const spectrum = [];
    const bins = fftWindowSize / 2; // Solo mitad positiva (0..Nyquist)
    for (let i = 0; i < bins; i++) {
      const re = out[i * 2];
      const im = out[i * 2 + 1];
      spectrum.push(Math.sqrt(re * re + im * im));
    }
    if (spectrum.length > 0) {
      spectrum[0] = 0; // Ignorar DC en la visualización/detección
    }
    
    const peaks = [];
    for (let i = 1; i < spectrum.length - 1; i++) {
      if (spectrum[i] > spectrum[i - 1] && spectrum[i] > spectrum[i + 1]) {
        peaks.push({ index: i, magnitude: spectrum[i] });
      }
    }

    peaks.sort((a, b) => b.magnitude - a.magnitude);
    const topFrequencies = peaks.slice(0, 3);

    console.log(`[FFT Worker] Calculation complete. Posting back ${spectrum.length}-point spectrum.`);
    self.postMessage({ spectrum, topFrequencies });
  } catch (e) {
    console.error('[FFT Worker] Error:', e);
    self.postMessage({ error: e.message });
  }
};

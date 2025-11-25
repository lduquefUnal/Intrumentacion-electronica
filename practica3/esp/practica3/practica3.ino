/*
 * Práctica 3 - Generador AM con procesamiento FFT
 *
 * Este sketch utiliza ambos núcleos del ESP32 para generar una señal
 * portadora modulada en amplitud (AM) en el pin DAC (GPIO25), medir la
 * señal recibida en el pin ADC (GPIO32) y, de forma paralela, calcular
 * su transformada rápida de Fourier (FFT) utilizando la biblioteca
 * arduinoFFT.  La tarea de muestreo se ejecuta en un núcleo y mantiene
 * un flujo continuo de datos con ayuda de un temporizador de alta
 * resolución; la segunda tarea se encarga de procesar el último
 * buffer lleno y publicar por el puerto serie la frecuencia y
 * magnitud más importantes.  Los datos medidos se envían de manera
 * empaquetada (batching) para permitir una transmisión eficiente.
 */

#include "driver/adc.h"
#include "driver/gptimer.h"
#include <math.h>
#include <Arduino.h>
#include "arduinoFFT.h"

// --- PINES (ESP32 DEVKIT V1) ---
const int dacPin = 25;             // Pin de salida DAC para la portadora
const int adcPin = 32;             // Pin de entrada ADC donde se mide la señal

// --- PARÁMETROS DE LA SEÑAL AM ---
volatile float freqP  = 50.0f;
volatile float freqM  = 5.0f;
volatile float m_index = 0.8f;
volatile float A_c    = 1.0f;

#define NUM_TOP_FREQS 3 

// Estructura para almacenar un par Frecuencia-Magnitud
struct FftPeak {
    float freq;
    float mag;
};

// Variable global para almacenar el último resultado de la FFT (los N picos)
volatile FftPeak last_top_peaks[NUM_TOP_FREQS];

// --- CONFIGURACIÓN CRÍTICA DE TIEMPO ---
#define SAMPLE_RATE_HZ     5000UL
#define PLOT_EVERY_N_SAMPLES 500

// --- CONFIGURACIÓN FFT ---
#define FFT_SAMPLES 256

static double vRealBuf[2][FFT_SAMPLES];
static double vImagBuf[2][FFT_SAMPLES];

volatile int currentBuffer = 0;
volatile int bufferIndex   = 0;
volatile bool bufferReady[2] = {false, false};

// Tareas y cola
TaskHandle_t samplingTaskHandle = NULL;
QueueHandle_t samplingQueue = NULL;
TaskHandle_t fftTaskHandle = NULL;

// Variables de sistema
gptimer_handle_t gptimer = NULL;

// Mux de sincronización
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

// --- VARIABLES PARA JSON ---
const int NUM_DATOS_JSON = 10;

// Acumuladores de fase
float phaseP = 0.0f;
float phaseM = 0.0f;
const float DOS_PI = 6.28318530718f;

// Prototipos
bool IRAM_ATTR onTimer(gptimer_handle_t timer, const gptimer_alarm_event_data_t *edata, void *user_ctx);
void procesarComando(const String &cmd);
void taskSampling(void *param);
void taskFFT(void *param);

void setup() {
    Serial.begin(115200);
    while (!Serial) { delay(10); }

    analogReadResolution(12);
    dacWrite(dacPin, 0);

    gptimer_config_t timer_config = {
        .clk_src       = GPTIMER_CLK_SRC_DEFAULT,
        .direction     = GPTIMER_COUNT_UP,
        .resolution_hz = 1'000'000UL
    };
    gptimer_new_timer(&timer_config, &gptimer);

    gptimer_alarm_config_t alarm_config = {
        .alarm_count  = (uint64_t)(1'000'000UL / SAMPLE_RATE_HZ),
        .reload_count = 0,
        .flags = { .auto_reload_on_alarm = true }
    };
    gptimer_set_alarm_action(gptimer, &alarm_config);

    gptimer_event_callbacks_t cbs = {
        .on_alarm = onTimer
    };
    gptimer_register_event_callbacks(gptimer, &cbs, NULL);

    gptimer_enable(gptimer);
    gptimer_start(gptimer);

    samplingQueue = xQueueCreate(1, sizeof(uint8_t));
    xTaskCreatePinnedToCore(taskSampling, "samplingTask", 8192, NULL, 2, &samplingTaskHandle, 0);
    xTaskCreatePinnedToCore(taskFFT,     "fftTask",      10240, NULL, 1, &fftTaskHandle,     1);

    Serial.println("--- Generador AM con procesamiento FFT ---");
}

void loop() {
    if (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        if (cmd.length() > 0) {
            procesarComando(cmd);
        }
    }
    delay(1);
}

// ISR del temporizador
bool IRAM_ATTR onTimer(gptimer_handle_t timer, const gptimer_alarm_event_data_t *edata, void *user_ctx) {
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    uint8_t dummy = 0;
    xQueueOverwriteFromISR(samplingQueue, &dummy, &xHigherPriorityTaskWoken);
    return (xHigherPriorityTaskWoken == pdTRUE);
}

void procesarComando(const String &cmd) {
    int separator = cmd.indexOf('=');
    if (separator > 0) {
        String param = cmd.substring(0, separator);
        float value = cmd.substring(separator + 1).toFloat();
        
        portENTER_CRITICAL(&timerMux);
        if (param.equalsIgnoreCase("FP")) {
            freqP = value;
        } else if (param.equalsIgnoreCase("FM")) {
            freqM = value;
        } else if (param.equalsIgnoreCase("IDX")) {
            m_index = value;
            if (m_index < 0.0f) m_index = 0.0f;
        }
        portEXIT_CRITICAL(&timerMux);
    }
}

/*
 * Tarea de muestreo y generación de la señal AM.
 */
void taskSampling(void *param) {
    static int plotCounter = 0;
    static char linea[2048];
    static int conteoJson = 0;
    static int idx = 0;
    
    // Solo datos leídos (NO se guarda valor teórico)
    static float vLeidos[NUM_DATOS_JSON];
    
    while (true) {
        uint8_t dummy;
        xQueueReceive(samplingQueue, &dummy, portMAX_DELAY);
        
        portENTER_CRITICAL(&timerMux);
            float stepP = (DOS_PI * freqP) / SAMPLE_RATE_HZ;
            float stepM = (DOS_PI * freqM) / SAMPLE_RATE_HZ;
        portEXIT_CRITICAL(&timerMux);

        phaseP += stepP;
        phaseM += stepM;
        if (phaseP >= DOS_PI) phaseP -= DOS_PI;
        if (phaseM >= DOS_PI) phaseM -= DOS_PI;

        float mod = sinf(phaseM);
        float car = sinf(phaseP);
        
        portENTER_CRITICAL(&timerMux);
            float raw_am = ((1.0f + m_index * mod) * car) / (1.0f + m_index);
        portEXIT_CRITICAL(&timerMux);
        
        int dacValue = (int)((raw_am + 1.0f) * 127.5f);
        if (dacValue < 0) dacValue = 0;
        else if (dacValue > 255) dacValue = 255;
        dacWrite(dacPin, dacValue);

        int adcRaw = analogRead(adcPin);
        bool notify_fft = false;
        
        portENTER_CRITICAL(&timerMux);
            vRealBuf[currentBuffer][bufferIndex] = (double)adcRaw;
            vImagBuf[currentBuffer][bufferIndex] = 0.0;
            bufferIndex++;
            
            if (bufferIndex >= FFT_SAMPLES) {
                bufferReady[currentBuffer] = true;
                notify_fft = true;
                currentBuffer = 1 - currentBuffer;
                bufferIndex = 0;
            }
        portEXIT_CRITICAL(&timerMux);
        
        if (notify_fft) {
            xTaskNotifyGive(fftTaskHandle); 
        } 
        
        // Acumulación de datos SOLO medidos
        plotCounter++;
        if (plotCounter >= PLOT_EVERY_N_SAMPLES) {
            plotCounter = 0;
            float vLeido = (adcRaw / 4095.0f) * 3.3f;

            if (conteoJson < NUM_DATOS_JSON) {
                vLeidos[conteoJson] = vLeido;
                conteoJson++;
            }
        }
        
        // Envío de datos cuando FFT notifica y hay lote completo
        if (ulTaskNotifyTake(pdTRUE, 0) == 1) {
            if (conteoJson >= NUM_DATOS_JSON) {
                
                FftPeak current_peaks_copy[NUM_TOP_FREQS];
                portENTER_CRITICAL(&timerMux);
                    for (int n = 0; n < NUM_TOP_FREQS; n++) {
                        current_peaks_copy[n].freq = last_top_peaks[n].freq;
                        current_peaks_copy[n].mag  = last_top_peaks[n].mag;
                    }
                portEXIT_CRITICAL(&timerMux);

                idx = 0;
                
                // JSON SIN parte teórica: {"real":[...],"fft":[...]}
                idx += snprintf(linea + idx, sizeof(linea) - idx, 
                                "{\"real\":[");
                for (int i = 0; i < NUM_DATOS_JSON; i++) {
                    idx += snprintf(linea + idx, sizeof(linea) - idx, 
                                    "%.3f%s", vLeidos[i], (i == NUM_DATOS_JSON - 1) ? "" : ",");
                }
                
                idx += snprintf(linea + idx, sizeof(linea) - idx, 
                                "],\"fft\":[");
                
                for (int n = 0; n < NUM_TOP_FREQS; n++) {
                    if (current_peaks_copy[n].mag > 0.0f) { 
                        idx += snprintf(linea + idx, sizeof(linea) - idx, 
                                        "{\"f\":%.1f,\"m\":%.1f}%s",
                                        current_peaks_copy[n].freq, current_peaks_copy[n].mag,
                                        (n == NUM_TOP_FREQS - 1 || current_peaks_copy[n+1].mag == 0.0f) ? "" : ",");
                    }
                }
                
                idx += snprintf(linea + idx, sizeof(linea) - idx, "]}");

                Serial.println(linea);

                conteoJson = 0; 
            }
        }
    }
}

/*
 * Tarea de cálculo de FFT.
 */
void taskFFT(void *param) {
    static double vReal[FFT_SAMPLES];
    static double vImag[FFT_SAMPLES];
    ArduinoFFT<double> FFT = ArduinoFFT<double>(vReal, vImag, FFT_SAMPLES, SAMPLE_RATE_HZ );
    
    FftPeak current_peaks[NUM_TOP_FREQS];
    
    const int SEARCH_SIZE = FFT_SAMPLES / 2;
    double temp_mag[SEARCH_SIZE];

    while (true) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        int bufToProcess = -1;
        portENTER_CRITICAL(&timerMux);
        if (bufferReady[0]) {
            bufToProcess = 0;
        } else if (bufferReady[1]) {
            bufToProcess = 1;
        }
        if (bufToProcess >= 0) {
            for (int i = 0; i < FFT_SAMPLES; i++) {
                vReal[i] = vRealBuf[bufToProcess][i];
                vImag[i] = 0.0;
            }
            bufferReady[bufToProcess] = false;
        }
        portEXIT_CRITICAL(&timerMux);

        if (bufToProcess < 0) {
            continue;
        }

        FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
        FFT.compute(FFTDirection::Forward);
        FFT.complexToMagnitude();

        for (int i = 0; i < SEARCH_SIZE; i++) {
            temp_mag[i] = vReal[i];
        }
        temp_mag[0] = 0.0; 

        for (int n = 0; n < NUM_TOP_FREQS; n++) {
            double max_val = 0.0;
            int max_index = 0;
            
            for (int i = 1; i < SEARCH_SIZE; i++) { 
                if (temp_mag[i] > max_val) {
                    max_val = temp_mag[i];
                    max_index = i;
                }
            }
            
            if (max_index == 0) {
                current_peaks[n] = {0.0f, 0.0f};
                for (int m = n; m < NUM_TOP_FREQS; m++) {
                    current_peaks[m] = {0.0f, 0.0f};
                }
                break; 
            } else {
                double freqBin = ((double)max_index * (double)SAMPLE_RATE_HZ) / (double)FFT_SAMPLES;
                current_peaks[n].freq = (float)freqBin;
                current_peaks[n].mag = (float)max_val;
                temp_mag[max_index] = 0.0; 
            }
        }
        
        portENTER_CRITICAL(&timerMux);
            for (int n = 0; n < NUM_TOP_FREQS; n++) {
                last_top_peaks[n].freq = current_peaks[n].freq;
                last_top_peaks[n].mag  = current_peaks[n].mag;
            }
        portEXIT_CRITICAL(&timerMux);

        xTaskNotifyGive(samplingTaskHandle);
    }
}

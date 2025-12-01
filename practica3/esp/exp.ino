
/*
 * Práctica 3 - Generador AM con procesamiento FFT
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
#include "driver/dac.h"
#include "arduinoFFT.h"
#include "esp_adc_cal.h"
#define DAC_CHANNEL DAC_CHANNEL_1 
// --- PINES (ESP32 DEVKIT V1) ---
const int dacPin = 25;             // Pin de salida DAC para la portadora
const int adcPin = 32;             // Pin de entrada ADC donde se mide la señal
// --- PARÁMETROS DE LA SEÑAL AM ---
// Estos parámetros se pueden modificar en tiempo de ejecución mediante
// comandos enviados por el puerto serie.  freqP corresponde a la
// frecuencia portadora y freqM a la frecuencia moduladora.  m_index es
// el índice de modulación (0..1) y A_c la amplitud de la portadora.
volatile float freqP  = 50.0f;
volatile float freqM  = 5.0f;
volatile float m_index = 0.8f;
volatile float A_c    = 1.0f;
#define ADC_CHANNEL_AMPLITUDE ADC1_CHANNEL_4 // Mapeo de GPIO32 a ADC1_CHANNEL_4
#define DEFAULT_VREF 1100 // Tensión de referencia (1100 mV por defecto)
static esp_adc_cal_characteristics_t adc_chars;
#define NUM_TOP_FREQS 3 

// Estructura para almacenar un par Frecuencia-Magnitud
struct FftPeak {
    float freq;
    float mag;
};

// Variable global para almacenar el último resultado de la FFT (los N picos)
volatile FftPeak last_top_peaks[NUM_TOP_FREQS];

// --- CONFIGURACIÓN CRÍTICA DE TIEMPO ---
// Frecuencia de muestreo.  Debe ser suficientemente alta para
// representar correctamente la señal modulada y cumplir el teorema de
// Nyquist.  Se utiliza tanto para el generador como para la FFT.
#define SAMPLE_RATE_HZ     10000UL
// Número de muestras entre cada paquete de datos enviado por el puerto
// serie.  Un valor alto reduce la carga del procesador asociada al
// envío de datos, pero disminuye la resolución temporal de las
// lecturas publicadas.

// --- CONFIGURACIÓN FFT ---
// Número de muestras usadas para la FFT.  Debe ser potencia de 2.
#define FFT_SAMPLES 512
const int NUM_DATOS_JSON = 200;

// Buffers de tiempo para almacenar los datos de la FFT. Se utilizan
// dos buffers (doble buffering) para permitir que la tarea de
// muestreo llene un buffer mientras el otro se procesa.  Los
// elementos se declaran como double porque la biblioteca arduinoFFT
// trabaja con números de coma flotante de doble precisión.
static double vRealBuf[2][FFT_SAMPLES];
static double vImagBuf[2][FFT_SAMPLES];

// Índices y banderas de control para la doble memoria intermedia.
volatile int currentBuffer = 0;       // Identificador del buffer en uso para rellenar
volatile int bufferIndex   = 0;       // Posición actual dentro del buffer
volatile bool bufferReady[2] = {false, false}; // Indica que un buffer completo está listo para procesarse

// Handles de las tareas FreeRTOS.  Una tarea se encarga del muestreo
// (generador y lectura ADC) y otra del procesamiento de la FFT.
// Reemplaza los handles de tareas con esta cola:
TaskHandle_t samplingTaskHandle = NULL;
QueueHandle_t samplingQueue = NULL;
TaskHandle_t fftTaskHandle = NULL;

// Variables de sistema
gptimer_handle_t gptimer = NULL;
// Mux para sincronización de acceso a variables compartidas entre
// interrupciones y tareas.  Se utiliza para proteger cambios en
// currentBuffer, bufferIndex y bufferReady.
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

#define NUM_MUESTRAS_PORTADORA 100 
// Tabla pre-calculada de una sinusoide normalizada (+1.0 a -1.0)
static float porta_base[NUM_MUESTRAS_PORTADORA]; 
// Índice flotante para recorrer la tabla (DDS)
volatile float portadoraIndex = 0.0f;


// Acumuladores de fase
float phaseP = 0.0f;
float phaseM = 0.0f;
const float DOS_PI = 6.28318530718f;

// Prototipos
bool IRAM_ATTR onTimer(gptimer_handle_t timer, const gptimer_alarm_event_data_t *edata, void *user_ctx);
void procesarComando(const String &cmd);
void taskSampling(void *param);
void taskFFT(void *param);
void generarTablaPortadora();
void setup() {
    Serial.begin(115200);
    // Esperar a que el puerto serie esté listo (evita perder datos al arranque)
    while (!Serial) { delay(10); }
    generarTablaPortadora();
    // Resolución del ADC: 12 bits (0..4095)
// Configuración del ADC
    adc1_config_width(ADC_WIDTH_BIT_12); 
    adc1_config_channel_atten(ADC_CHANNEL_AMPLITUDE, ADC_ATTEN_DB_11);
    
    // Calibración (OPCIONAL, pero recomendado para precisión)
    esp_adc_cal_characterize(ADC_UNIT_1,
                             ADC_ATTEN_DB_11,
                             ADC_WIDTH_BIT_12,
                             DEFAULT_VREF,
                             &adc_chars);
    // ...
    // Inicializa el DAC en 0
    // Después (Usando el driver):
    dac_output_enable(DAC_CHANNEL); // Habilita el canal DAC
    dac_output_voltage(DAC_CHANNEL, 0); // Inicializa el DAC en 0

    // Configuración del temporizador de muestreo.  Se utiliza el
    // GPTimer a 1 MHz para poder generar interrupciones con precisión
    // microsegundo.
    gptimer_config_t timer_config = {
        .clk_src      = GPTIMER_CLK_SRC_DEFAULT,
        .direction    = GPTIMER_COUNT_UP,
        .resolution_hz = 1'000'000UL
    };
    gptimer_new_timer(&timer_config, &gptimer);

    // Configuración de la alarma: genera una interrupción cada
    // (1e6 / SAMPLE_RATE_HZ) microsegundos y se recarga
    // automáticamente.
    gptimer_alarm_config_t alarm_config = {
        .alarm_count  = (uint64_t)(1'000'000UL / SAMPLE_RATE_HZ),
        .reload_count = 0,
        .flags = { .auto_reload_on_alarm = true }
    };
    gptimer_set_alarm_action(gptimer, &alarm_config);

    // Registrar la rutina de interrupción del temporizador.  Esta
    // interrupción no realiza ningún cálculo pesado, solo despierta a
    // la tarea de muestreo mediante una notificación FreeRTOS.
    gptimer_event_callbacks_t cbs = {
        .on_alarm = onTimer
    };
    gptimer_register_event_callbacks(gptimer, &cbs, NULL);

    gptimer_enable(gptimer);
    gptimer_start(gptimer);

    // Crear las tareas de muestreo y de FFT.  La tarea de muestreo
    // tiene mayor prioridad para evitar perder datos, y se fija al
    // núcleo 0.  La tarea de FFT se fija al núcleo 1 y puede tener
    // prioridad ligeramente inferior ya que el cálculo se realiza en
    // paralelo y debe adaptarse a la frecuencia de muestreo.
    
  samplingQueue = xQueueCreate(1, sizeof(uint8_t));
    xTaskCreatePinnedToCore(taskSampling, "samplingTask", 8192, NULL, 2, &samplingTaskHandle, 0);
    xTaskCreatePinnedToCore(taskFFT,     "fftTask",      10240, NULL, 1, &fftTaskHandle,      1);

    Serial.println("--- Generador AM con procesamiento FFT ---");
}

    void loop() {
        // El bucle principal se limita a procesar comandos recibidos por
        // el puerto serie.  Las tareas de muestreo y FFT se ejecutan en
        // paralelo en cada núcleo.  El uso de loop() permite seguir
        // interactuando sin bloquear el flujo de datos.
        if (Serial.available()) {
            String cmd = Serial.readStringUntil('\n');
            cmd.trim();
            if (cmd.length() > 0) {
                procesarComando(cmd);
            }
        }
        // Ceder el procesador para que otras tareas puedan ejecutarse
    }

// ISR
// Esta función se ejecuta en el contexto de interrupción del temporizador.
// En lugar de realizar operaciones de cálculo, simplemente notifica a la
// tarea de muestreo que existe una nueva muestra por procesar.  La
// función retorna true si fue necesario cambiar de contexto (según
// FreeRTOS), lo cual permite una conmutación eficiente.
bool IRAM_ATTR onTimer(gptimer_handle_t timer, const gptimer_alarm_event_data_t *edata, void *user_ctx) {
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    uint8_t dummy = 0;
    // Despertar la tarea de muestreo mediante una notificación.  Se
    // emplea la variante ISR para que sea segura en interrupciones.
    xQueueOverwriteFromISR(samplingQueue, &dummy, &xHigherPriorityTaskWoken);
    // Si la notificación despierta una tarea de mayor prioridad, se
    // produce un cambio de contexto al salir de la ISR.
    return (xHigherPriorityTaskWoken == pdTRUE);
}

void procesarComando(const String &cmd) {
    int separator = cmd.indexOf('=');
    if (separator > 0) {
        String param = cmd.substring(0, separator);
        float value = cmd.substring(separator + 1).toFloat();
        
        // 2. Proteger la ESCRITURA de frecuencias entre núcleos
        portENTER_CRITICAL(&timerMux); // <-- ¡NUEVO!
        if (param.equalsIgnoreCase("FP")) {
            freqP = value;
            portadoraIndex = 0.0f;
        } else if (param.equalsIgnoreCase("FM")) {
            freqM = value;
        } else if (param.equalsIgnoreCase("IDX")) {
            m_index = value;
            if (m_index < 0.0f) m_index = 0.0f;
        }
        portEXIT_CRITICAL(&timerMux); // <-- ¡NUEVO!
    }
}

/*
 * Tarea de muestreo y generación de la señal AM.
 *
 * Esta tarea se ejecuta en el núcleo 0 con prioridad alta.  Se
 * despierta por medio de una notificación enviada desde la
 * interrupción del temporizador cada vez que debe generarse una nueva
 * muestra.  En cada activación actualiza las fases de la portadora y
 * moduladora, calcula el valor del DAC para generar la señal AM,
 * realiza la lectura del ADC en adcPin, almacena el valor leído en el
 * buffer de tiempo para la FFT y empaqueta periódicamente lecturas de
 * referencia y medida en formato JSON para su envío por el puerto
 * serie.  Cuando se llena un buffer de FFT se marca como listo y se
 * notifica a la tarea de FFT.
 */
/*
 * Tarea de muestreo y generación de la señal AM.
 * Esta tarea se ejecuta en el núcleo 0 con prioridad alta.
 * Se despierta por notificación desde la interrupción del temporizador para cada muestra.
 * Se ha modificado para enviar datos de tiempo y datos de FFT de forma independiente.
 */
/* DENTRO DE onda_am.ino */
/*
 * Tarea de muestreo y generación de la señal AM.
 * Esta tarea se ejecuta en el núcleo 0 con prioridad alta.
 * Se despierta por notificación desde la interrupción del temporizador para cada muestra.
 * Se ha modificado para usar la tabla DDS (porta_base) para una generación de señal más fluida.
 */
void taskSampling(void *param) {
    static char linea[2048];        // Buffer para la cadena JSON
    static int conteoJson = 0;      // Contador de muestras en el lote
    static int idx = 0;             // Índice actual en la cadena JSON
    
    // Arrays estáticos para acumular los datos de muestreo antes de enviar el lote.
    static float vLeidos[NUM_DATOS_JSON]; 
    
    while (true) {
        // 1. ESPERA Y ACTIVACIÓN POR MUESTRA (Cola de Mensajes)
        uint8_t dummy; 
        xQueueReceive(samplingQueue, &dummy, portMAX_DELAY);
        
        // 2. CÁLCULO DE SEÑAL Y GENERACIÓN DAC (USANDO TABLA Y DDS)
        
        // 2a. Cálculos de Frecuencia y Paso (Protegido por Mutex)
        portENTER_CRITICAL(&timerMux);
            // PASO PORTADORA: Cantidad de muestras de la tabla a avanzar por ciclo de muestreo.
            float index_increment = (float)NUM_MUESTRAS_PORTADORA * freqP / SAMPLE_RATE_HZ;
            float stepM = (DOS_PI * freqM) / SAMPLE_RATE_HZ;
        portEXIT_CRITICAL(&timerMux); 

        // 2b. Avance de Fases y Punteros
        // Modulación (Fase simple)
        phaseM += stepM; 
        if (phaseM >= DOS_PI) phaseM -= DOS_PI;
        
        // Portadora (DDS: índice flotante)
        portadoraIndex += index_increment; 
        if (portadoraIndex >= NUM_MUESTRAS_PORTADORA) portadoraIndex -= NUM_MUESTRAS_PORTADORA;
        
        // 2c. Aplicación de la Modulación
        float mod = sinf(phaseM); 
        // Obtener el valor de la tabla de la portadora (sinusoidal normalizada).
        float car = porta_base[(int)portadoraIndex];

        float am_signal_volts;
        portENTER_CRITICAL(&timerMux); 
            // Fórmula AM: V(t) = Ac * (1 + m*mod(t)) * carrier(t)
            // La señal resultante está en Voltios.
            am_signal_volts = (A_c / 2.0f) * (1.0f + m_index * mod) * car;
        portEXIT_CRITICAL(&timerMux); 
        
        // 2d. Conversión a DAC (0-255). El DAC del ESP32 opera de 0 a 3.3V aprox.
        int dacValue = (int)((am_signal_volts + (A_c / 2.0f)) * (255.0f / 3.3f));
        if (dacValue < 0) dacValue = 0;
        else if (dacValue > 255) dacValue = 255;

        dac_output_voltage(DAC_CHANNEL, (uint8_t)dacValue); 
        
        // Leer el valor instantáneo en el ADC
        int adcRaw = adc1_get_raw(ADC_CHANNEL_AMPLITUDE);
        uint32_t voltage_mV;
        voltage_mV = esp_adc_cal_raw_to_voltage(adcRaw, &adc_chars);

        float vLeido = (float)voltage_mV / 1000.0f;
        bool notify_fft = false; 
        
        // 3. LLENADO DEL BUFFER DE FFT (Protegido por Mutex)
        portENTER_CRITICAL(&timerMux); 
            vRealBuf[currentBuffer][bufferIndex] = (double)adcRaw; 
            vImagBuf[currentBuffer][bufferIndex] = 0.0; // Parte imaginaria
            bufferIndex++;
            
            // Comprobar si se ha llenado el buffer
            if (bufferIndex >= FFT_SAMPLES) { 
                bufferReady[currentBuffer] = true;
                notify_fft = true; 
                
                // Cambiar al otro buffer y reiniciar el índice
                currentBuffer = 1 - currentBuffer;
                bufferIndex = 0;
            }
        portEXIT_CRITICAL(&timerMux);
        
        // Notificar a la tarea de FFT FUERA de la sección crítica
        if (notify_fft) {
            xTaskNotifyGive(fftTaskHandle); 
        } 
        
        // 4. ACUMULACIÓN CONSTANTE DE LECTURAS REALES
        // Acumula cada muestra en el buffer vLeidos.
        
        // Acumular los datos en el array estático vLeidos
        if (conteoJson < NUM_DATOS_JSON) {
            vLeidos[conteoJson] = vLeido;
            conteoJson++;
        }
        
        // 5. BLOQUE DE ENVÍO DE DATOS DE TIEMPO (Activado cuando el lote está lleno)
        // Envía el lote 'real' tan pronto como se llena (conteoJson).
        if (conteoJson >= NUM_DATOS_JSON) { 
            
            idx = 0;
            
            // Construir el paquete JSON ÚNICO: {"real":[...]}
            idx += snprintf(linea + idx, sizeof(linea) - idx, 
                           "{\"real\":[");
                           
            for (int i = 0; i < NUM_DATOS_JSON; i++) {
                idx += snprintf(linea + idx, sizeof(linea) - idx, 
                                "%.3f%s", vLeidos[i], (i == NUM_DATOS_JSON - 1) ? "" : ",");
            }
            
            idx += snprintf(linea + idx, sizeof(linea) - idx, "]}"); // Cerrar array Real y objeto principal

            Serial.println(linea);

            // Reiniciar contador de muestras
            conteoJson = 0;
        }
    }
}
/*
 * Tarea de cálculo de FFT.
 *
 * Esta tarea se ejecuta en el núcleo 1.  Espera a ser notificada de
 * que uno de los buffers de tiempo se encuentra lleno y listo para
 * procesarse.  Copia los datos en buffers locales para evitar
 * interferencias con la tarea de muestreo, aplica una ventana
 * (Hamming), calcula la FFT y convierte a magnitudes.  Posteriormente
 * determina la frecuencia con la mayor amplitud en el espectro 
 * publica por el puerto serie la frecuencia y la amplitud detectadas
 * en formato JSON.  Se pueden ampliar esta salida para enviar el
 * espectro completo si se desea.
 */
void taskFFT(void *param) {
    static char linea[1024];
    static double vReal[FFT_SAMPLES];
    static double vImag[FFT_SAMPLES];
    ArduinoFFT<double> FFT = ArduinoFFT<double>(vReal, vImag, FFT_SAMPLES, SAMPLE_RATE_HZ );
    // Buffers locales para procesamiento; se reservan en la pila de
    // la tarea y no compiten con la tarea de muestreo.

    // Estructura local para almacenar las N frecuencias principales
    FftPeak current_peaks[NUM_TOP_FREQS];
    
    // Buffers temporales para encontrar los picos sin modificar vReal
    const int SEARCH_SIZE = FFT_SAMPLES / 2;
    // Utilizamos un buffer local temporal para evitar modificar vReal
    double temp_mag[SEARCH_SIZE];
    while (true) {
        // Esperar a que la tarea de muestreo notifique que hay datos listos
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        // Determinar qué buffer está listo.  Se protege con mutex
        int bufToProcess = -1;
        portENTER_CRITICAL(&timerMux);
        // Procesar el buffer que tenga la bandera activa.  Si ambos
        // estuvieran listos se prioriza el índice más pequeño.
        if (bufferReady[0]) {
            bufToProcess = 0;
        } else if (bufferReady[1]) {
            bufToProcess = 1;
        }
        if (bufToProcess >= 0) {
            // Copiar datos al buffer local
            for (int i = 0; i < FFT_SAMPLES; i++) {
                vReal[i] = vRealBuf[bufToProcess][i];
                vImag[i] = 0.0;
            }
            // Marcar el buffer como procesado
            bufferReady[bufToProcess] = false;
        }
        portEXIT_CRITICAL(&timerMux);
        // Si no había buffer listo (puede ocurrir por notificaciones
        // acumuladas), continuar esperando
        if (bufToProcess < 0) {
            continue;
        }
        FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
        FFT.compute(FFTDirection::Forward);
        FFT.complexToMagnitude();
// 1. Copiar las magnitudes (solo frecuencias positivas)
        for (int i = 0; i < SEARCH_SIZE; i++) {
            temp_mag[i] = vReal[i];
        }
        // Asegurar que el componente DC (índice 0) se ignora
        temp_mag[0] = 0.0; 

        // 2. Buscar los N picos principales
        for (int n = 0; n < NUM_TOP_FREQS; n++) {
            double max_val = 0.0;
            int max_index = 0;
            
            // Buscar el máximo en el rango de frecuencias útiles (i=1 a SEARCH_SIZE-1)
            for (int i = 1; i < SEARCH_SIZE; i++) { 
                if (temp_mag[i] > max_val) {
                    max_val = temp_mag[i];
                    max_index = i;
                }
            }
            
            if (max_index == 0) {
                // No se encontraron más picos (magnitud 0)
                current_peaks[n] = {0.0f, 0.0f};
                // Rellenar el resto con cero y salir del bucle de picos
                for (int m = n; m < NUM_TOP_FREQS; m++) {
                    current_peaks[m] = {0.0f, 0.0f};
                }
                break; 
            } else {
                // Almacenar el resultado
                double freqBin = ((double)max_index * (double)SAMPLE_RATE_HZ) / (double)FFT_SAMPLES;
                current_peaks[n].freq = (float)freqBin;
                current_peaks[n].mag = (float)max_val;
                
                // Marcar este pico como encontrado para que no se repita en la siguiente iteración
                temp_mag[max_index] = 0.0; 
            }
        }
        
        // 3. Almacenar los resultados de forma segura y notificar a taskSampling
        portENTER_CRITICAL(&timerMux);
            for (int n = 0; n < NUM_TOP_FREQS; n++) {
                last_top_peaks[n].freq = current_peaks[n].freq;
                last_top_peaks[n].mag  = current_peaks[n].mag;
            }
        portEXIT_CRITICAL(&timerMux);

        // 4. Imprimir los resultados de la FFT directamente desde esta tarea
        int idx = 0;
        idx += snprintf(linea + idx, sizeof(linea) - idx,
                       "{\"fft\":[");

        for (int n = 0; n < NUM_TOP_FREQS; n++) {
            if (current_peaks[n].mag > 0.0f) {
                 idx += snprintf(linea + idx, sizeof(linea) - idx,
                            "{\"f\":%.1f,\"m\":%.1f}%s", // Formato: {"f":freq, "m":mag}
                            current_peaks[n].freq, current_peaks[n].mag,
                            (n == NUM_TOP_FREQS - 1 || current_peaks[n+1].mag == 0.0f) ? "" : ",");
            }
        }

        idx += snprintf(linea + idx, sizeof(linea) - idx, "]}"); // Cerrar array FFT y objeto principal

        Serial.println(linea);
    }
}


void generarTablaPortadora() {
    // Esto pre-calcula una sinusoide normalizada (-1.0 a +1.0) una sola vez.
    // La amplitud de la portadora (A_c) y la modulación (m_index) 
    // se aplican en tiempo de ejecución.
    for (int i = 0; i < NUM_MUESTRAS_PORTADORA; i++) {
        float angulo = DOS_PI * i / NUM_MUESTRAS_PORTADORA;
        porta_base[i] = sinf(angulo); 
    }
}
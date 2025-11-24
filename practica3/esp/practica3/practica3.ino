#include "driver/adc.h"
#include "driver/gptimer.h"
#include <math.h>

// --- PINES (ESP32 DEVKIT V1) ---
const int dacPin = 25; // Salida de la señal (Conectar al Osciloscopio)
const int adcPin = 32; // Entrada de retroalimentación (Opcional)

// --- PARÁMETROS DE LA SEÑAL AM ---
volatile float freqP = 50.0f;   // Portadora (Hz)
volatile float freqM = 5.0f;    // Moduladora (Hz)
volatile float m_index = 0.8f;  // Índice de modulación
volatile float A_c = 1.0f;      // Amplitud

// --- CONFIGURACIÓN CRÍTICA DE TIEMPO ---
#define SAMPLE_RATE_HZ 50000    // 50 kHz (1 muestra cada 20us)
// CORRECCIÓN IMPORTANTE: Aumentamos este valor para no saturar la CPU
#define PLOT_EVERY_N_SAMPLES 5000 // Enviar datos al PC solo cada 5000 muestras (aprox 10 veces/seg)

// Variables de sistema
volatile bool nuevaMuestra = false;
gptimer_handle_t gptimer = NULL;
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

// Acumuladores de fase
float phaseP = 0.0f;
float phaseM = 0.0f;
const float DOS_PI = 6.28318530718f;

// Prototipos
bool IRAM_ATTR onTimer(gptimer_handle_t timer, const gptimer_alarm_event_data_t *edata, void *user_ctx);
void procesarComando(String cmd);

void setup() {
    Serial.begin(115200);
    
    analogReadResolution(12);
    dacWrite(dacPin, 0);

    // Configuración del Timer
    gptimer_config_t timer_config = {
        .clk_src = GPTIMER_CLK_SRC_DEFAULT,
        .direction = GPTIMER_COUNT_UP,
        .resolution_hz = 1000000 // 1MHz (1 tick = 1us)
    };
    gptimer_new_timer(&timer_config, &gptimer);

    gptimer_alarm_config_t alarm_config = {
        .alarm_count = 1000000 / SAMPLE_RATE_HZ, // 20 ticks (20us)
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
    
    Serial.println("--- GENERADOR AM DE ALTA RESOLUCIÓN ---");
    Serial.println("Sistema optimizado para Osciloscopio.");
    Serial.println("Use el Serial Plotter para ver referencia.");
}

void loop() {
    // 1. Procesar comandos seriales (No bloqueante)
    if(Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        procesarComando(cmd);
    }

    // 2. Generación de señal (Prioridad Alta)
    if(nuevaMuestra) {
        portENTER_CRITICAL(&timerMux);
        nuevaMuestra = false;
        portEXIT_CRITICAL(&timerMux);

        // --- CÁLCULO MATEMÁTICO ---
        // Paso de fase dinámico (permite cambiar frecuencias en vivo)
        float stepP = (DOS_PI * freqP) / SAMPLE_RATE_HZ;
        float stepM = (DOS_PI * freqM) / SAMPLE_RATE_HZ;

        phaseP += stepP;
        phaseM += stepM;

        // Reset de fase para precisión a largo plazo
        if(phaseP > DOS_PI) phaseP -= DOS_PI;
        if(phaseM > DOS_PI) phaseM -= DOS_PI;

        // Ecuación AM
        float mod = sinf(phaseM);
        float car = sinf(phaseP);
        
        // Señal cruda normalizada (-1.0 a 1.0 aprox)
        // Dividimos por (1+idx) para evitar recorte matemático
        float raw_am = ((1.0f + m_index * mod) * car) / (1.0f + m_index);

        // Conversión a DAC 8-bits (0-255)
        // Mapeamos [-1, 1] -> [0, 255]
        int dacValue = (int)((raw_am + 1.0f) * 127.5f);

        // Clamping de seguridad
        if (dacValue < 0) dacValue = 0;
        else if (dacValue > 255) dacValue = 255;

        // --- SALIDA FÍSICA (Lo más rápido posible) ---
        dacWrite(dacPin, dacValue);

        // --- VISUALIZACIÓN (Decimada para no bloquear la señal) ---
        static int plotCounter = 0;
        plotCounter++;
        
        if (plotCounter >= PLOT_EVERY_N_SAMPLES) {
            plotCounter = 0;
            
            // Lectura de verificación (Solo para el plotter, no afecta la salida)
            int adcRaw = analogRead(adcPin);
            float vLeido = (adcRaw / 4095.0f) * 3.3f;
            float vTeorico = (dacValue / 255.0f) * 3.3f;

            Serial.print("Teorico:");
            Serial.print(vTeorico);
            Serial.print(",SalidaReal:");
            Serial.println(vLeido);
        }
    }
}

// ISR: Interrupción del timer
bool IRAM_ATTR onTimer(gptimer_handle_t timer, const gptimer_alarm_event_data_t *edata, void *user_ctx) {
    portENTER_CRITICAL_ISR(&timerMux);
    nuevaMuestra = true;
    portEXIT_CRITICAL_ISR(&timerMux);
    return false;
}

void procesarComando(String cmd) {
    int separator = cmd.indexOf('=');
    if(separator > 0) {
        String param = cmd.substring(0, separator);
        float value = cmd.substring(separator+1).toFloat();
        
        if(param.equalsIgnoreCase("FP")) freqP = value;
        else if(param.equalsIgnoreCase("FM")) freqM = value;
        else if(param.equalsIgnoreCase("IDX")) m_index = value;

        // Feedback corto para no interrumpir
        // Serial.println("OK"); 
    }
}
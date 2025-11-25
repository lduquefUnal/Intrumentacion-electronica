#include "driver/adc.h"
#include "driver/gptimer.h"
#include <math.h>

// --- PINES (ESP32 DEVKIT V1) ---
const int dacPin = 25; 
const int adcPin = 32; 

// --- PARÁMETROS DE LA SEÑAL AM ---
volatile float freqP = 50.0f;   
volatile float freqM = 5.0f;    
volatile float m_index = 0.8f;  
volatile float A_c = 1.0f;      

// --- CONFIGURACIÓN CRÍTICA DE TIEMPO ---
#define SAMPLE_RATE_HZ 50000    
#define PLOT_EVERY_N_SAMPLES 5000 

// Variables de sistema
volatile bool nuevaMuestra = false;
gptimer_handle_t gptimer = NULL;
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

// --- VARIABLES PARA JSON (NUEVO) ---
const int NUM_DATOS_JSON = 10; // Cantidad de puntos por paquete JSON
char linea[2048];              // Buffer aumentado para seguridad
int conteoJson = 0;            
int idx = 0;                   

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
        .resolution_hz = 1000000 
    };
    gptimer_new_timer(&timer_config, &gptimer);

    gptimer_alarm_config_t alarm_config = {
        .alarm_count = 1000000 / SAMPLE_RATE_HZ, 
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
    
    Serial.println("--- GENERADOR AM CON SALIDA JSON ---");
}

void loop() {
    // 1. Procesar comandos seriales
    if(Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        procesarComando(cmd);
    }

    // 2. Generación de señal
    if(nuevaMuestra) {
        portENTER_CRITICAL(&timerMux);
        nuevaMuestra = false;
        portEXIT_CRITICAL(&timerMux);

        // Paso de fase dinámico
        float stepP = (DOS_PI * freqP) / SAMPLE_RATE_HZ;
        float stepM = (DOS_PI * freqM) / SAMPLE_RATE_HZ;

        phaseP += stepP;
        phaseM += stepM;

        if(phaseP > DOS_PI) phaseP -= DOS_PI;
        if(phaseM > DOS_PI) phaseM -= DOS_PI;

        float mod = sinf(phaseM);
        float car = sinf(phaseP);
        
        float raw_am = ((1.0f + m_index * mod) * car) / (1.0f + m_index);
        int dacValue = (int)((raw_am + 1.0f) * 127.5f);

        if (dacValue < 0) dacValue = 0;
        else if (dacValue > 255) dacValue = 255;

        dacWrite(dacPin, dacValue);

        // --- VISUALIZACIÓN Y JSON ---
        static int plotCounter = 0;
        plotCounter++;
        
        if (plotCounter >= PLOT_EVERY_N_SAMPLES) {
            plotCounter = 0;
            
            int adcRaw = analogRead(adcPin);
            float vLeido = (adcRaw / 4095.0f) * 3.3f;
            float vTeorico = (dacValue / 255.0f) * 3.3f;

            // --- LÓGICA DE EMPAQUETADO JSON ---
            if (conteoJson == 0) {
                idx = 0;
                // Iniciar Array
                idx += snprintf(linea + idx, sizeof(linea) - idx, "[");
            }

            // Agregar dato
            idx += snprintf(linea + idx, sizeof(linea) - idx, 
                            "{\"teorico\":%.3f,\"real\":%.3f}%s", 
                            vTeorico, vLeido, 
                            (conteoJson + 1 == NUM_DATOS_JSON) ? "" : ",");

            conteoJson++;

            // Enviar paquete completo
            if (conteoJson >= NUM_DATOS_JSON) {
                idx += snprintf(linea + idx, sizeof(linea) - idx, "]");
                Serial.println(linea);
                conteoJson = 0; 
            }
        }
    }
}

// ISR
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
    }
}
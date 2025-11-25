#include "driver/adc.h"
#include "driver/gptimer.h"
#include <math.h>

// --- PINES ---
const int dacPin = 25; 
const int adcPin = 32; 

// --- PARÁMETROS DE LA SEÑAL AM ---
volatile float freqP = 50.0f;   
volatile float freqM = 5.0f;    
volatile float m_index = 0.8f;  
volatile float A_c = 1.0f;      

// --- CONFIGURACIÓN DE TIEMPO ---
#define SAMPLE_RATE_HZ 50000    

// AJUSTE CRÍTICO PARA 115200 BAUDIOS:
// 50kHz / 50 = 1000 muestras enviadas por segundo.
// Esto genera aprox 6000 caracteres por segundo, seguro para el límite de 11520 bytes/s.
#define PLOT_EVERY_N_SAMPLES 50 

// Variables de sistema
volatile bool nuevaMuestra = false;
gptimer_handle_t gptimer = NULL;
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

// --- VARIABLES PARA JSON ---
// Agrupamos 20 muestras por paquete JSON
const int NUM_DATOS_JSON = 20; 
char linea[2048];              
int conteoJson = 0;            
int idx = 0;                   

// Fases
float phaseP = 0.0f;
float phaseM = 0.0f;
const float DOS_PI = 6.28318530718f;

// Prototipos
bool IRAM_ATTR onTimer(gptimer_handle_t timer, const gptimer_alarm_event_data_t *edata, void *user_ctx);
void procesarComando(String cmd);

void setup() {
    // 1. Mantenemos la velocidad que pediste
    Serial.begin(115200);
    
    analogReadResolution(12);
    dacWrite(dacPin, 0);

    // Configuración del Timer (1MHz resolución)
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
    
    Serial.println("--- GENERADOR AM: MODO 115200 (SOLO REAL) ---");
}

void loop() {
    // 1. Procesar comandos
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

        // --- CÁLCULO DE SEÑAL ---
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

        // Salida física al DAC
        dacWrite(dacPin, dacValue);

        // --- LECTURA Y JSON ---
        static int plotCounter = 0;
        plotCounter++;
        
        if (plotCounter >= PLOT_EVERY_N_SAMPLES) {
            plotCounter = 0;
            
            // Leemos solo lo REAL
            int adcRaw = analogRead(adcPin);
            float vLeido = (adcRaw / 4095.0f) * 3.3f;

            // --- ARMADO DE JSON ARRAY ---
            // Formato: [1.20, 1.25, 1.30, ...]
            if (conteoJson == 0) {
                idx = 0;
                idx += snprintf(linea + idx, sizeof(linea) - idx, "[");
            }

            // Agregamos el dato con 2 decimales para ahorrar caracteres
            idx += snprintf(linea + idx, sizeof(linea) - idx, 
                            "%.2f%s", 
                            vLeido, 
                            (conteoJson + 1 == NUM_DATOS_JSON) ? "" : ",");

            conteoJson++;

            // Enviar cuando el paquete esté lleno
            if (conteoJson >= NUM_DATOS_JSON) {
                idx += snprintf(linea + idx, sizeof(linea) - idx, "]");
                Serial.println(linea);
                conteoJson = 0; 
            }
        }
    }
}

// ISR Timer
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
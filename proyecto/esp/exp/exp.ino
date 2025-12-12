/*
 * PROYECTO: Simulador de Fotopletismografía (PPG) con Flujo de Agua
 * VERSION: 3.0 (Doble DAC + Doble Motor Independiente)
 * MAPA DE PINES:
 * - GPIO 25 (DAC1): Señal Senoidal para LED IR (Modo Transmisión).
 * - GPIO 26 (DAC2): Señal Senoidal para LÁSER (Rango 2.2V - 2.7V).
 * - GPIO 32 (ADC1): Entrada del Fototransistor.
 * - GPIO 16: PWM Motor 1 (Base Transistor 1).
 * - GPIO 17: PWM Motor 2 (Base Transistor 2).
 */

#include <Arduino.h>
#include "driver/adc.h"
#include "driver/gptimer.h"
#include "driver/dac.h"
#include "driver/ledc.h"
#include "esp_adc_cal.h"
#include <math.h>

// ————— DEFINICIÓN DE PINES —————
#define CHANNEL_DAC_IR     DAC_CHANNEL_1  // GPIO 25
#define CHANNEL_DAC_LASER  DAC_CHANNEL_2  // GPIO 26
#define ADC_CHANNEL        ADC1_CHANNEL_4 // GPIO 32

const int pinADC    = 32;
const int pinMotor1 = 16;  // PWM Independiente 1
const int pinMotor2 = 17;  // PWM Independiente 2

// ————— CONFIGURACIÓN DE TIEMPO Y MUESTREO —————
#define SAMPLE_PERIOD_MS  10
#define SAMPLE_RATE_HZ    100

// ————— PARÁMETROS ONDA SENOIDAL IR (GPIO 25) —————
volatile float freqSeno = 1.0f;   // Hz
volatile float ampSeno  = 1.0f;   // 0.0 a 1.0
float faseSeno          = 0.0f;

// ————— PARÁMETROS ONDA SENOIDAL LÁSER (GPIO 26) —————
// Requerimiento típico: Min 2.2V, Max 2.7V -> Offset 2.45V, Amplitud 0.25V
volatile float laserFreq = 1.0f; 
volatile float laserAmpV = 0.25f; // Amplitud en Voltios
volatile float laserOffV = 2.45f; // Offset en Voltios
float faseLaser          = 0.0f;

const float DOS_PI = 6.28318530718f;

// ————— PARÁMETROS MOTORES (PWM) —————
volatile float freqPWM    = 500.0f; // Frecuencia compartida
volatile float dutyCycle1 = 0.0f;   // Motor 1 (0-100%)
volatile float dutyCycle2 = 0.0f;   // Motor 2 (0-100%)

// Configuración LEDC
const ledc_timer_t      PWM_TIMER      = LEDC_TIMER_0;
const ledc_timer_bit_t  PWM_RESOLUTION = LEDC_TIMER_10_BIT;
const ledc_channel_t    PWM_CHAN_1     = LEDC_CHANNEL_0; // Para pin 16
const ledc_channel_t    PWM_CHAN_2     = LEDC_CHANNEL_1; // Para pin 17

// ————— MAQUINA DE ESTADOS (FSM) —————
enum EstadoLuz {
    MODO_OFF    = 0,
    MODO_LED_IR = 1,
    MODO_LASER  = 2
};

volatile EstadoLuz estadoActual = MODO_OFF;

// ————— TRANSMISIÓN Y BUFFERS —————
const int NUM_DATOS_JSON = 10; 
const int DECIMATOR_VAL  = 1;   

TaskHandle_t samplingTaskHandle = NULL;
TaskHandle_t commTaskHandle     = NULL;

volatile bool sendSlotReady      = false;
float sendSlotRef[NUM_DATOS_JSON]; 
float sendSlotADC[NUM_DATOS_JSON]; 

gptimer_handle_t gptimer = NULL;
portMUX_TYPE timerMux    = portMUX_INITIALIZER_UNLOCKED;

// Calibración ADC
static esp_adc_cal_characteristics_t adc_chars;
static const uint32_t DEFAULT_VREF = 1100;

// ————— PROTOTIPOS —————
bool IRAM_ATTR onTimer(gptimer_handle_t timer, const gptimer_alarm_event_data_t *edata, void *user_ctx);
void procesarComando(const String &cmd);
void taskSampling(void *param);
void taskComm(void *param);
void inicializarPWM();
void actualizarPWM();

// ———————————————————————————————— SETUP ————————————————————————————————
void setup() {
    Serial.begin(115200);
    while (!Serial) { delay(10); }

    // 1. Configurar Pines
    pinMode(pinADC, INPUT);
    // Nota: Pines 16, 17, 25, 26 son manejados por drivers internos

    // 2. Configurar ADC
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(ADC_CHANNEL, ADC_ATTEN_DB_11);
    esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_11, ADC_WIDTH_BIT_12,
                             DEFAULT_VREF, &adc_chars);

    // 3. Inicializar DACs
    dac_output_enable(CHANNEL_DAC_IR);    
    dac_output_enable(CHANNEL_DAC_LASER); 
    dac_output_voltage(CHANNEL_DAC_IR, 0);
    dac_output_voltage(CHANNEL_DAC_LASER, 0);

    // 4. Inicializar PWM (Motores independientes)
    inicializarPWM();
    actualizarPWM();

    // 5. Crear Tareas
    xTaskCreatePinnedToCore(taskSampling, "TaskSampling",
                            4096, NULL, 5, &samplingTaskHandle, 1);
    xTaskCreatePinnedToCore(taskComm, "TaskComm",
                            4096, NULL, 1, &commTaskHandle, 0);

    vTaskDelay(pdMS_TO_TICKS(100));

    // 6. Configurar Timer (100 Hz)
    gptimer_config_t timer_config = {
        .clk_src       = GPTIMER_CLK_SRC_DEFAULT,
        .direction     = GPTIMER_COUNT_UP,
        .resolution_hz = 1000000UL
    };
    gptimer_new_timer(&timer_config, &gptimer);

    gptimer_alarm_config_t alarm_config = {
        .alarm_count  = (uint64_t)(1000000UL / SAMPLE_RATE_HZ),
        .reload_count = 0,
        .flags = { .auto_reload_on_alarm = true }
    };
    gptimer_set_alarm_action(gptimer, &alarm_config);

    gptimer_event_callbacks_t cbs = { .on_alarm = onTimer };
    gptimer_register_event_callbacks(gptimer, &cbs, NULL);

    gptimer_enable(gptimer);
    gptimer_start(gptimer);

    Serial.println("========================================");
    Serial.println("   Sistema PPG Hídrico V3.0 Iniciado");
    Serial.println("========================================");
    Serial.println("Comandos:");
    Serial.println("  STATE=0/1/2   -> Luz (0=OFF,1=LED_IR,2=LASER)");
    Serial.println("  DC1=0-100     -> Motor 1 (Pin 16)");
    Serial.println("  DC2=0-100     -> Motor 2 (Pin 17)");
    Serial.println("  FP=HZ         -> Frec PWM (Ambos)");
    Serial.println("  FREQ=HZ, AMP=0.0-1.0     -> Onda IR");
    Serial.println("  L_FREQ=HZ, L_AMP=V, L_OFF=V -> Onda Laser");
    Serial.println("========================================");
}

// ———————————————————————————————— LOOP ————————————————————————————————
void loop() {
    if (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        if (cmd.length() > 0) {
            procesarComando(cmd);
        }
    }
}

// —————————————————————— ISR DEL TIMER ——————————————————————
bool IRAM_ATTR onTimer(gptimer_handle_t timer,
                       const gptimer_alarm_event_data_t *edata,
                       void *user_ctx) {
    BaseType_t hpTaskWoken = pdFALSE;
    if (samplingTaskHandle != NULL) {
        vTaskNotifyGiveFromISR(samplingTaskHandle, &hpTaskWoken);
    }
    return (hpTaskWoken == pdTRUE);
}

// ———————————————— TAREA DE MUESTREO Y GENERACIÓN ————————————————
void taskSampling(void *param) {
    static int   idxBuffer        = 0;
    static float bufRef[NUM_DATOS_JSON];
    static float bufADC[NUM_DATOS_JSON];
    static int   decimatorCounter = 0;

    while (true) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

        EstadoLuz estadoLocal;
        int dacValIR    = 0;
        int dacValLaser = 0;
        float dacValIR_Float = 0.0f;

        // 1. Actualizar fases y calcular valores DAC bajo sección crítica
        portENTER_CRITICAL(&timerMux);
            estadoLocal = estadoActual;

            // IR
            float stepIR = (DOS_PI * freqSeno) / (float)SAMPLE_RATE_HZ;
            faseSeno += stepIR;
            if (faseSeno > DOS_PI) faseSeno -= DOS_PI;
            float rawSenoIR = sinf(faseSeno);
            dacValIR = (int)(((rawSenoIR * ampSeno) + 1.0f) * 127.5f);
            if (dacValIR < 0)   dacValIR = 0;
            if (dacValIR > 255) dacValIR = 255;
            dacValIR_Float = (dacValIR / 255.0f) * 3.3f;

            // LÁSER
            float stepLaser = (DOS_PI * laserFreq) / (float)SAMPLE_RATE_HZ;
            faseLaser += stepLaser;
            if (faseLaser > DOS_PI) faseLaser -= DOS_PI;

            float voltLaser = laserOffV + (laserAmpV * sinf(faseLaser));
            // (Opcional: limitar voltLaser a [0,3.3] antes de mapear)
            dacValLaser = (int)((voltLaser / 3.3f) * 255.0f);
            if (dacValLaser < 0)   dacValLaser = 0;
            if (dacValLaser > 255) dacValLaser = 255;
        portEXIT_CRITICAL(&timerMux);

        // 2. APLICAR SALIDAS SEGÚN ESTADO
        if (estadoLocal == MODO_LED_IR) {
            dac_output_voltage(CHANNEL_DAC_IR,    (uint8_t)dacValIR);
            dac_output_voltage(CHANNEL_DAC_LASER, 0);
        } else if (estadoLocal == MODO_LASER) {
            dac_output_voltage(CHANNEL_DAC_IR,    0);
            dac_output_voltage(CHANNEL_DAC_LASER, (uint8_t)dacValLaser);
        } else {
            dac_output_voltage(CHANNEL_DAC_IR,    0);
            dac_output_voltage(CHANNEL_DAC_LASER, 0);
        }

        // 3. LEER SENSOR
        uint32_t rawADC = adc1_get_raw(ADC_CHANNEL);
        uint32_t mV     = esp_adc_cal_raw_to_voltage(rawADC, &adc_chars);
        float voltADC   = mV / 1000.0f;

        // Referencia a enviar
        float voltRefToSend = 0.0f;
        if (estadoLocal == MODO_LED_IR) {
            voltRefToSend = dacValIR_Float;
        } else if (estadoLocal == MODO_LASER) {
            voltRefToSend = (dacValLaser / 255.0f) * 3.3f;
        }

        // 4. BUFFERING + DIEZMADO
        decimatorCounter++;
        if (decimatorCounter >= DECIMATOR_VAL) {
            decimatorCounter = 0;
            if (idxBuffer < NUM_DATOS_JSON) {
                bufRef[idxBuffer] = voltRefToSend;
                bufADC[idxBuffer] = voltADC;
                idxBuffer++;
            }
        }

        // 5. ENVÍO
        if (idxBuffer >= NUM_DATOS_JSON) {
            if (!sendSlotReady) {
                portENTER_CRITICAL(&timerMux);
                    for (int i = 0; i < NUM_DATOS_JSON; i++) {
                        sendSlotRef[i] = bufRef[i];
                        sendSlotADC[i] = bufADC[i];
                    }
                    sendSlotReady = true;
                portEXIT_CRITICAL(&timerMux);
                xTaskNotifyGive(commTaskHandle);
            }
            idxBuffer = 0;
        }
    }
}

// ———————————————— TAREA DE COMUNICACIÓN ————————————————
void taskComm(void *param) {
    static char bufferTx[1024];
    float localRef[NUM_DATOS_JSON];
    float localADC[NUM_DATOS_JSON];

    while (true) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

        bool     hayDatos    = false;
        EstadoLuz estadoLocal;
        float    dc1Local, dc2Local;

        portENTER_CRITICAL(&timerMux);
            if (sendSlotReady) {
                for (int i = 0; i < NUM_DATOS_JSON; i++) {
                    localRef[i] = sendSlotRef[i];
                    localADC[i] = sendSlotADC[i];
                }
                estadoLocal  = estadoActual;
                dc1Local     = dutyCycle1;
                dc2Local     = dutyCycle2;
                sendSlotReady = false;
                hayDatos      = true;
            }
        portEXIT_CRITICAL(&timerMux);

        if (!hayDatos) continue;

        int n = 0;
        n += snprintf(bufferTx + n, sizeof(bufferTx) - n,
                      "{\"s\":%d,\"dc1\":%.1f,\"dc2\":%.1f,\"ref\":[",
                      (int)estadoLocal, dc1Local, dc2Local);

        for (int i = 0; i < NUM_DATOS_JSON; i++) {
            n += snprintf(bufferTx + n, sizeof(bufferTx) - n,
                          "%.3f%s", localRef[i],
                          (i == NUM_DATOS_JSON - 1) ? "" : ",");
        }

        n += snprintf(bufferTx + n, sizeof(bufferTx) - n, "],\"adc\":[");
        
        for (int i = 0; i < NUM_DATOS_JSON; i++) {
            n += snprintf(bufferTx + n, sizeof(bufferTx) - n,
                          "%.3f%s", localADC[i],
                          (i == NUM_DATOS_JSON - 1) ? "" : ",");
        }
        n += snprintf(bufferTx + n, sizeof(bufferTx) - n, "]}");

        Serial.println(bufferTx);
    }
}

// —————————————————————— CONTROL DE MOTORES (PWM) ——————————————————————
void inicializarPWM() {
    ledc_timer_config_t tcfg = {
        .speed_mode      = LEDC_HIGH_SPEED_MODE,
        .duty_resolution = PWM_RESOLUTION,
        .timer_num       = PWM_TIMER,
        .freq_hz         = (uint32_t)freqPWM,
        .clk_cfg         = LEDC_AUTO_CLK
    };
    ledc_timer_config(&tcfg);

    // Motor 1 (Pin 16) - Canal 0
    ledc_channel_config_t ccfg1 = {
        .gpio_num   = pinMotor1,
        .speed_mode = LEDC_HIGH_SPEED_MODE,
        .channel    = PWM_CHAN_1,
        .intr_type  = LEDC_INTR_DISABLE,
        .timer_sel  = PWM_TIMER,
        .duty       = 0,
        .hpoint     = 0
    };
    ledc_channel_config(&ccfg1);

    // Motor 2 (Pin 17) - Canal 1
    ledc_channel_config_t ccfg2 = {
        .gpio_num   = pinMotor2,
        .speed_mode = LEDC_HIGH_SPEED_MODE,
        .channel    = PWM_CHAN_2,
        .intr_type  = LEDC_INTR_DISABLE,
        .timer_sel  = PWM_TIMER,
        .duty       = 0,
        .hpoint     = 0
    };
    ledc_channel_config(&ccfg2);
}

void actualizarPWM() {
    uint32_t dutyRaw1 = (uint32_t)((dutyCycle1 / 100.0f) * ((1 << PWM_RESOLUTION) - 1));
    uint32_t dutyRaw2 = (uint32_t)((dutyCycle2 / 100.0f) * ((1 << PWM_RESOLUTION) - 1));

    if (ledc_get_freq(LEDC_HIGH_SPEED_MODE, PWM_TIMER) != (uint32_t)freqPWM && freqPWM > 0.0f) {
        ledc_set_freq(LEDC_HIGH_SPEED_MODE, PWM_TIMER, (uint32_t)freqPWM);
    }

    ledc_set_duty(LEDC_HIGH_SPEED_MODE, PWM_CHAN_1, dutyRaw1);
    ledc_update_duty(LEDC_HIGH_SPEED_MODE, PWM_CHAN_1);

    ledc_set_duty(LEDC_HIGH_SPEED_MODE, PWM_CHAN_2, dutyRaw2);
    ledc_update_duty(LEDC_HIGH_SPEED_MODE, PWM_CHAN_2);
}

// ———————————————————— PROCESAMIENTO DE COMANDOS ————————————————————
void procesarComando(const String &cmd) {
    int idx = cmd.indexOf('=');
    if (idx < 0) {
        Serial.println("ERROR: Formato inválido. Use PARAM=VAL");
        return;
    }

    String p = cmd.substring(0, idx);
    p.toUpperCase();
    float val = cmd.substring(idx + 1).toFloat();

    // STATE
    if (p.equals("STATE")) {
        int s = (int)val;
        if (s < 0 || s > 2) {
            Serial.println("ERROR: STATE debe ser 0 (OFF), 1 (LED_IR) o 2 (LASER)");
            return;
        }
        portENTER_CRITICAL(&timerMux);
            estadoActual = (EstadoLuz)s;
        portEXIT_CRITICAL(&timerMux);
        Serial.print("OK: Estado -> ");
        if (s == 0) Serial.println("OFF");
        else if (s == 1) Serial.println("LED_IR");
        else             Serial.println("LASER");
        return;
    }

    // DC1 (Motor 1)
    if (p.equals("DC1")) {
        if (val < 0.0f || val > 100.0f) {
            Serial.println("ERROR: DC1 debe estar entre 0 y 100");
            return;
        }
        portENTER_CRITICAL(&timerMux);
            dutyCycle1 = val;
        portEXIT_CRITICAL(&timerMux);
        actualizarPWM();
        Serial.print("OK: DC1 = ");
        Serial.print(val, 1);
        Serial.println("%");
        return;
    }

    // DC2 (Motor 2)
    if (p.equals("DC2")) {
        if (val < 0.0f || val > 100.0f) {
            Serial.println("ERROR: DC2 debe estar entre 0 y 100");
            return;
        }
        portENTER_CRITICAL(&timerMux);
            dutyCycle2 = val;
        portEXIT_CRITICAL(&timerMux);
        actualizarPWM();
        Serial.print("OK: DC2 = ");
        Serial.print(val, 1);
        Serial.println("%");
        return;
    }

    // FP (PWM freq)
    if (p.equals("FP")) {
        if (val < 1.0f || val > 10000.0f) {
            Serial.println("ERROR: FP debe estar entre 1 y 10000 Hz");
            return;
        }
        portENTER_CRITICAL(&timerMux);
            freqPWM = val;
        portEXIT_CRITICAL(&timerMux);
        actualizarPWM();
        Serial.print("OK: Frecuencia PWM = ");
        Serial.print(val, 1);
        Serial.println(" Hz");
        return;
    }

    // FREQ (IR)
    if (p.equals("FREQ")) {
        if (val < 0.1f || val > 50.0f) {
            Serial.println("ERROR: FREQ debe estar entre 0.1 y 50 Hz");
            return;
        }
        portENTER_CRITICAL(&timerMux);
            freqSeno = val;
        portEXIT_CRITICAL(&timerMux);
        Serial.print("OK: Frecuencia IR = ");
        Serial.print(val, 2);
        Serial.println(" Hz");
        return;
    }

    // AMP (IR)
    if (p.equals("AMP")) {
        if (val < 0.0f || val > 1.0f) {
            Serial.println("ERROR: AMP debe estar entre 0.0 y 1.0");
            return;
        }
        portENTER_CRITICAL(&timerMux);
            ampSeno = val;
        portEXIT_CRITICAL(&timerMux);
        Serial.print("OK: Amplitud IR = ");
        Serial.println(val, 2);
        return;
    }

    // L_FREQ
    if (p.equals("L_FREQ")) {
        if (val < 0.1f || val > 50.0f) {
            Serial.println("ERROR: L_FREQ debe estar entre 0.1 y 50 Hz");
            return;
        }
        portENTER_CRITICAL(&timerMux);
            laserFreq = val;
        portEXIT_CRITICAL(&timerMux);
        Serial.print("OK: Frecuencia Láser = ");
        Serial.print(val, 2);
        Serial.println(" Hz");
        return;
    }

    // L_AMP (en Voltios)
    if (p.equals("L_AMP")) {
        if (val < 0.0f || val > 1.65f) { // sugerencia: no exceder ~metad mitad de 3.3
            Serial.println("ADVERTENCIA: L_AMP grande puede saturar el DAC (se recortará).");
        }
        portENTER_CRITICAL(&timerMux);
            laserAmpV = val;
        portEXIT_CRITICAL(&timerMux);
        Serial.print("OK: Amplitud Láser = ");
        Serial.print(val, 3);
        Serial.println(" V");
        return;
    }

    // L_OFF (en Voltios)
    if (p.equals("L_OFF")) {
        if (val < 0.0f || val > 3.3f) {
            Serial.println("ERROR: L_OFF debe estar entre 0.0 y 3.3 V");
            return;
        }
        portENTER_CRITICAL(&timerMux);
            laserOffV = val;
        portEXIT_CRITICAL(&timerMux);
        Serial.print("OK: Offset Láser = ");
        Serial.print(val, 3);
        Serial.println(" V");
        return;
    }

    Serial.print("ERROR: Comando desconocido '");
    Serial.print(p);
    Serial.println("'");
    Serial.println("Comandos válidos: STATE, DC1, DC2, FP, FREQ, AMP, L_FREQ, L_AMP, L_OFF");
}

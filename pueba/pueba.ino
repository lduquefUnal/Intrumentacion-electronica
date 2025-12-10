#include <Arduino.h>
#include "driver/adc.h"
#include "esp_adc_cal.h"
#include "driver/gptimer.h"
#include "driver/ledc.h"

// --- Configuración general ---
#define NUM_DATOS   50
#define DECIMATOR   5           // Tomar 1 de cada N muestras para enviar
#define ENVIO_TICKS 200         // Enviar cada cierto número de interrupciones aunque no se llene el buffer

// Pines y canales
static const adc1_channel_t TERM_CHANNEL  = ADC1_CHANNEL_4; // GPIO32
static const adc1_channel_t FOTOR_CHANNEL = ADC1_CHANNEL_5; // GPIO33
const int pwmPin = 25;

// PWM
volatile float freqPWM   = 1000.0f; // Hz
volatile float dutyCycle = 0.0f;    // % calculado a partir del termistor
const ledc_timer_t     PWM_TIMER      = LEDC_TIMER_0;
const ledc_channel_t   PWM_CHANNEL    = LEDC_CHANNEL_0;
const ledc_timer_bit_t PWM_RESOLUTION = LEDC_TIMER_10_BIT;

// Umbral fotorresistencia (mV)
volatile float umbralFotor_mV = 2300.0f;

// Muestreo
volatile uint32_t samplePeriodMs = 10; // periodo del timer en ms
gptimer_handle_t gptimer = NULL;
TaskHandle_t samplingTaskHandle = NULL;
TaskHandle_t commTaskHandle = NULL;
portMUX_TYPE timerMux = portMUX_INITIALIZER_UNLOCKED;

// ADC calibración
static const uint32_t DEFAULT_VREF = 0;
static esp_adc_cal_characteristics_t adc_chars;

// Buffer de envío
volatile bool sendSlotReady = false;
volatile int sendCount = 0;
uint16_t sendSlotTerm[NUM_DATOS];
uint16_t sendSlotFotor[NUM_DATOS];
volatile bool sendSlotLed = false;   // último estado a reportar (0/1)
volatile bool ledState = false;      // estado actual por umbral
volatile bool ledLatched = false;    // se detectó umbral desde el último envío

// Prototipos
bool IRAM_ATTR onTimer(gptimer_handle_t, const gptimer_alarm_event_data_t*, void*);
void inicializarPWM();
void actualizarPWM();
void actualizarPeriodoMuestreo(uint32_t periodMs);
void procesarComando(const String &cmd);
void taskSampling(void *param);
void taskComm(void *param);

void setup() {
    Serial.begin(115200);

    // ADC en mV
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(TERM_CHANNEL,  ADC_ATTEN_DB_11);
    adc1_config_channel_atten(FOTOR_CHANNEL, ADC_ATTEN_DB_11);
    esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_11, ADC_WIDTH_BIT_12, DEFAULT_VREF, &adc_chars);

    // PWM y timer
    inicializarPWM();
    actualizarPWM();

    gptimer_config_t gcfg = {
        .clk_src       = GPTIMER_CLK_SRC_DEFAULT,
        .direction     = GPTIMER_COUNT_UP,
        .resolution_hz = 1'000'000
    };
    gptimer_new_timer(&gcfg, &gptimer);
    actualizarPeriodoMuestreo(samplePeriodMs);
    gptimer_event_callbacks_t cbs = { .on_alarm = onTimer };
    gptimer_register_event_callbacks(gptimer, &cbs, NULL);
    gptimer_enable(gptimer);
    gptimer_start(gptimer);

    // Tareas
    xTaskCreatePinnedToCore(taskSampling, "taskSampling", 4096, NULL, 3, &samplingTaskHandle, 0);
    xTaskCreatePinnedToCore(taskComm, "taskComm", 3072, NULL, 1, &commTaskHandle, 1);

    Serial.println("Listo. Comandos: FP=Hz UM=mV PER=ms");
}

void loop() {
    if (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        cmd.trim();
        if (cmd.length() > 0) procesarComando(cmd);
    }
}

// --- ISR del timer ---
bool IRAM_ATTR onTimer(gptimer_handle_t, const gptimer_alarm_event_data_t*, void*) {
    BaseType_t hpTaskWoken = pdFALSE;
    vTaskNotifyGiveFromISR(samplingTaskHandle, &hpTaskWoken);
    return hpTaskWoken == pdTRUE;
}

// --- Tarea de muestreo y modulación PWM ---
void taskSampling(void *param) {
    static int decimator = 0;
    static int conteo = 0;
    static int ticks = 0;
    static uint16_t termBuf[NUM_DATOS];
    static uint16_t fotorBuf[NUM_DATOS];
    const float fullScale_mV = 3300.0f;

    while (true) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

        // Lecturas en mV
        uint32_t termRaw   = adc1_get_raw(TERM_CHANNEL);
        uint32_t term_mV   = esp_adc_cal_raw_to_voltage(termRaw, &adc_chars);
        uint32_t fotorRaw  = adc1_get_raw(FOTOR_CHANNEL);
        uint32_t fotor_mV  = esp_adc_cal_raw_to_voltage(fotorRaw, &adc_chars);

        // PWM proporcional al termistor
        // Mapear 1200 mV -> 0% y 2300 mV -> 100%
        const float dutyMin_mV = 1200.0f;
        const float dutyMax_mV = 2300.0f;
        float duty = ((float)term_mV - dutyMin_mV) * 100.0f / (dutyMax_mV - dutyMin_mV);
        if (duty < 0.0f) duty = 0.0f;
        if (duty > 100.0f) duty = 100.0f;
        dutyCycle = duty;
        actualizarPWM();

        bool ledNow = (float)fotor_mV >= umbralFotor_mV;
        ledState = ledNow;
        if (ledNow) ledLatched = true;

        // Decimado para envío
        if (++decimator >= DECIMATOR) {
            decimator = 0;
            if (conteo < NUM_DATOS) {
                termBuf[conteo]  = (uint16_t)term_mV;
                fotorBuf[conteo] = (uint16_t)fotor_mV;
                conteo++;
            }
        }

        // Condición de envío: buffer lleno o cada cierto tiempo
        ticks++;
        bool sendNow = false;
        if (conteo >= NUM_DATOS) sendNow = true;
        else if (ticks >= ENVIO_TICKS && conteo > 0) sendNow = true;

        if (sendNow && !sendSlotReady) {
            portENTER_CRITICAL(&timerMux);
                for (int i = 0; i < conteo; i++) {
                    sendSlotTerm[i]  = termBuf[i];
                    sendSlotFotor[i] = fotorBuf[i];
                }
                sendCount   = conteo;
                sendSlotLed = ledLatched;
                sendSlotReady = true;
                conteo = 0;
                ledLatched = ledState; // conservar estado actual
                ticks = 0;
            portEXIT_CRITICAL(&timerMux);
            xTaskNotifyGive(commTaskHandle);
        }
    }
}

// --- Tarea de comunicación ---
void taskComm(void *param) {
    static char linea[1024];
    uint16_t localTerm[NUM_DATOS];
    uint16_t localFotor[NUM_DATOS];
    bool localLed = false;
    int localCount = 0;

    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        if (!sendSlotReady) continue;

        portENTER_CRITICAL(&timerMux);
            localCount = sendCount;
            for (int i = 0; i < localCount; i++) {
                localTerm[i]  = sendSlotTerm[i];
                localFotor[i] = sendSlotFotor[i];
            }
            localLed = sendSlotLed;
            sendSlotReady = false;
        portEXIT_CRITICAL(&timerMux);

        if (localCount <= 0) continue;

        int idx = 0;
        idx += snprintf(linea + idx, sizeof(linea) - idx, "{\"termistor\":[");
        for (int i = 0; i < localCount; i++) {
            idx += snprintf(linea + idx, sizeof(linea) - idx, "%u%s",
                            (unsigned)localTerm[i],
                            (i == localCount - 1) ? "" : ",");
        }
        idx += snprintf(linea + idx, sizeof(linea) - idx, "],\"fotor\":[");
        for (int i = 0; i < localCount; i++) {
            idx += snprintf(linea + idx, sizeof(linea) - idx, "%u%s",
                            (unsigned)localFotor[i],
                            (i == localCount - 1) ? "" : ",");
        }
        idx += snprintf(linea + idx, sizeof(linea) - idx, "],\"led\":[%d]}", localLed ? 1 : 0);
        Serial.println(linea);
    }
}

void inicializarPWM() {
    ledc_timer_config_t tcfg = {
        .speed_mode      = LEDC_HIGH_SPEED_MODE,
        .duty_resolution = PWM_RESOLUTION,
        .timer_num       = PWM_TIMER,
        .freq_hz         = (uint32_t)freqPWM,
        .clk_cfg         = LEDC_AUTO_CLK
    };
    ledc_timer_config(&tcfg);

    ledc_channel_config_t ccfg = {
        .gpio_num   = pwmPin,
        .speed_mode = LEDC_HIGH_SPEED_MODE,
        .channel    = PWM_CHANNEL,
        .intr_type  = LEDC_INTR_DISABLE,
        .timer_sel  = PWM_TIMER,
        .duty       = 0,
        .hpoint     = 0
    };
    ledc_channel_config(&ccfg);
}

void actualizarPWM() {
    portENTER_CRITICAL(&timerMux);
        uint32_t duty = (uint32_t)((dutyCycle / 100.0f) * ((1 << PWM_RESOLUTION) - 1));
        ledc_set_freq(LEDC_HIGH_SPEED_MODE, PWM_TIMER, (uint32_t)freqPWM);
        ledc_set_duty(LEDC_HIGH_SPEED_MODE, PWM_CHANNEL, duty);
        ledc_update_duty(LEDC_HIGH_SPEED_MODE, PWM_CHANNEL);
    portEXIT_CRITICAL(&timerMux);
}

void actualizarPeriodoMuestreo(uint32_t periodMs) {
    if (periodMs == 0) return;
    gptimer_alarm_config_t aconf = {
        .alarm_count  = (uint64_t)periodMs * 1000ULL,
        .reload_count = 0,
        .flags = { .auto_reload_on_alarm = true }
    };
    gptimer_set_alarm_action(gptimer, &aconf);
}

void procesarComando(const String &cmd) {
    int pos = cmd.indexOf('=');
    if (pos < 0) { Serial.println("ERR"); return; }
    String p = cmd.substring(0, pos);
    float  val = cmd.substring(pos + 1).toFloat();

    bool ok = true;
    portENTER_CRITICAL(&timerMux);
        if      (p.equalsIgnoreCase("FP"))  { if (val < 1.0f) val = 1.0f; freqPWM = val; actualizarPWM(); }
        else if (p.equalsIgnoreCase("UM"))  { if (val < 0.0f) val = 0.0f; umbralFotor_mV = val; }
        else if (p.equalsIgnoreCase("PER")) {
            if (val < 1.0f) val = 1.0f;
            samplePeriodMs = (uint32_t)val;
            actualizarPeriodoMuestreo(samplePeriodMs);
        }
        else ok = false;
    portEXIT_CRITICAL(&timerMux);

    Serial.println(ok ? "OK" : "ERR");
}

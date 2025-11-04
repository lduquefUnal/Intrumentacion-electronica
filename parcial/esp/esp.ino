#include "driver/adc.h"
#include "esp_adc_cal.h"
#include "driver/gptimer.h"
#include "driver/ledc.h"

#define NUM_DATOS 10

// ————— Parámetros PWM y calibración ADC —————
volatile float freqPWM   = 500.0f;  // Hz para la lámpara
volatile float dutyCycle = 0.0f;    // % salida PWM (0..100)
int estado = 0;
// ————— Pines y canales —————
static const adc1_channel_t ADC_CHANNEL  = ADC1_CHANNEL_4;  // GPIO32 para el sensor de temperatura patron
static const adc1_channel_t ADC_CHANNEL2 = ADC1_CHANNEL_6;  // GPIO34 para el sensor de temperatura calibrar
const int pwmPin = 25;                                      // PWM para la bombillo de calor
// —————  calibración ADC —————
volatile float tempPatronOffset_mV = 0.0f;
volatile float tempPatron_mV_per_C = 10.0f;
volatile float adcScale = 1.0f;

volatile float correccion = 6.0f;

volatile float tempCalOffset_mV = 0.0f;  // sumar (mV) - mantenimiento de calibración ADC
volatile float tempCal_mV_per_C     = 1.0f;  

const ledc_timer_t     PWM_TIMER      = LEDC_TIMER_0;
const ledc_channel_t   PWM_CHANNEL    = LEDC_CHANNEL_0; //pin 25
const ledc_channel_t   PWM_CHANNEL2   = LEDC_CHANNEL_1; //pin 26
const ledc_timer_bit_t PWM_RESOLUTION = LEDC_TIMER_10_BIT; // Más resolución para la bomba

// ————— PID —————
float setPoint    = 28.0f; // Altura objetivo en cm
float Kp = 30.0f, Ki = 0.8f, Kd = 1.0f; // Parámetros ajustados
char linea[2048];
int idx = 0;

// ————— Muestreo con GPTimer —————
volatile uint64_t    t_micros      = 0;
volatile bool        nuevaMuestra  = false;
gptimer_handle_t     gptimer       = NULL;
portMUX_TYPE         timerMux      = portMUX_INITIALIZER_UNLOCKED;
const uint32_t SAMPLE_PERIOD_MS = 10;
#define N 50
static float errBuf[N] = {0};
static int   bufIdx   = 0;
static float sumErr   = 0;
TaskHandle_t taskHandle = NULL;

// ————— Calibración ADC —————
static const uint32_t DEFAULT_VREF = 0; // Calibración VREF típica
static esp_adc_cal_characteristics_t adc_chars;

// ————— Prototipos —————
bool IRAM_ATTR onTimer(gptimer_handle_t, const gptimer_alarm_event_data_t*, void*);
void inicializarPWM();
void actualizarPWM();
void procesarComando(const String &cmd);
float calcularPID(float measurement, float dt);
void resetIntegral();
void taskControl(void * param);

void taskControl(void *param) {
  while (true) {
    // --- Leer y calibrar ADC del sensor de nivel (GPIO32) ---
    uint32_t rawADC = adc1_get_raw(ADC_CHANNEL);
    uint32_t mV = esp_adc_cal_raw_to_voltage(rawADC, &adc_chars);
    float mV_corr = (float)mV * adcScale + tempPatronOffset_mV; // usar mV, no mV_raw
    float adc_mV = mV_corr;      
    float tempPatron = (adc_mV - tempPatronOffset_mV) / tempPatron_mV_per_C;


    uint32_t rawADC_Cal = adc1_get_raw(ADC_CHANNEL2);
    uint32_t mV_Cal = esp_adc_cal_raw_to_voltage(rawADC_Cal, &adc_chars);
    float mV_corr_Cal = (float)mV_Cal * adcScale + tempPatronOffset_mV; // usar mV, no mV_raw
    float adc_mV_Cal = mV_corr_Cal;      
    float tempCal = (0.05285354182821799 * adc_mV_Cal) - 49.655234285756165 - correccion;

    float dt = 0.01f; // 1 ms fijo
    float error = setPoint - tempPatron;
    float pidOut = calcularPID(tempPatron, dt);

    // Lógica de control de la bomba
    if (pidOut > 0.0f) {
      dutyCycle = constrain(pidOut, 0.0f, 100.0f);
    } else {
      dutyCycle = 0.0f;
      resetIntegral();
    }

    actualizarPWM();
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

    static int count = 0;
    if (count == 0) {
      // iniciar array JSON
      idx = 0;
      // Añadir corchete de apertura para formar un array JSON válido
      idx += snprintf(linea + idx, sizeof(linea) - idx, "[");
    }

    // objeto JSON por muestra (usar coma como separador)
    idx += snprintf(linea + idx, sizeof(linea) - idx,
                     "{\"Temp_patron\":%.2f,\"adc_mV_cal\":%.2f, \"TempTermist\":%.2f, \"err\":%.2f,\"SP\":%.2f}%s",
                     tempPatron, adc_mV_Cal, tempCal, error, setPoint,
                     (count + 1 == NUM_DATOS) ? "" : "," );

    count++;

    if (count == NUM_DATOS) {
      // cerrar array JSON y enviar (println añade '\r\n')
      idx += snprintf(linea + idx, sizeof(linea) - idx, "]");
      Serial.println(linea);
      idx = 0;
      count = 0;
    }
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial);

  // --- Configurar ADC con driver-ng ---
  adc1_config_width(ADC_WIDTH_BIT_12);
  adc1_config_channel_atten(ADC_CHANNEL,  ADC_ATTEN_DB_11);
  adc1_config_channel_atten(ADC_CHANNEL2, ADC_ATTEN_DB_11);
  esp_adc_cal_characterize(ADC_UNIT_1,
                           ADC_ATTEN_DB_11,
                           ADC_WIDTH_BIT_12,
                           DEFAULT_VREF,
                           &adc_chars);

  // --- PWM y timer ---
  inicializarPWM();
  actualizarPWM();
  xTaskCreatePinnedToCore(taskControl, "taskControl", 4096, NULL, 2, &taskHandle, 0);

  Serial.println("Sistema de control de nivel listo.");
  Serial.println("Envie comandos: FP=valor DC=valor KP=valor KI=valor KD=valor SP=valor");
}

void loop() {
  // 1) Procesar comandos seriales
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    procesarComando(cmd);
  }
}

float calcularPID(float measurement, float dt) {
  // 1) Error
  float error = setPoint - measurement;

  // 2) Integral en ventana móvil
  sumErr -= errBuf[bufIdx];
  errBuf[bufIdx] = error * dt;
  sumErr += errBuf[bufIdx];
  bufIdx = (bufIdx + 1) % N;
  float integralTerm = Ki * sumErr;

  // 3) Derivada con filtro exponencial
  static float prevMeas = measurement;
  static float derivFilt = 0.0f;
  const float alpha = 0.01f;
  float derivRaw = -(measurement - prevMeas) / dt;
  derivFilt = alpha * derivRaw + (1 - alpha) * derivFilt;
  prevMeas = measurement;
  float derivativeTerm = Kd * derivFilt;

  // 4) Salida PID
  float output = Kp * error
               + integralTerm
               + derivativeTerm;

  // 5) Saturar la salida
  // 5) Limitar la salida (positivo: llenar, negativo: vaciar)
  if (output > 100.0f) output = 100.0f;
  if (output < -100.0f) output = -100.0f;
  return output;
}

void inicializarPWM() {
  // Configura timer LEDC
  ledc_timer_config_t tcfg = {
    .speed_mode       = LEDC_HIGH_SPEED_MODE,
    .duty_resolution  = PWM_RESOLUTION,
    .timer_num        = PWM_TIMER,
    .freq_hz          = (uint32_t)freqPWM,
    .clk_cfg          = LEDC_AUTO_CLK
  };
  ledc_timer_config(&tcfg);

  // Configura canal LEDC
  ledc_channel_config_t ccfg = {
    .gpio_num       = pwmPin,
    .speed_mode     = LEDC_HIGH_SPEED_MODE,
    .channel        = PWM_CHANNEL,
    .intr_type      = LEDC_INTR_DISABLE,
    .timer_sel      = PWM_TIMER,
    .duty           = 0,
    .hpoint         = 0
  };
  ledc_channel_config(&ccfg);

  // Configurar GPTimer a 1 MHz para 1 ms de muestreo
  gptimer_config_t gcfg = {
    .clk_src      = GPTIMER_CLK_SRC_DEFAULT,
    .direction    = GPTIMER_COUNT_UP,
    .resolution_hz = 1'000'000
  };
  gptimer_new_timer(&gcfg, &gptimer);
  gptimer_alarm_config_t aconf = {
    .alarm_count = (uint64_t)SAMPLE_PERIOD_MS * 1000ULL,
    .reload_count = 0,
    .flags = { .auto_reload_on_alarm = true }
  };
  gptimer_set_alarm_action(gptimer, &aconf);
  gptimer_event_callbacks_t cbs = { .on_alarm = onTimer };
  gptimer_register_event_callbacks(gptimer, &cbs, NULL);
  gptimer_enable(gptimer);
  gptimer_start(gptimer);
}

void actualizarPWM() {
  portENTER_CRITICAL(&timerMux);
    uint32_t duty = (uint32_t)((dutyCycle/100.0f)*((1<<PWM_RESOLUTION)-1));
    if (ledc_get_freq(LEDC_HIGH_SPEED_MODE, PWM_TIMER) != (uint32_t)freqPWM)
      ledc_set_freq(LEDC_HIGH_SPEED_MODE, PWM_TIMER, (uint32_t)freqPWM);
    ledc_set_duty(LEDC_HIGH_SPEED_MODE, PWM_CHANNEL, duty);
    ledc_update_duty(LEDC_HIGH_SPEED_MODE, PWM_CHANNEL);
  portEXIT_CRITICAL(&timerMux);
}

void procesarComando(const String &cmd) {
  int idx = cmd.indexOf('=');
  if (idx < 0) { Serial.println("ERROR"); return; }
  String p = cmd.substring(0,idx), v = cmd.substring(idx+1);
  float  val = v.toFloat();
  
  portENTER_CRITICAL(&timerMux);
    if      (p.equalsIgnoreCase("FP")) freqPWM   = val, actualizarPWM();
    else if (p.equalsIgnoreCase("DC")) dutyCycle = val, actualizarPWM();
    else if (p.equalsIgnoreCase("KP")) Kp        = val;
    else if (p.equalsIgnoreCase("KI")) Ki        = val;
    else if (p.equalsIgnoreCase("KD")) Kd        = val;
    else if (p.equalsIgnoreCase("SP")) setPoint  = val;
    else if (p.equalsIgnoreCase("ESTADO")) estado = val;
    
  portEXIT_CRITICAL(&timerMux);
  Serial.println("OK");
}

bool IRAM_ATTR onTimer(gptimer_handle_t, const gptimer_alarm_event_data_t*, void*) {
  BaseType_t xHigherPriorityTaskWoken = pdFALSE;
  vTaskNotifyGiveFromISR(taskHandle, &xHigherPriorityTaskWoken);
  return xHigherPriorityTaskWoken == pdTRUE;
}

void resetIntegral() {
  for (int i = 0; i < N; ++i) errBuf[i] = 0.0f;
  bufIdx = 0;
  sumErr = 0.0f;
}
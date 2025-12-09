/*
 * Control de Temperatura (PWM) con Umbral y Lectura de LDR
 * MODIFICACIÓN: Salida de datos en formato JSON
 */

// --- Definición de Pines ---
const int pinTermistor = 32; // Entrada voltaje termistor
const int pinLDR = 33;       // Entrada voltaje fotorresistencia
const int pinPWM = 25;       // Salida hacia la base del transistor

// --- Configuración del PWM ---
const int frecuencia = 5000; // 5 KHz
const int resolucion = 8;    // 8 bits (0-255)

// Variables
int lecturaTemp = 0;
int lecturaLDR = 0;
int cicloTrabajo = 0;

void setup() {
  Serial.begin(115200);
  
  pinMode(pinTermistor, INPUT);
  pinMode(pinLDR, INPUT);

  // --- CONFIGURACIÓN PWM (Versión 3.0+) ---
  ledcAttach(pinPWM, frecuencia, resolucion);

  Serial.println("--- Sistema Iniciado con Umbral > 1700 ---");
}

void loop() {
  // 1. Lectura del Termistor
  lecturaTemp = analogRead(pinTermistor); 
  
  // --- LÓGICA DEL UMBRAL ---
  if (lecturaTemp < 1700) {
    // Si la temperatura es baja (menos de 1700), apagamos todo.
    cicloTrabajo = 0;
  } else {
    // Si supera 1700, calculamos el PWM proporcional.
    cicloTrabajo = map(lecturaTemp, 1700, 4095, 0, 255);
  }

  // Asegurarnos de que no se pase de 255
  cicloTrabajo = constrain(cicloTrabajo, 0, 255);

  // --- ESCRIBIR PWM ---
  ledcWrite(pinPWM, cicloTrabajo);

  // 2. Lectura de la Fotorresistencia (LDR)
  lecturaLDR = analogRead(pinLDR);
  float voltajeLDR = (lecturaLDR * 3.3) / 4095.0;

  // 3. Monitor Serial (FORMATO JSON)
  // Estructura: {"temp_adc": 1234, "pwm_duty": 100, "ldr_adc": 2000, "ldr_voltage": 1.65}
  
  Serial.print("{\"temp_adc\":");
  Serial.print(lecturaTemp);
  Serial.print(",\"pwm_duty\":");
  Serial.print(cicloTrabajo);
  Serial.print(",\"ldr_adc\":");
  Serial.print(lecturaLDR);
  Serial.print(",\"ldr_voltage\":");
  Serial.print(voltajeLDR);
  Serial.println("}"); // Cierra el JSON y salto de línea

  delay(100);
}
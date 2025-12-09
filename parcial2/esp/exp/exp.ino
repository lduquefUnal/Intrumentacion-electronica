/*
 * Control de Temperatura (PWM) con Umbral y Lectura de LDR
 * MODIFICACIÓN: Salida JSON con valores en corchetes []
 */

// --- Definición de Pines ---
const int pinTermistor = 32; 
const int pinLDR = 33;       
const int pinPWM = 25;       

// --- Configuración del PWM ---
const int frecuencia = 5000; 
const int resolucion = 8;    

// --- CALIBRACIÓN DE UMBRAL ---
const int UMBRAL = 1750;

// Variables
int lecturaTemp = 0;
int lecturaLDR = 0;
int cicloTrabajo = 0;

void setup() {
  Serial.begin(115200);
  
  pinMode(pinTermistor, INPUT);
  pinMode(pinLDR, INPUT);

  ledcAttach(pinPWM, frecuencia, resolucion);

  Serial.println("--- Sistema Iniciado ---");
}

void loop() {
  // 1. Lectura del Termistor
  lecturaTemp = analogRead(pinTermistor); 
  
  // Lógica del Umbral
  if (lecturaTemp < UMBRAL) {
    cicloTrabajo = 0;
  } else {
    cicloTrabajo = map(lecturaTemp, UMBRAL, 4095, 0, 255);
  }
  cicloTrabajo = constrain(cicloTrabajo, 0, 255);

  // Escribir PWM
  ledcWrite(pinPWM, cicloTrabajo);

  // 2. Lectura de la Fotorresistencia
  lecturaLDR = analogRead(pinLDR);
  float voltajeLDR = (lecturaLDR * 3.3) / 4095.0;

  // 3. Monitor Serial (FORMATO JSON CON CORCHETES)
  // Estructura deseada: {"temp_adc":[1846],"pwm_duty":[15], ...}

  Serial.print("{\"temp_adc\":[");      // Abre JSON y corchete
  Serial.print(lecturaTemp);
  
  Serial.print("],\"pwm_duty\":[");     // Cierra anterior, coma, abre nuevo
  Serial.print(cicloTrabajo);
  
  Serial.print("],\"ldr_adc\":[");      // Cierra anterior, coma, abre nuevo
  Serial.print(lecturaLDR);
  
  Serial.print("],\"ldr_voltage\":[");  // Cierra anterior, coma, abre nuevo
  Serial.print(voltajeLDR);
  
  Serial.println("]}");                 // Cierra último corchete y llave JSON

  delay(100);
}
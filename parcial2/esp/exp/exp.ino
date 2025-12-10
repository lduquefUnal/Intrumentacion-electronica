/*
 * PROYECTO FINAL: Control Termistor y Corte por LDR
 * HARDWARE: ESP32 (38 Pines)
 * - Entrada Temp: GPIO 32
 * - Entrada LDR:  GPIO 33
 * - Salida PWM:   GPIO 25 (Transistor/Bombillo)
 */

// --- PINES ---
const int pinTermistor = 32; 
const int pinLDR = 33;       
const int pinPWM = 25; 

// --- CONFIGURACIÓN PWM ---
const int frecuencia = 5000; 
const int resolucion = 8;    

// --- VARIABLES DE CONTROL ---
const int UMBRAL_TEMP = 1760; // Temperatura mínima para encender
int limiteCorteLDR = 2200;    // Límite de luz inicial (se actualiza desde la web)

int lecturaTemp = 0;
int lecturaLDR = 0;
int cicloTrabajo = 0;

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(50); // Lectura rápida del puerto serial
  
  pinMode(pinTermistor, INPUT);
  pinMode(pinLDR, INPUT);

  // Configurar PWM en el GPIO25 (Sintaxis ESP32 v3.0+)
  ledcAttach(pinPWM, frecuencia, resolucion);
  
  Serial.println("--- SISTEMA LISTO ---");
}

void loop() {
  // -----------------------------------------------------------
  // 1. LEER COMANDO DESDE LA WEB (Ej: "LIMIT:2000")
  // -----------------------------------------------------------
  if (Serial.available() > 0) {
    String comando = Serial.readStringUntil('\n');
    comando.trim(); // Eliminar espacios y saltos de línea sobrantes
    
    if (comando.startsWith("LIMIT:")) {
      String valorStr = comando.substring(6); 
      limiteCorteLDR = valorStr.toInt();
    }
  }

  // -----------------------------------------------------------
  // 2. LECTURAS DE SENSORES
  // -----------------------------------------------------------
  lecturaTemp = analogRead(pinTermistor); 
  lecturaLDR = analogRead(pinLDR);

  // -----------------------------------------------------------
  // 3. LÓGICA DE CONTROL (INTERRUPCIÓN POR LUZ)
  // -----------------------------------------------------------
  
  // Si la lectura del LDR es MAYOR al límite establecido...
  if (lecturaLDR > limiteCorteLDR) {
    // ... ENTONCES: Apagado Total por seguridad/luz.
    cicloTrabajo = 0; 
  } 
  else {
    // SI NO: Calculamos brillo basado en temperatura
    if (lecturaTemp <= UMBRAL_TEMP) {
      cicloTrabajo = 0; // Apagado si hace frío
    } else {
      // Mapeo proporcional a la temperatura
      cicloTrabajo = map(lecturaTemp, UMBRAL_TEMP, 4095, 0, 255);
    }
  }

  // Asegurar que no nos pasamos de 255
  cicloTrabajo = constrain(cicloTrabajo, 0, 255);

  // ESCRIBIR EN EL GPIO25 (Salida física al transistor)
  ledcWrite(pinPWM, cicloTrabajo);

  // -----------------------------------------------------------
  // 4. ENVIAR JSON COMPLETO (Para la interfaz Web)
  // -----------------------------------------------------------
  float voltajeLDR = (lecturaLDR * 3.3) / 4095.0;

  Serial.print("{\"temp_adc\":[");
  Serial.print(lecturaTemp);
  Serial.print("],\"pwm_duty\":[");
  Serial.print(cicloTrabajo);
  Serial.print("],\"ldr_adc\":[");
  Serial.print(lecturaLDR);
  Serial.print("],\"ldr_voltage\":[");
  Serial.print(voltajeLDR);
  
  // IMPORTANTE: Enviamos el límite para que el LED de la web sepa compararlo
  Serial.print("],\"ldr_limit\":["); 
  Serial.print(limiteCorteLDR); 
  
  Serial.println("]}"); // Cierre del JSON

  delay(100);
}
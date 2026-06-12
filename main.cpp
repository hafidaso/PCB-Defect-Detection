#include <Arduino.h>
#include <LiquidCrystal_I2C.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>

// LCD I2C
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Pins
const int buzzerPin = 13;
const int ledPin = 4;

// WiFi Credentials
const char *ssid = "IDS SALE";
const char *password = "IDS@2023";

// HiveMQ Cloud Settings
const char *mqttHost = "ac6ac8bb96e444b3b796a80e83455529.s1.eu.hivemq.cloud";
const int mqttPort = 8883;
const char *mqttUser = "hivemq.webclient.1775653497883";
const char *mqttPass = "1B%.CwaP:Kdr2I93k*Ap";

// MQTT Topic
const char *TOPIC_COMMAND = "hafida/robot/twin/command";

// Defect status
bool defectDetected = false;

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

// Connect to WiFi
void connectWiFi() {
  Serial.println();
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
}

// MQTT callback
void mqttCallback(char *topic, byte *payload, unsigned int length) {
  String message = "";

  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(message);

  if (message == "DEFECT") {
    defectDetected = true;
  } else if (message == "OK") {
    defectDetected = false;
  }
}

// Reconnect MQTT
void reconnectMQTT() {
  while (!mqttClient.connected()) {

    Serial.print("Attempting MQTT connection...");

    String clientId = "ESP32Client-";
    clientId += String(random(0xffff), HEX);

    if (mqttClient.connect(clientId.c_str(), mqttUser, mqttPass)) {

      Serial.println("Connected to HiveMQ!");

      mqttClient.subscribe(TOPIC_COMMAND);

      Serial.print("Subscribed to: ");
      Serial.println(TOPIC_COMMAND);

    } else {

      Serial.print("Failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" Retrying in 5 seconds...");

      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(buzzerPin, OUTPUT);
  pinMode(ledPin, OUTPUT);

  digitalWrite(ledPin, LOW);

  // I2C Pins
  Wire.begin(21, 22); // SDA = GPIO21, SCL = GPIO22

  // LCD Init
  lcd.init();
  lcd.backlight();
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("PCB Inspector");
  lcd.setCursor(0, 1);
  lcd.print("Starting...");

  // WiFi
  connectWiFi();

  // Secure MQTT
  secureClient.setInsecure();

  mqttClient.setServer(mqttHost, mqttPort);
  mqttClient.setCallback(mqttCallback);

  delay(2000);
}

void loop() {

  // Check WiFi
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Check MQTT
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }

  mqttClient.loop();

  // Display status
  if (defectDetected) {

    digitalWrite(ledPin, HIGH);
    tone(buzzerPin, 1000);

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("PCB DEFECT!");
    lcd.setCursor(0, 1);
    lcd.print("Check Board");

  } else {

    digitalWrite(ledPin, LOW);
    noTone(buzzerPin);

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("PCB OK");
    lcd.setCursor(0, 1);
    lcd.print("No Defects");
  }

  delay(500);
}
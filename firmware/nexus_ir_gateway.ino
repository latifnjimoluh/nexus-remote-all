/**
 * 📡 Nexus Remote All — Passerelle Infrarouge ESP32 (Phase 5)
 * 
 * Ce firmware transforme une carte ESP32 en passerelle Infrarouge (IR Blaster & Learner)
 * connectée au réseau local Wi-Fi.
 * Il écoute les commandes HTTP envoyées par le serveur agent ou la PWA Nexus,
 * et pilote une LED IR pour commander les appareils classiques (TV, climatiseur, ampli).
 * 
 * Matériel requis :
 * - Carte ESP32 (ex: ESP32 DevKit v1)
 * - LED émettrice Infrarouge 940 nm (branchée sur GPIO 4 via transistor 2N2222)
 * - Récepteur Infrarouge 38 kHz type TSOP38238 ou VS1838B (branché sur GPIO 15)
 * 
 * Bibliothèques Arduino requises :
 * - IRremoteESP8266 (par David Conelis, Sébastien Warin, Mark Szabo)
 */

#include <WiFi.h>
#include <WebServer.h>
#include <IRsend.h>
#include <IRrecv.h>
#include <IRutils.h>

// ─────────────────────────────────────────────────────────────
//  Configuration Wi-Fi & Broches Matérielles
// ─────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "VOTRE_SSID_WIFI";
const char* WIFI_PASSWORD = "VOTRE_MOT_DE_PASSE";

// Broche LED Infrarouge (émission)
const uint16_t PIN_IR_LED  = 4;

// Broche Récepteur Infrarouge (apprentissage / réception)
const uint16_t PIN_IR_RECV = 15;
const uint16_t CAPTURE_BUFFER_SIZE = 1024;
const uint8_t  CAPTURE_TIMEOUT = 50; // ms

// Serveur Web embarqué sur le port 80
WebServer server(80);

// Instances IR émetteur et récepteur
IRsend irsend(PIN_IR_LED);
IRrecv irrecv(PIN_IR_RECV, CAPTURE_BUFFER_SIZE, CAPTURE_TIMEOUT, true);
decode_results results;

// Dernier code appris
String lastLearnedCode = "none";
String lastLearnedProtocol = "unknown";

// ─────────────────────────────────────────────────────────────
//  Gestionnaires d'Endpoints HTTP
// ─────────────────────────────────────────────────────────────

// GET /health
void handleHealth() {
  String json = "{";
  json += "\"status\":\"ok\",";
  json += "\"device\":\"Nexus IR Gateway\",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"uptime_ms\":" + String(millis()) + ",";
  json += "\"last_learned\":\"" + lastLearnedCode + "\"";
  json += "}";
  server.send(200, "application/json", json);
}

// GET /send?code=0x20DF10EF&protocol=nec&bits=32
// Émet un signal infrarouge vers un équipement
void handleSend() {
  if (!server.hasArg("code")) {
    server.send(400, "text/plain", "Parametre 'code' manquant (ex: ?code=0x20DF10EF)");
    return;
  }

  String codeStr = server.arg("code");
  String proto = server.hasArg("protocol") ? server.arg("protocol") : "nec";
  uint16_t bits = server.hasArg("bits") ? server.arg("bits").toInt() : 32;

  uint64_t code = strtoull(codeStr.c_str(), nullptr, 16);

  proto.toLowerCase();
  if (proto == "nec") {
    irsend.sendNEC(code, bits);
  } else if (proto == "sony") {
    irsend.sendSony(code, bits);
  } else if (proto == "rc5") {
    irsend.sendRC5(code, bits);
  } else if (proto == "rc6") {
    irsend.sendRC6(code, bits);
  } else {
    // Par défaut : NEC
    irsend.sendNEC(code, bits);
  }

  // Réactivation du récepteur après émission
  irrecv.enableIRIn();

  String reply = "{\"success\":true,\"sent\":\"" + codeStr + "\",\"protocol\":\"" + proto + "\"}";
  server.send(200, "application/json", reply);
}

// GET /learn
// Renvoie le dernier code capté par le récepteur Infrarouge
void handleLearn() {
  String json = "{";
  json += "\"code\":\"" + lastLearnedCode + "\",";
  json += "\"protocol\":\"" + lastLearnedProtocol + "\"";
  json += "}";
  server.send(200, "application/json", json);
}

// ─────────────────────────────────────────────────────────────
//  Setup & Loop
// ─────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n========================================");
  Serial.println("  📡 Nexus Remote All — ESP32 IR Gateway");
  Serial.println("========================================");

  // Initialisation émetteur et récepteur IR
  irsend.begin();
  irrecv.enableIRIn();
  Serial.println("[IR] Emetteur pret sur GPIO " + String(PIN_IR_LED));
  Serial.println("[IR] Recepteur d'apprentissage pret sur GPIO " + String(PIN_IR_RECV));

  // Connexion Wi-Fi
  Serial.print("[WiFi] Connexion a : ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint8_t timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 30) {
    delay(500);
    Serial.print(".");
    timeout++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connecte avec succes !");
    Serial.print("[WiFi] Adresse IP locale : ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] ATTENTION : Echec de connexion Wi-Fi. Verifiez vos identifiants.");
  }

  // Enregistrement des routes
  server.on("/health", handleHealth);
  server.on("/send", handleSend);
  server.on("/learn", handleLearn);

  server.begin();
  Serial.println("[HTTP] Serveur pret sur port 80");
}

void loop() {
  server.handleClient();

  // Écoute continue des signaux de télécommandes pour l'apprentissage
  if (irrecv.decode(&results)) {
    lastLearnedCode = uint64ToString(results.value, 16);
    lastLearnedProtocol = typeToString(results.decode_type);

    Serial.print("[LEARN] Signal detecte : 0x");
    Serial.print(lastLearnedCode);
    Serial.print(" (Protocole : ");
    Serial.print(lastLearnedProtocol);
    Serial.println(")");

    irrecv.resume(); // Prêt pour le prochain signal
  }
}

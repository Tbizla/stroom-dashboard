/*
 * Shelly Script (Gen2/Gen3) — publiceert elke seconde de actuele EM-meting
 * (stroom/spanning/vermogen per fase) naar MQTT, in plaats van te wachten op de
 * vaste ~15s NotifyStatus-push die de Shelly standaard gebruikt en die niet via
 * de UI valt te verkorten.
 *
 * Installatie (identiek op elke Shelly Pro 3EM, geen wijzigingen nodig per kast):
 *   1. Stel eerst Settings > MQTT > Custom MQTT prefix in zoals gebruikelijk
 *      (zie README.md stap 2) — dit script leest die waarde zelf uit.
 *   2. Ga naar Settings > Scripts > "+ Add script", plak deze hele inhoud, Save.
 *   3. Zet "Run on startup" aan en start het script.
 *
 * Publiceert naar hetzelfde topic (<prefix>/status/em:0) en in dezelfde vorm als
 * de ingebouwde NotifyStatus-push, dus Telegraf/de webapp hoeven niet aangepast
 * te worden — dit script publiceert simpelweg vaker.
 */

let PUBLISH_INTERVAL_MS = 1000;

Shelly.call("MQTT.GetConfig", {}, function (result, error_code) {
  if (error_code !== 0 || !result || !result.topic_prefix) {
    print("em-fast-publish: geen MQTT topic_prefix gevonden — stel eerst Settings > MQTT > Custom MQTT prefix in. Script stopt.");
    return;
  }

  let topic = result.topic_prefix + "/status/em:0";

  Timer.set(PUBLISH_INTERVAL_MS, true, function () {
    if (!MQTT.isConnected()) return;
    Shelly.call("EM.GetStatus", { id: 0 }, function (em, em_error_code) {
      if (em_error_code !== 0 || !em) return;
      MQTT.publish(topic, JSON.stringify(em));
    });
  });

  print("em-fast-publish: actief, publiceert elke " + PUBLISH_INTERVAL_MS + "ms naar " + topic);
});

// Central definition of every supported sensor.
// The firmware, backend, and frontend all agree on these keys.
//
// preheatSeconds: recommended warm-up before readings are trusted/stored.
//   (These are sensible defaults for a controlled dataset; tune as you like.)
// unit: display unit for the reading.
// measures: which quantity the sensor reports.
// thresholds: used to derive a human-readable status from the value.
//   Each threshold is { max, label }. The first threshold whose `max` the
//   value is <= to wins. A final { max: Infinity } catches everything else.

const SENSORS = {
  "MQ-135": {
    key: "MQ-135",
    label: "MQ-135 (Air Quality / CO₂, NH₃, benzene)",
    measures: "airQuality",
    unit: "ppm",
    // MQ heaters need a long burn-in on first use, but a per-session
    // warm-up of a few minutes is the practical preheat.
    preheatSeconds: 180,
    thresholds: [
      { max: 100, label: "Excellent" },
      { max: 200, label: "Good" },
      { max: 300, label: "Moderate" },
      { max: 400, label: "Unhealthy" },
      { max: 600, label: "Very Unhealthy" },
      { max: Infinity, label: "Hazardous" },
    ],
  },

  "MQ-5": {
    key: "MQ-5",
    label: "MQ-5 (LPG / Natural Gas)",
    measures: "gas",
    unit: "ppm",
    preheatSeconds: 180,
    thresholds: [
      { max: 200, label: "Safe" },
      { max: 1000, label: "Elevated" },
      { max: 2000, label: "High" },
      { max: Infinity, label: "Dangerous" },
    ],
  },

  "MQ-7": {
    key: "MQ-7",
    label: "MQ-7 (Carbon Monoxide)",
    measures: "co",
    unit: "ppm",
    // MQ-7 ideally cycles its heater voltage; give it a solid warm-up.
    preheatSeconds: 240,
    thresholds: [
      { max: 9, label: "Safe" },
      { max: 35, label: "Moderate" },
      { max: 100, label: "Unhealthy" },
      { max: 400, label: "Dangerous" },
      { max: Infinity, label: "Hazardous" },
    ],
  },

  "MQ-8": {
    key: "MQ-8",
    label: "MQ-8 (Hydrogen)",
    measures: "hydrogen",
    unit: "ppm",
    preheatSeconds: 180,
    thresholds: [
      { max: 100, label: "Safe" },
      { max: 1000, label: "Elevated" },
      { max: 5000, label: "High" },
      { max: Infinity, label: "Dangerous" },
    ],
  },

  "MH-Z19B": {
    key: "MH-Z19B",
    label: "MH-Z19B (NDIR CO₂)",
    measures: "co2",
    unit: "ppm",
    // NDIR needs ~3 min warm-up on each power cycle.
    preheatSeconds: 180,
    thresholds: [
      { max: 600, label: "Excellent" },
      { max: 1000, label: "Good" },
      { max: 1500, label: "Moderate" },
      { max: 2000, label: "Poor" },
      { max: Infinity, label: "Very Poor" },
    ],
  },

  "DHT11": {
    key: "DHT11",
    label: "DHT11 (Temperature & Humidity)",
    measures: "climate",
    unit: "°C / %",
    // DHT needs only a couple seconds; keep a short symbolic preheat.
    preheatSeconds: 10,
    thresholds: [
      // Status here is informational; DHT reports two values so status
      // is derived on temperature comfort.
      { max: 18, label: "Cold" },
      { max: 26, label: "Comfortable" },
      { max: 32, label: "Warm" },
      { max: Infinity, label: "Hot" },
    ],
  },
};

const SENSOR_KEYS = Object.keys(SENSORS);

function getSensor(key) {
  return SENSORS[key] || null;
}

function statusFor(sensorKey, value) {
  const s = SENSORS[sensorKey];
  if (!s || value == null || isNaN(Number(value))) return "Unknown";
  const v = Number(value);
  for (const t of s.thresholds) {
    if (v <= t.max) return t.label;
  }
  return "Unknown";
}

module.exports = { SENSORS, SENSOR_KEYS, getSensor, statusFor };

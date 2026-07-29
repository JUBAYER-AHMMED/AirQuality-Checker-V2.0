const express = require("express");
const router = express.Router();
const AirQuality = require("../models/AirQuality.model");
const { SENSORS, SENSOR_KEYS, getSensor, statusFor } = require("../config/sensors");

/*
 * ---------------------------------------------------------------------------
 * SESSION STATE MACHINE  (held in memory on the server)
 * ---------------------------------------------------------------------------
 *
 *   idle        -> nothing selected. ESP readings are IGNORED (not stored).
 *   preheating  -> user armed a sensor+location. Countdown running.
 *                  ESP readings are shown as "live/preview" but NOT stored.
 *   collecting  -> preheat finished. ESP readings are STORED to MongoDB
 *                  and shown on the dashboard.
 *
 * Frontend drives transitions:
 *   POST /api/session/arm   { location, sensor }  -> preheating
 *   POST /api/session/stop                        -> idle
 *
 * ESP drives ingest:
 *   GET  /api/session/config      -> what to read + whether to send
 *   POST /api/air-quality { ... } -> submit a reading (stored only if collecting)
 *
 * The preheat -> collecting transition happens automatically based on time.
 */

const session = {
  state: "idle", // "idle" | "preheating" | "collecting"
  location: null, // string
  sensor: null, // sensor key, e.g. "MQ-135"
  preheatSeconds: 0, // total preheat for the chosen sensor
  preheatStartedAt: null, // ms epoch when preheat began
  latestReading: null, // last reading the ESP sent (for live preview)
  espLastSeen: null, // ms epoch of last ESP contact
};

// Recompute derived fields (auto-advance from preheating -> collecting).
function refreshSession() {
  if (session.state === "preheating" && session.preheatStartedAt) {
    const elapsed = (Date.now() - session.preheatStartedAt) / 1000;
    if (elapsed >= session.preheatSeconds) {
      session.state = "collecting";
    }
  }
}

function preheatRemaining() {
  if (session.state !== "preheating" || !session.preheatStartedAt) return 0;
  const elapsed = (Date.now() - session.preheatStartedAt) / 1000;
  return Math.max(0, Math.ceil(session.preheatSeconds - elapsed));
}

// A clean snapshot of the session for API responses.
function sessionSnapshot() {
  refreshSession();
  const sensorDef = session.sensor ? getSensor(session.sensor) : null;
  return {
    state: session.state,
    location: session.location,
    sensor: session.sensor,
    sensorLabel: sensorDef ? sensorDef.label : null,
    measures: sensorDef ? sensorDef.measures : null,
    unit: sensorDef ? sensorDef.unit : null,
    preheatSeconds: session.preheatSeconds,
    preheatRemaining: preheatRemaining(),
    // true only when preheat is done and we accept storage
    storing: session.state === "collecting",
    latestReading: session.latestReading,
    espOnline: session.espLastSeen
      ? Date.now() - session.espLastSeen < 15000
      : false,
    espLastSeen: session.espLastSeen,
  };
}

/* ---------------------------------------------------------------------------
 * META: list of supported sensors (frontend builds its dropdown from this)
 * ------------------------------------------------------------------------- */
router.get("/sensors", (req, res) => {
  const list = SENSOR_KEYS.map((k) => {
    const s = SENSORS[k];
    return {
      key: s.key,
      label: s.label,
      measures: s.measures,
      unit: s.unit,
      preheatSeconds: s.preheatSeconds,
    };
  });
  res.json(list);
});

/* ---------------------------------------------------------------------------
 * FRONTEND: arm a session (pick location + sensor, start preheat)
 * ------------------------------------------------------------------------- */
router.post("/session/arm", (req, res) => {
  let { location, sensor } = req.body || {};

  // location may arrive as a string or { name }
  if (location && typeof location === "object" && location.name) {
    location = location.name;
  }
  location = (location || "").toString().trim();

  if (!location) {
    return res.status(400).json({ error: "Location is required." });
  }
  const sensorDef = getSensor(sensor);
  if (!sensorDef) {
    return res.status(400).json({
      error: "Unknown sensor. Choose one of: " + SENSOR_KEYS.join(", "),
    });
  }

  session.state = "preheating";
  session.location = location;
  session.sensor = sensorDef.key;
  session.preheatSeconds = sensorDef.preheatSeconds;
  session.preheatStartedAt = Date.now();
  session.latestReading = null;

  console.log(
    `[session] ARMED  sensor=${session.sensor} location="${location}" preheat=${session.preheatSeconds}s`
  );

  res.status(200).json(sessionSnapshot());
});

/* ---------------------------------------------------------------------------
 * FRONTEND: stop / reset the session -> idle (ESP stops being stored)
 * ------------------------------------------------------------------------- */
router.post("/session/stop", (req, res) => {
  session.state = "idle";
  session.location = null;
  session.sensor = null;
  session.preheatSeconds = 0;
  session.preheatStartedAt = null;
  session.latestReading = null;
  console.log("[session] STOPPED -> idle");
  res.status(200).json(sessionSnapshot());
});

/* ---------------------------------------------------------------------------
 * FRONTEND: poll current session status (for preheat countdown + live value)
 * ------------------------------------------------------------------------- */
router.get("/session/status", (req, res) => {
  res.json(sessionSnapshot());
});

/* ---------------------------------------------------------------------------
 * ESP: fetch what to do. Tells the board which sensor is active and whether
 * the server is currently accepting/storing readings.
 * ------------------------------------------------------------------------- */
router.get("/session/config", (req, res) => {
  refreshSession();
  session.espLastSeen = Date.now();
  const sensorDef = session.sensor ? getSensor(session.sensor) : null;
  res.json({
    active: session.state !== "idle",
    state: session.state, // idle | preheating | collecting
    sensor: session.sensor, // which sensor to read (null if idle)
    measures: sensorDef ? sensorDef.measures : null,
    // ESP may send during preheat (for live preview) but should know it
    // won't be stored yet. When collecting, readings are stored.
    storing: session.state === "collecting",
    preheatRemaining: preheatRemaining(),
  });
});

/* ---------------------------------------------------------------------------
 * ESP: submit a reading.
 *   Body: { value, humidity?, sensor? }
 *   - value:    primary numeric reading (ppm, or °C for DHT)
 *   - humidity: optional second value for DHT11
 *   - sensor:   optional; if provided must match the armed sensor
 *
 * Stored ONLY when session.state === "collecting" (preheat complete).
 * During preheat we keep it as a live preview but do not persist.
 * ------------------------------------------------------------------------- */
router.post("/air-quality", async (req, res) => {
  refreshSession();
  session.espLastSeen = Date.now();

  const body = req.body || {};

  // Accept a few field names for flexibility / backward compat.
  let value = body.value;
  if (value == null) value = body.airQuality; // legacy field name
  let humidity = body.humidity != null ? Number(body.humidity) : null;

  if (value == null || isNaN(Number(value))) {
    return res.status(400).json({ error: "Numeric 'value' is required." });
  }
  value = Number(value);

  // If no session is armed, ignore silently (200 so ESP doesn't spam errors).
  if (session.state === "idle" || !session.sensor) {
    return res.status(200).json({
      stored: false,
      state: "idle",
      message: "No active session. Reading ignored.",
    });
  }

  // If ESP reports a sensor, make sure it matches what's armed.
  if (body.sensor && body.sensor !== session.sensor) {
    return res.status(409).json({
      stored: false,
      state: session.state,
      message: `Armed sensor is ${session.sensor}, but reading was tagged ${body.sensor}.`,
    });
  }

  const sensorDef = getSensor(session.sensor);
  const status = statusFor(session.sensor, value);

  // Update live preview regardless of state.
  session.latestReading = {
    sensor: session.sensor,
    location: session.location,
    value,
    humidity,
    unit: sensorDef.unit,
    measures: sensorDef.measures,
    status,
    at: Date.now(),
  };

  // Only persist once preheat is complete.
  if (session.state !== "collecting") {
    return res.status(200).json({
      stored: false,
      state: session.state,
      preheatRemaining: preheatRemaining(),
      message: "Preheating; reading shown live but not stored yet.",
      reading: session.latestReading,
    });
  }

  try {
    const entry = new AirQuality({
      location: session.location,
      sensor: session.sensor,
      measures: sensorDef.measures,
      airQuality: value,
      humidity,
      unit: sensorDef.unit,
      status,
    });
    await entry.save();
    return res.status(201).json({
      stored: true,
      state: "collecting",
      reading: session.latestReading,
    });
  } catch (error) {
    console.error("Error saving data:", error);
    return res.status(500).json({ error: "Failed to save data" });
  }
});

/* ---------------------------------------------------------------------------
 * DATA: fetch all readings, optionally filtered by sensor and/or location.
 *   GET /api/air-quality?sensor=MQ-135&location=Lab
 * ------------------------------------------------------------------------- */
router.get("/air-quality", async (req, res) => {
  try {
    const q = {};
    if (req.query.sensor) q.sensor = req.query.sensor;
    if (req.query.location) q.location = req.query.location;
    const data = await AirQuality.find(q).sort({ timestamp: 1 });
    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

/* ---------------------------------------------------------------------------
 * SUMMARY: grouped stats per (location, sensor), with IQR outlier trimming.
 * ------------------------------------------------------------------------- */
router.get("/summary", async (req, res) => {
  try {
    const data = await AirQuality.find({});
    const grouped = {};

    data.forEach((entry) => {
      const loc = entry.location?.trim();
      const sensor = entry.sensor || "unknown";
      if (!loc) return;
      const gkey = `${loc}||${sensor}`;
      if (!grouped[gkey]) {
        grouped[gkey] = { location: loc, sensor, values: [], hum: [] };
      }
      grouped[gkey].values.push(Number(entry.airQuality));
      if (entry.humidity != null) grouped[gkey].hum.push(Number(entry.humidity));
    });

    const summary = Object.values(grouped).map((g) => {
      let nums = g.values.filter((v) => !isNaN(v)).sort((a, b) => a - b);

      // IQR outlier trimming (keeps the original project's approach).
      if (nums.length >= 4) {
        const q1 = nums[Math.floor(nums.length / 4)];
        const q3 = nums[Math.floor((nums.length * 3) / 4)];
        const iqr = q3 - q1;
        const lo = q1 - 1.5 * iqr;
        const hi = q3 + 1.5 * iqr;
        nums = nums.filter((v) => v >= lo && v <= hi);
      }

      const min = nums.length ? Math.min(...nums).toFixed(2) : "0.00";
      const max = nums.length ? Math.max(...nums).toFixed(2) : "0.00";
      const avg = nums.length
        ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)
        : "0.00";
      const avgHum = g.hum.length
        ? (g.hum.reduce((a, b) => a + b, 0) / g.hum.length).toFixed(1)
        : null;

      return {
        location: g.location,
        sensor: g.sensor,
        min,
        max,
        average: avg,
        avgHumidity: avgHum,
        samples: nums.length,
        unit: getSensor(g.sensor)?.unit || "",
        status: statusFor(g.sensor, Number(avg)),
      };
    });

    res.json(summary);
  } catch (error) {
    console.error("Error building summary:", error);
    res.status(500).json({ error: "Failed to build summary" });
  }
});

/* ---------------------------------------------------------------------------
 * LEGACY: keep the old location-update endpoint working (no-op arm helper).
 * ------------------------------------------------------------------------- */
router.post("/air-quality/location", (req, res) => {
  let location = req.body.location;
  if (location && typeof location === "object" && location.name) {
    location = location.name;
  }
  session.location = (location || "").toString().trim() || session.location;
  res.status(200).json({ message: "Location updated", location: session.location });
});

module.exports = router;

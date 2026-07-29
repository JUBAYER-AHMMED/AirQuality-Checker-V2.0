const mongoose = require("mongoose");

// One document = one accepted reading, tagged with which sensor produced it
// and the location it was collected at. Backwards compatible with the old
// { location, airQuality } shape: airQuality still holds the primary value.
const AirQualitySchema = new mongoose.Schema({
  location: { type: String, required: true }, // e.g. "Lab Room 2"

  sensor: { type: String, required: true }, // e.g. "MQ-135", "MH-Z19B", "DHT11"

  measures: { type: String }, // what the value represents: airQuality/co2/co/...

  // Primary numeric value (ppm for gas sensors, °C for DHT).
  // Named airQuality to stay compatible with the original schema/frontend.
  airQuality: { type: Number, required: true },

  // Optional second value, used by DHT11 (humidity %). null for others.
  humidity: { type: Number, default: null },

  unit: { type: String },

  status: { type: String },

  timestamp: { type: Date, default: Date.now },
});

const AirQuality = mongoose.model("AirQuality", AirQualitySchema);
module.exports = AirQuality;

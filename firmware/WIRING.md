# Wiring Guide — one sensor at a time

Connect a single sensor, run a session for it in the dashboard, then swap to the
next. The firmware auto-detects which sensor to read from the backend, so you
don't reflash between sensors — just rewire and pick the new sensor in the UI.

Pins referenced use NodeMCU / Wemos D1 mini silkscreen labels (D5, D7, D8, A0).

## Analog gas sensors — MQ-135 / MQ-5 / MQ-7 / MQ-8

All four share the same analog input, so wiring is identical; only your UI
sensor selection changes.

| Sensor pin | ESP8266 pin | Notes |
|------------|-------------|-------|
| VCC        | 5V (VIN)    | MQ heaters need ~5V to reach spec |
| GND        | GND         | common ground |
| AOUT       | A0          | analog output |
| DOUT       | (unused)    | digital threshold, not used here |

**⚠ ADC voltage:** NodeMCU / Wemos boards have a built-in divider so A0 reads
0–3.3 V. Bare ESP-12 modules read only 0–1.0 V on A0 — add your own resistor
divider on AOUT if you use a bare module, or you'll clip/damage the pin.

The MQ analog value is not ppm out of the box. The firmware maps raw ADC to a
monotonic ppm-like number; calibrate for real ppm (see README).

## MH-Z19B — CO₂ (NDIR, UART)

| Sensor pin | ESP8266 pin       | Notes |
|------------|-------------------|-------|
| VCC (Vin)  | 5V (VIN)          | needs 5V |
| GND        | GND               | common ground |
| TX         | D7 (GPIO13)       | sensor TX → ESP RX (SoftwareSerial) |
| RX         | D8 (GPIO15)       | ESP TX → sensor RX |

Baud rate is 9600 (set in firmware). The sensor's RX is 3.3 V-tolerant on most
modules; if unsure, a divider on the ESP→sensor line is safe. Give it ~3 minutes
warm-up (the default preheat) and calibrate zero-point in fresh outdoor air.

## DHT11 — temperature + humidity

| Sensor pin | ESP8266 pin  | Notes |
|------------|--------------|-------|
| VCC        | 3.3V         | 3–5V works; 3.3V is fine |
| GND        | GND          | common ground |
| DATA       | D5 (GPIO14)  | add a 10kΩ pull-up to VCC if your module lacks one |

Bare DHT11 (not on a breakout) needs a 10kΩ resistor between DATA and VCC.

## Quick swap procedure

1. Power down the ESP.
2. Disconnect the current sensor, wire the next one per the table above.
3. Power up. In the dashboard press **Stop session** if one is running.
4. Enter the location, choose the newly connected sensor, press **Start session**.
5. Watch the preheat countdown in the donut; once it hits collecting, readings
   store automatically.

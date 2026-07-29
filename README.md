# AirWatch — Multi-Sensor Air Quality Logger

AirWatch is an IoT air-quality monitoring system. An **ESP8266** reads a sensor
and sends the value to a **Node.js/Express backend**, which stores it in
**MongoDB**; a **React dashboard** shows the live value and a summary of the
collected data.

This version extends the original single-sensor (MQ-135) project into a
**six-sensor** logger. You connect **one sensor at a time**. Before any data is
saved, you use the dashboard to (1) enter a **location** and (2) select **which
sensor is connected**. The system then waits out that sensor's **preheat**
(warm-up) period — showing a live countdown — and only *after preheating* does
it display and store readings, tagged to that specific sensor.
---

## Table of contents

1. [Supported sensors](#supported-sensors)
2. [How it works (data flow)](#how-it-works-data-flow)
3. [The session state machine](#the-session-state-machine)
4. [Project structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Setup & run — Backend](#setup--run--backend)
7. [Setup & run — Frontend](#setup--run--frontend)
8. [Setup & upload — ESP8266 firmware](#setup--upload--esp8266-firmware)
9. [Using the app](#using-the-app)
10. [API reference](#api-reference)
11. [Data model](#data-model)
12. [Wiring (one sensor at a time)](#wiring-one-sensor-at-a-time)
13. [Calibration notes](#calibration-notes)
14. [Configuration reference](#configuration-reference)
15. [Deployment](#deployment)
16. [Troubleshooting](#troubleshooting)

---

## Supported sensors

| Sensor   | Measures                          | Value stored          | Unit   | Default preheat |
|----------|-----------------------------------|-----------------------|--------|-----------------|
| MQ-135   | Air quality (CO₂, NH₃, benzene)   | gas concentration     | ppm    | 180 s |
| MQ-5     | LPG / natural gas                 | gas concentration     | ppm    | 180 s |
| MQ-7     | Carbon monoxide (CO)              | gas concentration     | ppm    | 240 s |
| MQ-8     | Hydrogen (H₂)                     | gas concentration     | ppm    | 180 s |
| MH-Z19B  | Carbon dioxide (CO₂, NDIR)        | CO₂ concentration     | ppm    | 180 s |
| DHT11    | Temperature + humidity            | temperature (+ RH %)  | °C / % | 10 s  |

Preheat times, units, and status thresholds are all defined in one file:
`backend/config/sensors.js`. Change them there and every part of the system
(firmware behaviour, dashboard countdown, stored status) follows.

---

## How it works (data flow)

```
   FRONTEND (React)              BACKEND (Express + MongoDB)            ESP8266
 ┌───────────────────┐        ┌──────────────────────────────┐   ┌──────────────┐
 │ 1. Enter location │        │  In-memory session state:    │   │              │
 │    + pick sensor  │──arm──▶│    idle / preheating /       │◀──┤ GET config   │
 │                   │        │    collecting                │   │ (which sensor│
 │ 2. Watch preheat  │        │                              │   │  to read?)   │
 │    countdown in   │◀status─│  Preheat countdown +         │   │              │
 │    the donut      │        │  latest live reading         │◀──┤ POST reading │
 │                   │        │                              │   │ (value +     │
 │ 3. See live value │        │  Stores to MongoDB ONLY      │   │  humidity)   │
 │    + summary table│        │  while state = collecting    │   │              │
 └───────────────────┘        └──────────────────────────────┘   └──────────────┘
```

Key idea: **the backend is the single source of truth.** The ESP8266 does not
decide anything on its own — it asks the backend *"which sensor is active, and
are you storing yet?"*, reads that sensor, and posts the value. This is why you
never have to reflash the board when swapping sensors: you just rewire and pick
the new sensor in the dashboard.

---

## The session state machine

The backend keeps one in-memory session with three states:

| State        | Set by                          | ESP readings are…                     | Stored? |
|--------------|---------------------------------|---------------------------------------|---------|
| `idle`       | server start / **Stop session** | ignored                               | No      |
| `preheating` | **Start session** (arm)         | shown live as a *preview*             | No      |
| `collecting` | automatic when preheat elapses  | shown live **and saved**              | **Yes** |

- **idle → preheating**: user presses *Start session* with a location + sensor.
  The backend records the sensor and starts a countdown for that sensor's
  `preheatSeconds`.
- **preheating → collecting**: happens **automatically** once the elapsed time
  reaches the preheat duration. No user action needed.
- **any → idle**: user presses *Stop session* (resets everything).

During `preheating`, incoming readings update the "latest reading" preview so
the dashboard can show a live value, but nothing is written to the database
until the state flips to `collecting`.

> Note: the session lives in memory. If you restart the backend, it returns to
> `idle` and you re-arm from the dashboard.

---

## Project structure

```
Air-Quality-Checker-MultiSensor/
├── README.md                     ← this file
│
├── backend/                      Node.js + Express + Mongoose API
│   ├── config/
│   │   └── sensors.js            sensor definitions: preheat times, units,
│   │                             status thresholds (single source of truth)
│   ├── models/
│   │   └── AirQuality.model.js   Mongoose schema for a stored reading
│   ├── router/
│   │   └── sendData.route.js     ALL endpoints + the session state machine
│   ├── connection.js             MongoDB connection helper
│   ├── index.js                  Express app entry point
│   ├── package.json              backend dependencies + scripts
│   └── .env.example              copy to .env and fill in MONGODB_URI
│
├── frontend/                     React (Vite) dashboard
│   ├── src/
│   │   ├── components/
│   │   │   ├── PieDonut.jsx               the donut: preheat ring + live value
│   │   │   ├── SessionControl.jsx         location input + sensor dropdown +
│   │   │   │                              start/stop buttons
│   │   │   ├── AirQualitySummaryTable.jsx per (location, sensor) stats table
│   │   │   ├── Heading.jsx                hero heading
│   │   │   └── Navbar.jsx                 top navigation
│   │   ├── store/
│   │   │   └── dataFetch.jsx     API layer (set VITE_API_BASE here/via .env)
│   │   ├── App.jsx               app shell
│   │   ├── App.css               all styles (original palette + new UI)
│   │   └── main.jsx              React entry point
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json              frontend dependencies + scripts
│   └── .env.example              copy to .env and set VITE_API_BASE
│
└── firmware/
    ├── AirWatch_ESP8266/
    │   └── AirWatch_ESP8266.ino  ONE sketch for all six sensors
    └── WIRING.md                 detailed per-sensor wiring tables
```

---

## Prerequisites

Install these before you start:

- **Node.js 18+** (developed and tested on Node 22) and **npm**.
  Check with:
  ```bash
  node --version
  npm --version
  ```
- **MongoDB** — either a local server or a free **MongoDB Atlas** cluster.
  You need a connection string (URI).
- **Arduino IDE 1.8+ or 2.x** with the **ESP8266 board package** installed
  (for uploading the firmware).
- An **ESP8266 board** (NodeMCU or Wemos/LOLIN D1 mini recommended) and one or
  more of the supported sensors.

---

## Setup & run — Backend

```bash
# 1. Go into the backend folder
cd backend

# 2. Install dependencies (express, mongoose, cors, dotenv, axios)
npm install

# 3. Create your environment file from the template
cp .env.example .env
#    (on Windows PowerShell:  copy .env.example .env )

# 4. Edit .env and set your MongoDB connection string:
#       MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/airwatch
#       PORT=3030
#    (PORT is optional; defaults to 3030)

# 5. Start the server
npm start
```

On success you'll see:

```
Server started on port 3030
MongoDB connected
```

The API is now available at `http://localhost:3030` (base path `/api`).

Quick check:

```bash
curl http://localhost:3030/api/sensors
```

This should return the JSON list of supported sensors.

> There is no separate dev/watch script. To auto-restart on file changes during
> development, you can optionally use nodemon:
> ```bash
> npx nodemon index.js
> ```

---

## Setup & run — Frontend

```bash
# 1. Go into the frontend folder
cd frontend

# 2. Install dependencies
npm install

# 3. Point the dashboard at your backend.
#    Create a .env file with your API base URL (must end in /api):
echo "VITE_API_BASE=http://localhost:3030/api" > .env
#    (on Windows PowerShell:
#       "VITE_API_BASE=http://localhost:3030/api" | Out-File -Encoding ascii .env )

# 4. Start the Vite dev server
npm run dev
```

Vite prints a local URL (typically `http://localhost:5173`). Open it in a
browser.

**Other frontend commands:**

```bash
npm run build     # production build into dist/
npm run preview   # serve the production build locally
npm run lint      # run ESLint
```

> If you don't set `VITE_API_BASE`, the app falls back to the original hosted
> backend URL baked into `src/store/dataFetch.jsx`. For your own setup, always
> set `VITE_API_BASE`.

---

## Setup & upload — ESP8266 firmware

1. **Open the sketch**: in the Arduino IDE, open
   `firmware/AirWatch_ESP8266/AirWatch_ESP8266.ino`.

2. **Install the ESP8266 board package** (if you haven't):
   - *File → Preferences → Additional Board Manager URLs*, add:
     `http://arduino.esp8266.com/stable/package_esp8266com_index.json`
   - *Tools → Board → Boards Manager* → search **esp8266** → Install.

3. **Install required libraries** (*Tools → Manage Libraries…*):
   - **ArduinoJson** (by Benoit Blanchon)
   - **DHT sensor library** (by Adafruit)
   - **Adafruit Unified Sensor** (dependency of the DHT library)
   - *(ESP8266WiFi, ESP8266HTTPClient, SoftwareSerial ship with the ESP8266 core)*

4. **Edit the configuration** at the top of the sketch:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_SSID";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

   // Your backend base URL, INCLUDING /api, no trailing slash:
   const char* API_BASE = "https://your-backend-url.onrender.com/api";
   //  For local testing on the same network, use your PC's LAN IP, e.g.:
   //  const char* API_BASE = "http://192.168.1.50:3030/api";
   ```

5. **Select the board and port**: *Tools → Board* → **NodeMCU 1.0** (or your
   board); *Tools → Port* → the COM/tty port for your board.

6. **Upload** (the → arrow). Open *Tools → Serial Monitor* at **115200 baud** to
   watch it connect to Wi-Fi, poll the backend, and send readings.

> **Local backend note:** an ESP on your Wi-Fi cannot reach `localhost` on your
> PC. Use your computer's LAN IP (e.g. `http://192.168.x.x:3030/api`) and make
> sure your firewall allows the connection — or deploy the backend and use its
> public URL.

---

## Using the app

1. Wire **one** sensor to the ESP8266 (see [Wiring](#wiring-one-sensor-at-a-time)).
2. Power the ESP; confirm in the Serial Monitor that it connects to Wi-Fi and
   starts polling.
3. In the dashboard:
   - Enter a **Location** (e.g. `Lab Room 2`).
   - Choose the **connected sensor** from the dropdown.
   - Press **Start session**.
4. The donut shows a **preheat countdown**. During this time you'll see a live
   *preview* value, but nothing is being stored yet.
5. When the countdown finishes, the state flips to **collecting**: the donut
   shows the live value (and humidity/status), a pulsing **● storing** badge
   appears, and readings are saved to MongoDB.
6. The **summary table** below updates with per-(location, sensor) statistics.
7. To switch sensors: press **Stop session**, power down, rewire the next
   sensor, power up, then start a new session and pick the new sensor.

---

## API reference

Base path: `/api`

### Meta
| Method | Endpoint            | Used by  | Description |
|--------|---------------------|----------|-------------|
| GET    | `/api/sensors`      | frontend | List supported sensors with their preheat times and units. |

### Session control
| Method | Endpoint               | Used by  | Body / Query | Description |
|--------|------------------------|----------|--------------|-------------|
| POST   | `/api/session/arm`     | frontend | `{ "location": "Lab", "sensor": "MQ-135" }` | Start a session; begins preheat. |
| POST   | `/api/session/stop`    | frontend | — | Reset session to `idle`. |
| GET    | `/api/session/status`  | frontend | — | Current state, preheat remaining, latest live reading, ESP online flag. |
| GET    | `/api/session/config`  | ESP8266  | — | Which sensor to read and whether the server is storing. |

### Readings & data
| Method | Endpoint            | Used by  | Body / Query | Description |
|--------|---------------------|----------|--------------|-------------|
| POST   | `/api/air-quality`  | ESP8266  | `{ "sensor": "DHT11", "value": 24.5, "humidity": 58 }` | Submit a reading. Stored only when `collecting`. `humidity` optional (DHT only). |
| GET    | `/api/air-quality`  | frontend | `?sensor=MQ-135&location=Lab` (both optional) | Fetch stored readings, sorted by time. |
| GET    | `/api/summary`      | frontend | — | Per (location, sensor) min/max/avg, average humidity, sample count, status (with IQR outlier trimming). |
| POST   | `/api/air-quality/location` | (legacy) | `{ "location": "Lab" }` | Kept for backward compatibility. |

**Example — arm a session:**
```bash
curl -X POST http://localhost:3030/api/session/arm \
  -H "Content-Type: application/json" \
  -d '{"location":"Lab Room 2","sensor":"MQ-135"}'
```

**Example — simulate an ESP reading (test without hardware):**
```bash
curl -X POST http://localhost:3030/api/air-quality \
  -H "Content-Type: application/json" \
  -d '{"sensor":"MQ-135","value":243}'
```

---

## Data model

Each stored reading is one MongoDB document (`AirQuality` collection):

| Field        | Type   | Notes |
|--------------|--------|-------|
| `location`   | String | required — where the reading was taken |
| `sensor`     | String | required — e.g. `MQ-135`, `MH-Z19B`, `DHT11` |
| `measures`   | String | what the value represents (`airQuality`, `co2`, `co`, `climate`, …) |
| `airQuality` | Number | required — primary value (ppm for gas sensors, °C for DHT). Named `airQuality` for backward compatibility. |
| `humidity`   | Number | optional — DHT humidity %; `null` for other sensors |
| `unit`       | String | display unit (`ppm`, `°C / %`) |
| `status`     | String | derived label (e.g. `Good`, `Moderate`, `Comfortable`) |
| `timestamp`  | Date   | defaults to time of insert |

---

## Wiring (one sensor at a time)

Full per-sensor tables and the important ADC voltage note are in
[`firmware/WIRING.md`](firmware/WIRING.md). Summary of the pins the firmware
expects (NodeMCU / Wemos D1 mini silkscreen labels):

- **MQ-135 / MQ-5 / MQ-7 / MQ-8** (analog): `AOUT → A0`, `VCC → 5V`, `GND → GND`.
  ⚠ On bare ESP-12 modules A0 tops out at 1.0 V — add a divider on `AOUT`.
  NodeMCU/Wemos boards already have a divider (0–3.3 V) and are fine.
- **MH-Z19B** (UART CO₂): sensor `TX → D7`, sensor `RX → D8`, `VCC → 5V`, `GND → GND`.
- **DHT11** (digital): `DATA → D5`, `VCC → 3.3V`, `GND → GND`
  (add a 10 kΩ pull-up from DATA to VCC if your module lacks one).

---

## Calibration notes

- **MQ sensors** output an analog *voltage*, not ppm. The firmware converts the
  raw ADC to a monotonic ppm-like number with a simple linear placeholder
  (`readMQppm`) so the dashboard is meaningful out of the box. For a real
  dataset, calibrate `Ro` in clean air and apply the sensor's datasheet curve.
  MQ sensors also want a long first-use **burn-in (24–48 h)** beyond the
  per-session preheat.
- **MH-Z19B** returns true ppm over UART; give it ~3 minutes warm-up per power
  cycle (the default preheat), and do zero-point calibration in fresh outdoor
  air (~400 ppm).
- **DHT11** is digital and needs only a couple of seconds.

---

## Configuration reference

| What | Where | Example |
|------|-------|---------|
| MongoDB URI, port | `backend/.env` | `MONGODB_URI=…`, `PORT=3030` |
| Sensor preheat times, units, thresholds | `backend/config/sensors.js` | `preheatSeconds: 180` |
| Frontend → backend URL | `frontend/.env` | `VITE_API_BASE=http://localhost:3030/api` |
| Wi-Fi + backend URL for the board | top of `AirWatch_ESP8266.ino` | `WIFI_SSID`, `API_BASE` |
| ESP poll / send intervals | top of `AirWatch_ESP8266.ino` | `CONFIG_INTERVAL`, `SEND_INTERVAL` |

---

## Deployment

- **Backend**: deploy to any Node host (Render, Railway, Fly.io, a VPS…). Set
  the `MONGODB_URI` environment variable there. Note the public URL.
- **Frontend**: build with `npm run build` and host the `dist/` folder on any
  static host (Netlify, Vercel, GitHub Pages, Render Static). Set
  `VITE_API_BASE` to your deployed backend's `/api` URL at build time.
- **Firmware**: set `API_BASE` to the deployed backend URL (with `/api`). For
  HTTPS backends the sketch uses `setInsecure()` to skip certificate validation,
  which is the simplest option for a hobby project.

---

## Troubleshooting

- **Dashboard shows "ESP offline"** — the backend hasn't heard from the board in
  ~15 s. Check the Serial Monitor: is Wi-Fi connected? Is `API_BASE` correct and
  reachable from the board's network?
- **Readings never store** — you must finish preheating. Confirm the donut has
  reached the **collecting** state (● storing badge). Also confirm the sensor
  you selected matches the one wired: the backend rejects a reading whose
  `sensor` doesn't match the armed sensor (HTTP 409).
- **Board can't reach a local backend** — `localhost` on your PC is not
  reachable from the ESP. Use your PC's LAN IP and open the firewall, or deploy
  the backend.
- **MongoDB connection failed** — check `MONGODB_URI`, and for Atlas make sure
  your IP is allow-listed in the cluster's Network Access settings.
- **MQ values look flat or wrong** — remember the ADC voltage limit on bare
  ESP-12 modules, and that MQ output needs calibration for true ppm.
- **CORS errors in the browser** — the backend enables CORS for all origins by
  default; if you changed that, re-enable it for your frontend origin.

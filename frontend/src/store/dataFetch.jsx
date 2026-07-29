import { createContext } from "react";
import axios from "axios";

// Backend base URL. Override with a Vite env var when deploying:
//   VITE_API_BASE=https://your-backend.onrender.com/api
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://airquality-checker-v2-0.onrender.com/api";

export const DataContext = createContext({
  API_BASE,
  GetSensors: async () => [],
  GetReadings: async () => [],
  GetSummary: async () => [],
  GetSessionStatus: async () => null,
  ArmSession: async () => null,
  StopSession: async () => null,
});

const DataProvider = ({ children }) => {
  // List of supported sensors (for the dropdown).
  const GetSensors = async () => {
    try {
      const res = await axios.get(`${API_BASE}/sensors`);
      return Array.isArray(res.data) ? res.data : [];
    } catch (e) {
      console.error("GetSensors failed:", e);
      return [];
    }
  };

  // Stored readings, optionally filtered by sensor/location.
  const GetReadings = async ({ sensor, location } = {}) => {
    try {
      const params = {};
      if (sensor) params.sensor = sensor;
      if (location) params.location = location;
      const res = await axios.get(`${API_BASE}/air-quality`, { params });
      return Array.isArray(res.data) ? res.data : [];
    } catch (e) {
      console.error("GetReadings failed:", e);
      return [];
    }
  };

  const GetSummary = async () => {
    try {
      const res = await axios.get(`${API_BASE}/summary`);
      return Array.isArray(res.data) ? res.data : [];
    } catch (e) {
      console.error("GetSummary failed:", e);
      return [];
    }
  };

  // Live session status: preheat countdown, live preview value, storing flag.
  const GetSessionStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/session/status`);
      return res.data;
    } catch (e) {
      console.error("GetSessionStatus failed:", e);
      return null;
    }
  };

  // Arm a session: choose location + sensor, start preheat.
  const ArmSession = async (location, sensor) => {
    const res = await axios.post(`${API_BASE}/session/arm`, {
      location,
      sensor,
    });
    return res.data;
  };

  // Stop / reset the session.
  const StopSession = async () => {
    const res = await axios.post(`${API_BASE}/session/stop`, {});
    return res.data;
  };

  return (
    <DataContext.Provider
      value={{
        API_BASE,
        GetSensors,
        GetReadings,
        GetSummary,
        GetSessionStatus,
        ArmSession,
        StopSession,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};

export default DataProvider;

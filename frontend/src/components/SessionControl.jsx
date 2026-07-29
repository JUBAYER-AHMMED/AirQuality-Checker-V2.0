import { useContext, useEffect, useState } from "react";
import { DataContext } from "../store/dataFetch";

// Panel where the user picks a LOCATION and which SENSOR is connected,
// then arms the session (which begins the preheat countdown on the backend).
const SessionControl = ({ session, onSessionChange }) => {
  const { GetSensors, ArmSession, StopSession } = useContext(DataContext);

  const [sensors, setSensors] = useState([]);
  const [location, setLocation] = useState("");
  const [sensor, setSensor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    GetSensors().then((list) => {
      setSensors(list);
      if (list.length && !sensor) setSensor(list[0].key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = session && session.state && session.state !== "idle";

  const handleArm = async () => {
    setError("");
    if (!location.trim()) {
      setError("Enter a location first.");
      return;
    }
    if (!sensor) {
      setError("Choose a sensor.");
      return;
    }
    setBusy(true);
    try {
      const snap = await ArmSession(location.trim(), sensor);
      onSessionChange && onSessionChange(snap);
    } catch (e) {
      setError(e?.response?.data?.error || "Failed to start session.");
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      const snap = await StopSession();
      onSessionChange && onSessionChange(snap);
    } catch (e) {
      setError("Failed to stop session.");
    } finally {
      setBusy(false);
    }
  };

  const selectedMeta = sensors.find((s) => s.key === sensor);

  return (
    <div className="session-panel">
      <div className="session-row">
        <label className="session-field">
          <span className="session-label">Location</span>
          <input
            type="text"
            className="session-input"
            placeholder="e.g. Lab Room 2"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={active || busy}
          />
        </label>

        <label className="session-field">
          <span className="session-label">Connected sensor</span>
          <select
            className="session-input session-select"
            value={sensor}
            onChange={(e) => setSensor(e.target.value)}
            disabled={active || busy}
          >
            {sensors.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedMeta && !active && (
        <p className="session-hint">
          Preheat time: <strong>{selectedMeta.preheatSeconds}s</strong> ·
          measures <strong>{selectedMeta.measures}</strong> (
          {selectedMeta.unit})
        </p>
      )}

      {error && <p className="session-error">{error}</p>}

      <div className="session-actions">
        {!active ? (
          <button
            className="session-btn session-btn--start"
            onClick={handleArm}
            disabled={busy}
          >
            {busy ? "Starting…" : "Start session"}
          </button>
        ) : (
          <button
            className="session-btn session-btn--stop"
            onClick={handleStop}
            disabled={busy}
          >
            {busy ? "Stopping…" : "Stop session"}
          </button>
        )}
      </div>
    </div>
  );
};

export default SessionControl;

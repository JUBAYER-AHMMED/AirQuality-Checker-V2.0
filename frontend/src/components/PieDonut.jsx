import { useContext, useEffect, useState, useRef } from "react";
import { DataContext } from "../store/dataFetch";
import ScrollReveal from "scrollreveal";
import SessionControl from "./SessionControl";

// Central hero: the donut. It shows one of three faces:
//   idle        -> "AirWatch" label, waiting to start
//   preheating  -> ring fills as preheat counts down + live preview value
//   collecting  -> live value in ppm/°C, ring full, "storing" badge
const PieDonut = () => {
  const { GetSessionStatus } = useContext(DataContext);
  const [session, setSession] = useState({ state: "idle" });
  const revealDone = useRef(false);

  // ScrollReveal once
  useEffect(() => {
    if (revealDone.current) return;
    revealDone.current = true;
    const sr = ScrollReveal({
      origin: "top",
      distance: "60px",
      duration: 1000,
      delay: 100,
      reset: false,
    });
    sr.reveal(".charts");
  }, []);

  // Poll session status every second (drives countdown + live value).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const snap = await GetSessionStatus();
      if (alive && snap) setSession(snap);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = session?.state || "idle";
  const isPreheating = state === "preheating";
  const isCollecting = state === "collecting";

  // Preheat progress 0..1 (how much of the ring is "done").
  const total = session?.preheatSeconds || 0;
  const remaining = session?.preheatRemaining || 0;
  const progress = total > 0 ? Math.min(1, (total - remaining) / total) : 0;
  const progressDeg = Math.round(progress * 360);

  // Live reading value (during preheat = preview, during collecting = stored).
  const reading = session?.latestReading;
  const value = reading?.value;
  const humidity = reading?.humidity;
  const unit = session?.unit || reading?.unit || "";
  const isDHT = session?.sensor === "DHT11";

  // Center text of the donut, per state.
  const renderCenter = () => {
    if (isPreheating) {
      return (
        <div className="donut-center">
          <div className="preheat-count">{remaining}s</div>
          <div className="preheat-label">Preheating…</div>
          {value != null && (
            <div className="preheat-preview">
              {value}
              {unit && <span className="unit"> {unit}</span>}
              <span className="preview-tag">preview</span>
            </div>
          )}
        </div>
      );
    }
    if (isCollecting) {
      return (
        <div className="donut-center">
          {value != null ? (
            <>
              <div className="value-main">
                {value}
                {isDHT ? "°C" : ""}
                {!isDHT && unit && <span className="unit"> {unit}</span>}
              </div>
              {isDHT && humidity != null && (
                <div className="value-sub">{humidity}% RH</div>
              )}
              {reading?.status && (
                <div className="value-status">{reading.status}</div>
              )}
            </>
          ) : (
            <div className="name">Waiting for sensor…</div>
          )}
        </div>
      );
    }
    // idle
    return <div className="name">AirWatch</div>;
  };

  // Ring style: while preheating we sweep the gradient by `progressDeg`.
  // Idle/collecting keep the original full 4-color donut look.
  const ringStyle = isPreheating
    ? {
        backgroundImage: `radial-gradient(white 40%, transparent 0 70%, white 0),
          conic-gradient(
            var(--c1) 0deg ${progressDeg}deg,
            rgba(0,0,0,0.08) ${progressDeg}deg 360deg
          )`,
      }
    : undefined; // falls back to CSS .donut default gradient

  return (
    <section className="pie-section">
      <figure className="charts">
        <div
          className={`pie donut ${isPreheating ? "donut--preheat" : ""} ${
            isCollecting ? "donut--live" : ""
          }`}
          style={ringStyle}
        >
          <div className="donut-face">{renderCenter()}</div>
        </div>
      </figure>

      {/* Session meta line under the donut */}
      {state !== "idle" && (
        <div className="session-meta">
          <span className="meta-chip meta-chip--sensor">
            {session.sensorLabel || session.sensor}
          </span>
          <span className="meta-chip meta-chip--loc">
            {session.location || "—"}
          </span>
          <span
            className={`meta-chip ${
              session.espOnline ? "meta-chip--online" : "meta-chip--offline"
            }`}
          >
            ESP {session.espOnline ? "online" : "offline"}
          </span>
          {isCollecting && (
            <span className="meta-chip meta-chip--storing">● storing</span>
          )}
        </div>
      )}

      {/* Location + sensor selector + start/stop */}
      <SessionControl session={session} onSessionChange={setSession} />
    </section>
  );
};

export default PieDonut;

import { useContext, useEffect, useState } from "react";
import { DataContext } from "../store/dataFetch";

// Per (location, sensor) summary of stored readings.
function AirQualitySummaryTable() {
  const { GetSummary } = useContext(DataContext);
  const [summary, setSummary] = useState([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const data = await GetSummary();
      if (alive) setSummary(Array.isArray(data) ? data : []);
    };
    load();
    const id = setInterval(load, 5000); // refresh periodically
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusClass = (status) => {
    switch (status) {
      case "Excellent":
      case "Safe":
      case "Comfortable":
        return "text-green-600";
      case "Good":
        return "text-green-600";
      case "Moderate":
      case "Elevated":
      case "Warm":
        return "text-yellow-600";
      case "Unhealthy":
      case "Poor":
      case "High":
      case "Hot":
        return "text-orange-600";
      case "Very Unhealthy":
      case "Very Poor":
      case "Dangerous":
        return "text-red-600";
      default:
        return "text-purple-800";
    }
  };

  return (
    <div className="p-4 dtable">
      <h2 className="text-xl font-bold mb-4">📊 Sensor Readings Summary</h2>
      <table className="w-full table-auto border-collapse border border-gray-400 summary-table">
        <thead>
          <tr className="bg-gray-200">
            <th className="border p-2">Location</th>
            <th className="border p-2">Sensor</th>
            <th className="border p-2">Min</th>
            <th className="border p-2">Max</th>
            <th className="border p-2">Average</th>
            <th className="border p-2">Humidity</th>
            <th className="border p-2">Samples</th>
            <th className="border p-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {Array.isArray(summary) && summary.length > 0 ? (
            summary.map((item, index) => (
              <tr key={index} className="text-center">
                <td className="border p-2">{item.location}</td>
                <td className="border p-2">{item.sensor}</td>
                <td className="border p-2">
                  {item.min}
                  {item.unit ? ` ${item.unit}` : ""}
                </td>
                <td className="border p-2">
                  {item.max}
                  {item.unit ? ` ${item.unit}` : ""}
                </td>
                <td className="border p-2">
                  {item.average}
                  {item.unit ? ` ${item.unit}` : ""}
                </td>
                <td className="border p-2">
                  {item.avgHumidity != null ? `${item.avgHumidity}%` : "—"}
                </td>
                <td className="border p-2">{item.samples}</td>
                <td className={`border p-2 font-semibold ${statusClass(item.status)}`}>
                  {item.status}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="8" className="text-center p-4">
                No data available yet. Start a session and finish preheating to
                collect readings.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default AirQualitySummaryTable;

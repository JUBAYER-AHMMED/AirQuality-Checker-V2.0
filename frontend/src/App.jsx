import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import PieDonut from "./components/PieDonut";
import DataProvider from "./store/dataFetch";
import Heading from "./components/Heading";
import NavBar from "./components/Navbar";
import AirQualitySummaryTable from "./components/AirQualitySummaryTable";

function App() {
  return (
    <div className="main">
      <DataProvider>
        <NavBar />
        <div className="container">
          <Heading />
          <PieDonut />
        </div>

        <AirQualitySummaryTable />
      </DataProvider>
    </div>
  );
}

export default App;

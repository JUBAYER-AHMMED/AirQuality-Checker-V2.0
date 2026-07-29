require("dotenv").config();
const express = require("express");
const cors = require("cors");
const router = require("./router/sendData.route");
const { connectToDB } = require("./connection");
const AirQuality = require("./models/AirQuality.model");

const app = express();
const PORT = process.env.PORT || 3030;

// Middleware
app.use(cors()); // Enable CORS for all origins
app.use(express.json());

// Connect to MongoDB
connectToDB(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection failed:", err));

// Routes
app.use("/api", router);

// Root route: dump all stored readings (handy for quick inspection)
app.get("/", async (req, res) => {
  try {
    const data = await AirQuality.find().sort({ timestamp: 1 });
    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).send({ error: "Failed to fetch data" });
  }
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

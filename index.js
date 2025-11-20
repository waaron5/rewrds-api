// index.js — Production Ready API Server (CommonJS)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const pool = require("./db");

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();

// ===========================
//        FIXED CORS
// ===========================
app.use(cors({
    origin: ["https://rewrds.vercel.app", "http://localhost:3000"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
}));

// Explicit preflight handler
app.options("*", cors());

// Parse JSON request bodies
app.use(express.json());

// Inject the database pool into the app (accessible in all routes)
app.set("db", pool);

// ===========================
//          ROUTES
// ===========================
app.use("/score", require("./routes/score"));
app.use("/cards", require("./routes/card"));

// Simple health check route
app.get("/", (req, res) => {
    res.json({ status: "REWRDS API is live", online: true });
});

// ===========================
//      START SERVER
// ===========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 REWRDS API running on port ${PORT}`);
});

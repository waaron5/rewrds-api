// index.js — Consistent CommonJS version

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config();

const app = express();

// Middleware
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// Database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Make pool available globally
app.set("db", pool);

// ROUTES
const scoreRoutes = require("./routes/score");
const cardRoutes = require("./routes/card");

app.use("/score", scoreRoutes);
app.use("/cards", cardRoutes);

// Health Check
app.get("/", (req, res) => {
    res.json({ status: "REWRDS API is live", online: true });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
    console.log(`🚀 REWRDS API running on port ${PORT}`)
);

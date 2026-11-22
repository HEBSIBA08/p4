const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers & CORS
app.use(helmet());
app.use(cors());
app.use(express.json());

// Serve frontend static files if placed in a "public" folder
app.use(express.static(path.join(__dirname, "public")));

// Rate limiter for API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});
app.use("/api", apiLimiter);

// Initialize SQLite database & schema
const dbPath = path.join(__dirname, "db", "internships.db");
const schemaPath = path.join(__dirname, "db", "schema.sql");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, "utf8");
    db.exec(schemaSql, (err) => {
      if (err) console.error("Schema error:", err.message);
    });
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      internship_id INTEGER NOT NULL,
      applicant_name TEXT NOT NULL,
      email TEXT NOT NULL,
      cover_note TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (internship_id) REFERENCES internships(id)
    )
  `);
});

// GET /api/internships (parameterized pagination)
app.get("/api/internships", (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const offset = (page - 1) * limit;

  db.get("SELECT COUNT(*) AS total FROM internships", [], (countErr, countRow) => {
    if (countErr) {
      return res.status(500).json({ error: "Failed to count internships" });
    }

    db.all(
      "SELECT * FROM internships ORDER BY id DESC LIMIT ? OFFSET ?",
      [limit, offset],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: "Failed to fetch internships" });
        }
        res.json({
          data: rows,
          pagination: {
            page,
            limit,
            total: countRow.total
          }
        });
      }
    );
  });
});

// POST /api/applications (server-side validation + parameterized insert)
app.post("/api/applications", (req, res) => {
  const { internship_id, applicant_name, email, cover_note } = req.body || {};
  const errors = [];

  const parsedId = Number(internship_id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    errors.push("A valid internship selection is required.");
  }
  if (typeof applicant_name !== "string" || applicant_name.trim().length < 2) {
    errors.push("Applicant name must be at least 2 characters.");
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof email !== "string" || !emailRegex.test(email.trim())) {
    errors.push("A valid email address is required.");
  }
  if (typeof cover_note !== "string" || cover_note.trim().length < 10) {
    errors.push("Cover note must be at least 10 characters.");
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  db.get("SELECT id FROM internships WHERE id = ?", [parsedId], (lookupErr, internship) => {
    if (lookupErr) {
      return res.status(500).json({ error: "Database error while checking internship" });
    }
    if (!internship) {
      return res.status(404).json({ error: "Selected internship does not exist" });
    }

    db.run(
      `INSERT INTO applications (internship_id, applicant_name, email, cover_note)
       VALUES (?, ?, ?, ?)`,
      [parsedId, applicant_name.trim(), email.trim(), cover_note.trim()],
      function (insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: "Failed to submit application" });
        }
        res.status(201).json({
          message: "Application submitted successfully",
          applicationId: this.lastID
        });
      }
    );
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
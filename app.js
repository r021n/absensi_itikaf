const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Set up view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configure session with proper settings to prevent memory leaks
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
    rolling: true,
  })
);

// Admin credentials
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "passKotak123";

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.isAuthenticated) {
    next();
  } else {
    res.redirect("/admin/login");
  }
};

// Database setup
const db = new sqlite3.Database("reservations.db", (err) => {
  if (err) {
    console.error("Error opening database:", err);
  } else {
    console.log("Connected to SQLite database");
    // Create table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      city TEXT NOT NULL,
      number TEXT NOT NULL,
      gender TEXT NOT NULL,
      pendaftaran TEXT NOT NULL,
      reservation_date TEXT NOT NULL,
      kehadiran BOOLEAN DEFAULT 0
    )`);
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected");

  // Function to emit updated statistics
  const emitStats = async () => {
    try {
      const [totalRow, maleRow, femaleRow] = await Promise.all([
        new Promise((resolve, reject) => {
          db.get("SELECT COUNT(*) as total FROM reservations", (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        }),
        new Promise((resolve, reject) => {
          db.get(
            "SELECT COUNT(*) as male FROM reservations WHERE gender = 'laki-laki'",
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        }),
        new Promise((resolve, reject) => {
          db.get(
            "SELECT COUNT(*) as female FROM reservations WHERE gender = 'perempuan'",
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        }),
      ]);

      socket.emit("stats", {
        total: totalRow.total,
        male: maleRow.male,
        female: femaleRow.female,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  };

  // Emit initial stats
  emitStats();

  // Clean up on disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Graceful shutdown handling
process.on("SIGTERM", () => {
  console.log("Received SIGTERM. Performing graceful shutdown...");
  server.close(() => {
    console.log("HTTP server closed");
    db.close((err) => {
      if (err) {
        console.error("Error closing database:", err);
      } else {
        console.log("Database connection closed");
      }
      process.exit(0);
    });
  });
});

process.on("SIGINT", () => {
  console.log("Received SIGINT. Performing graceful shutdown...");
  server.close(() => {
    console.log("HTTP server closed");
    db.close((err) => {
      if (err) {
        console.error("Error closing database:", err);
      } else {
        console.log("Database connection closed");
      }
      process.exit(0);
    });
  });
});

// Routes
app.get("/", (req, res) => {
  res.render("halaman_awal");
});

app.get("/sisa-kuota", (req, res) => {
  res.render("sisa_kuota");
});

app.get("/quota-data", async (req, res) => {
  const today = new Date("2025-03-21");
  const endDate = new Date("2025-03-30");
  const dates = [];

  for (let d = new Date(today); d <= endDate; d.setDate(d.getDate() + 1)) {
    const currentDate = d.toISOString().split("T")[0];
    dates.push(currentDate);
  }

  const quotaData = [];

  for (const date of dates) {
    const data = await new Promise((resolve, reject) => {
      db.get(
        "SELECT COUNT(*) as total, " +
          "SUM(CASE WHEN gender = 'laki-laki' THEN 1 ELSE 0 END) as male, " +
          "SUM(CASE WHEN gender = 'perempuan' THEN 1 ELSE 0 END) as female " +
          "FROM reservations WHERE reservation_date = ? AND pendaftaran = ?",
        [date, "online"],
        (err, row) => {
          if (err) reject(err);
          resolve({
            date,
            total: row.total || 0,
            male: row.male || 0,
            female: row.female || 0,
          });
        }
      );
    });
    quotaData.push(data);
  }

  res.json(quotaData);
});

// Admin routes
app.get("/admin/login", (req, res) => {
  res.render("login_admin");
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAuthenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Username atau password salah" });
  }
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/admin/login");
});

app.get("/admin/show_registrant", isAuthenticated, (req, res) => {
  res.render("show_registrant");
});

app.get("/admin/registrants", isAuthenticated, (req, res) => {
  const { date, gender, attendance, pendaftaran } = req.query;
  let query = "SELECT * FROM reservations";
  const params = [];
  const conditions = [];

  if (date) {
    conditions.push("reservation_date = ?");
    params.push(date);
  }
  if (gender) {
    conditions.push("gender = ?");
    params.push(gender);
  }
  if (attendance !== undefined && attendance !== "") {
    conditions.push("kehadiran = ?");
    params.push(attendance === "true" ? 1 : 0);
  }
  if (pendaftaran) {
    conditions.push("pendaftaran = ?");
    params.push(pendaftaran);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows);
  });
});

app.put("/admin/registrant/:id/attendance", isAuthenticated, (req, res) => {
  const { id } = req.params;
  const { kehadiran } = req.body;

  db.run(
    "UPDATE reservations SET kehadiran = ? WHERE id = ?",
    [kehadiran, id],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json({ success: true });
    }
  );
});

app.delete("/admin/registrant/:id", isAuthenticated, (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM reservations WHERE id = ?", [id], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    io.emit("statsUpdate");
    res.json({ success: true });
  });
});

app.get("/admin/download", isAuthenticated, (req, res) => {
  const { date, gender, attendance, pendaftaran } = req.query;
  let query = "SELECT * FROM reservations";
  const params = [];
  const conditions = [];

  if (date) {
    conditions.push("reservation_date = ?");
    params.push(date);
  }
  if (gender) {
    conditions.push("gender = ?");
    params.push(gender);
  }
  if (attendance !== undefined && attendance !== "") {
    conditions.push("kehadiran = ?");
    params.push(attendance === "true" ? 1 : 0);
  }
  if (pendaftaran) {
    conditions.push("pendaftaran = ?");
    params.push(pendaftaran);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  db.all(query, params, async (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Registrants");

    worksheet.columns = [
      { header: "Nama", key: "name", width: 30 },
      { header: "Email", key: "email", width: 30 },
      { header: "Jenis Kelamin", key: "gender", width: 15 },
      { header: "Jenis Pendaftaran", key: "pendaftaran", width: 17 },
      { header: "Kota Asal", key: "city", width: 20 },
      { header: "Nomor WA", key: "number", width: 20 },
      { header: "Tanggal Reservasi", key: "reservation_date", width: 20 },
      { header: "Kehadiran", key: "kehadiran", width: 15 },
    ];

    rows.forEach((row) => {
      row.kehadiran = row.kehadiran ? "Hadir" : "Tidak Hadir";
      worksheet.addRow(row);
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=registrants.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  });
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.get("/batal-daftar", (req, res) => {
  res.render("batal_daftar");
});

app.get("/search-registrants", (req, res) => {
  const searchName = req.query.name;
  db.all(
    "SELECT * FROM reservations WHERE name LIKE ?",
    [`%${searchName}%`],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

// Create a nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "rozinabdul@student.uns.ac.id", // Replace with your email
    pass: process.env.EMAIL_PASS, // Use EMAIL_PASS from .env
  },
});

app.post("/initiate-cancellation/:id", (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM reservations WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!row) {
      return res.status(404).json({ error: "Pendaftaran tidak ditemukan" });
    }

    const cancelUrl = `${req.protocol}://${req.get("host")}/cancel/${id}`;
    const mailOptions = {
      from: "rozinabdul@student.uns.ac.id",
      to: row.email,
      subject: "Konfirmasi Pembatalan Pendaftaran Itikaf",
      html: `
        <h2>Konfirmasi Pembatalan Pendaftaran Itikaf</h2>
        <p>Anda telah meminta untuk membatalkan pendaftaran itikaf.</p>
        <p>Untuk mengkonfirmasi pembatalan, silakan klik link di bawah ini:</p>
        <p><a href="${cancelUrl}" style="padding: 10px 20px; background-color: #f44336; color: white; text-decoration: none; border-radius: 4px;">Konfirmasi Pembatalan</a></p>
        <p>Jika Anda tidak meminta pembatalan ini, Anda dapat mengabaikan email ini.</p>
      `,
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) {
        console.error(error);
        return res
          .status(500)
          .json({ error: "Gagal mengirim email konfirmasi" });
      }
      res.json({ success: true });
    });
  });
});

app.get("/cancel/:id", (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM reservations WHERE id = ?", [id], (err) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .send("Terjadi kesalahan saat membatalkan pendaftaran");
    }

    io.emit("statsUpdate");
    res.render("cancellation_success");
  });
});

app.post("/register", (req, res) => {
  const { name, email, gender, city, number, reservation_date } = req.body;
  const pendaftaran = "online";
  const maleLimit = 50;
  const femaleLimit = 70;

  // Begin transaction
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    let hasError = false;
    let quotaError = false;
    let errorDate = null;

    // Check quota for all selected dates
    const checkQuotas = reservation_date.map((date) => {
      return new Promise((resolve, reject) => {
        db.get(
          "SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND gender = ? AND pendaftaran = ?",
          [date, gender, pendaftaran],
          (err, genderRow) => {
            if (err) {
              hasError = true;
              reject(err);
            } else {
              const currentCount = genderRow.count;
              const limit = gender === "laki-laki" ? maleLimit : femaleLimit;
              if (currentCount >= limit) {
                quotaError = true;
                errorDate = date;
                reject(new Error(`Quota exceeded for date ${date}`));
              } else {
                resolve();
              }
            }
          }
        );
      });
    });

    Promise.all(checkQuotas)
      .then(() => {
        // If all quota checks pass, insert reservations for each date
        const insertPromises = reservation_date.map((date) => {
          const id = uuidv4();
          return new Promise((resolve, reject) => {
            db.run(
              "INSERT INTO reservations (id, name, email, city, number, gender, reservation_date, kehadiran, pendaftaran) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [id, name, email, city, number, gender, date, false, pendaftaran],
              (err) => {
                if (err) {
                  hasError = true;
                  reject(err);
                } else {
                  resolve();
                }
              }
            );
          });
        });

        return Promise.all(insertPromises);
      })
      .then(() => {
        if (hasError) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Database error" });
        }
        db.run("COMMIT");
        io.emit("statsUpdate");
        res.redirect("/");
      })
      .catch((error) => {
        db.run("ROLLBACK");
        if (quotaError) {
          return res.status(400).json({
            error: `Maaf, kuota untuk ${gender} pada tanggal ${errorDate} sudah penuh`,
          });
        }
        console.error(error);
        return res.status(500).json({ error: "Database error" });
      });
  });
});

app.get("/admin/add_data", isAuthenticated, (req, res) => {
  res.render("add_data");
});

app.post("/admin/add_data", isAuthenticated, (req, res) => {
  const { name, gender, reservation_date, city, number } = req.body;
  const id = uuidv4();
  const email = "main@mail.com";
  const pendaftaran = "offline";
  const kehadiran = true;

  db.run(
    "INSERT INTO reservations (id, name, email, city, number, gender, reservation_date, kehadiran, pendaftaran) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      name,
      email,
      city,
      number,
      gender,
      reservation_date,
      kehadiran,
      pendaftaran,
    ],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }
      io.emit("statsUpdate");
      res.json({ success: true });
    }
  );
});

// Catch-all middleware for undefined routes
app.use((req, res) => {
  res.status(404).render("404");
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

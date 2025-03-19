const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");
const session = require("express-session");
const ExcelJS = require("exceljs");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");
const fs = require("fs");
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

// Serve static files
app.use("/static", express.static(path.join(__dirname, "views", "static")));

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
const ADMIN_PASSWORD = "adminMSA123";

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
// Variabel untuk menyimpan cache dan timestamp
let statsCache = null;
let lastCacheTime = 0;
const CACHE_TTL = 60 * 1000; // TTL: 60 detik

// Fungsi untuk memperbarui cache dengan query database
const updateCache = async () => {
  try {
    const [maleRows, femaleRows] = await Promise.all([
      new Promise((resolve, reject) => {
        db.all(
          "SELECT name, email, city, number, gender FROM reservations WHERE gender = 'laki-laki'",
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      }),
      new Promise((resolve, reject) => {
        db.all(
          "SELECT name, email, city, number, gender FROM reservations WHERE gender = 'perempuan'",
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      }),
    ]);

    // Membuat set untuk menghilangkan duplikasi
    const maleSet = new Set(
      maleRows.map(
        (row) => `${row.name}${row.email}${row.city}${row.number}${row.gender}`
      )
    );
    const femaleSet = new Set(
      femaleRows.map(
        (row) => `${row.name}${row.email}${row.city}${row.number}${row.gender}`
      )
    );

    // Menghitung jumlah berdasarkan set
    const maleCount = maleSet.size;
    const femaleCount = femaleSet.size;
    const totalCount = maleCount + femaleCount;

    // Menyimpan hasil ke cache dan memperbarui timestamp
    statsCache = { total: totalCount, male: maleCount, female: femaleCount };
    lastCacheTime = Date.now();
  } catch (error) {
    console.error("Error fetching stats:", error);
  }
};

// Fungsi untuk mendapatkan statistik, menggunakan cache jika masih berlaku
const getStats = async () => {
  if (statsCache && Date.now() - lastCacheTime < CACHE_TTL) {
    return statsCache;
  }
  await updateCache();
  return statsCache;
};

// Socket.io connection handler
io.on("connection", async (socket) => {
  console.log("Client connected");

  // Mengirim data statistik dari cache atau hasil query terbaru
  const stats = await getStats();
  socket.emit("stats", stats);

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

// Create a nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "badarmsaofficial@gmail.com", // Replace with your email
    pass: process.env.EMAIL_PASS, // Use EMAIL_PASS from .env
  },
});

// Routes

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/itikaf", (req, res) => {
  res.render("halaman_awal");
});

app.get("/itikaf-regist-done", (req, res) => {
  res.render("after_regist_itikaf");
});

app.get("/cancel-tutorial", (req, res) => {
  res.render("cancellation_tutorial");
});

app.get("/itikaf/ketentuan-itikaf", (req, res) => {
  res.render("itikaf_rule");
});

app.get("/itikaf/sisa-kuota", (req, res) => {
  res.render("sisa_kuota");
});

app.get("/itikaf/sisa/:tanggal", async (req, res) => {
  let tanggal = req.params.tanggal; // bisa berupa "20" atau "2025-03-20"

  // Jika parameter hanya terdiri dari 1-2 digit, asumsikan itu adalah hari di bulan Maret 2025
  if (tanggal.length <= 2) {
    if (tanggal.length === 1) {
      tanggal = "0" + tanggal;
    }
    tanggal = `2025-03-${tanggal}`;
  }

  const query = `
    SELECT 
      SUM(CASE WHEN gender = 'laki-laki' THEN 1 ELSE 0 END) as male,
      SUM(CASE WHEN gender = 'perempuan' THEN 1 ELSE 0 END) as female
    FROM reservations 
    WHERE reservation_date = ?
  `;

  db.get(query, [tanggal], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    const male = row && row.male ? row.male : 0;
    const female = row && row.female ? row.female : 0;
    res.render("sisa_hari_ini", { date: tanggal, male, female });
  });
});

app.get("/itikaf/quota-data", async (req, res) => {
  // Tentukan tanggal awal dan akhir dalam format string
  const startDateStr = "2025-03-20";
  const endDateStr = "2025-03-29";

  // Buat array tanggal antara startDate dan endDate
  const dates = [];
  let current = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  while (current <= endDate) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  // Query tunggal untuk mendapatkan data semua tanggal sekaligus
  const query = `
    SELECT reservation_date, 
           COUNT(*) as total,
           SUM(CASE WHEN gender = 'laki-laki' THEN 1 ELSE 0 END) as male,
           SUM(CASE WHEN gender = 'perempuan' THEN 1 ELSE 0 END) as female
    FROM reservations 
    WHERE reservation_date BETWEEN ? AND ? 
      AND pendaftaran = ?
    GROUP BY reservation_date;
  `;

  // Menggunakan db.all untuk mengeksekusi query dan mengambil field-group
  const rows = await new Promise((resolve, reject) => {
    db.all(query, [startDateStr, endDateStr, "online"], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

  // Membuat lookup table berdasarkan tanggal untuk akses cepat
  const dataMap = {};
  rows.forEach((row) => {
    dataMap[row.reservation_date] = {
      total: row.total || 0,
      male: row.male || 0,
      female: row.female || 0,
    };
  });

  // Bangun array hasil dengan memastikan setiap tanggal memiliki entri (default 0 jika tidak ada data)
  const quotaData = dates.map((date) => {
    return {
      date,
      total: dataMap[date] ? dataMap[date].total : 0,
      male: dataMap[date] ? dataMap[date].male : 0,
      female: dataMap[date] ? dataMap[date].female : 0,
    };
  });

  res.json(quotaData);
});

app.get("/itikaf/quota-data-offline", async (req, res) => {
  const startDateStr = "2025-03-20";
  const endDateStr = "2025-03-29";

  // Buat array tanggal antara startDate dan endDate
  const dates = [];
  let current = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  while (current <= endDate) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  // Query tunggal untuk mengambil data registrasi 'offline' antara dua tanggal
  const query = `
    SELECT reservation_date, 
           COUNT(*) AS total,
           SUM(CASE WHEN gender = 'laki-laki' THEN 1 ELSE 0 END) AS male,
           SUM(CASE WHEN gender = 'perempuan' THEN 1 ELSE 0 END) AS female
    FROM reservations
    WHERE reservation_date BETWEEN ? AND ?
      AND pendaftaran = ?
    GROUP BY reservation_date;
  `;

  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(query, [startDateStr, endDateStr, "offline"], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });

    // Buat lookup table dari hasil query
    const dataMap = {};
    rows.forEach((row) => {
      dataMap[row.reservation_date] = {
        total: row.total || 0,
        male: row.male || 0,
        female: row.female || 0,
      };
    });

    // Buat output dengan memastikan semua tanggal terwakili, walaupun data kosong di database
    const quotaData = dates.map((date) => ({
      date,
      total: dataMap[date] ? dataMap[date].total : 0,
      male: dataMap[date] ? dataMap[date].male : 0,
      female: dataMap[date] ? dataMap[date].female : 0,
    }));

    res.json(quotaData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin routes
app.get("/admin/login", (req, res) => {
  if (req.session.isAuthenticated) {
    res.redirect("/admin/show_registrant");
  } else {
    res.render("login_admin");
  }
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

app.get("/itikaf/register", (req, res) => {
  res.render("register");
});

app.post("/itikaf/register", async (req, res) => {
  const { name, email, gender, city, number, reservation_date } = req.body;
  const pendaftaran = "online";
  const limits = { "laki-laki": 75, perempuan: 100 };
  const limit = limits[gender];
  const tutorBatal = `${req.protocol}://${req.get("host")}/cancel-tutorial`;

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const months = [
      "Januari",
      "Februari",
      "Maret",
      "April",
      "Mei",
      "Juni",
      "Juli",
      "Agustus",
      "September",
      "Oktober",
      "November",
      "Desember",
    ];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  const beginTransaction = () =>
    new Promise((resolve, reject) => {
      db.run("BEGIN TRANSACTION", (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  const commitTransaction = () =>
    new Promise((resolve, reject) => {
      db.run("COMMIT", (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  const rollbackTransaction = () =>
    new Promise((resolve) => {
      db.run("ROLLBACK", () => resolve());
    });

  try {
    // Mulai transaksi dan lakukan insert data
    await beginTransaction();

    // Cek quota secara agregat
    const placeholders = reservation_date.map(() => "?").join(",");
    const checkQuotaQuery = `
        SELECT reservation_date, COUNT(*) as count
        FROM reservations
        WHERE reservation_date IN (${placeholders})
          AND gender = ?
          AND pendaftaran = ?
        GROUP BY reservation_date
      `;
    const checkParams = [...reservation_date, gender, pendaftaran];
    const quotaRows = await new Promise((resolve, reject) => {
      db.all(checkQuotaQuery, checkParams, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
    const quotaMap = {};
    quotaRows.forEach((row) => {
      quotaMap[row.reservation_date] = row.count;
    });
    for (const date of reservation_date) {
      const count = quotaMap[date] || 0;
      if (count >= limit) {
        throw new Error(`kuota untuk ${formatDate(date)} sudah penuh`);
      }
    }

    // Lakukan insert untuk setiap reservation
    for (const date of reservation_date) {
      const id = uuidv4();
      await new Promise((resolve, reject) => {
        db.run(
          "INSERT INTO reservations (id, name, email, city, number, gender, reservation_date, kehadiran, pendaftaran) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, name, email, city, number, gender, date, false, pendaftaran],
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
      });
    }

    // Commit transaksi terlebih dahulu
    await commitTransaction();
    io.emit("statsUpdate");

    return res.redirect("/itikaf");
  } catch (error) {
    await rollbackTransaction();
    console.error("Error during registration:", error);
    if (error.message.startsWith("kuota untuk")) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Database error" });
  }
});

app.get("/itikaf/batal-daftar", (req, res) => {
  res.render("batal_daftar");
});

app.get("/itikaf/search-registrants", (req, res) => {
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

app.post("/itikaf/initiate-cancellation", (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Invalid request format" });
  }

  const placeholders = ids.map(() => "?").join(",");
  const query = `SELECT * FROM reservations WHERE id IN (${placeholders})`;

  db.all(query, ids, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: "Pendaftaran tidak ditemukan" });
    }

    // Helper function to format date
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      const months = [
        "Januari",
        "Februari",
        "Maret",
        "April",
        "Mei",
        "Juni",
        "Juli",
        "Agustus",
        "September",
        "Oktober",
        "November",
        "Desember",
      ];
      return `${date.getDate()} ${
        months[date.getMonth()]
      } ${date.getFullYear()}`;
    };

    const emailPromises = rows.map((row) => {
      const cancelUrl = `${req.protocol}://${req.get("host")}/cancel/${row.id}`;
      const formattedDate = formatDate(row.reservation_date);

      const mailOptions = {
        from: "badarmsaofficial@gmail.com",
        to: row.email,
        subject: `Konfirmasi Pembatalan Pendaftaran Itikaf untuk ${formattedDate}`,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
            .email-container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa; }
            .header { background-color: #4CAF50; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            .btn { display: inline-block; padding: 15px 30px; background-color: #f44336; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; transition: background-color 0.3s ease; }
            .btn:hover { background-color: #d32f2f; }
            .footer { margin-top: 20px; font-size: 14px; color: #666; text-align: center; }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <h2 style="margin: 0;">Konfirmasi Pembatalan Pendaftaran Itikaf</h2>
              <p style="margin: 10px 0 0 0;">${formattedDate}</p>
            </div>
            <div class="content">
              <p>Assalamu'alaikum Wr. Wb.</p>
              <p>Anda telah meminta untuk membatalkan pendaftaran itikaf. Untuk melanjutkan proses pembatalan, silakan klik tombol di bawah ini:</p>
              <div style="text-align: center;">
                <a href="${cancelUrl}" class="btn">Konfirmasi Pembatalan</a>
              </div>
              <p style="color: #666; font-style: italic;">Jika Anda tidak meminta pembatalan ini, Anda dapat mengabaikan email ini.</p>
              <div class="footer">
                <p>Email ini dikirim secara otomatis, mohon untuk tidak membalas email ini.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      };

      return new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error) => {
          if (error) {
            console.error(`Failed to send email to ${row.email}:`, error);
            reject(error);
          } else {
            resolve();
          }
        });
      });
    });

    Promise.allSettled(emailPromises)
      .then(() => {
        res.json({ success: true });
      })
      .catch(() => {
        res
          .status(500)
          .json({ error: "Gagal mengirim beberapa email konfirmasi" });
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

app.post("/cancel", (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Invalid request format" });
  }

  const placeholders = ids.map(() => "?").join(",");
  const query = `DELETE FROM reservations WHERE id IN (${placeholders})`;

  db.run(query, ids, (err) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ error: "Terjadi kesalahan saat membatalkan pendaftaran" });
    }

    io.emit("statsUpdate");
    res.render("cancellation_success");
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
  const limit = 25;

  db.get(
    "SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND gender = ? AND pendaftaran = ?",
    [reservation_date, gender, pendaftaran],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }

      if (row.count >= limit) {
        return res.status(400).json({
          error: `Maaf, kuota untuk ${gender} pada tanggal ${reservation_date} sudah penuh`,
        });
      }

      // If quota is available, proceed with insertion
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
    }
  );
});

// QR Code scanning routes
app.get("/cek-kehadiran", isAuthenticated, (req, res) => {
  res.render("cek_kehadiran");
});

app.get("/get-attendee/:id", (req, res) => {
  const { id } = req.params;
  db.get("SELECT * FROM reservations WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!row) {
      return res.status(404).json({ error: "Data tidak ditemukan" });
    }
    res.json(row);
  });
});

app.put("/update-attendance/:id", (req, res) => {
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

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
  res.render("halaman_awal");
});

app.get("/ketentuan-itikaf", (req, res) => {
  res.render("itikaf_rule");
});

app.get("/sisa-kuota", (req, res) => {
  res.render("sisa_kuota");
});

app.get("/quota-data", async (req, res) => {
  const today = new Date("2025-03-20");
  const endDate = new Date("2025-03-29");
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

app.get("/quota-data-offline", async (req, res) => {
  const today = new Date("2025-03-20");
  const endDate = new Date("2025-03-29");
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
        [date, "offline"],
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

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", (req, res) => {
  const { name, email, gender, city, number, reservation_date } = req.body;
  const pendaftaran = "online";
  const maleLimit = 75;
  const femaleLimit = 100;
  const qrAttachments = [];

  // helper function
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

  // helper function to generate QR Code
  const generateQRCode = async (id, date) => {
    const fileName = `${formatDate(date)}_${name}.png`;
    const filePath = path.join(__dirname, "temp", fileName);

    // Ensure temp dirextory exists
    if (!fs.existsSync(path.join(__dirname, "temp"))) {
      fs.mkdirSync(path.join(__dirname, "temp"));
    }

    // generate qr code
    await QRCode.toFile(filePath, id);

    return {
      filename: fileName,
      path: filePath,
      cid: id,
    };
  };

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
                errorDate = formatDate(date);
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
          return new Promise(async (resolve, reject) => {
            try {
              // generate qr code first
              if (email != "-") {
                const qrAttachment = await generateQRCode(id, date);
                qrAttachments.push(qrAttachment);
              }

              // then insert into database
              db.run(
                "INSERT INTO reservations (id, name, email, city, number, gender, reservation_date, kehadiran, pendaftaran) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  id,
                  name,
                  email,
                  city,
                  number,
                  gender,
                  date,
                  false,
                  pendaftaran,
                ],
                (err) => {
                  if (err) {
                    hasError = true;
                    reject(err);
                  } else {
                    resolve();
                  }
                }
              );
            } catch (error) {
              hasError = true;
              reject(error);
            }
          });
        });

        return Promise.all(insertPromises);
      })
      .then(async () => {
        if (hasError) {
          // Delete all QR codes if there's an error
          qrAttachments.forEach((attachment) => {
            if (fs.existsSync(attachment.path)) {
              fs.unlinkSync(attachment.path);
            }
          });
          db.run("ROLLBACK");
          return res.status(500).json({ error: "Database error" });
        }

        // send email with qr codes
        const mailOptions = {
          from: "badarmsaofficial@gmail.com",
          to: email,
          subject: "QR Code pendaftaran Itikaf",
          html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; }
              .email-container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa; }
              .header { background-color: #4CAF50; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
              .content { background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
              .qr-info { margin: 20px 0; padding: 15px; background-color: #e8f5e9; border-radius: 5px; }
              .footer { margin-top: 20px; font-size: 14px; color: #666; text-align: center; }
            </style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <h2 style="margin: 0;">QR Code Pendaftaran Itikaf</h2>
              </div>
              <div class="content">
                <p>Assalamu'alaikum Wr. Wb.</p>
                <p>Terima kasih telah mendaftar itikaf. Berikut adalah QR Code untuk kehadiran Anda:</p>
                <div class="qr-info">
                  <p style="margin: 0; text-align: center;">Silakan tunjukkan QR Code ini saat hadir di lokasi.</p>
                </div>
                <div class="footer">
                  <p>Email ini dikirim secara otomatis, mohon untuk tidak membalas email ini.</p>
                </div>
              </div>
            </div>
          </body>
          </html>
          `,
          attachments: qrAttachments,
        };

        try {
          if (email != "-") {
            await transporter.sendMail(mailOptions);

            // Delete all QR codes after email is sent
            qrAttachments.forEach((attachment) => {
              if (fs.existsSync(attachment.path)) {
                fs.unlinkSync(attachment.path);
              }
            });
          }

          db.run("COMMIT");
          io.emit("statsUpdate");
          res.redirect("/");
        } catch (error) {
          console.error("Error sending email: ", error);
          db.run("ROLLBACK");
          res.status(500).json({
            error: "Gagal mengirim email (coba periksa kembali email anda)",
          });
        }
      })
      .catch((error) => {
        // Clean up generated QR code
        qrAttachments.forEach((attachment) => {
          if (fs.existsSync(attachment.path)) {
            fs.unlinkSync(attachment.path);
          }
        });

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

app.get("/batal-daftar", (req, res) => {
  res.render("batal_daftar");
});

app.get("/search-registrants", (req, res) => {
  const searchName = req.query.name;
  db.all(
    "SELECT * FROM reservations WHERE name LIKE ? AND pendaftaran = ?",
    [`%${searchName}%`, "online"],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

app.post("/initiate-cancellation", (req, res) => {
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

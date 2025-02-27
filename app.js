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

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Set up view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
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
      gender TEXT NOT NULL,
      reservation_date TEXT NOT NULL
    )`);
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected");

  // Function to emit updated statistics
  const emitStats = () => {
    db.get(
      "SELECT COUNT(*) as total FROM reservations",
      [],
      (err, totalRow) => {
        if (err) return console.error(err);

        db.get(
          "SELECT COUNT(*) as male FROM reservations WHERE gender = 'laki-laki'",
          [],
          (err, maleRow) => {
            if (err) return console.error(err);

            db.get(
              "SELECT COUNT(*) as female FROM reservations WHERE gender = 'perempuan'",
              [],
              (err, femaleRow) => {
                if (err) return console.error(err);

                socket.emit("stats", {
                  total: totalRow.total,
                  male: maleRow.male,
                  female: femaleRow.female,
                });
              }
            );
          }
        );
      }
    );
  };

  // Emit initial stats
  emitStats();
});

// Routes
app.get("/", (req, res) => {
  res.render("halaman_awal");
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
  const { date, gender } = req.query;
  let query = "SELECT * FROM reservations";
  const params = [];

  if (date && gender) {
    query += " WHERE reservation_date = ? AND gender = ?";
    params.push(date, gender);
  } else if (date) {
    query += " WHERE reservation_date = ?";
    params.push(date);
  } else if (gender) {
    query += " WHERE gender = ?";
    params.push(gender);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows);
  });
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
  const { date, gender } = req.query;
  let query = "SELECT * FROM reservations";
  const params = [];

  if (date && gender) {
    query += " WHERE reservation_date = ? AND gender = ?";
    params.push(date, gender);
  } else if (date) {
    query += " WHERE reservation_date = ?";
    params.push(date);
  } else if (gender) {
    query += " WHERE gender = ?";
    params.push(gender);
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
      { header: "Tanggal Reservasi", key: "reservation_date", width: 20 },
    ];

    rows.forEach((row) => {
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
    pass: "wwavzwkyilfehxyy", // Replace with your app password
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

    const cancelUrl = `http://localhost:3000/cancel/${id}`;
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
  const { name, email, gender, reservation_date } = req.body;
  const id = uuidv4();

  // Check quota for the selected date
  db.get(
    "SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ?",
    [reservation_date],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }

      if (row.count >= 4) {
        return res.status(400).json({ error: "Maaf kuota penuh" });
      }

      // Insert new reservation
      db.run(
        "INSERT INTO reservations (id, name, email, gender, reservation_date) VALUES (?, ?, ?, ?, ?)",
        [id, name, email, gender, reservation_date],
        (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database error" });
          }

          // Emit updated stats to all connected clients
          io.emit("statsUpdate");
          res.redirect("/");
        }
      );
    }
  );
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

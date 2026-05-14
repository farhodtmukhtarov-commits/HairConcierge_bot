const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const PUBLIC_DIR = path.join(__dirname, "public");
const DB_FILE = path.join(__dirname, "data", "db.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const defaultDb = {
  settings: {
    businessName: "Luma Beauty",
    dayStart: "09:00",
    dayEnd: "20:00",
    slotStepMinutes: 60
  },
  services: [
    {
      id: "haircut",
      name: "Стрижка",
      durationMinutes: 60,
      price: 120000,
      active: true
    },
    {
      id: "manicure",
      name: "Маникюр",
      durationMinutes: 90,
      price: 180000,
      active: true
    },
    {
      id: "brows",
      name: "Брови",
      durationMinutes: 45,
      price: 90000,
      active: true
    }
  ],
  bookings: [
    {
      id: "demo-1",
      serviceId: "manicure",
      clientName: "Алина",
      clientPhone: "+998 90 000 00 00",
      date: new Date().toISOString().slice(0, 10),
      startTime: "10:00",
      durationMinutes: 90,
      status: "confirmed",
      createdAt: new Date().toISOString()
    }
  ]
};

async function ensureDb() {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    await writeDb(defaultDb);
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
}

async function writeDb(db) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  if (Buffer.isBuffer(body)) {
    res.end(body);
    return;
  }
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function notFound(res) {
  send(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  send(res, 400, { error: message });
}

function minutes(time) {
  const [hours, mins] = String(time).split(":").map(Number);
  return hours * 60 + mins;
}

function timeFromMinutes(value) {
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  // Bookings use half-open intervals: 13:00-14:00 blocks 13:00 up to 13:59,
  // but does not block a new booking that starts exactly at 14:00.
  return aStart < bEnd && bStart < aEnd;
}

function validateDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function getService(db, serviceId) {
  return db.services.find((service) => service.id === serviceId && service.active);
}

function hasOverlap(db, date, startTime, durationMinutes) {
  const start = minutes(startTime);
  const end = start + durationMinutes;
  return dayBookings(db, date).some((booking) => {
    const bookingStart = minutes(booking.startTime);
    const bookingEnd = bookingStart + booking.durationMinutes;
    return overlaps(start, end, bookingStart, bookingEnd);
  });
}

function dayBookings(db, date) {
  return db.bookings.filter((booking) => booking.date === date && booking.status !== "cancelled");
}

function getDayStatus(db, date) {
  const start = minutes(db.settings.dayStart);
  const end = minutes(db.settings.dayEnd);
  const occupied = dayBookings(db, date).reduce((total, booking) => total + booking.durationMinutes, 0);
  const capacity = Math.max(0, end - start);

  if (occupied <= 0) return "free";
  if (occupied >= capacity) return "full";
  return "busy";
}

function availableSlots(db, serviceId, date) {
  const service = getService(db, serviceId);
  if (!service || !validateDate(date)) return [];

  const dayStart = minutes(db.settings.dayStart);
  const dayEnd = minutes(db.settings.dayEnd);
  const step = db.settings.slotStepMinutes;
  const bookings = dayBookings(db, date);
  const slots = [];

  for (let start = dayStart; start + service.durationMinutes <= dayEnd; start += step) {
    const end = start + service.durationMinutes;
    const taken = bookings.some((booking) => {
      const bookingStart = minutes(booking.startTime);
      const bookingEnd = bookingStart + booking.durationMinutes;
      return overlaps(start, end, bookingStart, bookingEnd);
    });

    slots.push({
      time: timeFromMinutes(start),
      available: !taken
    });
  }

  return slots;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function isAdmin(req) {
  return req.headers["x-admin-pin"] === ADMIN_PIN;
}

async function handleApi(req, res, url) {
  const db = await readDb();

  if (req.method === "GET" && url.pathname === "/api/config") {
    send(res, 200, {
      settings: db.settings,
      services: db.services.filter((service) => service.active)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/state") {
    if (!isAdmin(req)) return send(res, 401, { error: "Wrong admin PIN" });
    send(res, 200, db);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/calendar") {
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    if (!year || !month) return badRequest(res, "year and month are required");

    const days = new Date(year, month, 0).getDate();
    const data = Array.from({ length: days }, (_, index) => {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
      return {
        date,
        status: getDayStatus(db, date),
        bookingsCount: dayBookings(db, date).length
      };
    });

    send(res, 200, data);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/slots") {
    const serviceId = url.searchParams.get("serviceId");
    const date = url.searchParams.get("date");
    send(res, 200, availableSlots(db, serviceId, date));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const payload = await readJson(req);
    const service = getService(db, payload.serviceId);
    if (!service) return badRequest(res, "Выберите услугу");
    if (!validateDate(payload.date)) return badRequest(res, "Выберите дату");
    if (!/^\d{2}:\d{2}$/.test(String(payload.startTime))) return badRequest(res, "Выберите время");
    if (!String(payload.clientName || "").trim()) return badRequest(res, "Введите имя");
    if (!String(payload.clientPhone || "").trim()) return badRequest(res, "Введите телефон");

    const slot = availableSlots(db, service.id, payload.date).find((item) => item.time === payload.startTime);
    if (!slot || !slot.available) return badRequest(res, "Это время уже занято");

    const booking = {
      id: crypto.randomUUID(),
      serviceId: service.id,
      clientName: String(payload.clientName).trim().slice(0, 80),
      clientPhone: String(payload.clientPhone).trim().slice(0, 40),
      date: payload.date,
      startTime: payload.startTime,
      durationMinutes: service.durationMinutes,
      status: "confirmed",
      telegramUser: payload.telegramUser || null,
      createdAt: new Date().toISOString()
    };

    db.bookings.push(booking);
    await writeDb(db);
    send(res, 201, booking);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/services") {
    if (!isAdmin(req)) return send(res, 401, { error: "Wrong admin PIN" });
    const payload = await readJson(req);
    const name = String(payload.name || "").trim();
    const durationMinutes = Number(payload.durationMinutes);
    const price = Number(payload.price || 0);
    if (!name) return badRequest(res, "Название услуги обязательно");
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15) {
      return badRequest(res, "Длительность должна быть от 15 минут");
    }

    const service = {
      id: crypto.randomUUID(),
      name,
      durationMinutes,
      price,
      active: true
    };
    db.services.push(service);
    await writeDb(db);
    send(res, 201, service);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/blocks") {
    if (!isAdmin(req)) return send(res, 401, { error: "Wrong admin PIN" });
    const payload = await readJson(req);
    if (!validateDate(payload.date)) return badRequest(res, "Выберите дату");

    const allDay = Boolean(payload.allDay);
    const startTime = allDay ? db.settings.dayStart : String(payload.startTime || "");
    const durationMinutes = allDay
      ? minutes(db.settings.dayEnd) - minutes(db.settings.dayStart)
      : Number(payload.durationMinutes);

    if (!/^\d{2}:\d{2}$/.test(startTime)) return badRequest(res, "Выберите время");
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15) {
      return badRequest(res, "Укажите длительность резерва");
    }
    if (minutes(startTime) + durationMinutes > minutes(db.settings.dayEnd)) {
      return badRequest(res, "Резерв выходит за рабочий день");
    }
    if (hasOverlap(db, payload.date, startTime, durationMinutes)) {
      return badRequest(res, allDay ? "В этот день уже есть записи" : "Это время уже занято");
    }

    const block = {
      id: crypto.randomUUID(),
      type: "block",
      serviceId: null,
      clientName: allDay ? "День занят" : "Резерв",
      clientPhone: "",
      note: String(payload.note || "").trim().slice(0, 120),
      date: payload.date,
      startTime,
      durationMinutes,
      allDay,
      status: "confirmed",
      createdAt: new Date().toISOString()
    };

    db.bookings.push(block);
    await writeDb(db);
    send(res, 201, block);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/services/")) {
    if (!isAdmin(req)) return send(res, 401, { error: "Wrong admin PIN" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const payload = await readJson(req);
    const service = db.services.find((item) => item.id === id);
    if (!service) return notFound(res);

    if ("name" in payload) service.name = String(payload.name).trim();
    if ("durationMinutes" in payload) service.durationMinutes = Number(payload.durationMinutes);
    if ("price" in payload) service.price = Number(payload.price || 0);
    if ("active" in payload) service.active = Boolean(payload.active);

    await writeDb(db);
    send(res, 200, service);
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/bookings/")) {
    if (!isAdmin(req)) return send(res, 401, { error: "Wrong admin PIN" });
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const payload = await readJson(req);
    const booking = db.bookings.find((item) => item.id === id);
    if (!booking) return notFound(res);

    if ("status" in payload) booking.status = payload.status === "cancelled" ? "cancelled" : "confirmed";
    await writeDb(db);
    send(res, 200, booking);
    return;
  }

  notFound(res);
}

async function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.normalize(decodeURIComponent(filePath)).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) return notFound(res);

  try {
    const stat = await fs.stat(fullPath);
    const finalPath = stat.isDirectory() ? path.join(fullPath, "index.html") : fullPath;
    const ext = path.extname(finalPath).toLowerCase();
    send(res, 200, await fs.readFile(finalPath), MIME[ext] || "application/octet-stream");
  } catch {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Booking Mini App is running: http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`Admin PIN: ${ADMIN_PIN}`);
});

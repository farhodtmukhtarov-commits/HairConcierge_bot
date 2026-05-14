const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const state = {
  config: null,
  month: new Date(),
  selectedDate: null,
  selectedSlot: null
};

const businessName = document.querySelector("#businessName");
const serviceSelect = document.querySelector("#serviceSelect");
const serviceMeta = document.querySelector("#serviceMeta");
const servicePanel = document.querySelector("#servicePanel");
const clientPanel = document.querySelector("#clientPanel");
const monthTitle = document.querySelector("#monthTitle");
const calendarGrid = document.querySelector("#calendarGrid");
const slotsEl = document.querySelector("#slots");
const slotsPanel = document.querySelector("#slotsPanel");
const selectedDateTitle = document.querySelector("#selectedDateTitle");
const bookButton = document.querySelector("#bookButton");
const messageEl = document.querySelector("#message");

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];

function money(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

function selectedService() {
  return state.config.services.find((service) => service.id === serviceSelect.value);
}

function hideNextSteps() {
  servicePanel.classList.add("is-hidden");
  clientPanel.classList.add("is-hidden");
  serviceSelect.innerHTML = "";
  serviceMeta.textContent = "";
}

function setMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.style.color = isError ? "#be3455" : "#228b5f";
}

function updateBookButton() {
  bookButton.disabled = !(state.selectedDate && state.selectedSlot && serviceSelect.value);
}

async function servicesAvailableAtSelectedTime() {
  if (!state.selectedDate || !state.selectedSlot) return [];
  const checks = await Promise.all(state.config.services.map(async (service) => {
    const slots = await api(`/api/slots?serviceId=${service.id}&date=${state.selectedDate}`);
    const slot = slots.find((item) => item.time === state.selectedSlot);
    return slot?.available ? service : null;
  }));
  return checks.filter(Boolean);
}

async function availableTimesForDate() {
  const checks = await Promise.all(state.config.services.map(async (service) => {
    const slots = await api(`/api/slots?serviceId=${service.id}&date=${state.selectedDate}`);
    return slots.filter((slot) => slot.available).map((slot) => slot.time);
  }));
  return [...new Set(checks.flat())].sort();
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

async function loadConfig() {
  state.config = await api("/api/config");
  businessName.textContent = state.config.settings.businessName;
  hideNextSteps();
}

function renderServiceMeta() {
  const service = selectedService();
  if (!service) {
    serviceMeta.textContent = "Администратор еще не добавил услуги";
    return;
  }
  serviceMeta.textContent = `${service.durationMinutes} мин. · ${money(service.price)} сум`;
}

async function renderCalendar() {
  const year = state.month.getFullYear();
  const month = state.month.getMonth() + 1;
  const firstDay = new Date(year, month - 1, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const days = await api(`/api/calendar?year=${year}&month=${month}`);

  monthTitle.textContent = `${monthNames[month - 1]} ${year}`;
  calendarGrid.innerHTML = "";

  for (let i = 0; i < offset; i += 1) {
    const empty = document.createElement("div");
    empty.className = "day empty";
    calendarGrid.append(empty);
  }

  days.forEach((day, index) => {
    const button = document.createElement("button");
    button.className = `day ${day.status}`;
    button.type = "button";
    button.textContent = index + 1;
    button.dataset.date = day.date;
    if (state.selectedDate === day.date) button.classList.add("selected");
    button.addEventListener("click", () => selectDate(day.date));
    calendarGrid.append(button);
  });
}

async function selectDate(date) {
  state.selectedDate = date;
  state.selectedSlot = null;
  hideNextSteps();
  slotsPanel.classList.remove("is-hidden");
  selectedDateTitle.textContent = new Date(`${date}T00:00:00`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long"
  });
  await renderCalendar();
  await renderSlots();
  slotsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  updateBookButton();
}

async function renderSlots() {
  if (!state.selectedDate) {
    slotsEl.innerHTML = "";
    return;
  }

  const times = await availableTimesForDate();
  slotsEl.innerHTML = "";

  if (!times.length) {
    slotsEl.innerHTML = "<p class=\"muted\">На этот день свободного времени нет</p>";
    return;
  }

  times.forEach((time) => {
    const button = document.createElement("button");
    button.className = "slot";
    button.type = "button";
    button.textContent = time;
    if (time === state.selectedSlot) button.classList.add("selected");
    button.addEventListener("click", async () => {
      state.selectedSlot = time;
      document.querySelectorAll(".slot").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      await renderServicesForSelectedTime();
      updateBookButton();
    });
    slotsEl.append(button);
  });
}

async function renderServicesForSelectedTime() {
  const services = await servicesAvailableAtSelectedTime();
  clientPanel.classList.add("is-hidden");
  serviceSelect.innerHTML = `<option value="">Выберите услугу</option>` + services
    .map((service) => `<option value="${service.id}">${service.name}</option>`)
    .join("");
  serviceMeta.textContent = services.length
    ? "Выберите услугу для выбранного времени"
    : "На это время нет подходящих услуг";
  servicePanel.classList.remove("is-hidden");
  servicePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function createBooking() {
  try {
    bookButton.disabled = true;
    const payload = {
      serviceId: serviceSelect.value,
      date: state.selectedDate,
      startTime: state.selectedSlot,
      clientName: document.querySelector("#clientName").value,
      clientPhone: document.querySelector("#clientPhone").value,
      telegramUser: tg?.initDataUnsafe?.user || null
    };
    const booking = await api("/api/bookings", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    const service = selectedService();
    setMessage(`Готово: ${service.name}, ${booking.date} в ${booking.startTime}`);
    tg?.HapticFeedback?.notificationOccurred("success");
    tg?.MainButton?.hide();
    state.selectedSlot = null;
    hideNextSteps();
    await renderCalendar();
    await renderSlots();
  } catch (error) {
    setMessage(error.message, true);
    tg?.HapticFeedback?.notificationOccurred("error");
  } finally {
    updateBookButton();
  }
}

document.querySelector("#prevMonth").addEventListener("click", async () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
  await renderCalendar();
});

document.querySelector("#nextMonth").addEventListener("click", async () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
  await renderCalendar();
});

serviceSelect.addEventListener("change", async () => {
  renderServiceMeta();
  if (serviceSelect.value) {
    clientPanel.classList.remove("is-hidden");
    clientPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    clientPanel.classList.add("is-hidden");
  }
  updateBookButton();
});

bookButton.addEventListener("click", createBooking);

loadConfig()
  .then(renderCalendar)
  .catch((error) => setMessage(error.message, true));

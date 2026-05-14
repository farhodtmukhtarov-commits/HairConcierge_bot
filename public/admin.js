let adminPin = "";
let adminState = null;
let editingServiceId = null;
const bookingState = {
  month: new Date(),
  selectedDate: null,
  selectedSlot: null
};
const overviewState = {
  month: new Date(),
  selectedDate: dateKey(new Date())
};

const pinInput = document.querySelector("#pin");
const adminMessage = document.querySelector("#adminMessage");
const servicesList = document.querySelector("#servicesList");
const bookingsList = document.querySelector("#bookingsList");
const overviewMonthTitle = document.querySelector("#overviewMonthTitle");
const overviewCalendarGrid = document.querySelector("#overviewCalendarGrid");
const overviewWeekTitle = document.querySelector("#overviewWeekTitle");
const weekDays = document.querySelector("#weekDays");
const dayDetails = document.querySelector("#dayDetails");
const bookingService = document.querySelector("#bookingService");
const bookingServiceMeta = document.querySelector("#bookingServiceMeta");
const adminServicePanel = document.querySelector("#adminServicePanel");
const adminClientPanel = document.querySelector("#adminClientPanel");
const ownerTools = document.querySelector("#ownerTools");
const bookingStepPanel = document.querySelector("#bookingStepPanel");
const bookingDateTitle = document.querySelector("#bookingDateTitle");
const bookingSlots = document.querySelector("#bookingSlots");
const createBookingButton = document.querySelector("#createBooking");
const createBlockButton = document.querySelector("#createBlock");
const blockWholeDayButton = document.querySelector("#blockWholeDay");
const blockNote = document.querySelector("#blockNote");

const monthNames = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];

function setAdminMessage(text, isError = false) {
  adminMessage.textContent = text;
  adminMessage.style.color = isError ? "#be3455" : "#228b5f";
}

function money(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function dateFromKey(value) {
  return new Date(`${value}T00:00:00`);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date) {
  const next = new Date(date);
  const offset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - offset);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatShortDate(value) {
  return dateFromKey(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short"
  });
}

function formatLongDate(value) {
  return dateFromKey(value).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value).split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function bookingTimeRange(booking) {
  return `${booking.startTime}-${minutesToTime(timeToMinutes(booking.startTime) + booking.durationMinutes)}`;
}

async function adminApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-pin": adminPin,
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

async function loadAdminState() {
  adminPin = pinInput.value.trim();
  adminState = await adminApi("/api/admin/state");
  await renderOverview();
  renderServices();
  setAdminMessage("Данные загружены");
}

function serviceName(id) {
  if (!id) return "Резерв";
  return adminState.services.find((service) => service.id === id)?.name || "Услуга удалена";
}

function bookingTitle(booking) {
  if (booking.type === "block") return booking.allDay ? "День занят" : "Резерв";
  return serviceName(booking.serviceId);
}

function bookingPerson(booking) {
  if (booking.type === "block") return booking.note || "Время недоступно для записи";
  return `${booking.clientName} · ${booking.clientPhone}`;
}

function bookingCompactLabel(booking) {
  if (booking.type === "block") return booking.note ? `${bookingTitle(booking)} · ${booking.note}` : bookingTitle(booking);
  return `${bookingTitle(booking)} · ${booking.clientName}`;
}

function bookingsForDate(date) {
  if (!adminState) return [];
  return adminState.bookings
    .filter((booking) => booking.date === date && booking.status !== "cancelled")
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function allBookingsForDate(date) {
  if (!adminState) return [];
  return adminState.bookings
    .filter((booking) => booking.date === date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function dayStatus(date) {
  const count = bookingsForDate(date).length;
  if (count === 0) return "free";
  if (count >= 6) return "full";
  return "busy";
}

async function renderOverview() {
  if (!adminState) return;
  await renderOverviewCalendar();
  renderWeekView();
  renderDayDetails();
  await syncBookingFormToSelectedDay();
}

async function renderOverviewCalendar() {
  const year = overviewState.month.getFullYear();
  const month = overviewState.month.getMonth() + 1;
  const firstDay = new Date(year, month - 1, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const days = await adminApi(`/api/calendar?year=${year}&month=${month}`);

  overviewMonthTitle.textContent = `${monthNames[month - 1]} ${year}`;
  overviewCalendarGrid.innerHTML = "";

  for (let i = 0; i < offset; i += 1) {
    const empty = document.createElement("div");
    empty.className = "day empty";
    overviewCalendarGrid.append(empty);
  }

  days.forEach((day, index) => {
    const button = document.createElement("button");
    button.className = `day ${day.status}`;
    button.type = "button";
    button.textContent = index + 1;
    if (overviewState.selectedDate === day.date) button.classList.add("selected");
    button.addEventListener("click", () => selectOverviewDate(day.date));
    overviewCalendarGrid.append(button);
  });
}

function renderWeekView() {
  const selected = dateFromKey(overviewState.selectedDate);
  const weekStart = startOfWeek(selected);
  const weekEnd = addDays(weekStart, 6);

  overviewWeekTitle.textContent = `${formatShortDate(dateKey(weekStart))} - ${formatShortDate(dateKey(weekEnd))}`;
  weekDays.innerHTML = "";

  for (let i = 0; i < 7; i += 1) {
    const date = addDays(weekStart, i);
    const key = dateKey(date);
    const bookings = bookingsForDate(key);
    const day = document.createElement("button");
    day.className = `week-day ${dayStatus(key)}`;
    if (overviewState.selectedDate === key) day.classList.add("selected");
    day.type = "button";
    day.innerHTML = `
      <span class="week-date">
        <b>${date.toLocaleDateString("ru-RU", { weekday: "short" })}</b>
        <strong>${date.getDate()}</strong>
      </span>
      <span class="week-events">
        ${bookings.length ? bookings.map((booking) => `
          <span class="week-event">
            <b>${bookingTimeRange(booking)}</b>
            ${bookingCompactLabel(booking)}
          </span>
        `).join("") : "<span class=\"week-empty\">Нет записей</span>"}
      </span>
    `;
    day.addEventListener("click", () => selectOverviewDate(key));
    weekDays.append(day);
  }
}

async function selectOverviewDate(date) {
  overviewState.selectedDate = date;
  overviewState.month = new Date(dateFromKey(date).getFullYear(), dateFromKey(date).getMonth(), 1);
  await renderOverview();
}

function renderDayDetails() {
  const bookings = allBookingsForDate(overviewState.selectedDate);
  dayDetails.innerHTML = `
    <div class="day-details-head">
      <p class="eyebrow">Выбранный день</p>
      <h2>${formatLongDate(overviewState.selectedDate)}</h2>
    </div>
    ${bookings.length ? bookings.map((booking) => `
      <article class="timeline-item">
        <time>${bookingTimeRange(booking)}</time>
        <div>
          <strong>${bookingTitle(booking)}</strong>
          <span>${bookingPerson(booking)}</span>
          <small>${booking.durationMinutes} мин. · ${booking.status === "cancelled" ? "отменена" : "подтверждена"}</small>
          <button class="secondary compact booking-status-action" data-booking-id="${booking.id}" data-status="${booking.status === "cancelled" ? "confirmed" : "cancelled"}" type="button">
            ${booking.status === "cancelled" ? "Подтвердить" : "Отменить"}
          </button>
        </div>
      </article>
    `).join("") : "<p class=\"muted\">На этот день записей нет</p>"}
  `;

  dayDetails.querySelectorAll(".booking-status-action").forEach((button) => {
    button.addEventListener("click", async () => {
      await adminApi(`/api/admin/bookings/${button.dataset.bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: button.dataset.status })
      });
      await loadAdminState();
    });
  });
}

function activeBookingServices() {
  return adminState.services.filter((service) => service.active);
}

function selectedBookingService() {
  return activeBookingServices().find((service) => service.id === bookingService.value);
}

function updateCreateBookingButton() {
  createBookingButton.disabled = !(bookingState.selectedDate && bookingState.selectedSlot && bookingService.value);
  createBlockButton.disabled = !(bookingState.selectedDate && bookingState.selectedSlot && bookingService.value);
  blockWholeDayButton.disabled = !bookingState.selectedDate;
}

function hideBookingNextSteps() {
  adminServicePanel.classList.add("is-hidden");
  adminClientPanel.classList.add("is-hidden");
  ownerTools.classList.add("is-hidden");
  bookingService.innerHTML = "";
  bookingServiceMeta.textContent = "";
}

async function adminAvailableTimesForDate() {
  const checks = await Promise.all(activeBookingServices().map(async (service) => {
    const slots = await adminApi(`/api/slots?serviceId=${service.id}&date=${bookingState.selectedDate}`);
    return slots.filter((slot) => slot.available).map((slot) => slot.time);
  }));
  return [...new Set(checks.flat())].sort();
}

async function adminServicesAvailableAtSelectedTime() {
  const checks = await Promise.all(activeBookingServices().map(async (service) => {
    const slots = await adminApi(`/api/slots?serviceId=${service.id}&date=${bookingState.selectedDate}`);
    const slot = slots.find((item) => item.time === bookingState.selectedSlot);
    return slot?.available ? service : null;
  }));
  return checks.filter(Boolean);
}

function renderBookingServices(activeServices) {
  const currentValue = bookingService.value;
  bookingService.innerHTML = `<option value="">Выберите услугу</option>` + activeServices
    .map((service) => `<option value="${service.id}">${service.name}</option>`)
    .join("");

  if (activeServices.some((service) => service.id === currentValue)) {
    bookingService.value = currentValue;
  }

  const service = selectedBookingService();
  bookingServiceMeta.textContent = service
    ? `${service.durationMinutes} мин. · ${money(service.price)} сум`
    : "Выберите услугу для выбранного времени";
}

async function syncBookingFormToSelectedDay() {
  bookingState.selectedDate = overviewState.selectedDate;
  bookingState.selectedSlot = null;
  hideBookingNextSteps();
  bookingStepPanel.classList.remove("is-hidden");
  bookingDateTitle.textContent = `Создать запись: ${formatLongDate(bookingState.selectedDate)}`;
  await renderBookingSlots();
  updateCreateBookingButton();
}

async function renderBookingSlots() {
  if (!adminState) return;

  if (!bookingState.selectedDate) {
    bookingSlots.innerHTML = "<p class=\"muted\">Нажмите на дату, затем выберите время</p>";
    updateCreateBookingButton();
    return;
  }

  const times = await adminAvailableTimesForDate();
  bookingSlots.innerHTML = "";

  if (!times.length) {
    bookingSlots.innerHTML = "<p class=\"muted\">На этот день свободного времени нет</p>";
    updateCreateBookingButton();
    return;
  }

  times.forEach((time) => {
    const button = document.createElement("button");
    button.className = "slot";
    button.type = "button";
    button.textContent = time;
    if (time === bookingState.selectedSlot) button.classList.add("selected");
    button.addEventListener("click", async () => {
      bookingState.selectedSlot = time;
      bookingSlots.querySelectorAll(".slot").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      await renderAdminServicesForSelectedTime();
      updateCreateBookingButton();
    });
    bookingSlots.append(button);
  });

  updateCreateBookingButton();
}

async function renderAdminServicesForSelectedTime() {
  const services = await adminServicesAvailableAtSelectedTime();
  renderBookingServices(services);
  adminClientPanel.classList.add("is-hidden");
  ownerTools.classList.add("is-hidden");
  adminServicePanel.classList.remove("is-hidden");
  bookingServiceMeta.textContent = services.length
    ? "Выберите услугу для выбранного времени"
    : "На это время нет подходящих услуг";
}

function renderServices() {
  servicesList.innerHTML = "";
  adminState.services.forEach((service) => {
    const isEditing = editingServiceId === service.id;
    const item = document.createElement("article");
    item.className = "item";
    item.innerHTML = `
      <div class="service-summary">
        <div>
          <strong>${service.name}</strong>
          <div class="item-row"><span>${service.durationMinutes} мин.</span><span>${money(service.price)} сум</span></div>
        </div>
        <button class="secondary compact configure-service" type="button">${isEditing ? "Закрыть" : "Настроить"}</button>
      </div>
      ${isEditing ? `
        <div class="service-edit">
          <label class="field">
            <span>Название</span>
            <input class="edit-service-name" value="${service.name}">
          </label>
          <label class="field">
            <span>Длительность, минут</span>
            <input class="edit-service-duration" type="number" min="15" step="15" value="${service.durationMinutes}">
          </label>
          <label class="field">
            <span>Цена</span>
            <input class="edit-service-price" type="number" min="0" step="1000" value="${service.price}">
          </label>
          <div class="item-actions">
            <button class="secondary save-service" type="button">Сохранить</button>
            <button class="secondary toggle-service" type="button">${service.active ? "Скрыть услугу" : "Вернуть услугу"}</button>
          </div>
        </div>
      ` : ""}
    `;

    item.querySelector(".configure-service").addEventListener("click", () => {
      editingServiceId = isEditing ? null : service.id;
      renderServices();
    });

    if (isEditing) {
      item.querySelector(".save-service").addEventListener("click", async () => {
        try {
          await adminApi(`/api/admin/services/${service.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              name: item.querySelector(".edit-service-name").value,
              durationMinutes: item.querySelector(".edit-service-duration").value,
              price: item.querySelector(".edit-service-price").value
            })
          });
          editingServiceId = null;
          await loadAdminState();
          setAdminMessage("Услуга обновлена");
        } catch (error) {
          setAdminMessage(error.message, true);
        }
      });

      item.querySelector(".toggle-service").addEventListener("click", async () => {
        await adminApi(`/api/admin/services/${service.id}`, {
          method: "PATCH",
          body: JSON.stringify({ active: !service.active })
        });
        await loadAdminState();
      });
    }
    servicesList.append(item);
  });
}

function renderBookings() {
  if (!bookingsList) return;
  bookingsList.innerHTML = "";
  const bookings = [...adminState.bookings].sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`));

  bookings.forEach((booking) => {
    const item = document.createElement("article");
    item.className = "item";
    item.innerHTML = `
      <strong>${booking.type === "block" ? bookingTitle(booking) : booking.clientName}</strong>
      <div class="item-row"><span>${bookingTitle(booking)}</span><span>${booking.durationMinutes} мин.</span></div>
      <div class="item-row"><span>${booking.date} · ${bookingTimeRange(booking)}</span><span>${booking.type === "block" ? (booking.note || "резерв") : booking.clientPhone}</span></div>
      <div class="item-row"><span>${booking.status === "cancelled" ? "Отменена" : "Подтверждена"}</span></div>
      <button class="secondary" type="button">${booking.status === "cancelled" ? "Подтвердить" : "Отменить"}</button>
    `;
    item.querySelector("button").addEventListener("click", async () => {
      await adminApi(`/api/admin/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: booking.status === "cancelled" ? "confirmed" : "cancelled" })
      });
      await loadAdminState();
    });
    bookingsList.append(item);
  });
}

document.querySelector("#loadAdmin").addEventListener("click", () => {
  loadAdminState().catch((error) => setAdminMessage(error.message, true));
});

document.querySelector("#overviewPrevMonth").addEventListener("click", async () => {
  overviewState.month = new Date(overviewState.month.getFullYear(), overviewState.month.getMonth() - 1, 1);
  await renderOverviewCalendar();
});

document.querySelector("#overviewNextMonth").addEventListener("click", async () => {
  overviewState.month = new Date(overviewState.month.getFullYear(), overviewState.month.getMonth() + 1, 1);
  await renderOverviewCalendar();
});

document.querySelector("#overviewPrevWeek").addEventListener("click", async () => {
  overviewState.selectedDate = dateKey(addDays(startOfWeek(dateFromKey(overviewState.selectedDate)), -7));
  overviewState.month = new Date(dateFromKey(overviewState.selectedDate).getFullYear(), dateFromKey(overviewState.selectedDate).getMonth(), 1);
  await renderOverview();
});

document.querySelector("#overviewNextWeek").addEventListener("click", async () => {
  overviewState.selectedDate = dateKey(addDays(startOfWeek(dateFromKey(overviewState.selectedDate)), 7));
  overviewState.month = new Date(dateFromKey(overviewState.selectedDate).getFullYear(), dateFromKey(overviewState.selectedDate).getMonth(), 1);
  await renderOverview();
});

document.querySelector("#todayOverview").addEventListener("click", async () => {
  overviewState.selectedDate = dateKey(new Date());
  overviewState.month = new Date();
  await renderOverview();
});

document.querySelector("#addService").addEventListener("click", async () => {
  try {
    await adminApi("/api/admin/services", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#serviceName").value,
        durationMinutes: document.querySelector("#serviceDuration").value,
        price: document.querySelector("#servicePrice").value
      })
    });
    document.querySelector("#serviceName").value = "";
    await loadAdminState();
    setAdminMessage("Услуга добавлена");
  } catch (error) {
    setAdminMessage(error.message, true);
  }
});

bookingService.addEventListener("change", async () => {
  const availableServices = activeBookingServices().filter((service) => {
    return [...bookingService.options].some((option) => option.value === service.id);
  });
  renderBookingServices(availableServices);
  if (bookingService.value) {
    adminClientPanel.classList.remove("is-hidden");
    ownerTools.classList.remove("is-hidden");
  } else {
    adminClientPanel.classList.add("is-hidden");
    ownerTools.classList.add("is-hidden");
  }
  updateCreateBookingButton();
});

createBookingButton.addEventListener("click", async () => {
  try {
    createBookingButton.disabled = true;
    await adminApi("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        serviceId: bookingService.value,
        date: bookingState.selectedDate,
        startTime: bookingState.selectedSlot,
        clientName: document.querySelector("#bookingName").value,
        clientPhone: document.querySelector("#bookingPhone").value
      })
    });

    document.querySelector("#bookingName").value = "";
    document.querySelector("#bookingPhone").value = "";
    bookingState.selectedSlot = null;
    hideBookingNextSteps();
    await loadAdminState();
    setAdminMessage("Запись создана");
  } catch (error) {
    setAdminMessage(error.message, true);
    updateCreateBookingButton();
  }
});

createBlockButton.addEventListener("click", async () => {
  try {
    const service = selectedBookingService();
    createBlockButton.disabled = true;
    await adminApi("/api/admin/blocks", {
      method: "POST",
      body: JSON.stringify({
        date: bookingState.selectedDate,
        startTime: bookingState.selectedSlot,
        durationMinutes: service?.durationMinutes || 60,
        note: blockNote.value
      })
    });

    blockNote.value = "";
    bookingState.selectedSlot = null;
    hideBookingNextSteps();
    await loadAdminState();
    setAdminMessage("Время зарезервировано");
  } catch (error) {
    setAdminMessage(error.message, true);
    updateCreateBookingButton();
  }
});

blockWholeDayButton.addEventListener("click", async () => {
  try {
    blockWholeDayButton.disabled = true;
    await adminApi("/api/admin/blocks", {
      method: "POST",
      body: JSON.stringify({
        date: bookingState.selectedDate,
        allDay: true,
        note: blockNote.value || "Весь день занят"
      })
    });

    blockNote.value = "";
    bookingState.selectedSlot = null;
    hideBookingNextSteps();
    await loadAdminState();
    setAdminMessage("День заблокирован");
  } catch (error) {
    setAdminMessage(error.message, true);
    updateCreateBookingButton();
  }
});

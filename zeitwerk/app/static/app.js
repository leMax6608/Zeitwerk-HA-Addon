(() => {
  "use strict";

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const pad = value => String(value).padStart(2, "0");
  const isoDate = value => {
    const d = value instanceof Date ? value : new Date(value);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const parseISO = value => {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const minutesFromTime = time => {
    if (!time) return 0;
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  const formatDuration = (minutes, includeUnit = false) => {
    const safe = Math.max(0, Math.round(Number(minutes) || 0));
    const value = `${Math.floor(safe / 60)}:${pad(safe % 60)}`;
    return includeUnit ? `${value} Std.` : value;
  };
  const formatHoursMinutes = minutes => {
    const safe = Math.max(0, Math.round(Number(minutes) || 0));
    return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
  };
  const formatSigned = minutes => {
    const safe = Math.round(Number(minutes) || 0);
    return `${safe > 0 ? "+" : safe < 0 ? "−" : "±"} ${formatDuration(Math.abs(safe))}`;
  };
  const escapeHTML = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"})[char]);

  const TYPE_LABELS = {
    B: "Büro / Arbeit", H: "Homeoffice", X: "Tagesziel erfüllt", FT: "Frei / Feiertag", U: "Urlaub",
    K: "Krankheit", S: "Sonderurlaub", F: "Flexzeit-Abbau", A: "Überzeit abfeiern"
  };
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

  function applyTheme(preference = "system", remember = true) {
    const safePreference = ["system", "light", "dark"].includes(preference) ? preference : "system";
    const dark = safePreference === "dark" || (safePreference === "system" && themeMedia.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.themePreference = safePreference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#14252b" : "#f2f7f5");
    if (remember) localStorage.setItem("zeitwerk-theme", safePreference);
  }

  const state = {
    settings: null,
    entries: [],
    todayEntries: [],
    active: null,
    summary: null,
    liveActivity: null,
    nextVacation: null,
    loadedYear: new Date().getFullYear(),
    calendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDay: isoDate(new Date()),
    calendarDay: isoDate(new Date()),
    entryReturnView: null,
    selectedTimerType: "B",
    vacationYear: new Date().getFullYear(),
    ticker: null,
    timerBusy: false,
  };

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(path, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        signal: options.signal || controller.signal,
        ...options,
      });
    } catch (error) {
      const message = error.name === "AbortError"
        ? "Die Zeiterfassung antwortet nicht. Bitte das Zeitwerk-Add-on prüfen."
        : "Keine Verbindung zur Zeiterfassung. Bitte das Zeitwerk-Add-on starten oder neu laden.";
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) throw new Error(body.error || "Etwas ist schiefgegangen");
    return body;
  }

  function toast(message, error = false) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.toggle("error", error);
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
  }

  async function loadYear(year = state.loadedYear, quiet = false) {
    if (!quiet) document.body.classList.remove("loaded");
    try {
      const data = await api(`api/state?from=${year}-01-01&to=${year}-12-31`);
      state.settings = data.settings;
      state.entries = data.entries;
      state.todayEntries = data.today_entries || [];
      state.active = data.active;
      state.summary = data.summary;
      state.liveActivity = data.live_activity || null;
      state.nextVacation = data.next_vacation || null;
      state.loadedYear = year;
      $("#connectionBanner").classList.add("hidden");
      renderAll();
      document.body.classList.add("loaded");
    } catch (error) {
      document.body.classList.add("loaded");
      $("#connectionBanner").classList.remove("hidden");
      toast(error.message, true);
    }
  }

  function weekdayIndex(day) {
    const jsDay = day.getDay();
    return jsDay === 0 ? 6 : jsDay - 1;
  }

  function dailyTargets() {
    const configured = state.settings.daily_work_minutes;
    if (Array.isArray(configured) && configured.length === 7) return configured.map(value => Math.max(0, Number(value) || 0));
    const workdays = state.settings.workdays || [0, 1, 2, 3, 4];
    const perDay = Math.round(Number(state.settings.weekly_hours) * 60 / Math.max(1, workdays.length));
    return Array.from({ length: 7 }, (_, index) => workdays.includes(index) ? perDay : 0);
  }

  function targetPerDay(dayValue = new Date()) {
    const day = typeof dayValue === "string" ? parseISO(dayValue) : new Date(dayValue);
    return dailyTargets()[weekdayIndex(day)];
  }

  function vacationAllowance(year) {
    const values = state.settings.vacation_allowance_by_year || {};
    const annual = values[String(year)];
    return Number(annual ?? state.settings.vacation_allowance ?? 0);
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
  }

  function monthlyWorkdays(dayValue) {
    const day = typeof dayValue === "string" ? parseISO(dayValue) : new Date(dayValue);
    const cursor = new Date(day.getFullYear(), day.getMonth(), 1);
    let count = 0;
    while (cursor.getMonth() === day.getMonth()) {
      if (targetPerDay(cursor) > 0) count++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }

  function grossForMinutes(dayValue, minutes, monthlyOverride = null) {
    const monthly = Math.max(0, Number(monthlyOverride ?? state.settings.monthly_gross_eur) || 0);
    if (monthly) {
      const target = targetPerDay(dayValue);
      return target ? monthly / Math.max(1, monthlyWorkdays(dayValue)) * Math.min(1, Math.max(0, minutes) / target) : 0;
    }
    return Math.max(0, minutes) / 60 * Math.max(0, Number(state.settings.hourly_gross_eur || 0));
  }

  function isWorkday(day) {
    return targetPerDay(day) > 0;
  }

  function targetBetween(start, end, capToday = true) {
    const trackingStart = state.settings.tracking_start_date ? parseISO(state.settings.tracking_start_date) : new Date(start);
    const cursor = new Date(Math.max(new Date(start).getTime(), trackingStart.getTime()));
    const final = new Date(end);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let minutes = 0;
    while (cursor <= final && (!capToday || cursor <= today)) {
      minutes += targetPerDay(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
    return minutes;
  }

  function entriesOn(dateValue) {
    const key = typeof dateValue === "string" ? dateValue : isoDate(dateValue);
    return state.entries.filter(entry => entry.work_date === key);
  }

  function minutesOn(dateValue) {
    return entriesOn(dateValue).reduce((sum, entry) => sum + entry.worked_minutes, 0);
  }

  function mondayOf(dateValue) {
    const d = new Date(dateValue);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function renderAll() {
    renderHeader();
    renderDashboard();
    renderCalendar();
    renderReports();
    renderSettings();
    renderLegend();
  }

  function renderHeader() {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(now);
    $("#todayDate").textContent = formatted.toUpperCase();
    const hour = now.getHours();
    const greeting = hour < 11 ? "Guten Morgen" : hour < 17 ? "Guten Tag" : "Guten Abend";
    const name = (state.settings.display_name || "").trim();
    const xToday = state.todayEntries.some(entry => entry.type === "X");
    const finishedToday = state.todayEntries.some(entry => ["B", "H"].includes(entry.type) && entry.finalized);
    $("#pageTitle").textContent = xToday ? (name ? `Tagesziel geschafft, ${name}` : "Tagesziel geschafft") : finishedToday ? (name ? `Feierabend, ${name}` : "Feierabend") : name ? `${greeting}, ${name}` : "Dein Arbeitstag";
  }

  function renderDashboard() {
    renderTimer();
    renderVacationCountdown();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDay = parseISO(state.selectedDay);
    const selectedIsToday = state.selectedDay === isoDate(today);
    const monday = mondayOf(selectedDay);
    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    const weekCutoff = sunday < today ? sunday : today;
    const weekEntries = state.entries.filter(entry => {
      const d = parseISO(entry.work_date);
      return d >= monday && d <= weekCutoff;
    });
    const weekWorked = weekEntries.reduce((sum, entry) => sum + entry.worked_minutes, 0);
    const weekAccount = weekEntries.reduce((sum, entry) => sum + entry.account_minutes, 0);
    const weekTarget = targetBetween(monday, sunday, false);
    const balance = weekAccount - targetBetween(monday, weekCutoff);
    const percent = Math.min(100, Math.round(weekWorked / Math.max(1, weekTarget) * 100));
    $("#weekRange").textContent = `${pad(monday.getDate())}.${pad(monday.getMonth() + 1)}. – ${pad(sunday.getDate())}.${pad(sunday.getMonth() + 1)}.`;
    $("#weekWorked").textContent = formatDuration(weekWorked);
    $("#weekTarget").textContent = `von ${formatDuration(weekTarget)} Std.`;
    $("#weekPercent").textContent = `${percent}%`;
    $("#weekRing").style.setProperty("--progress", `${percent * 3.6}deg`);
    $("#weekBalance").textContent = formatSigned(balance);
    $("#weekBalance").classList.toggle("negative", balance < 0);
    $("#weekEyebrow").textContent = selectedIsToday ? "DIESE WOCHE" : "WOCHE DES TAGES";

    const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    $("#weekBars").innerHTML = names.map((name, index) => {
      const day = new Date(monday); day.setDate(day.getDate() + index);
      const minutes = minutesOn(day);
      const dayTarget = targetPerDay(day);
      if (!dayTarget && !minutes) return "";
      const height = Math.min(100, Math.round(minutes / Math.max(1, dayTarget) * 100));
      return `<div class="day-bar ${isoDate(day) === state.selectedDay ? "today" : ""}" title="${name}: ${formatDuration(minutes)} Stunden"><div class="day-bar-track"><div class="day-bar-fill" style="height:${height}%"></div></div><span>${name}</span></div>`;
    }).join("");

    const todays = entriesOn(selectedDay);
    $("#dayDetailTitle").textContent = selectedIsToday
      ? "Heute"
      : new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(selectedDay);
    $("#jumpToday").textContent = selectedIsToday ? "Heute ausgewählt" : "Zu heute";
    $("#jumpToday").classList.toggle("current", selectedIsToday);
    $("#nextDay").disabled = false;
    const todayBox = $("#todayEntry");
    if (todays.length) {
      const entry = todays[0];
      const timed = todays.filter(item => ["B", "H"].includes(item.type));
      const total = timed.reduce((sum, item) => sum + item.worked_minutes, 0);
      const pauses = timed.reduce((sum, item) => sum + item.recorded_break_minutes, 0);
      const starts = timed.map(item => item.start_time).filter(Boolean).sort();
      const ends = timed.map(item => item.end_time).filter(Boolean).sort();
      const isRunning = timed.some(item => item.is_running);
      todayBox.className = "today-entry-summary";
      if (timed.length) {
        todayBox.innerHTML = `<div class="today-entry-head"><div class="entry-type-badge">${escapeHTML(entry.type)}</div><div><b>${escapeHTML(entry.type_label)}</b><span>${isRunning ? "Zeiterfassung läuft" : "Arbeitszeit gespeichert"}</span></div></div><div class="today-facts"><div><span>Beginn</span><b>${escapeHTML(starts[0]?.slice(0, 5) || "–")}</b></div><div><span>Ende</span><b>${isRunning ? "läuft" : escapeHTML(ends.at(-1)?.slice(0, 5) || "–")}</b></div><div><span>Pause gesamt</span><b>${formatHoursMinutes(pauses)}</b></div><div class="work-total"><span>Arbeitszeit</span><b>${formatDuration(total)}</b></div></div>`;
      } else {
        const detail = entry.type === "X" ? `${formatDuration(entry.worked_minutes)} Stunden als erfüllt verbucht.` : entry.type === "FT" ? "Arbeitsfrei · kein Urlaubstag und keine Minusstunden." : "Dieser Tag wird automatisch berücksichtigt.";
        todayBox.innerHTML = `<div class="today-entry-head"><div class="entry-type-badge type-${escapeHTML(entry.type)}">${escapeHTML(entry.type)}</div><div><b>${escapeHTML(entry.type_label)}</b><span>${escapeHTML(detail)}</span></div></div>`;
      }
      $("#openTodayEntry").textContent = "Manuell bearbeiten";
    } else {
      todayBox.className = "empty-inline";
      todayBox.innerHTML = `<div class="empty-icon"><svg aria-hidden="true"><use href="#i-clock"></use></svg></div><div><b>Noch kein Eintrag</b><span>${selectedIsToday ? "Starte den Timer oder trage den Tag manuell ein." : "Für diesen Tag wurde keine Arbeitszeit gespeichert."}</span></div>`;
      $("#openTodayEntry").textContent = "Manuell nachtragen";
    }
    renderPauseAdvice(todays);

    const year = selectedDay.getFullYear();
    const yearEntries = state.loadedYear === year ? state.entries : [];
    const vacationUsed = yearEntries.filter(entry => entry.type === "U").length;
    const vacationTotal = vacationAllowance(year) + (year === new Date().getFullYear() ? Number(state.settings.vacation_carryover) : 0);
    $("#vacationLeft").textContent = Math.max(0, vacationTotal - vacationUsed);
    $("#homeofficeDays").textContent = yearEntries.filter(entry => entry.type === "H").length;
    $("#commuteDays").textContent = yearEntries.filter(entry => entry.commute).length;
    $("#todayEarnings").textContent = formatMoney(state.todayEntries.reduce((sum, entry) => sum + Number(entry.estimated_gross_eur || 0), 0));

    const yearStart = new Date(year, 0, 1);
    const balanceEnd = selectedDay > today ? today : selectedDay;
    const carry = year === today.getFullYear() ? Number(state.settings.previous_balance_minutes || 0) : 0;
    const yearBalance = yearEntries.filter(entry => entry.work_date <= isoDate(balanceEnd)).reduce((sum, entry) => sum + entry.account_minutes, 0) - targetBetween(yearStart, balanceEnd) + carry;
    $("#sidebarBalance").textContent = formatSigned(yearBalance);
    $("#balanceChip").classList.toggle("negative", yearBalance < 0);
    $("#balanceChip").classList.toggle("positive", yearBalance > 0);
  }

  function liveTimerValues() {
    if (!state.active) return { elapsedSeconds: 0, breakSeconds: 0, netSeconds: 0 };
    const now = new Date();
    const [h, m, s = 0] = state.active.start_time.split(":").map(Number);
    const start = parseISO(state.active.work_date);
    start.setHours(h, m, s, 0);
    const elapsedSeconds = Math.max(0, Math.floor((now - start) / 1000));
    let breakSeconds = Number(state.active.manual_break_minutes || 0) * 60;
    state.active.breaks.forEach(segment => {
      const [sh, sm, ss = 0] = segment.start.split(":").map(Number);
      const breakStart = parseISO(state.active.work_date);
      breakStart.setHours(sh, sm, ss, 0);
      if (breakStart < start) breakStart.setDate(breakStart.getDate() + 1);
      let breakEnd = now;
      if (segment.end) {
        const [eh, em, es = 0] = segment.end.split(":").map(Number);
        breakEnd = new Date(breakStart);
        breakEnd.setHours(eh, em, es, 0);
        if (breakEnd < breakStart) breakEnd.setDate(breakEnd.getDate() + 1);
      }
      breakSeconds += Math.max(0, Math.floor((breakEnd - breakStart) / 1000));
    });
    return { elapsedSeconds, breakSeconds, netSeconds: Math.max(0, elapsedSeconds - breakSeconds) };
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${pad(Math.floor(safe / 3600))}:${pad(Math.floor(safe / 60) % 60)}:${pad(safe % 60)}`;
  }

  function updateTimerButtons() {
    const active = state.active;
    const paused = Boolean(active?.is_paused);
    const busy = state.timerBusy;
    $("#startTimer").disabled = busy || Boolean(active);
    $("#stopTimer").disabled = busy || !active;
    $("#pauseTimer").disabled = busy || !active || paused;
    $("#resumeTimer").disabled = busy || !active || !paused;
  }

  function renderTimer() {
    clearInterval(state.ticker);
    const card = $(".timer-card");
    const active = state.active;
    const lastTimed = state.todayEntries.find(entry => ["B", "H"].includes(entry.type));
    const completedEntry = state.todayEntries.find(entry => entry.type === "X") || (lastTimed?.finalized ? lastTimed : null);
    const finished = !active && Boolean(completedEntry);
    card.classList.toggle("hidden", finished);
    $("#finishedCard").classList.toggle("hidden", !finished);
    if (finished) {
      renderFinishedCard(completedEntry);
      return;
    }
    card.classList.toggle("running", Boolean(active));
    card.classList.toggle("paused", Boolean(active?.is_paused));
    $("#timerTypePicker").classList.toggle("locked", Boolean(active));
    updateTimerButtons();
    $("#metaTarget").textContent = formatDuration(targetPerDay(active?.work_date || new Date()));
    if (!active) {
      $("#timerStatus").textContent = lastTimed ? "Arbeit gestoppt" : "Bereit";
      $("#workTimerValue").textContent = formatClock(lastTimed?.net_work_seconds || 0);
      $("#breakTimerValue").textContent = formatClock(lastTimed?.recorded_break_seconds || 0);
      $("#workTimerHint").textContent = lastTimed ? "Arbeitszeit gespeichert" : "Noch nicht gestartet";
      $("#breakTimerHint").textContent = lastTimed?.recorded_break_seconds ? "Pausen heute" : "Noch keine Pause";
      $("#timerSubline").textContent = lastTimed ? "Abgeschlossen" : "Nicht gestartet";
      $("#metaStart").textContent = lastTimed?.start_time?.slice(0, 5) || "–";
      $("#metaEnd").textContent = lastTimed?.end_time?.slice(0, 5) || "–";
      $("#startTimer").innerHTML = `<svg aria-hidden="true"><use href="#i-play"></use></svg>Arbeit starten`;
      return;
    }
    state.selectedTimerType = active.type;
    $("#startTimer").innerHTML = `<svg aria-hidden="true"><use href="#i-play"></use></svg>Läuft`;
    $$("#timerTypePicker button").forEach(button => button.classList.toggle("active", button.dataset.type === active.type));
    const tick = () => {
      const values = liveTimerValues();
      const remainingSeconds = Math.max(0, targetPerDay(active.work_date) * 60 - values.netSeconds);
      $("#workTimerValue").textContent = formatClock(values.netSeconds);
      $("#breakTimerValue").textContent = formatClock(values.breakSeconds);
      $("#timerStatus").textContent = active.is_paused ? "Pause läuft" : "Arbeitszeit läuft";
      $("#timerSubline").textContent = active.type_label;
      $("#metaStart").textContent = active.start_time.slice(0, 5);
      $("#metaEnd").textContent = "läuft";
      $("#workTimerHint").textContent = remainingSeconds
        ? `Noch ${formatClock(remainingSeconds).slice(0, 5)} bis zum Tagesziel`
        : "Tagesziel erreicht";
      $("#breakTimerHint").textContent = active.is_paused ? "Gesamte Pause läuft weiter" : values.breakSeconds ? "Pause heute gesamt" : "Noch keine Pause";
      $("#todayEarnings").textContent = formatMoney(grossForMinutes(active.work_date, values.netSeconds / 60));
    };
    tick(); state.ticker = setInterval(tick, 1000);
  }

  function renderFinishedCard(entry) {
    const target = targetPerDay(entry.work_date);
    const delta = entry.worked_minutes - target;
    const isX = entry.type === "X";
    $("#finishedLead").textContent = isX ? "Tagesziel erfüllt." : "Feierabend.";
    $("#finishedHeadline").textContent = isX ? "Für heute sind" : "Heute hast du";
    $("#finishedUnit").textContent = isX ? "verbucht." : "gearbeitet.";
    $("#finishedDuration").textContent = formatDuration(entry.worked_minutes);
    $("#finishedSpanLabel").textContent = isX ? "Erfassung" : "Beginn – Ende";
    $("#finishedSpan").textContent = isX ? "Ohne Uhrzeit" : `${entry.start_time?.slice(0, 5) || "–"} – ${entry.end_time?.slice(0, 5) || "–"}`;
    $("#finishedBreak").textContent = isX ? "–" : formatDuration(entry.recorded_break_minutes);
    $("#finishedEarned").textContent = formatMoney(entry.estimated_gross_eur || 0);
    $("#finishedBalance").textContent = formatSigned(delta);
    $("#finishedBalance").classList.toggle("negative", delta < 0);
    $("#finishedMessage").textContent = isX
      ? "Dein Tagesziel ist vollständig erfüllt und gespeichert."
      : delta >= 0
      ? `Tagesziel geschafft${delta > 0 ? ` · ${formatDuration(delta)} darüber` : ""}. Deine Zeit ist sicher gespeichert.`
      : `${formatDuration(-delta)} bis zum Tagesziel. Deine Zeit ist sicher gespeichert.`;
  }

  function renderVacationCountdown() {
    const vacation = state.nextVacation;
    if (!vacation) {
      $("#vacationCountdown").textContent = "Nächster Urlaub";
      $("#vacationCountdownDetail").textContent = "Noch keiner eingetragen.";
      return;
    }
    const start = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long" }).format(parseISO(vacation.start_date));
    const end = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long" }).format(parseISO(vacation.end_date));
    $("#vacationCountdown").textContent = vacation.days_until === 0 ? "Heute hast du Urlaub" : vacation.days_until === 1 ? "Noch 1 Tag bis zum Urlaub" : `Noch ${vacation.days_until} Tage bis zum Urlaub`;
    $("#vacationCountdownDetail").textContent = `${start}${vacation.end_date !== vacation.start_date ? ` – ${end}` : ""} · ${vacation.workdays} ${vacation.workdays === 1 ? "Urlaubstag" : "Urlaubstage"}`;
  }

  function renderPauseAdvice(todays) {
    const box = $("#pauseAdvice");
    const timed = todays.find(entry => ["B", "H"].includes(entry.type));
    if (todays.length && !timed) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    if (timed && timed.missing_break_minutes > 0) {
      const missing = timed.missing_break_minutes;
      box.classList.add("warning");
      box.innerHTML = `<svg aria-hidden="true"><use href="#i-shield"></use></svg><div><b>${missing} Minuten Mindestpause fehlen</b><span>Die fehlende Pause wird automatisch von der Arbeitszeit abgezogen.</span></div>`;
      return;
    }
    box.classList.remove("warning");
    const text = state.settings.age_group === "minor"
      ? "Ab 4:30 Stunden gelten mindestens 30, ab 6 Stunden 60 Minuten Pause."
      : "Ab 6 Stunden gelten mindestens 30, ab 9 Stunden 45 Minuten Pause.";
    box.innerHTML = `<svg aria-hidden="true"><use href="#i-shield"></use></svg><div><b>Pausen im Blick</b><span>${text}</span></div>`;
  }

  function renderCalendar() {
    const shown = state.calendarDate;
    $("#calendarMonth").textContent = `${MONTHS[shown.getMonth()]} ${shown.getFullYear()}`;
    const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(start.getDate() - offset);
    const todayKey = isoDate(new Date());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(start); day.setDate(start.getDate() + i);
      const key = isoDate(day);
      const entry = entriesOn(key)[0];
      let label = "";
      if (entry) {
        const value = entry.start_time ? `${formatDuration(minutesOn(key))} Std.` : entry.type_label;
        label = `<div class="calendar-entry type-${entry.type}"><b>${entry.type}</b><span>${escapeHTML(value)}</span></div>`;
      }
      const dayLabel = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(day);
      cells.push(`<button type="button" class="calendar-day ${day.getMonth() !== shown.getMonth() ? "muted" : ""} ${key === todayKey ? "today" : ""} ${key === state.calendarDay ? "selected" : ""} ${entry ? "has-entry" : ""}" data-date="${key}" aria-label="${escapeHTML(dayLabel)}${entry ? `, ${entry.start_time ? `${formatDuration(minutesOn(key))} Stunden` : entry.type_label}` : ", kein Eintrag"}"><span class="day-number">${day.getDate()}</span>${label}</button>`);
    }
    $("#calendarGrid").innerHTML = cells.join("");
    $$(".calendar-day").forEach(button => button.addEventListener("click", () => openCalendarDay(button.dataset.date)));
  }

  function renderCalendarDay() {
    const day = state.calendarDay;
    const entry = entriesOn(day)[0];
    const target = targetPerDay(day);
    $("#calendarDayTitle").textContent = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(parseISO(day));
    $("#editCalendarDay").textContent = entry ? "Eintrag bearbeiten" : "Eintrag hinzufügen";
    if (!entry) {
      $("#calendarDayContent").innerHTML = `<div class="calendar-day-state empty"><span class="calendar-day-symbol"><svg aria-hidden="true"><use href="#i-calendar"></use></svg></span><div><b>Noch kein Eintrag</b><p>${target ? `Tagesziel ${formatDuration(target)} Std.` : "Laut Arbeitsmodell frei."}</p></div></div>`;
      return;
    }
    const timed = ["B", "H"].includes(entry.type);
    const facts = timed
      ? [["Beginn", entry.start_time?.slice(0, 5) || "–"], ["Ende", entry.end_time?.slice(0, 5) || "Läuft"], ["Pause", formatDuration(entry.recorded_break_minutes)], ["Arbeitszeit", formatDuration(entry.worked_minutes)]]
      : entry.type === "X"
        ? [["Tagesziel", formatDuration(target)], ["Zusätzlich", formatDuration(entry.extra_work_minutes || 0)], ["Verbucht", formatDuration(entry.worked_minutes)], ["Zeitkonto", formatSigned(entry.account_minutes - target)]]
        : [["Tagesziel", formatDuration(target)], ["Als Arbeit", "0:00"], ["Urlaubstage", entry.type === "U" ? "1" : "0"], ["Zeitkonto", formatSigned(entry.account_minutes - target)]];
    const note = entry.note ? `<p class="calendar-day-note">${escapeHTML(entry.note)}</p>` : "";
    const earned = entry.estimated_gross_eur ? `<div class="calendar-day-earned"><span>Brutto für diesen Tag (geschätzt)</span><b>${formatMoney(entry.estimated_gross_eur)}</b></div>` : "";
    $("#calendarDayContent").innerHTML = `<div class="calendar-day-state"><span class="calendar-day-symbol type-${escapeHTML(entry.type)}">${escapeHTML(entry.type)}</span><div><b>${escapeHTML(entry.type_label)}</b><p>${timed ? entry.is_running ? "Zeiterfassung läuft" : "Arbeitszeit gespeichert" : entry.type === "X" ? "Tagesziel erfüllt" : "Als freier Tag berücksichtigt"}</p></div></div><div class="calendar-day-facts">${facts.map(([label, value]) => `<div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join("")}</div>${earned}${note}`;
  }

  async function openCalendarDay(day) {
    state.calendarDay = day;
    const chosen = parseISO(day);
    state.calendarDate = new Date(chosen.getFullYear(), chosen.getMonth(), 1);
    if (chosen.getFullYear() !== state.loadedYear) await loadYear(chosen.getFullYear(), true);
    renderCalendar();
    renderCalendarDay();
    if (!$("#calendarDayDialog").open) $("#calendarDayDialog").showModal();
  }

  async function moveCalendarDay(offset) {
    const day = parseISO(state.calendarDay);
    day.setDate(day.getDate() + offset);
    await openCalendarDay(isoDate(day));
  }

  async function selectDay(dateValue) {
    const keepScrollPosition = document.body.dataset.view === "dashboard";
    const selected = typeof dateValue === "string" ? parseISO(dateValue) : new Date(dateValue);
    selected.setHours(0, 0, 0, 0);
    state.selectedDay = isoDate(selected);
    state.calendarDate = new Date(selected.getFullYear(), selected.getMonth(), 1);
    if (selected.getFullYear() !== state.loadedYear) await loadYear(selected.getFullYear(), true);
    else {
      renderDashboard();
      renderCalendar();
    }
    setView("dashboard", { scroll: !keepScrollPosition });
  }

  async function moveSelectedDay(offset) {
    const selected = parseISO(state.selectedDay);
    selected.setDate(selected.getDate() + offset);
    await selectDay(selected);
  }

  function renderLegend() {
    $("#legendList").innerHTML = Object.entries(TYPE_LABELS).map(([code, label]) => `<div class="legend-item"><span class="legend-code ${code}">${code}</span><span>${escapeHTML(label)}</span></div>`).join("");
  }

  function renderReports() {
    const year = state.loadedYear;
    const select = $("#reportYear");
    if (!select.options.length) {
      const current = new Date().getFullYear();
      for (let y = current + 1; y >= current - 7; y--) select.add(new Option(String(y), String(y)));
    }
    select.value = String(year);
    $("#csvExport").href = `api/export.csv?year=${year}`;
    const worked = state.entries.reduce((sum, entry) => sum + entry.worked_minutes, 0);
    const todayKey = isoDate(new Date());
    const account = state.entries.filter(entry => entry.work_date <= todayKey).reduce((sum, entry) => sum + entry.account_minutes, 0);
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const target = year > new Date().getFullYear() ? 0 : targetBetween(yearStart, yearEnd, year === new Date().getFullYear());
    const previous = year === new Date().getFullYear() ? Number(state.settings.previous_balance_minutes || 0) : 0;
    const balance = account - target + previous;
    const vacationUsed = state.entries.filter(entry => entry.type === "U").length;
    const vacationTotal = vacationAllowance(year) + (year === new Date().getFullYear() ? Number(state.settings.vacation_carryover) : 0);
    $("#reportBalance").textContent = formatSigned(balance);
    $("#reportWorked").textContent = formatDuration(worked);
    $("#reportTarget").textContent = `von ${formatDuration(target)} Stunden`;
    $("#reportVacation").textContent = `${vacationUsed} / ${vacationTotal}`;
    $("#reportHome").textContent = state.entries.filter(entry => entry.type === "H").length;
    $("#reportGross").textContent = formatMoney(state.entries.filter(entry => entry.work_date <= todayKey).reduce((sum, entry) => sum + Number(entry.estimated_gross_eur || 0), 0));

    const weekdayData = Array.from({ length: 7 }, () => []);
    const byDate = new Map();
    state.entries.forEach(entry => {
      const current = byDate.get(entry.work_date) || { worked: 0, account: 0 };
      current.worked += Number(entry.worked_minutes || 0);
      current.account += Number(entry.account_minutes || 0);
      byDate.set(entry.work_date, current);
    });
    byDate.forEach((values, key) => {
      if (values.worked > 0) weekdayData[weekdayIndex(parseISO(key))].push(values.worked);
    });
    const weekdayAverages = weekdayData.map(values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
    const maxAverage = Math.max(1, ...weekdayAverages);
    $("#weekdayChart").innerHTML = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((name, index) => `<div class="weekday-column" title="${name}: Ø ${formatDuration(weekdayAverages[index])} Std."><b>${weekdayAverages[index] ? formatDuration(weekdayAverages[index]) : "–"}</b><div><span style="height:${Math.round(weekdayAverages[index] / maxAverage * 100)}%"></span></div><small>${name}</small></div>`).join("");

    const trackingStart = state.settings.tracking_start_date ? parseISO(state.settings.tracking_start_date) : yearStart;
    const streakStart = new Date(Math.max(yearStart.getTime(), trackingStart.getTime()));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const streakEnd = new Date(Math.min(yearEnd.getTime(), today.getTime()));
    let currentStreak = 0, bestStreak = 0, goalsReached = 0, scheduledDays = 0;
    for (const cursor = new Date(streakStart); cursor <= streakEnd; cursor.setDate(cursor.getDate() + 1)) {
      const dayTarget = targetPerDay(cursor);
      if (!dayTarget) continue;
      scheduledDays += 1;
      const reached = (byDate.get(isoDate(cursor))?.account || 0) >= dayTarget;
      if (reached) {
        goalsReached += 1;
        currentStreak += 1;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    $("#currentStreak").textContent = currentStreak;
    $("#goalsReached").textContent = goalsReached;
    $("#goalRate").textContent = `${Math.round(goalsReached / Math.max(1, scheduledDays) * 100)} %`;
    $("#bestStreak").textContent = bestStreak;

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    $("#monthList").innerHTML = MONTHS.map((name, month) => {
      const entries = state.entries.filter(entry => parseISO(entry.work_date).getMonth() === month);
      const actual = entries.reduce((sum, entry) => sum + entry.worked_minutes, 0);
      const account = entries.filter(entry => entry.work_date <= todayKey).reduce((sum, entry) => sum + entry.account_minutes, 0);
      const first = new Date(year, month, 1), last = new Date(year, month + 1, 0);
      const monthTarget = targetBetween(first, last, year === currentYear);
      const saldo = account - monthTarget;
      const ratio = Math.min(100, Math.round(actual / Math.max(1, monthTarget) * 100));
      const future = year > currentYear || (year === currentYear && month > currentMonth);
      return `<div class="month-row ${future ? "future" : ""}"><span class="month-name">${name}</span><div class="month-track"><div class="month-fill" style="width:${future ? 0 : ratio}%"></div></div><span class="numeric">${future ? "–" : formatDuration(actual)}</span><span class="numeric">${future ? "–" : formatDuration(monthTarget)}</span><span class="numeric saldo ${saldo < 0 ? "negative" : ""}">${future ? "–" : formatSigned(saldo)}</span></div>`;
    }).join("");
  }

  function renderSettings() {
    const s = state.settings;
    $("#settingName").value = s.display_name || "";
    const targets = dailyTargets();
    $("#settingHours").value = (targets.reduce((sum, value) => sum + value, 0) / 60).toFixed(2).replace(/\.00$/, "");
    targets.forEach((value, index) => { $(`#settingDay${index}`).value = formatHoursMinutes(value); });
    $("#settingAge").value = s.age_group;
    $("#settingStartDate").value = s.tracking_start_date || isoDate(new Date());
    $("#settingVacationYear").value = state.vacationYear;
    $("#settingVacation").value = vacationAllowance(state.vacationYear);
    $("#settingMonthlyGross").value = Number(s.monthly_gross_eur || 0);
    $("#settingCarry").value = s.vacation_carryover;
    $("#settingBalance").value = s.previous_balance_minutes;
    $("#settingAutoBreak").checked = Boolean(s.auto_break_deduction);
    $("#settingLiveActivity").checked = Boolean(s.live_activity_enabled);
    $("#settingMilestones").checked = Boolean(s.milestone_notifications_enabled);
    $("#settingMilestoneStyle").value = s.milestone_notification_style || "saying_money";
    $("#settingGoalNotification").checked = s.goal_notification_enabled !== false;
    $("#settingEndSummary").checked = s.end_summary_enabled !== false;
    $("#settingLiveService").value = s.live_activity_service || "";
    const theme = ["system", "light", "dark"].includes(s.theme) ? s.theme : "system";
    const themeInput = $(`input[name="theme"][value="${theme}"]`);
    if (themeInput) themeInput.checked = true;
    applyTheme(theme);
    renderNotificationExamples();
    const finishedToday = state.todayEntries.find(entry => ["B", "H"].includes(entry.type) && entry.finalized);
    $("#reopenTimer").disabled = !finishedToday;
    $("#reopenHint").textContent = finishedToday
      ? `Heute um ${finishedToday.end_time?.slice(0, 5) || "–"} Uhr abgeschlossen.`
      : "Heute liegt kein abgeschlossener Arbeitstag vor.";
    if (!$("#xExtraDate").value) $("#xExtraDate").value = isoDate(new Date());
    const selectedX = state.entries.find(entry => entry.work_date === $("#xExtraDate").value && entry.type === "X");
    if (selectedX) $("#xExtraDuration").value = formatHoursMinutes(selectedX.extra_work_minutes || 0);
  }

  function renderNotificationExamples() {
    const monthly = Math.max(0, Number($("#settingMonthlyGross").value) || 0);
    const targets = Array.from({ length: 7 }, (_, index) => minutesFromTime($(`#settingDay${index}`).value));
    const target = targets[weekdayIndex(new Date())] || targets.find(value => value > 0) || 480;
    const style = $("#settingMilestoneStyle").value;
    const examples = [
      [25, "Der Anfang ist gemacht – weiter so!"],
      [50, "Halbzeit – bleib dran!"],
      [75, "Der Endspurt beginnt!"],
    ];
    const preview = examples.map(([percent, saying]) => {
      const earnings = monthly > 0 ? ` Heute verdient: ca. ${formatMoney(grossForMinutes(new Date(), target * percent / 100, monthly))} brutto.` : "";
      const title = style === "percent" ? "Zeitwerk · Fortschritt" : style === "saying" ? "Zeitwerk · Motivation" : `Zeitwerk · ${percent} %`;
      const message = style === "percent" ? `${percent} % deines Tagesziels geschafft.` : style === "saying" ? saying : saying + earnings;
      return `<div class="notification-example"><span class="notification-example-icon"><svg aria-hidden="true"><use href="#i-timer"></use></svg></span><span><b>${escapeHTML(title)}</b><small>${escapeHTML(message)}</small></span></div>`;
    });
    preview.push(`<div class="notification-example"><span class="notification-example-icon"><svg aria-hidden="true"><use href="#i-shield"></use></svg></span><span><b>Zeitwerk · Tagesziel erreicht</b><small>Dein Soll von ${escapeHTML(formatDuration(target))} Std. ist geschafft. Ab jetzt sammelst du Pluszeit.</small></span></div>`);
    preview.push(`<div class="notification-example"><span class="notification-example-icon"><svg aria-hidden="true"><use href="#i-sun"></use></svg></span><span><b>Zeitwerk · Feierabend</b><small>Beispiel: Heute +00:30 zum Soll · Konto −01:15${monthly > 0 ? ` · ${escapeHTML(formatMoney(grossForMinutes(new Date(), target, monthly)))} brutto` : ""}</small></span></div>`);
    $("#notificationExamples").innerHTML = preview.join("");
  }

  function setView(name, { scroll = true } = {}) {
    const desiredYear = name === "dashboard" ? parseISO(state.selectedDay).getFullYear() : name === "calendar" ? state.calendarDate.getFullYear() : state.loadedYear;
    if (desiredYear !== state.loadedYear) {
      loadYear(desiredYear, true).then(() => setView(name));
      return;
    }
    $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
    document.body.dataset.view = name;
    $$(".nav-item[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === name));
    const titles = { dashboard: "Dein Arbeitstag", calendar: "Kalender", reports: "Jahresübersicht", settings: "Einstellungen" };
    if (name !== "dashboard") $("#pageTitle").textContent = titles[name]; else renderHeader();
    history.replaceState(null, "", `#${name}`);
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openEntryDialog(dateValue = isoDate(new Date()), entryId = null) {
    const dayEntries = entriesOn(dateValue);
    const existing = entryId ? state.entries.find(item => item.id === entryId) : dayEntries.find(item => ["B", "H"].includes(item.type)) || dayEntries[0];
    $("#entryDialogTitle").textContent = existing ? "Arbeitszeit korrigieren" : "Arbeitszeit nachtragen";
    $("#entryId").value = existing?.id || "";
    $("#entryDate").value = existing?.work_date || dateValue;
    const type = existing?.type || "B";
    const typeInput = $(`input[name="entryType"][value="${type}"]`);
    if (typeInput) typeInput.checked = true;
    $("#entryStart").value = existing?.start_time?.slice(0, 5) || "09:00";
    $("#entryEnd").value = existing?.end_time?.slice(0, 5) || "17:00";
    $("#entryBreak").value = formatHoursMinutes(existing?.recorded_break_minutes ?? 30);
    $("#entryCommute").checked = Boolean(existing?.commute);
    $("#entryNote").value = existing?.note || "";
    $("#deleteEntry").classList.toggle("hidden", !existing);
    toggleTimedFields(type);
    $("#entryDialog").showModal();
  }

  function toggleTimedFields(type) {
    const timed = ["B", "H"].includes(type);
    $("#timedFields").classList.toggle("hidden", !timed);
    $("#entryStart").required = timed;
    $("#entryEnd").required = timed;
    $("#entryVacationRange").classList.toggle("hidden", type !== "U");
    if (type === "H") $("#entryCommute").checked = false;
  }

  async function timerAction(action) {
    if (action === "stop" && !window.confirm("Arbeitstag wirklich abschließen? Danach ist der Timer für heute gesperrt. Falls nötig, kannst du ihn nur unter Einstellungen → Daten & Sicherung → Erweiterte Korrekturen wieder öffnen.")) return;
    setTimerBusy(true);
    try {
      const payload = action === "start" ? { type: state.selectedTimerType } : {};
      const result = await api(`api/timer/${action}`, { method: "POST", body: JSON.stringify(payload) });
      const messages = { start: "Arbeitszeit gestartet", pause: "Pause gestartet", resume: "Pause gestoppt – Arbeitszeit läuft weiter", stop: "Arbeitstag abgeschlossen und gespeichert" };
      toast(messages[action]);
      await loadYear(new Date().getFullYear(), true);
    } catch (error) {
      $("#connectionBanner").classList.remove("hidden");
      toast(error.message, true);
    } finally { setTimerBusy(false); }
  }

  async function reopenTimer() {
    if (!window.confirm("Abgeschlossenen Arbeitstag wirklich wieder öffnen? Die Zeit seit dem Ende wird als Pause erfasst und die Arbeitszeit läuft sofort weiter.")) return;
    try {
      await api("api/timer/reopen", { method: "POST", body: "{}" });
      toast("Arbeitstag wieder geöffnet");
      state.selectedDay = isoDate(new Date());
      await loadYear(new Date().getFullYear(), true);
      setView("dashboard");
    } catch (error) { toast(error.message, true); }
  }

  async function saveXExtra() {
    const workDate = $("#xExtraDate").value;
    const extra = $("#xExtraDuration").value;
    if (!workDate || !extra) return toast("Datum und Zusatzzeit angeben", true);
    try {
      await api("api/entries/x-extra", { method: "POST", body: JSON.stringify({ work_date: workDate, extra_duration: extra }) });
      await loadYear(parseISO(workDate).getFullYear(), true);
      toast("Zusätzliche X-Stunden gespeichert");
    } catch (error) { toast(error.message, true); }
  }

  function openVacationDialog(day = isoDate(new Date())) {
    $("#vacationStart").value = day;
    $("#vacationEnd").value = day;
    $("#vacationNote").value = "";
    updateVacationRangePreview();
    $("#vacationDialog").showModal();
  }

  function calendarFocusDay() {
    const month = isoDate(state.calendarDate).slice(0, 7);
    return state.selectedDay.slice(0, 7) === month ? state.selectedDay : isoDate(state.calendarDate);
  }

  function openDayOffDialog(day = calendarFocusDay()) {
    $("#dayOffDate").value = day;
    $("#dayOffNote").value = "";
    $("#dayOffDialog").showModal();
  }

  async function saveDayOff(event) {
    event.preventDefault();
    const workDate = $("#dayOffDate").value;
    try {
      await api("api/entries", {
        method: "POST",
        body: JSON.stringify({ work_date: workDate, type: "FT", break_duration: "00:00", note: $("#dayOffNote").value }),
      });
      $("#dayOffDialog").close();
      state.selectedDay = workDate;
      const shown = parseISO(workDate);
      state.calendarDate = new Date(shown.getFullYear(), shown.getMonth(), 1);
      await loadYear(shown.getFullYear(), true);
      setView("calendar");
      toast("Arbeitsfreier Tag gespeichert");
    } catch (error) { toast(error.message, true); }
  }

  function updateVacationRangePreview() {
    const first = $("#vacationStart").value;
    const last = $("#vacationEnd").value;
    const box = $("#vacationRangePreview");
    if (!first || !last || last < first) {
      box.textContent = "Bitte einen gültigen Zeitraum wählen.";
      box.classList.add("warning");
      return;
    }
    const days = Math.round((parseISO(last) - parseISO(first)) / 86400000) + 1;
    if (days > 367) {
      box.textContent = "Bitte höchstens 367 Kalendertage auswählen.";
      box.classList.add("warning");
      return;
    }
    let workdays = 0;
    for (let index = 0; index < days; index++) {
      const day = parseISO(first); day.setDate(day.getDate() + index);
      if (targetPerDay(day) > 0) workdays++;
    }
    box.classList.remove("warning");
    box.textContent = `Bis zu ${workdays} ${workdays === 1 ? "Arbeitstag" : "Arbeitstage"} als Urlaub · ${days - workdays} laut Arbeitsmodell frei. Bereits eingetragene freie Tage werden zusätzlich ausgelassen.`;
  }

  async function saveVacationRange(event) {
    event.preventDefault();
    const payload = { start_date: $("#vacationStart").value, end_date: $("#vacationEnd").value, note: $("#vacationNote").value };
    try {
      const result = await api("api/vacation/range", { method: "POST", body: JSON.stringify(payload) });
      $("#vacationDialog").close();
      toast(result.added ? `${result.added} Urlaubstage eingetragen${result.free_days ? ` · ${result.free_days} freie Tage ausgelassen` : ""}` : "Diese Urlaubstage waren bereits eingetragen");
      state.calendarDate = new Date(parseISO(payload.start_date).getFullYear(), parseISO(payload.start_date).getMonth(), 1);
      await loadYear(parseISO(payload.start_date).getFullYear(), true);
      setView("calendar");
    } catch (error) { toast(error.message, true); }
  }

  function setTimerBusy(busy) {
    state.timerBusy = busy;
    updateTimerButtons();
  }

  async function saveEntry(event) {
    event.preventDefault();
    const type = $("input[name='entryType']:checked").value;
    const id = $("#entryId").value;
    const payload = {
      work_date: $("#entryDate").value,
      type,
      start_time: ["B", "H"].includes(type) ? $("#entryStart").value : null,
      end_time: ["B", "H"].includes(type) ? $("#entryEnd").value : null,
      break_duration: ["B", "H"].includes(type) ? $("#entryBreak").value : "00:00",
      commute: type === "B" && $("#entryCommute").checked,
      note: $("#entryNote").value,
    };
    try {
      await api(id ? `api/entries/${id}` : "api/entries", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      $("#entryDialog").close();
      toast("Eintrag gespeichert");
      const returnToCalendar = state.entryReturnView === "calendar";
      state.entryReturnView = null;
      if (!returnToCalendar) state.selectedDay = payload.work_date;
      await loadYear(parseISO(payload.work_date).getFullYear(), true);
      if (returnToCalendar) { setView("calendar"); await openCalendarDay(payload.work_date); }
    } catch (error) { toast(error.message, true); }
  }

  async function deleteCurrentEntry() {
    const id = $("#entryId").value;
    if (!id || !window.confirm("Diesen Eintrag wirklich löschen?")) return;
    try {
      await api(`api/entries/${id}`, { method: "DELETE" });
      $("#entryDialog").close();
      toast("Eintrag gelöscht");
      const returnToCalendar = state.entryReturnView === "calendar";
      state.entryReturnView = null;
      await loadYear(returnToCalendar ? parseISO(state.calendarDay).getFullYear() : state.loadedYear, true);
      if (returnToCalendar) { setView("calendar"); await openCalendarDay(state.calendarDay); }
    } catch (error) { toast(error.message, true); }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const targets = Array.from({ length: 7 }, (_, index) => minutesFromTime($(`#settingDay${index}`).value));
    const workdays = targets.map((value, index) => value > 0 ? index : null).filter(value => value !== null);
    if (!workdays.length) return toast("Bitte mindestens für einen Tag eine Arbeitszeit festlegen", true);
    const vacationYear = String(Number($("#settingVacationYear").value));
    const vacationValues = { ...(state.settings.vacation_allowance_by_year || {}), [vacationYear]: Number($("#settingVacation").value) };
    const payload = {
      display_name: $("#settingName").value.trim(),
      weekly_hours: targets.reduce((sum, value) => sum + value, 0) / 60,
      workdays,
      daily_work_minutes: targets,
      age_group: $("#settingAge").value,
      tracking_start_date: $("#settingStartDate").value,
      vacation_allowance: Number($("#settingVacation").value),
      vacation_allowance_by_year: vacationValues,
      vacation_carryover: Number($("#settingCarry").value),
      monthly_gross_eur: Number($("#settingMonthlyGross").value),
      previous_balance_minutes: Number($("#settingBalance").value),
      auto_break_deduction: $("#settingAutoBreak").checked,
      theme: $("input[name='theme']:checked").value,
      live_activity_enabled: $("#settingLiveActivity").checked,
      live_activity_service: $("#settingLiveService").value.trim(),
      milestone_notifications_enabled: $("#settingMilestones").checked,
      milestone_notification_style: $("#settingMilestoneStyle").value,
      goal_notification_enabled: $("#settingGoalNotification").checked,
      end_summary_enabled: $("#settingEndSummary").checked,
    };
    try {
      await api("api/settings", { method: "POST", body: JSON.stringify(payload) });
      $("#settingsHint").textContent = "Gespeichert";
      setTimeout(() => { $("#settingsHint").textContent = ""; }, 2200);
      toast("Einstellungen gespeichert");
      await loadYear(state.loadedYear, true);
    } catch (error) { toast(error.message, true); }
  }

  async function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!window.confirm("Die Sicherung ersetzt alle aktuellen Einträge. Fortfahren?")) { event.target.value = ""; return; }
    try {
      const payload = JSON.parse(await file.text());
      const result = await api("api/import", { method: "POST", body: JSON.stringify(payload) });
      toast(`${result.imported} Einträge wiederhergestellt`);
      await loadYear(new Date().getFullYear(), true);
    } catch (error) { toast(error.message || "Sicherung konnte nicht gelesen werden", true); }
    event.target.value = "";
  }

  async function testLiveActivity() {
    const service = $("#settingLiveService").value.trim();
    if (!service) return toast("Bitte zuerst die mobile_app-Aktion eintragen", true);
    try {
      await api("api/settings", {
        method: "POST",
        body: JSON.stringify({ live_activity_service: service }),
      });
      await api("api/live-activity/test", { method: "POST", body: "{}" });
      toast("Test an dein iPhone gesendet");
    } catch (error) { toast(error.message, true); }
  }

  function bindEvents() {
    $$(".nav-item[data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
    $$("[data-go]").forEach(button => button.addEventListener("click", () => setView(button.dataset.go)));
    ["#openEntry", "#mobileAdd"].forEach(selector => $(selector).addEventListener("click", () => { state.entryReturnView = null; openEntryDialog(state.selectedDay); }));
    $("#manualAdjust").addEventListener("click", () => { state.entryReturnView = null; openEntryDialog(); });
    $("#openTodayEntry").addEventListener("click", () => { state.entryReturnView = null; openEntryDialog(state.selectedDay); });
    $("#prevDay").addEventListener("click", () => moveSelectedDay(-1));
    $("#nextDay").addEventListener("click", () => moveSelectedDay(1));
    $("#jumpToday").addEventListener("click", () => selectDay(new Date()));
    $("#startTimer").addEventListener("click", () => timerAction("start"));
    $("#pauseTimer").addEventListener("click", () => timerAction("pause"));
    $("#resumeTimer").addEventListener("click", () => timerAction("resume"));
    $("#stopTimer").addEventListener("click", () => timerAction("stop"));
    $("#reopenTimer").addEventListener("click", reopenTimer);
    $("#saveXExtra").addEventListener("click", saveXExtra);
    $("#xExtraDate").addEventListener("change", () => {
      const entry = state.entries.find(item => item.work_date === $("#xExtraDate").value && item.type === "X");
      $("#xExtraDuration").value = formatHoursMinutes(entry?.extra_work_minutes || 0);
    });
    $("#closeCalendarDay").addEventListener("click", () => $("#calendarDayDialog").close());
    $("#calendarDayPrev").addEventListener("click", () => moveCalendarDay(-1));
    $("#calendarDayNext").addEventListener("click", () => moveCalendarDay(1));
    $("#editCalendarDay").addEventListener("click", () => {
      $("#calendarDayDialog").close();
      state.entryReturnView = "calendar";
      openEntryDialog(state.calendarDay);
    });
    $("#openVacationHome").addEventListener("click", () => openVacationDialog(isoDate(new Date())));
    $("#openVacationCalendar").addEventListener("click", () => openVacationDialog(calendarFocusDay()));
    $("#openDayOffCalendar").addEventListener("click", () => openDayOffDialog());
    $("#dayOffForm").addEventListener("submit", saveDayOff);
    $("#cancelDayOff").addEventListener("click", () => $("#dayOffDialog").close());
    $("#closeDayOff").addEventListener("click", () => $("#dayOffDialog").close());
    $("#entryVacationRange").addEventListener("click", () => {
      const day = $("#entryDate").value;
      $("#entryDialog").close();
      openVacationDialog(day);
    });
    $("#vacationForm").addEventListener("submit", saveVacationRange);
    $("#vacationStart").addEventListener("change", updateVacationRangePreview);
    $("#vacationEnd").addEventListener("change", updateVacationRangePreview);
    $("#cancelVacation").addEventListener("click", () => $("#vacationDialog").close());
    $("#closeVacation").addEventListener("click", () => $("#vacationDialog").close());
    $$("#timerTypePicker button").forEach(button => button.addEventListener("click", () => {
      state.selectedTimerType = button.dataset.type;
      $$("#timerTypePicker button").forEach(item => item.classList.toggle("active", item === button));
    }));
    $$(`input[name="entryType"]`).forEach(input => input.addEventListener("change", () => toggleTimedFields(input.value)));
    $("#entryForm").addEventListener("submit", saveEntry);
    $("#cancelEntry").addEventListener("click", () => { state.entryReturnView = null; $("#entryDialog").close(); });
    $(".dialog-close").addEventListener("click", () => { state.entryReturnView = null; $("#entryDialog").close(); });
    $("#deleteEntry").addEventListener("click", deleteCurrentEntry);
    $("#settingsForm").addEventListener("submit", saveSettings);
    $("#settingMilestoneStyle").addEventListener("change", renderNotificationExamples);
    $$("#dailyTargetGrid input").forEach(input => input.addEventListener("input", () => {
      const total = Array.from({ length: 7 }, (_, index) => minutesFromTime($(`#settingDay${index}`).value)).reduce((sum, value) => sum + value, 0);
      $("#settingHours").value = (total / 60).toFixed(2).replace(/\.00$/, "");
      renderNotificationExamples();
    }));
    $("#settingMonthlyGross").addEventListener("input", renderNotificationExamples);
    $("#settingVacationYear").addEventListener("change", event => {
      state.vacationYear = Number(event.target.value) || new Date().getFullYear();
      $("#settingVacation").value = vacationAllowance(state.vacationYear);
    });
    $("#testLiveActivity").addEventListener("click", testLiveActivity);
    $$("input[name='theme']").forEach(input => input.addEventListener("change", () => applyTheme(input.value)));
    $("#importFile").addEventListener("change", importBackup);
    $("#reconnectButton").addEventListener("click", () => loadYear(new Date().getFullYear()));
    $("#prevMonth").addEventListener("click", async () => {
      state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
      if (state.calendarDate.getFullYear() !== state.loadedYear) await loadYear(state.calendarDate.getFullYear(), true); else renderCalendar();
    });
    $("#nextMonth").addEventListener("click", async () => {
      state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
      if (state.calendarDate.getFullYear() !== state.loadedYear) await loadYear(state.calendarDate.getFullYear(), true); else renderCalendar();
    });
    $("#reportYear").addEventListener("change", event => loadYear(Number(event.target.value), true));
    window.addEventListener("hashchange", () => {
      const name = location.hash.slice(1);
      if (["dashboard", "calendar", "reports", "settings"].includes(name)) setView(name);
    });
  }

  async function registerWebMCP() {
    if (!document.modelContext?.registerTool) return;
    try {
      await document.modelContext.registerTool({
        name: "start_time_entry_creation",
        title: "Arbeitszeiteintrag vorbereiten",
        description: "Öffnet in Zeitwerk den Dialog für einen neuen Arbeitszeiteintrag.",
        inputSchema: { type: "object", properties: { date: { type: "string", description: "Datum im Format YYYY-MM-DD" } }, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async ({ date } = {}) => {
          if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isoDate(parseISO(date)) !== date)) throw new Error("Datum muss ein gültiges Datum im Format YYYY-MM-DD sein");
          openEntryDialog(date || isoDate(new Date()));
          return { status: "dialog_open", date: date || isoDate(new Date()) };
        }
      });
    } catch { /* Browser unterstützt die optionale Schnittstelle noch nicht vollständig. */ }
  }

  bindEvents();
  themeMedia.addEventListener?.("change", () => {
    if ((document.documentElement.dataset.themePreference || "system") === "system") applyTheme("system", false);
  });
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {}));
  const initialView = ["dashboard", "calendar", "reports", "settings"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "dashboard";
  loadYear(new Date().getFullYear()).then(() => { setView(initialView); registerWebMCP(); });
})();

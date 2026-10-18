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
  const GERMAN_STATES = { BW: "Baden-Württemberg", BY: "Bayern", BE: "Berlin", BB: "Brandenburg", HB: "Bremen", HH: "Hamburg", HE: "Hessen", MV: "Mecklenburg-Vorpommern", NI: "Niedersachsen", NW: "Nordrhein-Westfalen", RP: "Rheinland-Pfalz", SL: "Saarland", SN: "Sachsen", ST: "Sachsen-Anhalt", SH: "Schleswig-Holstein", TH: "Thüringen" };
  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

  function applyTheme(preference = "system", remember = true) {
    const safePreference = ["system", "light", "dark"].includes(preference) ? preference : "system";
    const dark = safePreference === "dark" || (safePreference === "system" && themeMedia.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.themePreference = safePreference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#15171c" : "#f5f5f7");
    if (remember) localStorage.setItem("zeitwerk-theme", safePreference);
  }

  const state = {
    settings: null,
    entries: [],
    todayEntries: [],
    active: null,
    summary: null,
    currentAccount: null,
    liveActivity: null,
    nextVacation: null,
    holidays: null,
    vacationPeriods: [],
    vacationAllowancesDraft: {},
    vacationYearDirty: false,
    vacationReturnView: null,
    loadedYear: new Date().getFullYear(),
    calendarDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDay: isoDate(new Date()),
    calendarDay: isoDate(new Date()),
    entryReturnView: null,
    selectedTimerType: "B",
    vacationYear: new Date().getFullYear(),
    ticker: null,
    timerBusy: false,
    pendingSettings: new Map(),
    settingsRevision: 0,
    settingsSaveTimer: null,
    settingsSavePromise: null,
    settingsRetryDelay: 2000,
    vacationEditing: null,
    reportMode: "month",
    reportPeriods: [],
    selectedPeriod: null,
    noteRevision: 0,
    noteSavedRevision: 0,
    noteSaveTimer: null,
    noteSavePromise: null,
    noteRetryDelay: 2000,
    refreshBusy: false,
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

  async function loadYear(year = state.loadedYear, quiet = false, keepSettings = false) {
    if (!quiet) document.body.classList.remove("loaded");
    try {
      const data = await api(`api/state?from=${year}-01-01&to=${year}-12-31`);
      state.settings = data.settings;
      state.entries = data.entries;
      state.todayEntries = data.today_entries || [];
      state.active = data.active;
      state.summary = data.summary;
      state.currentAccount = data.current_account || null;
      state.liveActivity = data.live_activity || null;
      state.nextVacation = data.next_vacation || null;
      state.holidays = data.holidays || null;
      state.vacationPeriods = data.vacation_periods || [];
      state.loadedYear = year;
      $("#connectionBanner").classList.add("hidden");
      renderAll(keepSettings || state.pendingSettings.size > 0 || Boolean(state.settingsSavePromise));
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

  function effectiveValues(key, dayValue = new Date()) {
    const day = typeof dayValue === "string" ? dayValue : isoDate(dayValue);
    return (state.settings[key] || []).filter(item => item.effective_from <= day).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] || state.settings;
  }

  function dailyTargets(dayValue = new Date()) {
    const configured = effectiveValues("work_model_history", dayValue).daily_work_minutes;
    if (Array.isArray(configured) && configured.length === 7) return configured.map(value => Math.max(0, Number(value) || 0));
    const workdays = state.settings.workdays || [0, 1, 2, 3, 4];
    const perDay = Math.round(Number(state.settings.weekly_hours) * 60 / Math.max(1, workdays.length));
    return Array.from({ length: 7 }, (_, index) => workdays.includes(index) ? perDay : 0);
  }

  function targetPerDay(dayValue = new Date()) {
    const day = typeof dayValue === "string" ? parseISO(dayValue) : new Date(dayValue);
    return dailyTargets(day)[weekdayIndex(day)];
  }

  function overtimeForDay(dayValue = new Date()) {
    const key = typeof dayValue === "string" ? dayValue : isoDate(dayValue);
    return Number(state.settings.overtime_plan_by_date?.[key] || 0);
  }

  function plannedTarget(dayValue = new Date()) {
    return targetPerDay(dayValue) + overtimeForDay(dayValue);
  }

  function renderNoteHTML(text) {
    let list = false, html = "";
    String(text || "").split("\n").forEach(line => {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) {
        if (!list) { html += "<ul>"; list = true; }
        html += `<li>${escapeHTML(bullet[1])}</li>`;
      } else {
        if (list) { html += "</ul>"; list = false; }
        html += line.trim() ? `<p>${escapeHTML(line)}</p>` : "<br>";
      }
    });
    return html + (list ? "</ul>" : "");
  }

  function continueBulletList(event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const input = event.target;
    if (input.selectionStart !== input.selectionEnd) return;
    const cursor = input.selectionStart;
    const lineStart = input.value.lastIndexOf("\n", cursor - 1) + 1;
    const line = input.value.slice(lineStart, cursor);
    const match = line.match(/^(\s*[-*]\s+)(.*)$/);
    if (!match) return;
    event.preventDefault();
    if (match[2].trim()) input.setRangeText("\n" + match[1], cursor, cursor, "end");
    else input.setRangeText("", lineStart, cursor, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
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
    const targets = dailyTargets(dayValue);
    const cursor = new Date(day.getFullYear(), day.getMonth(), 1);
    let count = 0;
    while (cursor.getMonth() === day.getMonth()) {
      if (targets[weekdayIndex(cursor)] > 0) count++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }

  function grossForMinutes(dayValue, minutes, monthlyOverride = null) {
    const salary = effectiveValues("salary_history", dayValue);
    const monthly = Math.max(0, Number(monthlyOverride ?? salary.monthly_gross_eur) || 0);
    if (monthly) {
      const target = targetPerDay(dayValue);
      return target ? monthly / Math.max(1, monthlyWorkdays(dayValue)) * Math.min(1, Math.max(0, minutes) / target) : 0;
    }
    return monthlyOverride !== null ? 0 : Math.max(0, minutes) / 60 * Math.max(0, Number(salary.hourly_gross_eur || 0));
  }

  function isWorkday(day) {
    return targetPerDay(day) > 0;
  }

  function countsForAccount(entry) {
    return !state.settings.tracking_start_date || entry.work_date >= state.settings.tracking_start_date;
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

  function renderAll(keepSettings = false) {
    renderHeader();
    renderDashboard();
    renderCalendar();
    renderReports();
    if (!keepSettings) renderSettings();
    else { renderHolidaySettings(); renderVacationSettings(); }
    renderLegend();
  }

  function renderHeader() {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(now);
    $("#todayDate").textContent = formatted;
    const hour = now.getHours();
    const greeting = hour < 11 ? "Guten Morgen" : hour < 17 ? "Guten Tag" : "Guten Abend";
    const name = (state.settings.display_name || "").trim();
    const xToday = state.todayEntries.some(entry => entry.type === "X");
    const finishedToday = state.todayEntries.some(entry => ["B", "H"].includes(entry.type) && entry.finalized);
    const freeToday = state.todayEntries.some(entry => ["FT", "U", "S", "K", "F", "A"].includes(entry.type));
    $("#pageTitle").textContent = freeToday ? "Heute frei" : xToday ? (name ? `Tagesziel geschafft, ${name}` : "Tagesziel geschafft") : finishedToday ? (name ? `Feierabend, ${name}` : "Feierabend") : name ? `${greeting}, ${name}` : "Dein Arbeitstag";
  }

  function weekBarProgress(workedMinutes, targetMinutes) {
    const worked = Math.max(0, Number(workedMinutes) || 0);
    const target = Math.max(0, Number(targetMinutes) || 0);
    const overtimeMinutes = Math.max(0, worked - target);
    return {
      goalPercent: target ? Math.min(100, worked / target * 100) : 0,
      overtimePercent: target ? Math.min(100, overtimeMinutes / target * 100) : worked > 0 ? 100 : 0,
      overtimeMinutes,
    };
  }

  function weekBarDescription(name, minutes, target, overtime) {
    return `${name}: ${formatDuration(minutes)} Std. · Soll ${formatDuration(target)} Std.${overtime > 0 ? ` · ${formatDuration(overtime)} Std. Überstunden` : ""}`;
  }

  function updateLiveWeekBar(day, minutes) {
    const bar = $(`#weekBars .day-bar[data-date='${day}']`);
    if (!bar) return;
    const target = Number(bar.dataset.target);
    const progress = weekBarProgress(minutes, target);
    bar.querySelector(".day-bar-fill").style.height = `${progress.goalPercent}%`;
    bar.querySelector(".day-bar-overtime").style.height = `${progress.overtimePercent}%`;
    bar.classList.toggle("has-overtime", progress.overtimeMinutes > 0);
    const description = weekBarDescription(bar.dataset.day, minutes, target, progress.overtimeMinutes);
    bar.title = description;
    bar.setAttribute("aria-label", description);
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
    const weekAccount = weekEntries.filter(countsForAccount).reduce((sum, entry) => sum + entry.account_minutes, 0);
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
    $("#weekEyebrow").textContent = selectedIsToday ? "Diese Woche" : "Woche des Tages";

    const names = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    $("#weekBars").innerHTML = names.map((name, index) => {
      const day = new Date(monday); day.setDate(day.getDate() + index);
      const minutes = state.active?.work_date === isoDate(day) ? liveTimerValues().netSeconds / 60 : minutesOn(day);
      const dayTarget = targetPerDay(day);
      if (!dayTarget && !minutes && state.active?.work_date !== isoDate(day)) return "";
      const progress = weekBarProgress(minutes, dayTarget);
      const description = weekBarDescription(name, minutes, dayTarget, progress.overtimeMinutes);
      return `<div class="day-bar ${isoDate(day) === state.selectedDay ? "today" : ""} ${progress.overtimeMinutes > 0 ? "has-overtime" : ""}" data-date="${isoDate(day)}" data-day="${name}" data-target="${dayTarget}" role="img" aria-label="${description}" title="${description}"><div class="day-bar-track" aria-hidden="true"><div class="day-bar-fill" style="height:${progress.goalPercent}%"></div><div class="day-bar-overtime" style="height:${progress.overtimePercent}%"></div></div><span aria-hidden="true">${name}</span></div>`;
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
      if (entry.automatic_holiday) $("#openTodayEntry").textContent = "Im Kalender öffnen";
      if (entry.note) todayBox.insertAdjacentHTML("beforeend", `<div class="day-note-display">${renderNoteHTML(entry.note)}</div>`);
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

    renderAccountSummary();
  }

  function renderAccountSummary() {
    const account = state.currentAccount;
    if (!account) return;
    const activeInScope = state.active && state.active.work_date >= (state.settings.tracking_start_date || "") && state.active.work_date.startsWith(String(new Date().getFullYear()));
    const liveDifference = activeInScope ? liveAccountMinutes(liveTimerValues(), state.settings) - Number(account.today_account_minutes || 0) : 0;
    const balance = Number(account.balance_minutes || 0) + liveDifference;
    $("#sidebarBalance").textContent = formatSigned(balance);
    $("#balanceChip").classList.toggle("negative", balance < 0);
    $("#balanceChip").classList.toggle("positive", balance > 0);
    $("#balanceChip").setAttribute("aria-label", `Zeitkonto ansehen: ${formatSigned(balance)} Stunden`);
    $("#accountDialogBalance").textContent = formatSigned(balance);
    $("#accountDialogBalance").classList.toggle("negative", balance < 0);
    $("#accountDialogHint").textContent = balance > 0 ? "Plusstunden gesammelt" : balance < 0 ? "Aktuell unter dem Soll" : "Dein Zeitkonto ist ausgeglichen";
    $("#accountRecorded").textContent = formatDuration(Number(account.account_minutes || 0) + liveDifference);
    $("#accountTarget").textContent = formatDuration(account.target_minutes);
    $("#accountCarry").textContent = formatSigned(account.previous_balance_minutes);
    $("#accountBeforeToday").textContent = formatSigned(account.balance_before_today_minutes);
    $("#accountTodayDelta").textContent = formatSigned(Number(account.today_account_minutes || 0) + liveDifference - Number(account.today_target_minutes || 0));
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const start = state.settings.tracking_start_date > yearStart ? state.settings.tracking_start_date : yearStart;
    $("#accountPeriod").textContent = `Berechnet ab ${new Intl.DateTimeFormat("de-DE").format(parseISO(start))} · Stand heute`;
  }

  function liveTimerValues() {
    if (!state.active) return { elapsedSeconds: 0, breakSeconds: 0, netSeconds: 0, qualifiedMinutes: 0 };
    const now = new Date();
    const [h, m, s = 0] = state.active.start_time.split(":").map(Number);
    const start = parseISO(state.active.work_date);
    start.setHours(h, m, s, 0);
    const elapsedSeconds = Math.max(0, Math.floor((now - start) / 1000));
    let breakSeconds = Number(state.active.manual_break_minutes || 0) * 60;
    let recordedMinutes = Number(state.active.manual_break_minutes || 0);
    let qualifiedMinutes = breakSeconds >= 900 ? breakSeconds / 60 : 0;
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
      const seconds = Math.max(0, Math.floor((breakEnd - breakStart) / 1000));
      breakSeconds += seconds;
      recordedMinutes += Math.floor(seconds / 60);
      if (seconds >= 900) qualifiedMinutes += Math.floor(seconds / 60);
    });
    return { elapsedSeconds, breakSeconds, netSeconds: Math.max(0, elapsedSeconds - breakSeconds), qualifiedMinutes, ruleWorkMinutes: Math.max(0, Math.floor(elapsedSeconds / 60) - recordedMinutes) };
  }

  function liveAccountMinutes(values, settings) {
    const rawMinutes = values.netSeconds / 60;
    const ruleMinutes = values.ruleWorkMinutes ?? Math.floor(rawMinutes);
    const required = settings.age_group === "minor" ? (ruleMinutes > 360 ? 60 : ruleMinutes > 270 ? 30 : 0) : ruleMinutes > 540 ? 45 : ruleMinutes > 360 ? 30 : 0;
    const missing = values.qualifiedMinutes >= required ? 0 : Math.max(15, required - values.qualifiedMinutes);
    return Math.max(0, rawMinutes - (settings.auto_break_deduction ? missing : 0));
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

  function updateTimerProgress(seconds, targetMinutes) {
    const layers = weekBarProgress(seconds / 60, targetMinutes);
    const percent = targetMinutes > 0 ? Math.round(seconds / (targetMinutes * 60) * 100) : 0;
    const orbit = $("#timerOrbit");
    orbit.style.setProperty("--progress", `${layers.goalPercent * 3.6}deg`);
    orbit.style.setProperty("--progress-percent", `${layers.goalPercent}%`);
    orbit.style.setProperty("--overtime-progress", `${targetMinutes > 0 ? layers.overtimePercent * 3.6 : 0}deg`);
    orbit.style.setProperty("--overtime-percent", `${targetMinutes > 0 ? layers.overtimePercent : 0}%`);
    orbit.setAttribute("aria-label", `${percent} Prozent des Tagesziels erreicht`);
    $("#timerOrbitPercent").textContent = `${percent}%`;
  }

  function renderTimer() {
    clearInterval(state.ticker);
    const card = $(".timer-card");
    const active = state.active;
    const lastTimed = state.todayEntries.find(entry => ["B", "H"].includes(entry.type));
    const completedEntry = state.todayEntries.find(entry => ["X", "FT", "U", "S", "K", "F", "A"].includes(entry.type)) || (lastTimed?.finalized ? lastTimed : null);
    const finished = !active && Boolean(completedEntry);
    card.classList.toggle("hidden", finished);
    $("#finishedCard").classList.toggle("hidden", !finished);
    $("#openDayPlan").classList.toggle("hidden", finished);
    if (finished) {
      if (["B", "H", "X"].includes(completedEntry.type)) renderFinishedCard(completedEntry);
      else renderFreeDayCard(completedEntry);
      return;
    }
    card.classList.toggle("running", Boolean(active));
    card.classList.toggle("paused", Boolean(active?.is_paused));
    $("#timerTypePicker").classList.toggle("locked", Boolean(active));
    updateTimerButtons();
    $("#correctStart").hidden = !active || active.work_date !== isoDate(new Date());
    $("#metaTarget").textContent = formatDuration(plannedTarget(active?.work_date || new Date()));
    $("#metaTargetLabel").textContent = overtimeForDay(active?.work_date || new Date()) ? "Tagesplan" : "Tagesziel";
    $("#timerOrbit span").textContent = overtimeForDay(active?.work_date || new Date()) ? "Tagesplan" : "Tagesziel";
    if (!active) {
      $("#timerStatus").textContent = lastTimed ? "Arbeit gestoppt" : "Bereit";
      $("#workTimerValue").textContent = formatClock(lastTimed?.net_work_seconds || 0);
      $("#breakTimerValue").textContent = formatClock(lastTimed?.recorded_break_seconds || 0);
      $("#workTimerHint").textContent = lastTimed ? "Arbeitszeit gespeichert" : overtimeForDay() ? `Heute ${formatDuration(overtimeForDay())} Std. zusätzlich geplant` : "Noch nicht gestartet";
      $("#breakTimerHint").textContent = lastTimed?.recorded_break_seconds ? "Pausen heute" : "Noch keine Pause";
      $("#timerSubline").textContent = lastTimed ? "Abgeschlossen" : "Nicht gestartet";
      $("#metaStart").textContent = lastTimed?.start_time?.slice(0, 5) || "–";
      $("#metaEnd").textContent = lastTimed?.end_time?.slice(0, 5) || "–";
      $("#startTimer").innerHTML = `<svg aria-hidden="true"><use href="#i-play"></use></svg>Arbeit starten`;
      updateTimerProgress(lastTimed?.net_work_seconds || 0, plannedTarget());
      return;
    }
    state.selectedTimerType = active.type;
    $("#startTimer").innerHTML = `<svg aria-hidden="true"><use href="#i-play"></use></svg>Läuft`;
    $$("#timerTypePicker button").forEach(button => button.classList.toggle("active", button.dataset.type === active.type));
    const tick = () => {
      const values = liveTimerValues();
      updateLiveWeekBar(active.work_date, values.netSeconds / 60);
      renderAccountSummary();
      const remainingSeconds = Math.max(0, plannedTarget(active.work_date) * 60 - values.netSeconds);
      $("#workTimerValue").textContent = formatClock(values.netSeconds);
      $("#breakTimerValue").textContent = formatClock(values.breakSeconds);
      $("#timerStatus").textContent = active.is_paused ? "Pause läuft" : "Arbeitszeit läuft";
      $("#timerSubline").textContent = active.type_label;
      $("#metaStart").textContent = active.start_time.slice(0, 5);
      $("#metaEnd").textContent = "läuft";
      $("#workTimerHint").textContent = remainingSeconds
        ? `Noch ${formatClock(remainingSeconds).slice(0, 5)} bis zum ${overtimeForDay(active.work_date) ? "Tagesplan" : "Tagesziel"}`
        : overtimeForDay(active.work_date) ? "Überstundenplan geschafft" : "Tagesziel erreicht";
      $("#breakTimerHint").textContent = active.is_paused ? "Gesamte Pause läuft weiter" : values.breakSeconds ? "Pause heute gesamt" : "Noch keine Pause";
      $("#todayEarnings").textContent = formatMoney(grossForMinutes(active.work_date, values.netSeconds / 60));
      updateTimerProgress(values.netSeconds, plannedTarget(active.work_date));
      $("#timerOrbit span").textContent = overtimeForDay(active.work_date) ? "Tagesplan" : "Tagesziel";
    };
    tick(); state.ticker = setInterval(tick, 1000);
  }

  function renderFinishedCard(entry) {
    $("#finishedCard").classList.remove("day-off");
    $("#finishedCard .finished-eyebrow > span:last-child").textContent = "Arbeitstag abgeschlossen";
    $("#finishedCard .finished-goal").classList.remove("hidden");
    $("#finishedCard .finished-facts").classList.remove("hidden");
    $("#finishedDelta").classList.remove("hidden");
    $("#finishedNote").classList.remove("hidden");
    $("#dayNoteSummary").textContent = entry.note ? "Tagesnotiz ansehen oder bearbeiten" : "Tagesnotiz hinzufügen";
    const target = targetPerDay(entry.work_date);
    const delta = entry.worked_minutes - target;
    const completed = delta >= 0;
    $(".finished-day-icon").classList.toggle("is-goal-met", completed);
    $("#finishedDaySymbol").setAttribute("href", completed ? "#i-complete" : "#i-clock");
    const isX = entry.type === "X";
    $("#finishedLead").textContent = isX ? "Für heute verbucht" : "Deine Arbeitszeit heute";
    $("#finishedHeadline").textContent = isX ? "Für heute sind" : "Heute hast du";
    $("#finishedUnit").textContent = isX ? "Stunden verbucht" : "Stunden gearbeitet";
    $("#finishedDuration").textContent = formatDuration(entry.worked_minutes);
    const progress = target > 0 ? Math.round(entry.worked_minutes / target * 100) : 100;
    const fill = Math.min(100, progress);
    $("#finishedProgress").style.setProperty("--finished-progress", `${fill}%`);
    const overtime = target > 0 ? weekBarProgress(entry.worked_minutes, target).overtimePercent : 0;
    $("#finishedProgress").style.setProperty("--finished-overtime", `${overtime}%`);
    $("#finishedProgress").classList.toggle("has-overtime", overtime > 0);
    $("#finishedColorKey").hidden = overtime <= 0;
    $("#finishedProgress").setAttribute("aria-valuenow", String(fill));
    $("#finishedProgress").setAttribute("aria-valuetext", target > 0 ? `${progress} % des Tagesziels erreicht` : "Kein Tagesziel an diesem Tag");
    $("#finishedGoalLabel").textContent = target > 0 ? `${progress} % von ${formatDuration(target)} Std. Tagesziel` : "Kein Tagesziel an diesem Tag";
    $("#finishedSpanLabel").textContent = isX ? "Erfassung" : "Beginn – Ende";
    $("#finishedSpan").textContent = isX ? "Ohne Uhrzeit" : `${entry.start_time?.slice(0, 5) || "–"} – ${entry.end_time?.slice(0, 5) || "–"}`;
    $("#finishedBreak").textContent = isX ? "–" : formatDuration(entry.recorded_break_minutes);
    $("#finishedEarned").textContent = formatMoney(entry.estimated_gross_eur || 0);
    $("#finishedBalance").textContent = formatSigned(delta);
    $("#finishedBalance").classList.toggle("negative", delta < 0);
    $("#finishedDelta").classList.toggle("is-negative", delta < 0);
    $("#finishedDeltaLabel").textContent = delta > 0 ? "über deinem Tagessoll" : delta < 0 ? "unter deinem Tagessoll" : "genau im Tagessoll";
    $("#finishedMessage").textContent = isX
      ? "Dein Tagesziel ist vollständig erfüllt und gespeichert."
      : delta >= 0
      ? "Gut geschafft. Deine Arbeitszeit ist gespeichert."
      : "Dein Tag ist abgeschlossen und sicher gespeichert.";
  }

  function renderFreeDayCard(entry) {
    $("#finishedCard").classList.add("day-off");
    $("#finishedCard .finished-eyebrow > span:last-child").textContent = "Heute keine Zeiterfassung nötig";
    $("#finishedLead").textContent = entry.automatic_holiday ? "Automatischer Feiertag" : "Arbeitsfreier Tag";
    $("#finishedDuration").textContent = entry.holiday_name || entry.type_label;
    $("#finishedUnit").textContent = "Zeit für dich";
    $("#finishedMessage").textContent = entry.type === "U" ? "Dein Urlaub ist eingetragen. Genieße die freie Zeit." : `${formatDuration(entry.credited_minutes || 0)} Std. berücksichtigt · kein Urlaubstag verbraucht.`;
    $("#finishedCard .finished-goal").classList.add("hidden");
    $("#finishedCard .finished-facts").classList.add("hidden");
    $("#finishedDelta").classList.add("hidden");
    $("#finishedNote").classList.add("hidden");
  }

  function openDayNote() {
    const entry = state.todayEntries.find(item => ["B", "H", "X"].includes(item.type) && (item.finalized || item.type === "X"));
    if (!entry) return;
    $("#dayNoteEntryId").value = entry.id;
    $("#dayNoteText").value = entry.note || "";
    state.noteRevision = state.noteSavedRevision = 0;
    $("#dayNoteStatus").textContent = "Automatisch gespeichert";
    $("#dayNoteDialog").showModal();
  }

  async function saveDayNote(event) {
    event?.preventDefault();
    clearTimeout(state.noteSaveTimer);
    if (state.noteSavePromise) return state.noteSavePromise;
    if (state.noteRevision === state.noteSavedRevision) return true;
    const revision = state.noteRevision;
    const id = $("#dayNoteEntryId").value;
    const note = $("#dayNoteText").value;
    let failed = false;
    const job = (async () => {
      $("#dayNoteStatus").textContent = "Wird gespeichert …";
      try {
        await api(`api/entries/${id}/note`, { method: "POST", body: JSON.stringify({ note }), keepalive: true });
        state.noteSavedRevision = revision;
        state.noteRetryDelay = 2000;
        [state.entries, state.todayEntries].forEach(entries => entries.filter(item => String(item.id) === id).forEach(item => { item.note = note; }));
        $("#dayNoteSummary").textContent = note ? "Tagesnotiz ansehen oder bearbeiten" : "Tagesnotiz hinzufügen";
        $("#dayNoteStatus").textContent = revision === state.noteRevision ? "Automatisch gespeichert" : "Weitere Änderungen werden gespeichert …";
        return true;
      } catch (error) {
        failed = true;
        $("#dayNoteStatus").textContent = "Noch nicht gespeichert. Neuer Versuch folgt automatisch.";
        if (state.noteRetryDelay === 2000) toast(error.message, true);
        return false;
      }
    })();
    state.noteSavePromise = job;
    try { return await job; }
    finally {
      state.noteSavePromise = null;
      if (state.noteRevision !== state.noteSavedRevision) {
        state.noteSaveTimer = setTimeout(() => { void saveDayNote(); }, failed ? state.noteRetryDelay : 400);
        if (failed) state.noteRetryDelay = Math.min(30000, state.noteRetryDelay * 2);
      }
    }
  }

  async function closeDayNote() {
    if (!await saveDayNote()) return;
    if (state.noteRevision !== state.noteSavedRevision) { await saveDayNote(); }
    if (state.noteRevision === state.noteSavedRevision) {
      $("#dayNoteDialog").close();
      await loadYear(state.loadedYear, true, true);
    }
  }

  function celebrateAfterWork() {
    const entry = state.todayEntries.find(item => ["B", "H"].includes(item.type) && item.finalized);
    if (!entry || document.body.dataset.view !== "dashboard" || !state.settings.after_work_animation_enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const key = `zeitwerk-after-work-${entry.work_date}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "seen"); } catch { return; }
    const icon = $(".finished-day-icon");
    icon.classList.add("celebrate");
    setTimeout(() => icon.classList.remove("celebrate"), 2400);
  }

  function updateDayPlanPreview() {
    const base = targetPerDay();
    const extra = minutesFromTime($("#dayPlanExtra").value);
    $("#dayPlanPreview").innerHTML = `<span>Vertragliches Soll <b>${formatDuration(base)}</b></span><span>Zusätzlich geplant <b>+ ${formatDuration(extra)}</b></span><span>Dein Tagesplan <b>${formatDuration(base + extra)} Std.</b></span>`;
  }

  function openDayPlan() {
    $("#dayPlanExtra").value = formatHoursMinutes(overtimeForDay());
    updateDayPlanPreview();
    $("#dayPlanDialog").showModal();
  }

  async function saveDayPlan(event) {
    event.preventDefault();
    try {
      await api("api/day-plan", { method: "POST", body: JSON.stringify({ work_date: isoDate(new Date()), extra_minutes: minutesFromTime($("#dayPlanExtra").value) }) });
      $("#dayPlanDialog").close();
      await loadYear(state.loadedYear, true);
      toast("Tagesplan gespeichert");
    } catch (error) { toast(error.message, true); }
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
    const monthKey = `${shown.getFullYear()}-${String(shown.getMonth() + 1).padStart(2, "0")}`;
    const monthEntries = state.entries.filter(entry => entry.work_date.startsWith(monthKey) && ["B", "H", "X"].includes(entry.type));
    const monthMinutes = monthEntries.reduce((sum, entry) => sum + (entry.worked_minutes || 0), 0);
    $("#calendarSummary").textContent = `${monthEntries.length} ${monthEntries.length === 1 ? "Arbeitstag" : "Arbeitstage"} · ${formatDuration(monthMinutes)} Std. erfasst`;
    const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(start.getDate() - offset);
    const weeks = Math.ceil((offset + new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate()) / 7);
    const todayKey = isoDate(new Date());
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const day = new Date(start); day.setDate(start.getDate() + i);
      const key = isoDate(day);
      const entry = entriesOn(key)[0];
      let label = "";
      if (entry) {
        const duration = formatDuration(minutesOn(key));
        const value = entry.start_time ? `${entry.type === "H" ? "Homeoffice" : "Arbeit"} · ${duration}` : entry.type_label;
        const compact = entry.start_time ? duration : entry.type;
        label = `<span class="calendar-entry type-${escapeHTML(entry.type)}"><i aria-hidden="true"></i><span class="calendar-entry-label">${escapeHTML(value)}</span><span class="calendar-entry-compact">${escapeHTML(compact)}</span></span>`;
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
    $("#editCalendarDay").textContent = entry?.type === "U" ? "Urlaubszeitraum bearbeiten" : entry ? "Eintrag bearbeiten" : "Eintrag hinzufügen";
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
    const note = entry.note ? `<div class="calendar-day-note">${renderNoteHTML(entry.note)}</div>` : "";
    const earned = entry.estimated_gross_eur ? `<div class="calendar-day-earned"><span>Brutto für diesen Tag (geschätzt)</span><b>${formatMoney(entry.estimated_gross_eur)}</b></div>` : "";
    $("#calendarDayContent").innerHTML = `<div class="calendar-day-state"><span class="calendar-day-symbol type-${escapeHTML(entry.type)}">${escapeHTML(entry.type)}</span><div><b>${escapeHTML(entry.type_label)}</b><p>${timed ? entry.is_running ? "Zeiterfassung läuft" : "Arbeitszeit gespeichert" : entry.type === "X" ? "Tagesziel erfüllt" : "Als freier Tag berücksichtigt"}</p></div></div><div class="calendar-day-facts">${facts.map(([label, value]) => `<div><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join("")}</div>${earned}${note}`;
    if (entry.automatic_holiday) {
      $("#editCalendarDay").textContent = "Feiertag ausschließen";
      $("#calendarDayContent").insertAdjacentHTML("beforeend", '<p class="settings-section-copy">Automatisch berücksichtigt. Ausschließen entfernt nur den Feiertag; vorhandene Einträge bleiben erhalten.</p>');
    }
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
    const todayKey = isoDate(new Date());
    const worked = state.entries.filter(entry => entry.work_date <= todayKey).reduce((sum, entry) => sum + entry.worked_minutes, 0);
    const account = state.entries.filter(entry => entry.work_date <= todayKey && countsForAccount(entry)).reduce((sum, entry) => sum + entry.account_minutes, 0);
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
    $("#reportVacation").nextElementSibling.textContent = "eingetragen / Anspruch";
    $("#reportHome").textContent = state.entries.filter(entry => entry.type === "H").length;
    $("#reportGross").textContent = formatMoney(state.entries.filter(entry => entry.work_date <= todayKey).reduce((sum, entry) => sum + Number(entry.estimated_gross_eur || 0), 0));

    const weekdayData = Array.from({ length: 7 }, () => []);
    const byDate = new Map();
    state.entries.filter(entry => entry.work_date <= todayKey).forEach(entry => {
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
    const finishedWork = state.entries.filter(entry => entry.work_date <= todayKey && countsForAccount(entry) && (["B", "H"].includes(entry.type) && entry.finalized || entry.type === "X"));
    for (const cursor = new Date(streakStart); cursor <= streakEnd; cursor.setDate(cursor.getDate() + 1)) {
      const dayTarget = targetPerDay(cursor);
      if (!dayTarget) continue;
      const key = isoDate(cursor);
      const dayEntries = state.entries.filter(entry => entry.work_date === key);
      if (dayEntries.some(entry => ["U", "K", "S", "FT"].includes(entry.type))) continue;
      if (key === todayKey && !finishedWork.some(entry => entry.work_date === key)) continue;
      const completed = finishedWork.filter(entry => entry.work_date === key);
      if (completed.length) scheduledDays += 1;
      const reached = completed.reduce((sum, entry) => sum + entry.worked_minutes, 0) >= dayTarget;
      if (reached) {
        goalsReached += 1;
        currentStreak += 1;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    $("#currentStreak").textContent = currentStreak;
    $("#currentStreak").parentElement.title = `Aktuelle Serie: ${currentStreak} abgeschlossene Arbeitstage mit erfülltem Tagesziel`;
    $("#goalsReached").textContent = goalsReached;
    $("#goalRate").textContent = `${Math.round(goalsReached / Math.max(1, scheduledDays) * 100)} %`;
    $("#goalRate").nextElementSibling.textContent = "abgeschlossener Arbeitstage";
    $("#bestStreak").textContent = bestStreak;
    const pauses = finishedWork.filter(entry => ["B", "H"].includes(entry.type) && entry.required_break_minutes > 0 && entry.qualified_break_minutes >= entry.required_break_minutes).length;
    const notes = finishedWork.filter(entry => (entry.note || "").trim()).length;
    const weeks = new Set(finishedWork.map(entry => { const value = calendarWeek(parseISO(entry.work_date)); return `${value.year}-${value.week}`; })).size;
    renderCollections({ entries: finishedWork.length, goals: goalsReached, streak: bestStreak, pauses, notes, weeks });
    renderPeriodList();
    if ($("#periodDialog").open && state.selectedPeriod) renderPeriodDetails(state.selectedPeriod);
  }

  function calendarWeek(day) {
    const date = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const year = date.getUTCFullYear();
    const week = Math.ceil((((date - new Date(Date.UTC(year, 0, 1))) / 86400000) + 1) / 7);
    return { year, week };
  }

  function collectionMilestones(metrics) {
    const groups = [
      ["entries", "i-edit", "abgeschlossene Arbeitstage", [[1, "Erster Eintrag"], [10, "Gut dokumentiert"], [25, "Dein Zeitjournal"], [100, "Einträge-Profi"]]],
      ["goals", "i-complete", "erfüllte Tagesziele", [[10, "Gut geschafft"], [25, "Auf Kurs"], [50, "Zielroutine"]]],
      ["streak", "i-flame", "Tagesziele in Folge", [[5, "Im Rhythmus"], [10, "Stabile Serie"], [20, "Dein Rhythmus"]]],
      ["pauses", "i-pause", "Tage mit ausreichender Pause", [[5, "Pausen im Blick"], [15, "Gut erholt"], [30, "Pausenroutine"]]],
      ["notes", "i-edit", "Tage mit einer Notiz", [[5, "Festgehalten"], [15, "Dein Rückblick"], [30, "Notizen-Routine"]]],
      ["weeks", "i-calendar", "Wochen mit erfassten Arbeitstagen", [[1, "Eine Woche im Blick"], [4, "Wochenrhythmus"], [12, "Langfristig im Blick"]]],
    ];
    return groups.flatMap(([category, icon, detail, goals]) => goals.map(([goal, name]) => ({ category, icon, goal, name, detail: goal === 1 ? (category === "entries" ? "Ein abgeschlossener Arbeitstag" : "Eine Woche mit erfassten Arbeitstagen") : `${goal} ${detail}`, value: Math.max(0, Number(metrics[category]) || 0) })));
  }

  function splitCollections(badges) {
    const seen = new Set();
    const next = [], later = [], earned = [];
    badges.forEach(badge => {
      if (badge.value >= badge.goal) earned.push(badge);
      else if (!seen.has(badge.category)) { seen.add(badge.category); next.push(badge); }
      else later.push(badge);
    });
    return { next, later, earned };
  }

  function renderCollections(metrics) {
    const badges = collectionMilestones(metrics);
    const groups = splitCollections(badges);
    const markup = badge => `<article class="report-badge ${badge.value >= badge.goal ? "earned" : ""}"><svg aria-hidden="true"><use href="#${badge.icon}"></use></svg><div><b>${badge.name}</b><small>${badge.detail}</small><span>${Math.min(badge.value, badge.goal)} / ${badge.goal}${badge.value >= badge.goal ? " · Erreicht" : ""}</span><progress max="${badge.goal}" value="${Math.min(badge.value, badge.goal)}" aria-label="${badge.name}"></progress></div></article>`;
    $("#reportBadges").innerHTML = groups.next.map(markup).join("") || '<p class="collection-complete">Alle Meilensteine dieses Jahres erreicht. Deine Sammlung findest du unten.</p>';
    $("#collectionCount").textContent = `${groups.earned.length} / ${badges.length} erreicht · ${state.loadedYear}`;
    $("#laterBadgeCount").textContent = groups.later.length;
    $("#earnedBadgeCount").textContent = groups.earned.length;
    $("#laterBadges").innerHTML = groups.later.map(markup).join("");
    $("#earnedBadges").innerHTML = groups.earned.map(markup).join("");
    $("#laterCollections").classList.toggle("hidden", groups.later.length === 0);
    $("#earnedCollections").classList.toggle("hidden", groups.earned.length === 0);
  }

  function periodSummary(period) {
    const todayKey = isoDate(new Date());
    const firstKey = isoDate(period.first), lastKey = isoDate(period.last);
    const entries = state.entries.filter(entry => entry.work_date >= firstKey && entry.work_date <= lastKey && entry.work_date <= todayKey);
    const future = firstKey > todayKey;
    const worked = entries.reduce((sum, entry) => sum + Number(entry.worked_minutes || 0), 0);
    const account = entries.filter(countsForAccount).reduce((sum, entry) => sum + Number(entry.account_minutes || 0), 0);
    const target = targetBetween(period.first, period.last, !future);
    return { entries, future, worked, account, target, saldo: account - target };
  }

  function reportMonths(year, entries, today = new Date()) {
    const todayKey = isoDate(today);
    const workedMonths = new Set(entries.filter(entry => entry.work_date <= todayKey && Number(entry.worked_minutes) > 0).map(entry => entry.work_date.slice(0, 7)));
    return MONTHS.map((label, month) => ({ label, first: new Date(year, month, 1), last: new Date(year, month + 1, 0), current: year === today.getFullYear() && month === today.getMonth() }))
      .filter(period => period.current || workedMonths.has(isoDate(period.first).slice(0, 7)))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.first - a.first);
  }

  function renderPeriodList() {
    const year = state.loadedYear;
    const yearStart = new Date(year, 0, 1), yearEnd = new Date(year, 11, 31);
    const todayKey = isoDate(new Date());
    const dates = day => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(day);
    state.reportPeriods = state.reportMode === "month" ? reportMonths(year, state.entries) : [];
    if (state.reportMode === "week") {
      for (let monday = mondayOf(yearStart); monday <= yearEnd; monday.setDate(monday.getDate() + 7)) {
        const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
        const first = new Date(Math.max(monday.getTime(), yearStart.getTime()));
        const last = new Date(Math.min(sunday.getTime(), yearEnd.getTime()));
        if (year <= new Date().getFullYear() && isoDate(first) > todayKey) continue;
        const week = calendarWeek(monday);
        state.reportPeriods.push({ label: `KW ${week.week}`, first, last, subtitle: `${dates(first)} – ${dates(last)}${week.year !== year ? ` · ${week.year}` : ""}` });
      }
      state.reportPeriods.reverse();
    }
    $$("[data-report-mode]").forEach(button => { const active = button.dataset.reportMode === state.reportMode; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    $("#reportPeriodLabel").textContent = state.reportMode === "month" ? "Monate" : "Kalenderwochen";
    $("#monthList").innerHTML = state.reportPeriods.map((period, index) => {
      const values = periodSummary(period);
      const ratio = Math.min(100, values.account / Math.max(1, values.target) * 100);
      return `<button type="button" class="period-row ${values.future ? "future" : ""} ${period.current ? "is-current" : ""}" ${period.current ? 'aria-current="date"' : ""} data-period-index="${index}" aria-label="${escapeHTML(period.label)}${period.current ? ", aktueller Monat" : ""}: Details öffnen"><span class="period-name"><b>${period.label}</b><small>${period.current ? '<span class="period-current-label">Aktueller Monat</span>' : period.subtitle || `${year}${values.future ? " · Geplant" : ""}`}</small></span><span class="period-progress" aria-hidden="true"><i style="width:${values.future ? 0 : ratio}%"></i></span><span class="period-number"><small>Gearbeitet</small><b>${values.future ? "–" : formatDuration(values.worked)}</b></span><span class="period-number"><small>${values.future ? "Soll geplant" : "Soll bis heute"}</small><b>${formatDuration(values.target)}</b></span><span class="period-number ${values.saldo < 0 ? "negative" : ""}"><small>Saldo</small><b>${values.future ? "–" : formatSigned(values.saldo)}</b></span><svg aria-hidden="true"><use href="#i-right"></use></svg></button>`;
    }).join("") || '<p class="report-empty">In diesem Jahr wurde noch keine Arbeitszeit erfasst.</p>';
    $$("[data-period-index]").forEach(button => button.addEventListener("click", () => {
      state.selectedPeriod = state.reportPeriods[Number(button.dataset.periodIndex)];
      renderPeriodDetails(state.selectedPeriod);
      $("#periodDialog").showModal();
    }));
  }

  function renderPeriodDetails(period) {
    const values = periodSummary(period);
    $("#periodTitle").textContent = `${period.label} · ${state.loadedYear}`;
    const format = day => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long" }).format(day);
    $("#periodRange").textContent = `${format(period.first)} – ${format(period.last)} · ${values.future ? "Geplanter Zeitraum" : "Stand heute"}`;
    $("#periodMetrics").innerHTML = [["Gearbeitet", values.future ? "–" : formatDuration(values.worked)], ["Angerechnet", values.future ? "–" : formatDuration(values.account)], [values.future ? "Soll geplant" : "Soll bis heute", formatDuration(values.target)], ["Saldo", values.future ? "–" : formatSigned(values.saldo)]].map(([label, value]) => `<div><small>${label}</small><b>${value}</b></div>`).join("");
    const days = [];
    for (const cursor = new Date(period.first); cursor <= period.last; cursor.setDate(cursor.getDate() + 1)) {
      const key = isoDate(cursor);
      const entries = state.entries.filter(entry => entry.work_date === key);
      const target = countsForAccount({ work_date: key }) ? targetPerDay(cursor) : 0;
      if (!target && !entries.length) continue;
      const future = key > isoDate(new Date());
      const worked = entries.reduce((sum, entry) => sum + entry.worked_minutes, 0);
      const credited = entries.filter(countsForAccount).reduce((sum, entry) => sum + entry.account_minutes, 0);
      const dateLabel = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }).format(cursor);
      days.push(`<button class="period-day" type="button" data-period-day="${key}"><span class="period-day-name"><b>${dateLabel}</b><small>${escapeHTML(entries.map(entry => entry.type_label).join(" · ") || (future ? "Geplant" : "Kein Eintrag"))}</small></span><span><small>Gearbeitet</small><b>${future ? "–" : formatDuration(worked)}</b></span><span><small>Soll</small><b>${formatDuration(target)}</b></span><span><small>Saldo</small><b>${future ? "–" : formatSigned(credited - target)}</b></span></button>`);
    }
    $("#periodDays").innerHTML = days.join("") || '<p class="settings-section-copy">Keine Arbeitstage in diesem Zeitraum.</p>';
    $$("[data-period-day]").forEach(button => button.addEventListener("click", () => { $("#periodDialog").close(); void openCalendarDay(button.dataset.periodDay); }));
  }

  function datedLabel(day) {
    return !day || day === "0001-01-01" ? "Bisheriger Stand" : `Ab ${parseISO(day).toLocaleDateString("de-DE")}`;
  }

  function renderDatedSettings() {
    [["model", "work_model_history", "model"], ["salary", "salary_history", "salary"]].forEach(([kind, key, prefix]) => {
      const current = effectiveValues(key);
      $(`#${prefix}EffectiveLabel`).textContent = current.effective_from ? datedLabel(current.effective_from) : "Bisheriger Stand · frühere Tage bleiben erhalten";
      const records = [...(state.settings[key] || [])].reverse();
      $(`#${prefix}History`).innerHTML = records.length ? records.map(item => `<div class="history-row"><span><b>${escapeHTML(datedLabel(item.effective_from))}</b><small>${kind === "model" ? `${formatDuration(item.daily_work_minutes.reduce((sum, minutes) => sum + minutes, 0))} Std. pro Woche` : `${formatMoney(item.monthly_gross_eur)} brutto / Monat`}${item.effective_from > isoDate(new Date()) ? " · Geplant" : ""}</small></span>${item.effective_from !== "0001-01-01" ? `<button class="text-action" type="button" data-dated-edit="${kind}" data-date="${item.effective_from}" aria-label="${kind === "model" ? "Arbeitsmodell" : "Gehalt"} vom ${item.effective_from} bearbeiten">Bearbeiten</button>` : ""}</div>`).join("") : '<p class="settings-section-copy">Noch keine Änderungen. Dein bisheriger Stand wird bei der ersten Änderung automatisch bewahrt.</p>';
    });
    $$("[data-dated-edit]").forEach(button => button.addEventListener("click", () => openDatedChange(button.dataset.datedEdit, button.dataset.date)));
  }

  function openDatedChange(kind, day = isoDate(new Date())) {
    $("#datedChangeKind").value = kind;
    $("#datedChangeDate").value = day;
    $("#datedChangeTitle").textContent = kind === "model" ? "Deine neue Arbeitswoche" : "Dein Monatsgehalt";
    $("#datedModelFields").hidden = kind !== "model";
    $("#datedSalaryField").hidden = kind !== "salary";
    $("#datedSalaryAmount").required = kind === "salary";
    $("#datedChangeError").textContent = "";
    loadDatedChangeValues();
    $("#datedChangeDialog").showModal();
  }

  function loadDatedChangeValues() {
    const day = $("#datedChangeDate").value || isoDate(new Date());
    $("#datedModelGrid").innerHTML = dailyTargets(day).map((minutes, index) => `<label><span>${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][index]}</span><input type="time" data-model-day="${index}" aria-label="Tagesziel ${["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"][index]}" value="${formatHoursMinutes(minutes)}" step="60" required></label>`).join("");
    $$("#datedModelGrid input").forEach(input => { input.required = $("#datedChangeKind").value === "model"; input.addEventListener("input", updateDatedPreview); });
    $("#datedSalaryAmount").value = Number(effectiveValues("salary_history", day).monthly_gross_eur || 0);
    updateDatedPreview();
  }

  function updateDatedPreview() {
    const day = $("#datedChangeDate").value;
    const kind = $("#datedChangeKind").value;
    const total = $$("#datedModelGrid input").reduce((sum, input) => sum + minutesFromTime(input.value), 0);
    const amount = Number($("#datedSalaryAmount").value);
    const existing = (state.settings[kind === "model" ? "work_model_history" : "salary_history"] || []).some(item => item.effective_from === day);
    $("#datedChangePreview").textContent = `${kind === "model" ? `${formatDuration(total)} Std. pro Woche` : `${formatMoney(amount)} brutto / Monat`}. ${existing ? "Ersetzt die Änderung an diesem Datum." : "Gilt bis zur nächsten datierten Änderung."}${day < isoDate(new Date()) ? " Achtung: Ab diesem Datum werden auch vergangene Tage neu berechnet." : " Frühere Tage ändern sich nicht."}`;
  }

  async function saveDatedChange(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      if (!await saveSettings()) throw new Error("Bitte zuerst die übrigen Einstellungen prüfen.");
      const kind = $("#datedChangeKind").value;
      const payload = { kind, effective_from: $("#datedChangeDate").value };
      if (kind === "model") payload.daily_work_minutes = $$("#datedModelGrid input").map(input => minutesFromTime(input.value));
      else { payload.monthly_gross_eur = Number($("#datedSalaryAmount").value); payload.hourly_gross_eur = 0; }
      await api("api/settings/dated", { method: "POST", body: JSON.stringify(payload) });
      $("#datedChangeDialog").close();
      await loadYear(state.loadedYear, true);
      toast("Änderung mit Startdatum gespeichert");
    } catch (error) { $("#datedChangeError").textContent = error.message; }
    finally { button.disabled = false; }
  }

  function openStartCorrection() {
    if (!state.active || state.active.work_date !== isoDate(new Date())) return toast("Heute läuft kein Arbeitstag.", true);
    $("#startCorrectionId").value = state.active.id;
    $("#startCorrectionTime").value = state.active.start_time.slice(0, 5);
    $("#startCorrectionStatus").textContent = state.active.is_paused ? "Deine aktuelle Pause läuft weiter." : "Nur der Beginn wird geändert. Kein Arbeitsende wird eingetragen.";
    $("#startCorrectionDialog").showModal();
  }

  async function saveStartCorrection(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await api("api/timer/start-time", { method: "POST", body: JSON.stringify({ entry_id: Number($("#startCorrectionId").value), start_time: $("#startCorrectionTime").value }) });
      $("#startCorrectionDialog").close();
      await loadYear(state.loadedYear, true, true);
      toast("Beginn korrigiert · dein Tag läuft weiter");
    } catch (error) { $("#startCorrectionStatus").textContent = error.message; }
    finally { button.disabled = false; }
  }

  function openVacationPlanner() {
    const year = new Date().getFullYear();
    $("#plannerYear").innerHTML = Array.from({ length: 4 }, (_, index) => `<option value="${year + index}">${year + index}</option>`).join("");
    $("#plannerYear").value = Math.max(year, Math.min(year + 3, state.vacationYear));
    $("#plannerStatus").textContent = "Wähle dein Jahr und die Zahl neuer Urlaubstage. Es wird nichts automatisch eingetragen.";
    $("#plannerResults").replaceChildren();
    $("#vacationPlannerDialog").showModal();
  }

  async function findVacationSuggestions(event) {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    $("#plannerResults").replaceChildren();
    $("#plannerStatus").textContent = "Deine Arbeitswoche und freien Tage werden verglichen …";
    try {
      const result = await api("api/vacation/suggestions", { method: "POST", body: JSON.stringify({ year: Number($("#plannerYear").value), max_days: Number($("#plannerBudget").value) }) });
      const automatic = state.settings.holidays_enabled;
      const loaded = result.holiday_status.fetched_at;
      $("#plannerStatus").textContent = `${result.suggestions.length ? "Deine besten Auszeiten" : "Keine passenden Auszeiten gefunden. Versuche ein anderes Jahr oder mehr Urlaubstage."}${automatic ? loaded ? ` · Feiertage: ${result.holiday_status.state_name}` : " · Feiertage konnten nicht geladen werden; bitte prüfen." : " · Automatische Feiertage sind aus; manuell eingetragene freie Tage zählen mit."}${result.holiday_status.error && loaded ? " · Gespeicherte Feiertage verwendet; Aktualisierung fehlgeschlagen." : ""}`;
      $("#plannerResults").innerHTML = result.suggestions.map((item, index) => `<article class="planner-option"><div class="planner-option-top"><span class="planner-rank">${index === 0 ? "Längste Auszeit" : "Weitere Möglichkeit"}</span><span class="planner-ratio">${(item.free_days / item.vacation_days).toFixed(1).replace(".", ",")}× freie Zeit</span></div><div class="planner-days"><strong>${item.free_days}</strong><span>Tage am Stück frei<small>mit ${item.vacation_days} neuen Urlaubstagen${item.already_booked ? ` · ${item.already_booked} bereits gebucht` : ""}</small></span></div><p class="planner-dates">${parseISO(item.start_date).toLocaleDateString("de-DE", { day: "numeric", month: "long" })} – ${parseISO(item.end_date).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" })}</p>${item.holidays.length ? `<p class="planner-holidays">${escapeHTML([...new Set(item.holidays.map(day => day.name))].join(" · "))}</p>` : ""}<button class="button quiet-button" type="button" data-plan-select="${index}">Zeitraum prüfen<svg aria-hidden="true"><use href="#i-right"></use></svg></button></article>`).join("");
      $$("[data-plan-select]").forEach(control => control.addEventListener("click", async () => {
        const item = result.suggestions[Number(control.dataset.planSelect)];
        control.disabled = true;
        try {
          await loadYear(Number(item.start_date.slice(0, 4)), true, true);
          $("#vacationPlannerDialog").close();
          openVacationDialog(item.start_date, "settings");
          $("#vacationEnd").value = item.end_date;
          updateVacationRangePreview();
        } catch (error) { $("#plannerStatus").textContent = error.message; }
        finally { control.disabled = false; }
      }));
    } catch (error) { $("#plannerStatus").textContent = error.message; }
    finally { button.disabled = false; }
  }

  function renderSettings() {
    const s = state.settings;
    $("#settingName").value = s.display_name || "";
    $("#settingAfterWorkAnimation").checked = Boolean(s.after_work_animation_enabled);
    const targets = dailyTargets();
    $("#settingHours").value = (targets.reduce((sum, value) => sum + value, 0) / 60).toFixed(2).replace(/\.00$/, "");
    targets.forEach((value, index) => { $(`#settingDay${index}`).value = formatHoursMinutes(value); $(`#settingDay${index}`).readOnly = true; });
    $("#settingAge").value = s.age_group;
    $("#settingStartDate").value = s.tracking_start_date || isoDate(new Date());
    state.vacationAllowancesDraft = { ...(s.vacation_allowance_by_year || {}) };
    state.vacationYearDirty = false;
    const thisYear = new Date().getFullYear();
    const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, thisYear + 2, state.vacationYear, ...Object.keys(state.vacationAllowancesDraft).map(Number)])].sort((a, b) => a - b);
    $("#settingVacationYear").innerHTML = years.map(year => `<option value="${year}">${year}${year === thisYear ? " · Dieses Jahr" : ""}</option>`).join("");
    $("#settingVacationYear").value = state.vacationYear;
    $("#settingVacation").value = vacationAllowance(state.vacationYear);
    $("#settingVacationDefault").value = Number(s.vacation_allowance || 0);
    $("#settingMonthlyGross").value = Number(effectiveValues("salary_history").monthly_gross_eur || 0);
    renderDatedSettings();
    $("#settingCarry").value = s.vacation_carryover;
    $("#settingBalance").value = s.previous_balance_minutes;
    $("#settingAutoBreak").checked = Boolean(s.auto_break_deduction);
    $("#settingLiveActivity").checked = Boolean(s.live_activity_enabled);
    $("#settingMilestones").checked = Boolean(s.milestone_notifications_enabled);
    $("#settingMilestoneStyle").value = s.milestone_notification_style || "saying_money";
    $("#settingGoalNotification").checked = s.goal_notification_enabled !== false;
    $("#settingEndSummary").checked = s.end_summary_enabled !== false;
    [["settingStartNotification", "start_notification_enabled"], ["settingPauseMinimum", "pause_minimum_notification_enabled"], ["settingPauseReminder", "pause_reminder_enabled"], ["settingEndSoon", "end_soon_notification_enabled"], ["settingOvertimeNotification", "overtime_notification_enabled"], ["settingHolidays", "holidays_enabled"]].forEach(([id, key]) => { $(`#${id}`).checked = Boolean(s[key]); });
    $("#settingHolidayState").innerHTML = '<option value="">Bundesland wählen</option>' + Object.entries(GERMAN_STATES).map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
    $("#settingHolidayState").value = s.holiday_state || "";
    $("#settingLiveService").value = s.live_activity_service || "";
    const theme = ["system", "light", "dark"].includes(s.theme) ? s.theme : "system";
    const themeInput = $(`input[name="theme"][value="${theme}"]`);
    if (themeInput) themeInput.checked = true;
    applyTheme(theme);
    updateSettingsControls();
    renderNotificationExamples();
    renderVacationSettings();
    renderHolidaySettings();
    const finishedToday = state.todayEntries.find(entry => ["B", "H"].includes(entry.type) && entry.finalized);
    $("#reopenTimer").disabled = !finishedToday;
    $("#reopenHint").textContent = finishedToday
      ? `Heute um ${finishedToday.end_time?.slice(0, 5) || "–"} Uhr abgeschlossen.`
      : "Heute liegt kein abgeschlossener Arbeitstag vor.";
    if (!$("#xExtraDate").value) $("#xExtraDate").value = isoDate(new Date());
    const selectedX = state.entries.find(entry => entry.work_date === $("#xExtraDate").value && entry.type === "X");
    if (selectedX) $("#xExtraDuration").value = formatHoursMinutes(selectedX.extra_work_minutes || 0);
    setSettingsStatus("saved", "Automatisch gespeichert");
  }

  function updateSettingsControls() {
    $$(".settings-panel .switch-row").forEach(row => {
      const input = row.querySelector('input[type="checkbox"]');
      const stateLabel = row.querySelector(".switch-state");
      if (input && stateLabel) stateLabel.textContent = input.checked ? "An" : "Aus";
    });
    const milestoneStyle = $("#settingMilestoneStyle");
    milestoneStyle.disabled = !$("#settingMilestones").checked;
    milestoneStyle.closest(".milestone-style-field")?.classList.toggle("is-disabled", milestoneStyle.disabled);
    $("#settingHolidayState").disabled = !$("#settingHolidays").checked;
    $("#refreshHolidays").disabled = !$("#settingHolidays").checked || $("#settingHolidayState").value !== state.settings.holiday_state || !state.settings.holidays_enabled;
  }

  function renderVacationSettings() {
    const year = state.vacationYear;
    const used = state.vacationPeriods.flatMap(period => period.dates || []).filter(day => day.startsWith(String(year))).length;
    const carry = year === new Date().getFullYear() ? Number($("#settingCarry").value || 0) : 0;
    const allowance = Number($("#settingVacation").value || 0) + carry;
    $("#vacationSettingsBudget").innerHTML = `<div><strong>${Math.max(0, allowance - used)}</strong><span>Tage übrig</span></div><div><b>${used}</b><span>eingetragen</span></div><div><b>${allowance}</b><span>verfügbar ${year}</span></div>`;
    const periods = state.vacationPeriods.filter(period => (period.dates || []).some(day => day.startsWith(String(year))));
    $("#settingsVacationList").innerHTML = periods.length ? '<h3>Deine Urlaubszeiträume</h3>' + periods.map(period => {
      const format = day => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(parseISO(day));
      return `<article class="vacation-period"><div><b>${escapeHTML(format(period.start_date))}${period.start_date !== period.end_date ? ` – ${escapeHTML(format(period.end_date))}` : ""}</b><span>${period.workdays} Urlaubstage${period.note ? ` · ${escapeHTML(period.note)}` : ""}</span></div><div class="vacation-period-actions"><button type="button" class="text-action" data-vacation-edit="${period.start_date}">Bearbeiten</button><button type="button" class="text-action remove-vacation" data-vacation-from="${period.start_date}" data-vacation-to="${period.end_date}">Entfernen</button></div></article>`;
    }).join("") : '<p class="settings-section-copy">Noch kein Urlaub für dieses Jahr eingetragen. Plane gleich einen Zeitraum.</p>';
    $$("[data-vacation-edit]").forEach(button => button.addEventListener("click", () => openVacationDialog(button.dataset.vacationEdit, "settings", state.vacationPeriods.find(period => period.start_date === button.dataset.vacationEdit))));
    $$("[data-vacation-from]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("Diesen Urlaubszeitraum entfernen? Andere Tagestypen und Feiertage bleiben erhalten.")) return;
      try {
        await api("api/vacation/remove", { method: "POST", body: JSON.stringify({ start_date: button.dataset.vacationFrom, end_date: button.dataset.vacationTo }) });
        await loadYear(state.loadedYear, true, true);
        toast("Urlaubszeitraum entfernt");
      } catch (error) { toast(error.message, true); }
    }));
  }

  function renderHolidaySettings() {
    const info = state.holidays;
    $("#holidayYearLabel").textContent = info?.year || state.loadedYear;
    $("#holidayLoadStatus").textContent = !state.settings.holidays_enabled ? "Aktiviere den Schalter und wähle dein Bundesland. Die Auswahl wird automatisch gespeichert." : info?.error || (info?.fetched_at ? `${info.state_name} · ${info.holidays.length} Feiertage gespeichert. Einzelne Ausnahmen werden sofort gespeichert.` : "Noch keine Feiertage geladen. Bitte aktualisieren.");
    const excluded = new Set(state.settings.holiday_exclusions || []);
    $("#settingsHolidayList").innerHTML = (info?.holidays || []).map(item => `<div class="holiday-row ${excluded.has(item.date) ? "is-excluded" : ""}"><div><b>${escapeHTML(item.name)}</b><small>${new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }).format(parseISO(item.date))}${excluded.has(item.date) ? " · ausgeschlossen" : ""}</small></div><button type="button" class="text-action" data-holiday-date="${item.date}" data-excluded="${excluded.has(item.date) ? "false" : "true"}">${excluded.has(item.date) ? "Wieder nutzen" : "Ausschließen"}</button></div>`).join("") || '<p class="settings-section-copy">Keine gespeicherten Feiertage.</p>';
    $$("[data-holiday-date]").forEach(button => button.addEventListener("click", () => saveHolidayException(button.dataset.holidayDate, button.dataset.excluded === "true")));
  }

  async function saveHolidayException(day, excluded) {
    try {
      await api("api/holidays/exception", { method: "POST", body: JSON.stringify({ work_date: day, excluded }) });
      await loadYear(state.loadedYear, true, true);
      if ($("#calendarDayDialog").open) renderCalendarDay();
      toast(excluded ? "Feiertag ausgeschlossen" : "Feiertag wieder berücksichtigt");
    } catch (error) { toast(error.message, true); }
  }

  async function refreshHolidayList() {
    const button = $("#refreshHolidays");
    button.disabled = true;
    try {
      const result = await api("api/holidays/refresh", { method: "POST", body: JSON.stringify({ year: state.loadedYear }) });
      state.holidays = result.holidays;
      await loadYear(state.loadedYear, true, true);
      toast(result.holidays.error || "Feiertage aktualisiert", Boolean(result.holidays.error));
    } catch (error) { toast(error.message, true); }
    finally { updateSettingsControls(); }
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
    [["Pausenziel erreicht", "30 Minuten anrechenbare Pause geschafft. Du kannst weiter pausieren oder entspannt weiterarbeiten."], ["Zeit für eine Pause", "Für deine Arbeitszeit sind 30 Minuten Pause nötig. Bisher sind 15 Minuten anrechenbar."], ["Feierabend in Sicht", "Noch höchstens 15 Minuten bis zu deinem Tagesplan. Zeit, die letzten Aufgaben abzurunden."], ["Überstundenplan geschafft", "Deine geplanten 1:00 Std. zusätzlich sind erreicht."], ["Arbeitszeit gestartet", "Dein Tagesplan steht. Gute Arbeit und einen angenehmen Tag!"]].forEach(([title, message]) => preview.push(`<div class="notification-example"><span class="notification-example-icon"><svg><use href="#i-info"></use></svg></span><span><b>Zeitwerk · ${title}</b><small>${message}</small></span></div>`));
    $("#notificationExamples").innerHTML = preview.join("");
  }

  function setView(name, { scroll = true } = {}) {
    if (document.body.dataset.view === "settings" && name !== "settings" && state.pendingSettings.size) void saveSettings();
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
    if (name === "dashboard") celebrateAfterWork();
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openEntryDialog(dateValue = isoDate(new Date()), entryId = null) {
    if (state.active && dateValue === isoDate(new Date()) && state.active.work_date === dateValue && (!entryId || entryId === state.active.id)) return openStartCorrection();
    const dayEntries = entriesOn(dateValue);
    const existing = entryId ? state.entries.find(item => item.id === entryId) : dayEntries.find(item => ["B", "H"].includes(item.type)) || dayEntries[0];
    $("#entryDialogTitle").textContent = existing ? "Arbeitszeit korrigieren" : "Arbeitszeit nachtragen";
    $("#entryId").value = existing?.automatic_holiday ? "" : existing?.id || "";
    $("#entryDate").value = existing?.work_date || dateValue;
    const type = existing?.type || "B";
    const typeInput = $(`input[name="entryType"][value="${type}"]`);
    if (typeInput) typeInput.checked = true;
    $("#entryStart").value = existing?.start_time?.slice(0, 5) || "09:00";
    $("#entryEnd").value = existing?.end_time?.slice(0, 5) || "17:00";
    $("#entryBreak").value = formatHoursMinutes(existing?.recorded_break_minutes ?? 30);
    $("#entryCommute").checked = Boolean(existing?.commute);
    $("#entryNote").value = existing?.note || "";
    $("#deleteEntry").classList.toggle("hidden", !existing || existing.automatic_holiday);
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
    if (action === "stop" && !window.confirm("Arbeitstag jetzt abschließen? Deine Endzeit wird gespeichert.")) return;
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

  function openVacationDialog(day = isoDate(new Date()), returnView = "calendar", editing = null) {
    state.vacationReturnView = returnView;
    state.vacationEditing = editing;
    $("#vacationTitle").textContent = editing ? "Urlaubszeitraum bearbeiten" : "Urlaub als Zeitraum";
    $("#vacationSubmit").textContent = editing ? "Änderungen speichern" : "Urlaub eintragen";
    $("#vacationStart").value = editing?.start_date || day;
    $("#vacationEnd").value = editing?.end_date || day;
    $("#vacationNote").value = editing?.note || "";
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
    let workdays = 0, alreadyBooked = 0;
    const holidayDays = new Set(state.settings.holidays_enabled ? (state.holidays?.holidays || []).filter(item => !(state.settings.holiday_exclusions || []).includes(item.date)).map(item => item.date) : []);
    for (let index = 0; index < days; index++) {
      const day = parseISO(first); day.setDate(day.getDate() + index);
      const key = isoDate(day);
      if (targetPerDay(day) > 0 && !holidayDays.has(key) && !entriesOn(key).some(entry => entry.type === "FT")) {
        workdays++;
        if (!state.vacationEditing && entriesOn(key).some(entry => entry.type === "U")) alreadyBooked++;
      }
    }
    box.classList.remove("warning");
    const knownYear = first.slice(0, 4) === String(state.loadedYear) && last.slice(0, 4) === String(state.loadedYear);
    box.textContent = `${knownYear ? "" : "Voraussichtlich "}${workdays - alreadyBooked} ${workdays - alreadyBooked === 1 ? "Urlaubstag" : "Urlaubstage"}${alreadyBooked ? ` neu · ${alreadyBooked} bereits eingetragen` : ""} · ${days - workdays} freie Tage oder bekannte Feiertage.${knownYear ? "" : " Weitere Feiertage werden beim Speichern geprüft."}`;
  }

  async function saveVacationRange(event) {
    event.preventDefault();
    const payload = { start_date: $("#vacationStart").value, end_date: $("#vacationEnd").value, note: $("#vacationNote").value };
    const editing = state.vacationEditing;
    if (editing) { payload.original_dates = editing.dates; payload.original_note = editing.note; }
    try {
      const result = await api(editing ? "api/vacation/update" : "api/vacation/range", { method: "POST", body: JSON.stringify(payload) });
      $("#vacationDialog").close();
      toast(editing ? `Urlaubszeitraum geändert · ${result.workdays} Urlaubstage` : result.added ? `${result.added} ${result.added === 1 ? "Urlaubstag" : "Urlaubstage"} eingetragen${result.free_days ? ` · ${result.free_days} ${result.free_days === 1 ? "freier Tag" : "freie Tage"} ausgelassen` : ""}` : "Diese Urlaubstage waren bereits eingetragen");
      state.calendarDate = new Date(parseISO(payload.start_date).getFullYear(), parseISO(payload.start_date).getMonth(), 1);
      const returnView = state.vacationReturnView || "calendar";
      await loadYear(parseISO(payload.start_date).getFullYear(), true, returnView === "settings");
      setView(returnView);
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

  function collectSettingsPayload() {
    const targets = Array.from({ length: 7 }, (_, index) => minutesFromTime($(`#settingDay${index}`).value));
    const workdays = targets.map((value, index) => value > 0 ? index : null).filter(value => value !== null);
    const vacationYear = String(Number($("#settingVacationYear").value));
    const vacationValues = { ...state.vacationAllowancesDraft };
    if (state.vacationYearDirty) vacationValues[vacationYear] = Number($("#settingVacation").value);
    const payload = {
      display_name: $("#settingName").value.trim(),
      weekly_hours: targets.reduce((sum, value) => sum + value, 0) / 60,
      workdays,
      daily_work_minutes: targets,
      age_group: $("#settingAge").value,
      tracking_start_date: $("#settingStartDate").value,
      vacation_allowance: Number($("#settingVacationDefault").value),
      vacation_allowance_by_year: vacationValues,
      vacation_carryover: Number($("#settingCarry").value),
      monthly_gross_eur: Number($("#settingMonthlyGross").value),
      previous_balance_minutes: Number($("#settingBalance").value),
      auto_break_deduction: $("#settingAutoBreak").checked,
      theme: $("input[name='theme']:checked").value,
      after_work_animation_enabled: $("#settingAfterWorkAnimation").checked,
      live_activity_enabled: $("#settingLiveActivity").checked,
      live_activity_service: $("#settingLiveService").value.trim(),
      milestone_notifications_enabled: $("#settingMilestones").checked,
      milestone_notification_style: $("#settingMilestoneStyle").value,
      goal_notification_enabled: $("#settingGoalNotification").checked,
      end_summary_enabled: $("#settingEndSummary").checked,
      start_notification_enabled: $("#settingStartNotification").checked,
      pause_minimum_notification_enabled: $("#settingPauseMinimum").checked,
      pause_reminder_enabled: $("#settingPauseReminder").checked,
      end_soon_notification_enabled: $("#settingEndSoon").checked,
      overtime_notification_enabled: $("#settingOvertimeNotification").checked,
      holidays_enabled: $("#settingHolidays").checked,
      holiday_state: $("#settingHolidayState").value,
    };
    return payload;
  }

  const settingFieldKeys = {
    settingAfterWorkAnimation: ["after_work_animation_enabled"],
    settingName: ["display_name"], settingAge: ["age_group"], settingStartDate: ["tracking_start_date"],
    settingVacation: ["vacation_allowance_by_year"], settingVacationDefault: ["vacation_allowance"],
    settingCarry: ["vacation_carryover"], settingBalance: ["previous_balance_minutes"],
    settingAutoBreak: ["auto_break_deduction"], settingLiveActivity: ["live_activity_enabled"],
    settingLiveService: ["live_activity_service"], settingMilestones: ["milestone_notifications_enabled"],
    settingMilestoneStyle: ["milestone_notification_style"], settingGoalNotification: ["goal_notification_enabled"],
    settingEndSummary: ["end_summary_enabled"], settingStartNotification: ["start_notification_enabled"],
    settingPauseMinimum: ["pause_minimum_notification_enabled"], settingPauseReminder: ["pause_reminder_enabled"],
    settingEndSoon: ["end_soon_notification_enabled"], settingOvertimeNotification: ["overtime_notification_enabled"],
    settingHolidays: ["holidays_enabled", "holiday_state"], settingHolidayState: ["holidays_enabled", "holiday_state"],
  };

  function setSettingsStatus(status, text) {
    $("#settingsStatus").dataset.state = status;
    $("#settingsHint").textContent = text;
  }

  function settingIsValid(key, payload) {
    if (["holidays_enabled", "holiday_state"].includes(key) && payload.holidays_enabled && !payload.holiday_state) return false;
    if (["daily_work_minutes", "weekly_hours", "workdays"].includes(key) && (!payload.workdays.length || payload.weekly_hours > 80)) return false;
    if (key === "live_activity_service" && payload.live_activity_service && !/^mobile_app_[a-z0-9_]+$/.test(payload.live_activity_service.toLowerCase().replace(/^notify\./, ""))) return false;
    const controls = Object.entries(settingFieldKeys).filter(([, keys]) => keys.includes(key)).map(([id]) => $(`#${id}`));
    return controls.every(input => input.validity.valid && (!["number", "time", "date"].includes(input.type) || input.value !== ""));
  }

  function scheduleSettingsSave(event) {
    const input = event.target;
    const keys = input.name === "theme" ? ["theme"] : settingFieldKeys[input.id];
    if (!keys) return;
    const revision = ++state.settingsRevision;
    keys.forEach(key => state.pendingSettings.set(key, revision));
    const immediate = event.type === "change" && ["checkbox", "radio", "select-one", "date", "time"].includes(input.type);
    clearTimeout(state.settingsSaveTimer);
    state.settingsNextSaveAt = Date.now() + (immediate ? 0 : 650);
    setSettingsStatus("pending", "Änderungen werden gespeichert …");
    state.settingsSaveTimer = setTimeout(() => { void saveSettings(); }, immediate ? 0 : 650);
  }

  async function saveSettings(event) {
    event?.preventDefault();
    clearTimeout(state.settingsSaveTimer);
    if (state.settingsSavePromise) return state.settingsSavePromise;
    if (!state.pendingSettings.size) return true;
    const fullPayload = collectSettingsPayload();
    const captured = new Map([...state.pendingSettings].filter(([key]) => settingIsValid(key, fullPayload)));
    if (!captured.size) {
      const holidayChoiceMissing = fullPayload.holidays_enabled && !fullPayload.holiday_state;
      setSettingsStatus("invalid", holidayChoiceMissing ? "Wähle noch dein Bundesland." : "Bitte den eingegebenen Wert prüfen. Noch nicht gespeichert.");
      return false;
    }
    const payload = Object.fromEntries([...captured.keys()].map(key => [key, fullPayload[key]]));
    let failed = false;
    setSettingsStatus("saving", "Wird gespeichert …");
    const job = (async () => {
      try {
        const result = await api("api/settings", { method: "POST", body: JSON.stringify(payload), keepalive: true });
        state.settings = result.settings;
        captured.forEach((revision, key) => {
          if (state.pendingSettings.get(key) === revision) state.pendingSettings.delete(key);
        });
        if (!state.pendingSettings.has("vacation_allowance_by_year")) {
          state.vacationAllowancesDraft = { ...(result.settings.vacation_allowance_by_year || {}) };
          state.vacationYearDirty = false;
        }
        state.settingsRetryDelay = 2000;
        await loadYear(state.loadedYear, true, true);
        updateSettingsControls();
        setSettingsStatus(state.pendingSettings.size ? "pending" : "saved", state.pendingSettings.size ? "Weitere Änderungen werden gespeichert …" : "Automatisch gespeichert");
        return true;
      } catch (error) {
        failed = true;
        setSettingsStatus("error", `Noch nicht gespeichert. ${error.message} Neuer Versuch folgt automatisch.`);
        if (state.settingsRetryDelay === 2000) toast("Einstellungen noch nicht gespeichert. Neuer Versuch folgt automatisch.", true);
        return false;
      }
    })();
    state.settingsSavePromise = job;
    try { return await job; }
    finally {
      state.settingsSavePromise = null;
      if (state.pendingSettings.size) {
        const delay = failed ? state.settingsRetryDelay : Math.max(0, (state.settingsNextSaveAt || 0) - Date.now());
        if (failed) state.settingsRetryDelay = Math.min(30000, state.settingsRetryDelay * 2);
        state.settingsSaveTimer = setTimeout(() => { void saveSettings(); }, delay);
      }
    }
  }

  async function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!window.confirm("Die Sicherung ersetzt alle aktuellen Einträge. Fortfahren?")) { event.target.value = ""; return; }
    try {
      const payload = JSON.parse(await file.text());
      // Finish any older save before replacing settings from the backup.
      clearTimeout(state.settingsSaveTimer);
      if (state.settingsSavePromise) await state.settingsSavePromise;
      clearTimeout(state.settingsSaveTimer);
      const result = await api("api/import", { method: "POST", body: JSON.stringify(payload) });
      state.pendingSettings.clear();
      state.vacationYearDirty = false;
      toast(`${result.imported} Einträge wiederhergestellt`);
      await loadYear(new Date().getFullYear(), true);
    } catch (error) {
      toast(error.message || "Sicherung konnte nicht gelesen werden", true);
      if (state.pendingSettings.size) state.settingsSaveTimer = setTimeout(() => { void saveSettings(); }, 2000);
    }
    event.target.value = "";
  }

  async function testLiveActivity() {
    const service = $("#settingLiveService").value.trim();
    if (!service) return toast("Bitte zuerst die mobile_app-Aktion eintragen", true);
    try {
      await saveSettings();
      await api("api/settings", {
        method: "POST",
        body: JSON.stringify({ live_activity_service: service }),
      });
      await api("api/live-activity/test", { method: "POST", body: "{}" });
      toast("Test an dein iPhone gesendet");
    } catch (error) { toast(error.message, true); }
  }

  function bindEvents() {
    $$("[data-close]").forEach(button => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
    $("#openModelChange").addEventListener("click", () => openDatedChange("model"));
    $("#openSalaryChange").addEventListener("click", () => openDatedChange("salary"));
    $("#datedChangeForm").addEventListener("submit", saveDatedChange);
    $("#datedChangeDate").addEventListener("change", loadDatedChangeValues);
    $("#datedSalaryAmount").addEventListener("input", updateDatedPreview);
    $("#correctStart").addEventListener("click", openStartCorrection);
    $("#startCorrectionForm").addEventListener("submit", saveStartCorrection);
    $("#openVacationPlanner").addEventListener("click", openVacationPlanner);
    $("#vacationPlannerForm").addEventListener("submit", findVacationSuggestions);
    $("#balanceChip").addEventListener("click", () => { renderAccountSummary(); $("#balanceDialog").showModal(); });
    $("#closeAccount").addEventListener("click", () => $("#balanceDialog").close());
    $("#accountReports").addEventListener("click", async () => {
      $("#balanceDialog").close();
      if (state.loadedYear !== new Date().getFullYear()) await loadYear(new Date().getFullYear(), true);
      setView("reports");
    });
    $$(".nav-item[data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
    $$("[data-go]").forEach(button => button.addEventListener("click", () => setView(button.dataset.go)));
    ["#openEntry", "#mobileAdd"].forEach(selector => $(selector).addEventListener("click", () => { state.entryReturnView = null; openEntryDialog(state.selectedDay); }));
    $("#manualAdjust").addEventListener("click", () => { state.entryReturnView = null; openEntryDialog(); });
    $("#openTodayEntry").addEventListener("click", () => {
      if (entriesOn(state.selectedDay)[0]?.automatic_holiday) return openCalendarDay(state.selectedDay);
      state.entryReturnView = null; openEntryDialog(state.selectedDay);
    });
    $("#prevDay").addEventListener("click", () => moveSelectedDay(-1));
    $("#nextDay").addEventListener("click", () => moveSelectedDay(1));
    $("#jumpToday").addEventListener("click", () => selectDay(new Date()));
    $("#startTimer").addEventListener("click", () => timerAction("start"));
    $("#pauseTimer").addEventListener("click", () => timerAction("pause"));
    $("#resumeTimer").addEventListener("click", () => timerAction("resume"));
    $("#stopTimer").addEventListener("click", () => timerAction("stop"));
    $("#openDayPlan").addEventListener("click", openDayPlan);
    $("#dayPlanForm").addEventListener("submit", saveDayPlan);
    $("#dayPlanExtra").addEventListener("input", updateDayPlanPreview);
    ["#closeDayPlan", "#cancelDayPlan"].forEach(selector => $(selector).addEventListener("click", () => $("#dayPlanDialog").close()));
    $("#finishedNote").addEventListener("click", openDayNote);
    $("#dayNoteForm").addEventListener("submit", event => { event.preventDefault(); void saveDayNote(); });
    $("#dayNoteText").addEventListener("input", () => {
      state.noteRevision += 1;
      clearTimeout(state.noteSaveTimer);
      $("#dayNoteStatus").textContent = "Änderungen werden gespeichert …";
      state.noteSaveTimer = setTimeout(() => { void saveDayNote(); }, 650);
    });
    $("#dayNoteText").addEventListener("blur", () => { void saveDayNote(); });
    ["#closeDayNote", "#doneDayNote"].forEach(selector => $(selector).addEventListener("click", () => { void closeDayNote(); }));
    $("#dayNoteDialog").addEventListener("cancel", event => { event.preventDefault(); void closeDayNote(); });
    $("#closePeriod").addEventListener("click", () => $("#periodDialog").close());
    $$("[data-report-mode]").forEach(button => button.addEventListener("click", () => { state.reportMode = button.dataset.reportMode; renderPeriodList(); }));
    ["#dayNoteText", "#entryNote", "#vacationNote"].forEach(selector => $(selector).addEventListener("keydown", continueBulletList));
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
      if (entriesOn(state.calendarDay)[0]?.automatic_holiday) return saveHolidayException(state.calendarDay, true);
      $("#calendarDayDialog").close();
      const vacation = state.vacationPeriods.find(period => period.dates.includes(state.calendarDay));
      if (vacation) return openVacationDialog(state.calendarDay, "calendar", vacation);
      state.entryReturnView = "calendar";
      openEntryDialog(state.calendarDay);
    });
    $("#openVacationHome").addEventListener("click", () => openVacationDialog(isoDate(new Date())));
    $("#openVacationCalendar").addEventListener("click", () => openVacationDialog(calendarFocusDay()));
    $("#openVacationSettings").addEventListener("click", () => openVacationDialog(isoDate(new Date()), "settings"));
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
    $("#settingsForm").addEventListener("submit", event => { event.preventDefault(); void saveSettings(); });
    $$(".settings-card > .settings-heading").forEach(heading => heading.addEventListener("click", () => {
      const section = heading.closest(".settings-card");
      const open = !section.classList.contains("is-open");
      $$(".settings-card.is-open").forEach(item => {
        item.classList.remove("is-open");
        item.querySelector(".settings-heading")?.setAttribute("aria-expanded", "false");
        item.querySelector(".settings-panel")?.setAttribute("aria-hidden", "true");
      });
      section.classList.toggle("is-open", open);
      heading.setAttribute("aria-expanded", String(open));
      section.querySelector(".settings-panel")?.setAttribute("aria-hidden", String(!open));
    }));
    $("#settingsForm").addEventListener("input", scheduleSettingsSave);
    $("#settingsForm").addEventListener("change", scheduleSettingsSave);
    $("#settingsForm").addEventListener("focusout", event => {
      if (settingFieldKeys[event.target.id] && state.pendingSettings.size) void saveSettings();
    });
    $$(".settings-panel .switch-row input[type='checkbox']").forEach(input => input.addEventListener("change", updateSettingsControls));
    $("#settingMilestoneStyle").addEventListener("change", renderNotificationExamples);
    $$("#dailyTargetGrid input").forEach(input => input.addEventListener("input", () => {
      const total = Array.from({ length: 7 }, (_, index) => minutesFromTime($(`#settingDay${index}`).value)).reduce((sum, value) => sum + value, 0);
      $("#settingHours").value = (total / 60).toFixed(2).replace(/\.00$/, "");
      renderNotificationExamples();
    }));
    $("#settingMonthlyGross").addEventListener("input", renderNotificationExamples);
    $("#settingVacationYear").addEventListener("change", event => {
      event.stopPropagation();
      if (state.vacationYearDirty && $("#settingVacation").value !== "" && $("#settingVacation").validity.valid) state.vacationAllowancesDraft[String(state.vacationYear)] = Number($("#settingVacation").value);
      state.vacationYear = Number(event.target.value) || new Date().getFullYear();
      state.vacationYearDirty = false;
      $("#settingVacation").value = state.vacationAllowancesDraft[String(state.vacationYear)] ?? Number($("#settingVacationDefault").value);
      renderVacationSettings();
    });
    $("#settingVacation").addEventListener("input", () => {
      state.vacationYearDirty = true;
      if ($("#settingVacation").value !== "" && $("#settingVacation").validity.valid) state.vacationAllowancesDraft[String(state.vacationYear)] = Number($("#settingVacation").value);
      renderVacationSettings();
    });
    $("#settingCarry").addEventListener("input", renderVacationSettings);
    $("#settingVacationDefault").addEventListener("input", () => {
      if (!state.vacationYearDirty && state.vacationAllowancesDraft[String(state.vacationYear)] === undefined) $("#settingVacation").value = $("#settingVacationDefault").value;
      renderVacationSettings();
    });
    $("#settingHolidayState").addEventListener("change", updateSettingsControls);
    $("#refreshHolidays").addEventListener("click", refreshHolidayList);
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
    window.addEventListener("online", () => { if (state.pendingSettings.size) void saveSettings(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && state.pendingSettings.size) void saveSettings(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && state.noteRevision !== state.noteSavedRevision) void saveDayNote();
      if (document.visibilityState === "visible") { void refreshState(); celebrateAfterWork(); }
    });
    window.addEventListener("online", () => { if (state.noteRevision !== state.noteSavedRevision) void saveDayNote(); });
    window.addEventListener("beforeunload", event => {
      if (state.pendingSettings.size || state.settingsSavePromise || state.noteRevision !== state.noteSavedRevision || state.noteSavePromise) { event.preventDefault(); event.returnValue = ""; }
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

  async function refreshState() {
    if (state.refreshBusy || state.timerBusy || !state.settings || document.visibilityState === "hidden") return;
    state.refreshBusy = true;
    try { await loadYear(state.loadedYear, true, true); }
    finally { state.refreshBusy = false; }
  }

  bindEvents();
  setInterval(() => { void refreshState(); }, 30000);
  themeMedia.addEventListener?.("change", () => {
    if ((document.documentElement.dataset.themePreference || "system") === "system") applyTheme("system", false);
  });
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {}));
  const initialView = ["dashboard", "calendar", "reports", "settings"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "dashboard";
  loadYear(new Date().getFullYear()).then(() => { setView(initialView); registerWebMCP(); });
})();

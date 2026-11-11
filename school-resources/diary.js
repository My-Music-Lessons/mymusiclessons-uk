import {diaryAccountConfig} from "./diary-account-config.js";
import { mountDiaryAccount } from "./diary-account.js";
import { calendarRange, shiftPeriod, renderCalendar } from "./diary-calendar.js";
import { validateDiary } from "./diary-model.js";
import { diaryToIcs, diaryToCsv, wallTimeToUtc } from "./diary-export.js";
import {
  parseDiary,
  readDeviceDiary,
  saveDeviceDiary,
  forgetDeviceDiary,
  DIARY_STORAGE_KEY,
  MAX_DIARY_FILE,
  withDiaryLock,
  readPreviousDiary,
  restorePreviousDiary,
  DIARY_PREVIOUS_KEY,
} from "./diary-store.js";
import { downloadText } from "./planning-download.js";
import { duplicateDiarySession } from "./diary-planner.js";
import { mountDiaryWorkflows } from "./diary-workflows.js";
import { mountDiaryManagement } from "./diary-management.js";
import { createDiaryProjectionCache } from "./diary-projection.js";
import { mountDiaryPremium } from "./diary-premium.js";
const root = document.querySelector("[data-diary-tool]");
if (root) {
  const $ = (key) => root.querySelector(`[${key}]`),
    node = (tag, text = "", className = "") => {
      const e = document.createElement(tag);
      e.textContent = text;
      if (className) e.className = className;
      return e;
    };
  const uid = () => crypto.randomUUID(),
    copy = (x) => JSON.parse(JSON.stringify(x));
  const addDays = (date, n) =>
    new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
  const monday = (date) =>
    addDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
  const todayFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    prettyFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const today = () => {
    const p = Object.fromEntries(
      todayFormatter
        .formatToParts(new Date())
        .filter((x) => x.type !== "literal")
        .map((x) => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day}`;
  };
  const pretty = (date) =>
    prettyFormatter.format(new Date(date + "T12:00:00Z"));
  const fresh = () => {
    const start = monday(today());
    return {
      format: "mml-school-music-diary",
      version: 1,
      calendarId: uid(),
      settings: { school: "", termStart: start, termEnd: addDays(start, 83) },
      resources: { rooms: [], people: [] },
      closures: [],
      sessions: [],
    };
  };
  let diary = fresh(),
    week = monday(today()),
    editingId = null,
    editorDirty = false,
    dirty = false,
    revision = null,
    savedAt = null,
    history = [],
    day = today(),
    changesSinceBackup = 0,
    accounts,
    workflows,
    management,
    currentView,
    premium,
    renderedDiary,
    boardSource,
    boardKey,
    boardDays = [],
    previousReadKey,
    previousDeviceCopy;
  const projectionCache = createDiaryProjectionCache(),
    clockChecks = new Set();
  const message = (text) => {
    $("data-diary-message").textContent = text;
  };
  const button = (label, action, id) => {
    const b = node("button", label, "diary-button diary-button-small");
    b.type = "button";
    b.dataset[action] = id;
    return b;
  };
  const readResource = (kind, id) =>
    diary.resources[kind].find((x) => x.id === id)?.name || "Unassigned";
  const validateClock = (plan) => {
    for (const o of projectionCache.get(plan).occurrences)
      for (const time of [o.startTime, o.endTime]) {
        const key = o.date + "T" + time;
        if (!clockChecks.has(key)) {
          wallTimeToUtc(o.date, time);
          if (clockChecks.size >= 10000) clockChecks.clear();
          clockChecks.add(key);
        }
      }
  };
  function saveSummary() {
    const summary = $("data-diary-save-summary");
    if (!summary) return;
    summary.textContent = accounts?.signedIn ? accounts.status : dirty
      ? (diaryAccountConfig.enabled?"Changes are open in this tab. Use your account to save online, or keep a device copy.":"Changes are open in this tab. Turn on device saving or download a backup to keep your timetable.")
      : savedAt
        ? `Device copy saved ${new Date(savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. ${changesSinceBackup ? "Download a portable backup too." : "Keep a backup before changing device."}`
        : (diaryAccountConfig.enabled?"Create a free account to save your diary and return to it. Device copies and backups are optional.":"Device saving is off. Keep a browser copy or download a backup to return to this timetable.");
    summary.dataset.state = dirty ? "unsaved" : "saved";
    const recovery = $("data-diary-restore-previous");
    if (recovery) {
      try {
        const key = String(revision) + "|" + String(savedAt);
        if (previousReadKey !== key) {
          previousDeviceCopy = readPreviousDiary(localStorage);
          previousReadKey = key;
        }
        const previous = previousDeviceCopy;
        recovery.disabled =
          accounts?.connected || !previous || typeof navigator.locks?.request !== "function";
        recovery.textContent = previous
          ? `Recover previous device copy (${new Date(previous.savedAt).toLocaleString("en-GB")})`
          : "No previous device copy yet";
      } catch {
        recovery.disabled = true;
        recovery.textContent = "Previous copy unavailable — use a JSON backup";
      }
    }
  }
  async function persist() {
    if (accounts?.connected) {accounts.changed();saveSummary();return;}
    if (!$("data-diary-autosave").checked) {
      $("data-diary-save-status").textContent = dirty
        ? (diaryAccountConfig.enabled?"Not saved on this device. Use your account or keep a backup copy.":"Not saved on this device. Turn on device saving or download a backup.")
        : (diaryAccountConfig.enabled?"Device saving is off. Use your account to keep this diary online.":"Device saving is off. Download a backup to keep this diary.");
      saveSummary();
      return;
    }
    try {
      await withDiaryLock(navigator.locks, () => {
        if (!$("data-diary-autosave").checked) return;
        const saved = saveDeviceDiary(localStorage, diary, revision);
        revision = saved.revision;
        savedAt = saved.savedAt;
        dirty = false;
        $("data-diary-save-status").textContent =
          "Saved on this browser at " +
          new Date(savedAt).toLocaleString("en-GB") +
          ". Keep a backup before changing device or clearing browser data.";
        saveSummary();
      });
    } catch (e) {
      $("data-diary-autosave").checked = false;
      $("data-diary-save-status").textContent = "Not saved: " + e.message;
      message("Your current diary is still here in this tab. " + e.message);
      saveSummary();
    }
  }
  function commit(next, text) {
    try {
      const clean = validateDiary(next);
      validateClock(clean);
      history.push(copy(diary));
      if (history.length > 12) history.shift();
      diary = clean;
      dirty = true;
      changesSinceBackup++;
      persist();
      render();
      message(text);
      return true;
    } catch (e) {
      message("No change made. " + e.message);
      return false;
    }
  }
  function fitWeek() {
    if (addDays(week, 6) < diary.settings.termStart)
      week = monday(diary.settings.termStart);
    if (week > diary.settings.termEnd) week = monday(diary.settings.termEnd);
  }
  function setOptions(select, items, empty) {
    const previous = select.value;
    select.replaceChildren();
    const blank = node("option", empty);
    blank.value = "";
    select.append(blank);
    for (const item of items) {
      const option = node("option", item.name);
      option.value = item.id;
      select.append(option);
    }
    select.value = items.some((x) => x.id === previous) ? previous : "";
  }
  function renderResources() {
    for (const [kind, selector] of [
      ["rooms", "data-diary-rooms"],
      ["people", "data-diary-people"],
    ]) {
      const list = $(selector);
      list.replaceChildren();
      if (!diary.resources[kind].length)
        list.append(node("li", "None added yet.", "diary-list-empty"));
      for (const resource of diary.resources[kind]) {
        const row = node("li", "", "diary-rule"),
          label = node("span", resource.name),
          b = button("Remove", "resourceRemove", resource.id);
        b.dataset.resourceKind = kind;
        const used = diary.sessions.filter(
          (s) => s[kind === "rooms" ? "roomId" : "personId"] === resource.id,
        ).length;
        b.disabled = used > 0;
        if (used)
          label.append(
            node(
              "small",
              ` · Used by ${used} pattern${used === 1 ? "" : "s"}; edit those before removing.`,
            ),
          );
        row.append(label, b);
        list.append(row);
      }
    }
    setOptions(
      $("data-session-room"),
      diary.resources.rooms,
      "Unassigned room",
    );
    setOptions(
      $("data-session-person"),
      diary.resources.people,
      "Unassigned staff role",
    );
    setOptions($("data-diary-room-filter"), diary.resources.rooms, "All rooms");
    setOptions(
      $("data-diary-person-filter"),
      diary.resources.people,
      "All staff roles",
    );
    const groups = new Map();
    for (const s of diary.sessions)
      if (s.group) groups.set(s.group.toLowerCase(), s.group);
    setOptions(
      $("data-diary-group-filter"),
      [...groups]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      "All groups",
    );
    const closures = $("data-diary-closures");
    closures.replaceChildren();
    if (!diary.closures.length)
      closures.append(node("li", "No closures added.", "diary-list-empty"));
    for (const c of diary.closures) {
      const row = node("li", "", "diary-rule");
      row.append(
        node("span", `${c.label || "Closure"} · ${c.start} to ${c.end}`),
        button("Remove closure", "closureRemove", c.id),
      );
      closures.append(row);
    }
  }
  function renderRules() {
    const list = $("data-diary-rules");
    list.replaceChildren();
    if (!diary.sessions.length)
      list.append(
        node(
          "li",
          "No session patterns yet. Add the first session to begin.",
          "diary-list-empty",
        ),
      );
    for (const s of diary.sessions) {
      const row = node("li", "", "diary-rule"),
        text = node("div");
      text.append(
        node("strong", s.title),
        node(
          "p",
          `${s.repeat} · ${s.startDate}${s.repeat === "once" ? "" : " to " + s.endDate} · ${s.startTime}–${s.endTime} · ${s.group || "No group label"}`,
        ),
      );
      if (s.excludedDates.length)
        text.append(
          node(
            "p",
            `${s.excludedDates.length} date exclusion${s.excludedDates.length === 1 ? "" : "s"} · edit to restore.`,
          ),
        );
      const actions = node("div", "", "diary-session-actions");
      actions.append(
        button("Edit pattern", "ruleEdit", s.id),
        button("Duplicate", "ruleDuplicate", s.id),
        button("Delete pattern", "ruleDelete", s.id),
      );
      row.append(text, actions);
      list.append(row);
    }
  }
  function renderExclusions() {
    const list = $("data-session-exclusions"),
      rule = diary.sessions.find((s) => s.id === editingId);
    list.replaceChildren();
    list.hidden = !rule?.excludedDates.length;
    if (rule)
      for (const date of rule.excludedDates) {
        const row = node("li", "", "diary-rule"),
          b = button("Restore date", "restoreRuleDate", rule.id);
        b.dataset.restoreDate = date;
        row.append(node("span", pretty(date)), b);
        list.append(row);
      }
  }
  function card(o, clashing) {
    const article = node(
      "article",
      "",
      "diary-session" + (clashing ? " diary-session-conflict" : ""),
    );
    article.dataset.sessionId = o.sessionId;
    article.dataset.sessionDate = o.date;
    if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      article.draggable = true;
      article.title =
        "Drag onto another day to review a move, or use Move session.";
    }
    article.append(
      node("p", o.startTime + "–" + o.endTime, "diary-session-time"),
      node("h5", o.title, "diary-session-title"),
      node(
        "p",
        [o.group, o.instrument].filter(Boolean).join(" · ") ||
          "No group / instrument label",
        "diary-session-meta",
      ),
      node(
        "p",
        readResource("rooms", o.roomId) +
          " · " +
          readResource("people", o.personId),
        "diary-session-meta",
      ),
    );
    if (clashing)
      article.append(node("p", "Clash to review", "diary-session-meta"));
    const actions = node("div", "", "diary-session-actions"),
      cancel = button("Cancel this date", "cancelOccurrence", o.sessionId);
    cancel.dataset.occurrenceDate = o.date;
    const move = button("Move session", "moveOccurrence", o.sessionId);
    move.dataset.occurrenceDate = o.date;
    actions.append(
      move,
      button("Edit pattern", "ruleEdit", o.sessionId),
      cancel,
    );
    const menu = node("details", "", "diary-card-menu"),
      summary = node("summary", "Actions");
    summary.setAttribute("aria-label", `Actions for ${o.title} on ${o.date}`);
    menu.append(summary, actions);
    article.append(menu);
    return article;
  }
  function render() {
    fitWeek();
    day =
      day < diary.settings.termStart
        ? diary.settings.termStart
        : day > diary.settings.termEnd
          ? diary.settings.termEnd
          : day;
    const sourceChanged = renderedDiary !== diary;
    if (sourceChanged) {
      renderResources();
      renderRules();
      renderExclusions();
      renderedDiary = diary;
    }
    const mode = $("data-diary-view").value,
      isDay = mode === "day",
      isCalendar = mode === "month" || mode === "year",
      period = isCalendar ? calendarRange(mode, day) : null,
      isPack = mode === "print-pack",
      rangeFrom = isCalendar ? period.from : isDay
        ? day
        : isPack && $("data-diary-export-range").value === "term"
          ? diary.settings.termStart
          : week,
      end = isCalendar ? period.to : isDay
        ? day
        : isPack && $("data-diary-export-range").value === "term"
          ? diary.settings.termEnd
          : addDays(week, 6),
      projection = projectionCache.get(diary),
      all = projection.occurrences,
      inWeek = (() => {
        const rows = [];
        for (let date = rangeFrom; date <= end; date = addDays(date, 1))
          rows.push(...(projection.byDate.get(date) || []));
        return rows;
      })(),
      room = $("data-diary-room-filter").value,
      person = $("data-diary-person-filter").value,
      group = $("data-diary-group-filter").value,
      search = $("data-diary-search").value.trim().toLowerCase(),
      visible = inWeek.filter(
        (o) =>
          (!room || o.roomId === room) &&
          (!person || o.personId === person) &&
          (!group || o.group.toLowerCase() === group) &&
          (!search ||
            [
              o.title,
              o.group,
              o.instrument,
              readResource("rooms", o.roomId),
              readResource("people", o.personId),
            ]
              .join(" ")
              .toLowerCase()
              .includes(search)),
      );
    const ids = new Set(visible.map((o) => o.id)),
      lookup = projection.lookup,
      rangedConflicts = (() => {
        const rows = [];
        for (let date = rangeFrom; date <= end; date = addDays(date, 1))
          rows.push(...(projection.conflictsByDate.get(date) || []));
        return rows;
      })(),
      conflicts = rangedConflicts.filter((c) =>
        c.occurrenceIds.some((id) => ids.has(id)),
      ),
      clashing = new Set(conflicts.flatMap((c) => c.occurrenceIds));
    currentView = {
      from:
        rangeFrom < diary.settings.termStart
          ? diary.settings.termStart
          : rangeFrom,
      to: end > diary.settings.termEnd ? diary.settings.termEnd : end,
      occurrences: visible,
    };
    const overview = projection.overview(visible),
      metrics = $("data-diary-overview");
    metrics.replaceChildren();
    for (const [value, label] of [
      [overview.sessions, "Sessions"],
      [
        `${Math.floor(overview.totalMinutes / 60)}h ${overview.totalMinutes % 60}m`,
        "Planned time",
      ],
      [overview.groups, "Groups"],
      [overview.unassignedRooms, "No room"],
      [overview.unassignedStaffRoles, "No teacher"],
    ]) {
      const item = node("div", "", "diary-overview-metric");
      item.append(node("strong", String(value)), node("span", label));
      item.setAttribute(
        "aria-label",
        `${value} ${{ Sessions: "sessions in view", Groups: "distinct group labels", "No room": "sessions without a room", "No teacher": "sessions without a teacher or staff role", "Planned time": "total planned session time" }[label]}`,
      );
      if (label === "Planned time")
        item.title =
          "Overlapping sessions count separately. This is planned session time, not unique room occupancy.";
      metrics.append(item);
    }
    $("data-diary-heading").textContent =
      (diary.settings.school ? diary.settings.school + " · " : "") +
      pretty(rangeFrom) +
      (isDay ? "" : " – " + pretty(end));
    $("data-diary-stats").textContent =
      `${visible.length} visible session${visible.length === 1 ? "" : "s"} ${isCalendar ? "in this " + mode : isDay ? "on this day" : isPack && $("data-diary-export-range").value === "term" ? "in this term" : "this week"} · ${conflicts.length} clash pair${conflicts.length === 1 ? "" : "s"} to review · ${all.length} sessions in the term · Europe/London`;
    $("data-diary-day").value = day;
    $("data-diary-day").min = diary.settings.termStart;
    $("data-diary-day").max = diary.settings.termEnd;
    $("data-diary-day-control").hidden = !isDay;
    $("data-diary-pack-control").hidden = !isPack;
    $("data-diary-week").closest("label").hidden = isDay;
    $("data-diary-week").previousSibling.textContent = isCalendar ? "Date in " + mode : "Week containing";
    $("data-diary-week").value = week;
    $("data-diary-week").min = monday(diary.settings.termStart);
    $("data-diary-week").max = diary.settings.termEnd;
    $("data-diary-prev").disabled = isCalendar ? period.from <= diary.settings.termStart : isDay
      ? day <= diary.settings.termStart
      : addDays(week, -1) < diary.settings.termStart;
    $("data-diary-next").disabled = isCalendar ? period.to >= diary.settings.termEnd : isDay
      ? day >= diary.settings.termEnd
      : addDays(week, 7) > diary.settings.termEnd;
    const grid = $("data-diary-grid"),
      agenda = $("data-diary-agenda");
    const nextBoardKey = `${mode}|${isDay ? day : week}|${rangeFrom}|${end}`;
    if (boardSource !== diary || boardKey !== nextBoardKey) {
      boardSource = diary;
      boardKey = nextBoardKey;
      boardDays = [];
      grid.replaceChildren();
      agenda.replaceChildren();
      grid.classList.toggle("diary-day-view", isDay);
      const rangeClashes = new Set(
        rangedConflicts.flatMap((c) => c.occurrenceIds),
      );
      for (let i = 0; i < (isDay ? 1 : 7); i++) {
        const date = addDays(isDay ? day : week, i),
          items = projection.byDate.get(date) || [],
          closure = diary.closures.find(
            (c) => date >= c.start && date <= c.end,
          );
        for (const [target, isAgenda] of [
          [grid, false],
          [agenda, true],
        ]) {
          if (isAgenda && mode !== "agenda") continue;
          if (isAgenda && !items.length && !closure) continue;
          const section = node("section", "", "diary-day");
          section.dataset.diaryDate = date;
          if (closure) section.classList.add("diary-day-closed");
          section.append(node("h4", pretty(date), "diary-day-heading"));
          if (closure)
            section.append(
              node(
                "p",
                closure.label || "School closure",
                "diary-closure-note",
              ),
            );
          const body = node("div", "", "diary-day-body"),
            empty = node(
              "p",
              date < diary.settings.termStart || date > diary.settings.termEnd
                ? "Outside term"
                : "No sessions",
              "diary-list-empty",
            ),
            cards = [];
          body.append(empty);
          if (
            (isAgenda && mode === "agenda") ||
            (!isAgenda && mode !== "agenda" && !isPack)
          ) {
            for (const occurrence of items) {
              const element = card(occurrence, rangeClashes.has(occurrence.id));
              body.append(element);
              cards.push({ id: occurrence.id, element });
            }
          }
          if (
            date >= diary.settings.termStart &&
            date <= diary.settings.termEnd &&
            !closure
          )
            body.append(button("Add on this date", "addOnDate", date));
          section.append(body);
          target.append(section);
          boardDays.push({ section, empty, cards, isAgenda, closure, date });
        }
      }
    }
    // A filter changes visibility, not session content or editor state. Retain
    // the canonical cards and native Actions disclosures until source/date/view changes.
    for (const entry of boardDays) {
      let count = 0;
      for (const row of entry.cards) {
        const shown = ids.has(row.id);
        if (row.element.hidden === shown) row.element.hidden = !shown;
        if (shown) count++;
      }
      entry.empty.hidden = count > 0 || !!entry.closure;
      entry.section.classList.toggle("diary-day-empty", count === 0);
      entry.section.hidden = entry.isAgenda && count === 0 && !entry.closure;
    }
    const agendaMode = $("data-diary-view").value === "agenda";
    grid.closest(".diary-week-scroll").hidden = agendaMode || isPack || isCalendar;
    const calendar = $("data-diary-calendar");
    calendar.hidden = !isCalendar;
    $("data-diary-prev").setAttribute("aria-label", "Previous " + (isCalendar ? mode : isDay ? "day" : "week"));
    $("data-diary-next").setAttribute("aria-label", "Next " + (isCalendar ? mode : isDay ? "day" : "week"));
    $("data-diary-today").textContent = isCalendar ? "This " + mode : isDay ? "Today" : "This week";
    if(isCalendar) renderCalendar({container:calendar,mode,anchor:day,rows:visible,clashes:clashing,closures:diary.closures,termStart:diary.settings.termStart,termEnd:diary.settings.termEnd,onSelect:(date)=>{day=date;week=monday(date);$("data-diary-view").value="day";render();}});
    agenda.hidden = !agendaMode || isPack;
    const pack = $("data-diary-pack");
    pack.hidden = !isPack;
    pack.replaceChildren();
    if (isPack) {
      const kind = $("data-diary-print-group").value,
        grouped = new Map();
      for (const o of visible) {
        const label =
          kind === "room"
            ? readResource("rooms", o.roomId)
            : kind === "person"
              ? readResource("people", o.personId)
              : o.group || "No group label";
        if (!grouped.has(label)) grouped.set(label, []);
        grouped.get(label).push(o);
      }
      for (const [label, items] of [...grouped].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        const section = node("section", "", "diary-print-pack-group");
        section.append(
          node(
            "h4",
            `${kind === "room" ? "Room" : kind === "person" ? "Staff role" : "Group"}: ${label}`,
          ),
        );
        const table = node("table"),
          head = node("thead"),
          header = node("tr");
        section.append(
          node(
            "p",
            `${diary.settings.school || "School music programme"} · My Music Lessons · ${rangeFrom}–${end} · Prepared ${today()}`,
            "diary-pack-context diary-help",
          ),
        );
        for (const label of [
          "Date / time",
          "Session / group",
          "Room / staff role",
        ]) {
          const th = node("th", label);
          th.scope = "col";
          header.append(th);
        }
        head.append(header);
        table.append(head);
        const body = node("tbody");
        for (const o of items) {
          const row = node("tr");
          for (const text of [
            `${pretty(o.date)} · ${o.startTime}–${o.endTime}`,
            `${o.title} · ${o.group || "No group"}${clashing.has(o.id) ? " · Clash to review" : ""}`,
            `${readResource("rooms", o.roomId)} · ${readResource("people", o.personId)}`,
          ])
            row.append(node("td", text));
          body.append(row);
        }
        table.append(body);
        section.append(table);
        pack.append(section);
      }
    }
    $("data-diary-empty").hidden = visible.length > 0;
    const empty = $("data-diary-empty");
    empty.replaceChildren();
    empty.append(
      node(
        "strong",
        all.length
          ? "A clear space in the diary."
          : "Your music week starts here.",
      ),
      node(
        "span",
        all.length
          ? "No sessions match these dates and filters. Try another week or clear the filters."
          : "Add one session, build a weekly timetable or bring in your spreadsheet.",
      ),
    );
    const emptyActions = node("div", "", "diary-actions");
    if (all.length) {
      const reset = button("Clear filters", "unused", "");
      reset.addEventListener("click", () => {
        for (const key of [
          "data-diary-room-filter",
          "data-diary-person-filter",
          "data-diary-group-filter",
          "data-diary-search",
        ])
          $(key).value = "";
        render();
      });
      emptyActions.append(reset);
    } else
      for (const [text, panelId, selector] of [
        ["Add a session", "diary-session-setup", "[data-session-title]"],
        [
          "Build a timetable",
          "diary-timetable-builder",
          "[data-builder-title]",
        ],
        ["Import a spreadsheet", "diary-spreadsheet-import", "[data-csv-file]"],
      ]) {
        const b = button(text, "unused", "");
        b.addEventListener("click", () => {
          const panel = root.querySelector("#" + panelId);
          panel.open = true;
          panel.querySelector(selector)?.focus();
        });
        emptyActions.append(b);
      }
    empty.append(emptyActions);
    const alerts = $("data-diary-conflicts");
    const clashExpanded =
      alerts.querySelector(".diary-conflict-disclosure")?.open || false;
    alerts.replaceChildren();
    if (conflicts.length) {
      const disclosure = node("details", "", "diary-conflict-disclosure");
      disclosure.open = clashExpanded;
      disclosure.append(
        node(
          "summary",
          `${conflicts.length} clash pair${conflicts.length === 1 ? "" : "s"} · Review clashes`,
        ),
      );
      const list = node("ul");
      for (const c of conflicts.slice(0, 100)) {
        const a = lookup.get(c.occurrenceIds[0]),
          b = lookup.get(c.occurrenceIds[1]);
        list.append(
          node(
            "li",
            `${pretty(c.date)} · ${a.title} (${a.startTime}–${a.endTime}) and ${b.title} (${b.startTime}–${b.endTime}) share ${c.types.map((t) => ({ room: "a room", person: "a staff role", group: "a group label" })[t]).join(", ")}.`,
            "diary-conflict-item",
          ),
        );
      }
      disclosure.append(list);
      if (conflicts.length > 100)
        disclosure.append(
          node(
            "p",
            "Only the first 100 clash pairs are listed. Filter or edit the patterns to reduce clashes.",
          ),
        );
      alerts.append(disclosure);
    }
    alerts.hidden = !conflicts.length;
    $("data-diary-print-heading")?.replaceChildren(
      node("p", "My Music Lessons · School music programme diary"),
      node(
        "p",
        `${rangeFrom}–${end}. ${room ? "Room: " + readResource("rooms", room) + ". " : ""}${person ? "Staff role: " + readResource("people", person) + ". " : ""}${group ? "Group: " + group + ". " : ""}${search ? "Search: " + search + ". " : ""}Prepared ${today()}. Europe/London. School planning labels only.`,
      ),
    );
    root
      .querySelector("[data-diary-undo]")
      ?.toggleAttribute("disabled", !history.length);
    saveSummary();
    if (sourceChanged) {
      workflows?.stateChanged();
      management?.stateChanged();
    }
    premium?.stateChanged();
  }
  function syncSettings() {
    $("data-diary-school").value = diary.settings.school;
    $("data-diary-term-start").value = diary.settings.termStart;
    $("data-diary-term-end").value = diary.settings.termEnd;
  }
  function clearEditor() {
    editingId = null;
    editorDirty = false;
    $("data-session-title").value = "";
    $("data-session-group").value = "";
    $("data-session-repeat").value = "weekly";
    $("data-session-start-date").value = diary.settings.termStart;
    $("data-session-end-date").value = diary.settings.termEnd;
    $("data-session-start-time").value = "15:30";
    $("data-session-end-time").value = "15:50";
    $("data-session-room").value = "";
    $("data-session-person").value = "";
    $("data-session-end-date").disabled = false;
    $("data-session-cancel-edit").hidden = true;
    $("data-session-save").textContent = "Save session pattern";
    $("data-session-edit-status").textContent =
      "Add a session pattern. Use group and staff-role labels, not pupil names.";
    renderExclusions();
    premium?.stateChanged();
  }
  function safeEditor() {
    if (!editorDirty) return true;
    message(
      "Save or cancel the session edit before replacing, exporting or printing the diary.",
    );
    return false;
  }
  function editRule(id) {
    if (editorDirty && !confirm("Discard the unsaved session edit?")) return;
    const s = diary.sessions.find((x) => x.id === id);
    if (!s) return;
    editingId = id;
    for (const [key, name] of [
      ["title", "title"],
      ["group", "group"],
      ["instrument", "instrument"],
      ["room", "roomId"],
      ["person", "personId"],
      ["start-date", "startDate"],
      ["end-date", "endDate"],
      ["start-time", "startTime"],
      ["end-time", "endTime"],
      ["repeat", "repeat"],
    ]) {
      const input = $("data-session-" + key);
      if (
        key === "instrument" &&
        ![...input.options].some((o) => o.value === s[name])
      ) {
        const option = node("option", s[name] || "Other");
        option.value = s[name];
        input.append(option);
      }
      input.value = s[name];
    }
    editorDirty = false;
    $("data-session-end-date").disabled = s.repeat === "once";
    $("data-session-cancel-edit").hidden = false;
    $("data-session-save").textContent = "Save pattern changes";
    $("data-session-edit-status").textContent =
      "Editing " +
      s.title +
      ". Changes apply to the whole pattern; cancellations stay excluded.";
    renderExclusions();
    $("data-session-title").closest("details").open = true;
    $("data-session-title").focus();
    premium?.stateChanged();
  }
  const editor = root.querySelector("#diary-session-editor");
  editor.addEventListener("input", () => {
    editorDirty = true;
    $("data-session-cancel-edit").hidden = false;
    $("data-session-cancel-edit").textContent = editingId
      ? "Cancel edit"
      : "Clear unsaved session";
    premium?.stateChanged();
  });
  $("data-session-repeat").addEventListener("change", () => {
    const once = $("data-session-repeat").value === "once";
    $("data-session-end-date").disabled = once;
    if (once)
      $("data-session-end-date").value = $("data-session-start-date").value;
  });
  $("data-session-start-date").addEventListener("change", () => {
    if ($("data-session-repeat").value === "once")
      $("data-session-end-date").value = $("data-session-start-date").value;
  });
  $("data-session-save").addEventListener("click", () => {
    const invalid = [...editor.querySelectorAll("input,select")].find(
      (e) => !e.disabled && !e.checkValidity(),
    );
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    const previous = diary.sessions.find((s) => s.id === editingId);
    const session = {
      id: editingId || uid(),
      title: $("data-session-title").value,
      group: $("data-session-group").value,
      instrument: $("data-session-instrument").value,
      roomId: $("data-session-room").value,
      personId: $("data-session-person").value,
      startDate: $("data-session-start-date").value,
      endDate:
        $("data-session-repeat").value === "once"
          ? $("data-session-start-date").value
          : $("data-session-end-date").value,
      startTime: $("data-session-start-time").value,
      endTime: $("data-session-end-time").value,
      repeat: $("data-session-repeat").value,
      excludedDates: previous?.excludedDates || [],
    };
    const next = copy(diary);
    if (previous)
      next.sessions[next.sessions.findIndex((s) => s.id === editingId)] =
        session;
    else next.sessions.push(session);
    if (
      commit(
        next,
        "Session pattern saved. Review any clash warnings in the diary.",
      )
    ) {
      week = monday(session.startDate);
      clearEditor();
      render();
      premium?.closeTool();
    }
  });
  $("data-session-cancel-edit").addEventListener("click", () => {
    clearEditor();
    message("Session edit cancelled. The saved diary has not changed.");
  });
  $("data-diary-settings-save").addEventListener("click", () => {
    if (
      !$("data-diary-term-start").reportValidity() ||
      !$("data-diary-term-end").reportValidity()
    )
      return;
    const next = copy(diary);
    next.settings = {
      school: $("data-diary-school").value,
      termStart: $("data-diary-term-start").value,
      termEnd: $("data-diary-term-end").value,
    };
    if (
      commit(
        next,
        "School and term applied. Patterns outside the term remain in All session patterns.",
      )
    ) {
      syncSettings();
      if (!editingId && !editorDirty) clearEditor();
    }
  });
  for (const [kind, key] of [
    ["rooms", "room"],
    ["people", "person"],
  ])
    $("data-diary-" + key + "-add").addEventListener("click", () => {
      const input = $("data-diary-" + key + "-name"),
        name = input.value.trim();
      if (!name) {
        input.focus();
        message(
          "Enter a " +
            (key === "room" ? "room" : "staff role") +
            " label first.",
        );
        return;
      }
      const next = copy(diary);
      next.resources[kind].push({ id: uid(), name });
      if (
        commit(
          next,
          "Resource added. You can allocate it to a session pattern.",
        )
      )
        input.value = "";
    });
  $("data-diary-closure-add").addEventListener("click", () => {
    const start = $("data-diary-closure-start"),
      end = $("data-diary-closure-end");
    if (!start.reportValidity() || !end.reportValidity()) return;
    const next = copy(diary);
    next.closures.push({
      id: uid(),
      start: start.value,
      end: end.value,
      label: $("data-diary-closure-label").value.trim() || "School closure",
    });
    if (
      commit(
        next,
        "Closure added. Session dates within the closure are omitted.",
      )
    )
      $("data-diary-closure-label").value = "";
  });
  root.addEventListener("click", (event) => {
    const b = event.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.ruleEdit) editRule(d.ruleEdit);
    if (d.ruleDuplicate && safeEditor()) {
      try {
        commit(
          duplicateDiarySession(diary, d.ruleDuplicate),
          "Session pattern duplicated. Its time is unchanged; move or edit the copy and review clashes.",
        );
      } catch (e) {
        message("Duplicate was not added. " + e.message);
      }
    }
    if (
      d.ruleDelete &&
      confirm(
        "Delete this whole session pattern and all its dates? You can undo this action in this tab.",
      )
    ) {
      const next = copy(diary);
      next.sessions = next.sessions.filter((s) => s.id !== d.ruleDelete);
      if (
        commit(next, "Session pattern deleted.") &&
        editingId === d.ruleDelete
      )
        clearEditor();
    }
    if (d.cancelOccurrence) {
      const next = copy(diary),
        s = next.sessions.find((x) => x.id === d.cancelOccurrence);
      if (s && !s.excludedDates.includes(d.occurrenceDate)) {
        s.excludedDates.push(d.occurrenceDate);
        commit(
          next,
          "This date is cancelled in the diary. Edit the pattern to restore it.",
        );
      }
    }
    if (d.restoreRuleDate) {
      const next = copy(diary),
        s = next.sessions.find((x) => x.id === d.restoreRuleDate);
      s.excludedDates = s.excludedDates.filter(
        (date) => date !== d.restoreDate,
      );
      commit(next, "Date restored. Review any new clash warnings.");
    }
    if (d.resourceRemove) {
      const selected = $(
        d.resourceKind === "rooms"
          ? "data-session-room"
          : "data-session-person",
      ).value;
      if (selected === d.resourceRemove && (editorDirty || editingId)) {
        message(
          "This resource is selected in the session editor. Change that selection or cancel the edit before removing the resource.",
        );
        return;
      }

      const next = copy(diary);
      next.resources[d.resourceKind] = next.resources[d.resourceKind].filter(
        (x) => x.id !== d.resourceRemove,
      );
      commit(next, "Resource removed.");
    }
    if (d.closureRemove) {
      const next = copy(diary);
      next.closures = next.closures.filter((c) => c.id !== d.closureRemove);
      commit(next, "Closure removed. Eligible session dates are restored.");
    }
    if (d.addOnDate) {
      if (editorDirty && !confirm("Discard the unsaved session edit?")) return;
      clearEditor();
      $("data-session-repeat").value = "once";
      $("data-session-start-date").value = d.addOnDate;
      $("data-session-end-date").value = d.addOnDate;
      $("data-session-end-date").disabled = true;
      $("data-session-title").closest("details").open = true;
      $("data-session-title").focus();
    }
  });
  let dragSource = null;
  const clearDropTargets = () =>
    root
      .querySelectorAll(".diary-drop-target")
      .forEach((e) => e.classList.remove("diary-drop-target"));
  root.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".diary-session[draggable=true]");
    if (!card || event.target.closest("button") || !event.dataTransfer) return;
    dragSource = {
      sessionId: card.dataset.sessionId,
      date: card.dataset.sessionDate,
      calendarId: diary.calendarId,
      base: JSON.stringify(diary),
    };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-mml-diary",
      JSON.stringify({
        sessionId: dragSource.sessionId,
        date: dragSource.date,
        calendarId: dragSource.calendarId,
      }),
    );
  });
  root.addEventListener("dragover", (event) => {
    const target = event.target.closest("[data-diary-date]");
    if (!dragSource || !target) return;
    const date = target.dataset.diaryDate;
    if (
      date < diary.settings.termStart ||
      date > diary.settings.termEnd ||
      diary.closures.some((c) => date >= c.start && date <= c.end)
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearDropTargets();
    target.classList.add("diary-drop-target");
  });
  root.addEventListener("dragleave", (event) => {
    const target = event.target.closest(".diary-drop-target");
    if (target && !target.contains(event.relatedTarget))
      target.classList.remove("diary-drop-target");
  });
  root.addEventListener("dragend", () => {
    dragSource = null;
    clearDropTargets();
  });
  root.addEventListener("drop", (event) => {
    const target = event.target.closest("[data-diary-date]"),
      source = dragSource;
    dragSource = null;
    clearDropTargets();
    if (!source || !target) return;
    event.preventDefault();
    try {
      const transfer = JSON.parse(
          event.dataTransfer.getData("application/x-mml-diary"),
        ),
        date = target.dataset.diaryDate;
      if (
        source.base !== JSON.stringify(diary) ||
        transfer.calendarId !== diary.calendarId ||
        transfer.sessionId !== source.sessionId ||
        transfer.date !== source.date
      )
        throw Error(
          "The diary changed during the drag. Choose Move session again.",
        );
      if (
        date < diary.settings.termStart ||
        date > diary.settings.termEnd ||
        diary.closures.some((c) => date >= c.start && date <= c.end)
      )
        throw Error("Choose an open date inside the school term.");
      workflows?.moveOpen(source.sessionId, source.date, { newDate: date });
    } catch (e) {
      message("No session was moved. " + e.message);
    }
  });
  const undo = button("Undo", "unused", "");
  undo.setAttribute("aria-label", "Undo last diary change");
  undo.title = "Undo last diary change";
  undo.setAttribute("data-diary-undo", "");
  undo.disabled = true;
  root.querySelector(".diary-toolbar").append(undo);
  undo.addEventListener("click", () => {
    if (!history.length || !safeEditor()) return;
    diary = history.pop();
    dirty = true;
    persist();
    syncSettings();
    clearEditor();
    render();
    message("Last diary change undone.");
  });
  $("data-diary-prev").addEventListener("click", () => {
    const mode = $("data-diary-view").value;
    if (mode === "month" || mode === "year") {day=shiftPeriod(day,mode,-1);week=monday(day);}
    else if (mode === "day") {
      day = addDays(day, -1);
      week = monday(day);
    } else {
      week = addDays(week, -7);
      day = week;
    }
    render();
  });
  $("data-diary-next").addEventListener("click", () => {
    const mode = $("data-diary-view").value;
    if (mode === "month" || mode === "year") {day=shiftPeriod(day,mode,1);week=monday(day);}
    else if (mode === "day") {
      day = addDays(day, 1);
      week = monday(day);
    } else {
      week = addDays(week, 7);
      day = week;
    }
    render();
  });
  $("data-diary-today").addEventListener("click", () => {
    week = monday(today());
    day = today();
    render();
  });
  $("data-diary-week").addEventListener("change", () => {
    if (!$("data-diary-week").reportValidity()) return;
    week = monday($("data-diary-week").value);
    day = $("data-diary-week").value;
    render();
  });
  $("data-diary-day").addEventListener("change", () => {
    if (!$("data-diary-day").reportValidity()) return;
    day = $("data-diary-day").value;
    week = monday(day);
    render();
  });
  for (const k of [
    "data-diary-view",
    "data-diary-room-filter",
    "data-diary-person-filter",
    "data-diary-group-filter",
    "data-diary-print-group",
    "data-diary-export-range",
  ])
    $(k).addEventListener("change", render);
  $("data-diary-search").addEventListener("input", render);
  $("data-diary-backup").addEventListener("click", () => {
    if (!safeEditor()) return;
    downloadText(
      "mml-school-music-diary.json",
      JSON.stringify(validateDiary(diary), null, 2),
      "application/json",
    );
    dirty = false;
    changesSinceBackup = 0;
    saveSummary();
    message(
      "JSON backup downloaded. Keep it somewhere appropriate for your school.",
    );
  });
  $("data-diary-quick-backup").addEventListener("click", () =>
    $("data-diary-backup").click(),
  );
  $("data-diary-open-saving").addEventListener("click", () => {
    const panel = root.querySelector("#diary-save-settings");
    panel.open = true;
    panel.scrollIntoView({ block: "start" });
    $("data-diary-autosave").focus({ preventScroll: true });
  });
  $("data-diary-import").addEventListener("change", async (event) => {
    let importFile;
    try {
      const file = event.target.files[0];
      importFile = file;
      if (!file) return;
      if (!safeEditor()) return;
      if (file.size > MAX_DIARY_FILE)
        throw Error("Choose a backup smaller than 1 MB.");
      const next = parseDiary(await file.text());
      if (event.target.files[0] !== file || !safeEditor()) return;
      validateClock(next);
      if (
        (diary.sessions.length || dirty) &&
        !confirm(
          "Replace the current diary with this backup? Download your current backup first if needed.",
        )
      )
        return;
      if (commit(next, "Diary backup imported.")) {
        week = monday(next.settings.termStart);
        syncSettings();
        clearEditor();
        render();
      }
    } catch (e) {
      message("Import was not applied. " + e.message);
    } finally {
      if (event.target.files[0] === importFile) event.target.value = "";
    }
  });
  function replacePlan(next, label) {
    if (!safeEditor()) return;
    if (
      (diary.sessions.length || dirty) &&
      !confirm("Replace the current diary? Download a backup first if needed.")
    )
      return;
    if (commit(next, label)) {
      week = monday(diary.settings.termStart);
      syncSettings();
      clearEditor();
      render();
      premium?.closeTool();
    }
  }
  $("data-diary-reset").addEventListener("click", () =>
    replacePlan(fresh(), "New empty diary created."),
  );
  $("data-diary-example").addEventListener("click", () => {
    const example = fresh();
    example.settings.school = "Example school programme";
    example.resources = {
      rooms: [
        { id: "room-a", name: "Practice room A" },
        { id: "room-b", name: "Practice room B" },
      ],
      people: [
        { id: "role-a", name: "Music lead" },
        { id: "role-b", name: "Club supervisor" },
      ],
    };
    example.sessions = [
      {
        id: "example-guitar",
        title: "Beginner guitar practice",
        group: "Guitar group A",
        instrument: "Guitar",
        roomId: "room-a",
        personId: "role-a",
        startDate: example.settings.termStart,
        endDate: example.settings.termEnd,
        startTime: "15:30",
        endTime: "15:50",
        repeat: "weekly",
        excludedDates: [],
      },
      {
        id: "example-piano",
        title: "Keyboard practice",
        group: "Keyboard group B",
        instrument: "Piano",
        roomId: "room-b",
        personId: "role-b",
        startDate: addDays(example.settings.termStart, 2),
        endDate: example.settings.termEnd,
        startTime: "12:30",
        endTime: "12:50",
        repeat: "fortnightly",
        excludedDates: [],
      },
    ];
    replacePlan(
      example,
      "Labelled example loaded. Replace its dates and labels before using it for your school.",
    );
  });
  $("data-diary-autosave").addEventListener("change", async () => {
    if ($("data-diary-autosave").checked) {
      persist();
      return;
    }
    if (revision) {
      if (
        !confirm(
          "Turn off device saving and remove this browser’s saved copy? Keep a JSON backup if needed.",
        )
      ) {
        $("data-diary-autosave").checked = true;
        return;
      }
      try {
        await withDiaryLock(navigator.locks, () =>
          forgetDeviceDiary(localStorage, revision),
        );
        revision = null;
        savedAt = null;
        dirty = true;
      } catch (e) {
        message(e.message);
      }
    }
    persist();
  });
  $("data-diary-local-load").addEventListener("click", () => {
    if (accounts?.connected) return message("Sign out before loading a device copy, or import a backup to replace your account programme deliberately.");
    try {
      const saved = readDeviceDiary(localStorage);
      if (!saved) {
        message("There is no saved diary in this browser.");
        return;
      }
      if (!safeEditor()) return;
      if (
        (dirty || diary.sessions.length) &&
        !confirm("Load the browser’s saved diary and replace the current one?")
      )
        return;
      validateClock(saved.diary);
      history = [];
      diary = saved.diary;
      revision = saved.revision;
      savedAt = saved.savedAt;
      dirty = false;
      $("data-diary-autosave").checked =
        typeof navigator.locks?.request === "function";
      week = monday(diary.settings.termStart);
      syncSettings();
      clearEditor();
      render();
      $("data-diary-save-status").textContent =
        "Loaded the device copy saved at " +
        new Date(savedAt).toLocaleString("en-GB") +
        ".";
      message("Saved device diary loaded.");
    } catch (e) {
      message(e.message);
    }
  });
  $("data-diary-local-clear").addEventListener("click", async () => {
    if (
      !confirm(
        "Forget this browser’s saved diary? The current diary stays open; download a JSON backup to keep it.",
      )
    )
      return;
    try {
      await withDiaryLock(navigator.locks, () => {
        try {
          readDeviceDiary(localStorage);
        } catch {
          localStorage.removeItem(DIARY_PREVIOUS_KEY);
          localStorage.removeItem(DIARY_STORAGE_KEY);
          return;
        }
        forgetDeviceDiary(localStorage, revision);
      });
      revision = null;
      savedAt = null;
      $("data-diary-autosave").checked = false;
      dirty = true;
      persist();
      message("Browser-saved copy removed. Current diary remains in this tab.");
    } catch (e) {
      message(e.message);
    }
  });
  $("data-diary-restore-previous").addEventListener("click", async () => {
    if (accounts?.connected) return message("Sign out before recovering a device copy, or import a backup to replace your account programme deliberately.");
    if (!safeEditor()) return;
    if (
      !confirm(
        "Recover the previous device copy and replace the open diary? Download a backup first if needed. Device saving will be on; the replaced saved copy becomes the recovery copy.",
      )
    )
      return;
    const recoverySource = JSON.stringify(diary);
    try {
      const saved = await withDiaryLock(navigator.locks, () => {
        if (!safeEditor() || JSON.stringify(diary) !== recoverySource)
          throw Error(
            "The open diary or session editor changed while recovery waited. Keep your changes and request recovery again when ready.",
          );
        const previous = readPreviousDiary(localStorage);
        if (!previous)
          throw Error("There is no previous device copy to recover.");
        validateClock(previous.diary);
        return restorePreviousDiary(localStorage, revision);
      });
      history.push(copy(diary));
      if (history.length > 12) history.shift();
      diary = saved.diary;
      revision = saved.revision;
      savedAt = saved.savedAt;
      dirty = false;
      changesSinceBackup++;
      $("data-diary-autosave").checked = true;
      week = monday(diary.settings.termStart);
      day = diary.settings.termStart;
      syncSettings();
      clearEditor();
      render();
      $("data-diary-save-status").textContent =
        "Previous device copy recovered and saved. The replaced saved version is available as the recovery copy. Keep a JSON backup too.";
      message(
        "Previous device diary recovered. The open diary has been replaced.",
      );
    } catch (e) {
      message("Recovery was not applied. " + e.message);
    }
  });
  window.addEventListener("storage", (event) => {
    if (
      event.key !== DIARY_STORAGE_KEY &&
      event.key !== DIARY_PREVIOUS_KEY &&
      event.key !== null
    )
      return;
    previousReadKey = undefined;
    $("data-diary-autosave").checked = false;
    $("data-diary-save-status").textContent =
      "Another tab changed or removed the browser copy. This tab has not been overwritten. Download a backup or load the saved copy before saving again.";
    dirty = true;
    saveSummary();
    message(
      "Device diary changed in another tab. Automatic saving stopped to protect this tab.",
    );
  });
  function exportView() {
    const plan = copy(diary),
      room = $("data-diary-room-filter").value,
      person = $("data-diary-person-filter").value,
      group = $("data-diary-group-filter").value,
      search = $("data-diary-search").value.trim().toLowerCase();
    plan.sessions = plan.sessions.filter(
      (s) =>
        (!room || s.roomId === room) &&
        (!person || s.personId === person) &&
        (!group || s.group.toLowerCase() === group) &&
        (!search ||
          [
            s.title,
            s.group,
            s.instrument,
            readResource("rooms", s.roomId),
            readResource("people", s.personId),
          ]
            .join(" ")
            .toLowerCase()
            .includes(search)),
    );
    const range =
      $("data-diary-export-range").value === "term"
        ? {}
        : {
            from:
              week < diary.settings.termStart ? diary.settings.termStart : week,
            to:
              addDays(week, 6) > diary.settings.termEnd
                ? diary.settings.termEnd
                : addDays(week, 6),
          };
    return { plan, range };
  }
  for (const [selector, extension, type, fn] of [
    ["data-diary-ics", "ics", "text/calendar;charset=utf-8", diaryToIcs],
    ["data-diary-csv", "csv", "text/csv;charset=utf-8", diaryToCsv],
  ])
    $(selector).addEventListener("click", () => {
      if (!safeEditor()) return;
      try {
        const { plan, range } = exportView();
        downloadText("school-music-diary." + extension, fn(plan, range), type);
        message(
          extension.toUpperCase() +
            " snapshot downloaded using the selected range and current filters. This does not sync or send calendar invitations.",
        );
      } catch (e) {
        message("Export was not created. " + e.message);
      }
    });
  $("data-diary-print").addEventListener("click", () => {
    if (safeEditor()) {
      render();
      window.print();
    }
  });
  let printClashState = null;
  window.addEventListener("beforeprint", () => {
    const panel = root.querySelector(".diary-conflict-disclosure");
    if (panel) {
      printClashState = { panel, open: panel.open };
      panel.open = true;
    }
  });
  window.addEventListener("afterprint", () => {
    if (printClashState) {
      printClashState.panel.open = printClashState.open;
      printClashState = null;
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty || editorDirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  try {
    const saved = readDeviceDiary(localStorage);
    if (saved) {
      validateClock(saved.diary);
      diary = saved.diary;
      revision = saved.revision;
      savedAt = saved.savedAt;
      $("data-diary-autosave").checked =
        typeof navigator.locks?.request === "function";
      week = monday(today());
      $("data-diary-save-status").textContent =
        "Loaded this browser’s saved diary from " +
        new Date(savedAt).toLocaleString("en-GB") +
        ".";
      message(
        "Saved device diary loaded. Keep a portable backup before changing device.",
      );
    } else persist();
  } catch (e) {
    $("data-diary-save-status").textContent =
      "Device save unavailable: " + e.message;
  }
  if (typeof navigator.locks?.request !== "function") {
    $("data-diary-autosave").checked = false;
    $("data-diary-autosave").disabled = true;
    $("data-diary-local-clear").disabled = true;
    $("data-diary-save-status").textContent =
      "Device saving is unavailable in this browser. Use a JSON backup; your open diary still works.";
  }
  if (matchMedia("(max-width: 700px)").matches)
    $("data-diary-view").value = "agenda";
  syncSettings();
  render();
  clearEditor();
  workflows = mountDiaryWorkflows({
    root,
    getDiary: () => diary,
    commit,
    safeEditor,
    message,
    navigate: (date) => {
      if (date) {
        day = date;
        week = monday(date);
      }
      clearEditor();
      render();
      premium?.closeTool();
    },
  });
  management = mountDiaryManagement({
    root,
    getDiary: () => diary,
    getView: () => currentView,
    commit,
    safeEditor,
    message,
    navigate: (date) => {
      if (date) {
        day = date;
        week = monday(date);
      }
      render();
      premium?.closeTool();
    },
    prefillSession: (slot) => {
      if (!safeEditor()) return;
      clearEditor();
      $("data-session-repeat").value = "once";
      $("data-session-start-date").value = slot.date;
      $("data-session-end-date").value = slot.date;
      $("data-session-end-date").disabled = true;
      $("data-session-start-time").value = slot.startTime;
      $("data-session-end-time").value = slot.endTime;
      $("data-session-room").value = slot.roomId;
      $("data-session-person").value = slot.personId;
      $("data-session-group").value = slot.group;
      editorDirty = true;
      $("data-session-cancel-edit").hidden = false;
      $("data-session-cancel-edit").textContent = "Clear unsaved session";
      $("data-session-title").closest("details").open = true;
      $("data-session-title")
        .closest("details")
        .scrollIntoView({ block: "start" });
      $("data-session-title").focus({ preventScroll: true });
    },
  });
  accounts = mountDiaryAccount({root,getDiary:()=>diary,onStatus:()=>{const online=!!accounts?.connected;const device=$("data-diary-autosave");device.disabled=online||typeof navigator.locks?.request!=="function";if(online)device.checked=false;$("data-diary-local-load").disabled=online;saveSummary();},onSaved:(saved)=>{if(accounts?.connected)$("data-diary-autosave").checked=false;if(JSON.stringify(saved)===JSON.stringify(diary)){dirty=false;saveSummary();}},replaceDiary:(next,force=false)=>{if(!force&&!safeEditor())return false;if(!force&&(diary.sessions.length||dirty)&&!confirm("Open the account diary instead of the current diary? Keep a backup first if needed."))return false;diary=next?validateDiary(next):fresh();history=[];dirty=false;day=diary.settings.termStart;week=monday(day);$("data-diary-autosave").checked=false;syncSettings();clearEditor();render();return true;}});
  premium = mountDiaryPremium({
    root,
    getDiary: () => diary,
    getView: () => currentView,
    hasEditorChanges: () => editorDirty,
    message,
    addSession: () => {
      if (!editorDirty) {
        clearEditor();
        $("data-session-start-date").value = currentView.from;
      }
      const panel = $("data-session-title").closest("details");
      panel.open = true;
      $("data-session-title").focus({ preventScroll: true });
    },
    redraw: render,
  });
}

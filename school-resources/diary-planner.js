import { validateDiary, expandDiary, findConflicts } from "./diary-model.js";
import { wallTimeToUtc } from "./diary-export.js";

const DAY = 86_400_000;
const MAX_PATTERNS = 100;

function record(value, path) {
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new TypeError(`${path} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
    )
      throw new TypeError(`${path} must contain plain data fields.`);
  }
  return value;
}

function label(value, path, max, required = false) {
  if (typeof value !== "string") throw new TypeError(`${path} must be text.`);
  if (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(
      value,
    )
  )
    throw new TypeError(`${path} contains unsupported control characters.`);
  const clean = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if ((required && !clean) || clean.length > max)
    throw new RangeError(
      `${path} must contain ${required ? "1" : "0"}–${max} characters.`,
    );
  return clean;
}

function day(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new TypeError(`${path} must use YYYY-MM-DD.`);
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value ||
    value < "2020-01-01" ||
    value > "2100-12-31"
  )
    throw new RangeError(`${path} must be a real date between 2020 and 2100.`);
  return timestamp / DAY;
}

function dateText(value) {
  const result = new Date(value * DAY).toISOString().slice(0, 10);
  day(result, "Shifted date");
  return result;
}

function minute(value, path) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value))
    throw new TypeError(`${path} must use a 24-hour HH:mm time.`);
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function timeText(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function whole(value, path, min, max) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(
      `${path} must be a whole number from ${min} to ${max}.`,
    );
  return value;
}

function id(value, path) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(value))
    throw new TypeError(
      `${path} must use 1–80 letters, numbers, underscores or hyphens.`,
    );
  return value;
}

function newIds(diary, options) {
  record(options, "Planner options");
  const factory =
    options.idFactory === undefined
      ? () => globalThis.crypto.randomUUID()
      : options.idFactory;
  if (typeof factory !== "function")
    throw new TypeError("The ID factory must be a function.");
  const used = new Set(diary.sessions.map((session) => session.id));
  return () => {
    const value = id(factory(), "New session ID");
    if (used.has(value))
      throw new TypeError(
        "The ID factory returned a duplicate session ID. Try again.",
      );
    used.add(value);
    return value;
  };
}

function capacity(count) {
  if (count > MAX_PATTERNS)
    throw new RangeError(
      "The diary can contain at most 100 session patterns. Shorten the draft or use a fixed weekly timetable.",
    );
}

function inTerm(diary, value, path) {
  const result = day(value, path);
  if (value < diary.settings.termStart || value > diary.settings.termEnd)
    throw new RangeError(
      `${path} must be inside the diary term. Change the term or choose another date.`,
    );
  return result;
}

function isClosed(diary, value) {
  return diary.closures.some(
    (closure) => value >= closure.start && value <= closure.end,
  );
}

function resources(diary, roomId, personId) {
  for (const [value, collection, path] of [
    [roomId, "rooms", "Room"],
    [personId, "people", "Staff role"],
  ]) {
    if (value !== "") {
      id(value, path);
      if (
        !diary.resources[collection].some((resource) => resource.id === value)
      )
        throw new TypeError(
          `${path} refers to a resource that no longer exists.`,
        );
    }
  }
}

function checkTimes(occurrences) {
  for (const occurrence of occurrences) {
    wallTimeToUtc(occurrence.date, occurrence.startTime);
    wallTimeToUtc(occurrence.date, occurrence.endTime);
  }
}

function validatedChange(diary, changedIds) {
  const clean = validateDiary(diary);
  checkTimes(
    expandDiary(clean).filter((occurrence) =>
      changedIds.has(occurrence.sessionId),
    ),
  );
  return clean;
}

/** Create an additive draft for one weekly teaching window, without mutating the programme. */
export function buildDiaryDraft(input, config, options = {}) {
  const diary = validateDiary(input);
  record(config, "Timetable setup");
  const makeId = newIds(diary, options);
  const title = label(config.title, "Title", 120, true);
  const instrument = label(config.instrument, "Instrument", 80);
  if (
    !Array.isArray(config.groups) ||
    Object.getPrototypeOf(config.groups) !== Array.prototype ||
    !config.groups.length ||
    config.groups.length > 100
  )
    throw new RangeError("Add 1–100 group labels.");
  const groups = [];
  for (let index = 0; index < config.groups.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(
      config.groups,
      String(index),
    );
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new TypeError("Groups must contain plain text labels.");
    groups.push(label(descriptor.value, `Group ${index + 1}`, 80, true));
  }
  if (
    new Set(groups.map((group) => group.toLowerCase())).size !== groups.length
  )
    throw new TypeError("Each group label must be unique.");
  const first = inTerm(diary, config.firstDate, "First date");
  const last = inTerm(diary, config.lastDate, "Last date");
  if (last < first)
    throw new RangeError("The last date must be on or after the first date.");
  const start = minute(config.startTime, "Window start");
  const end = minute(config.endTime, "Window end");
  if (end <= start)
    throw new RangeError(
      "The teaching window must end after it starts on the same day.",
    );
  const duration = whole(config.durationMinutes, "Session length", 1, 1439);
  const changeover = whole(config.changeoverMinutes, "Changeover", 0, 1439);
  const breakStartValue =
    config.breakStart === undefined ? "" : config.breakStart;
  const breakEndValue = config.breakEnd === undefined ? "" : config.breakEnd;
  let breakStart = null;
  let breakEnd = null;
  if (breakStartValue !== "" || breakEndValue !== "") {
    breakStart = minute(breakStartValue, "Break start");
    breakEnd = minute(breakEndValue, "Break end");
    if (breakEnd <= breakStart || breakStart < start || breakEnd > end)
      throw new RangeError(
        "The break must be a forward time range inside the teaching window.",
      );
  }
  if (!["fixed", "rotate"].includes(config.mode))
    throw new TypeError("Choose a fixed or rotating timetable.");
  const roomId = config.roomId === undefined ? "" : config.roomId;
  const personId = config.personId === undefined ? "" : config.personId;
  resources(diary, roomId, personId);
  const slots = [];
  let cursor = start;
  for (const group of groups) {
    if (
      breakStart !== null &&
      cursor < breakEnd &&
      cursor + duration > breakStart
    )
      cursor = breakEnd;
    if (cursor + duration > end)
      throw new RangeError(
        "The teaching window does not have enough time for every group, changeover and break. Extend the window or reduce the groups or session length.",
      );
    slots.push({
      startTime: timeText(cursor),
      endTime: timeText(cursor + duration),
    });
    cursor += duration + changeover;
  }
  const weeks = [];
  for (let current = first, phase = 0; current <= last; current += 7, phase++) {
    const date = dateText(current);
    if (!isClosed(diary, date)) weeks.push({ date, phase });
  }
  if (!weeks.length)
    throw new RangeError(
      "There are no session dates in this window after school closures.",
    );
  const count =
    config.mode === "fixed" ? groups.length : weeks.length * groups.length;
  capacity(diary.sessions.length + count);
  const added = [];
  const base = { title, instrument, roomId, personId, excludedDates: [] };
  if (config.mode === "fixed") {
    groups.forEach((group, index) =>
      added.push({
        ...base,
        id: makeId(),
        group,
        ...slots[index],
        startDate: config.firstDate,
        endDate: config.lastDate,
        repeat: "weekly",
      }),
    );
  } else {
    for (const { date, phase } of weeks)
      slots.forEach((slot, index) =>
        added.push({
          ...base,
          id: makeId(),
          group: groups[(index + phase) % groups.length],
          ...slot,
          startDate: date,
          endDate: date,
          repeat: "once",
        }),
      );
  }
  const addedRuleIds = added.map((session) => session.id);
  const addedSet = new Set(addedRuleIds);
  const next = validateDiary({
    ...diary,
    sessions: [...diary.sessions, ...added],
  });
  const all = expandDiary(next);
  const occurrences = all.filter((occurrence) =>
    addedSet.has(occurrence.sessionId),
  );
  checkTimes(occurrences);
  const conflicts = findConflicts(all).filter((conflict) =>
    conflict.sessionIds.some((sessionId) => addedSet.has(sessionId)),
  );
  const summary = `${added.length} new pattern${added.length === 1 ? "" : "s"} · ${occurrences.length} scheduled session${occurrences.length === 1 ? "" : "s"} · ${conflicts.length} clash pair${conflicts.length === 1 ? "" : "s"} to review${config.mode === "rotate" ? ". Rotation uses one pattern per group and open date; closed weeks still advance the order" : ""}.`;
  return { diary: next, addedRuleIds, occurrences, conflicts, summary };
}

/** Move one real occurrence, or split its rule while retaining all earlier identities. */
export function rescheduleDiary(input, change, options = {}) {
  const diary = validateDiary(input);
  record(change, "Reschedule");
  const makeId = newIds(diary, options);
  id(change.sessionId, "Session ID");
  day(change.date, "Original date");
  if (!["once", "future"].includes(change.scope))
    throw new TypeError("Choose this date only or this and future dates.");
  const index = diary.sessions.findIndex(
    (session) => session.id === change.sessionId,
  );
  if (index < 0) throw new RangeError("The session pattern no longer exists.");
  const original = diary.sessions[index];
  const occurrences = expandDiary(diary).filter(
    (occurrence) => occurrence.sessionId === original.id,
  );
  if (!occurrences.some((occurrence) => occurrence.date === change.date))
    throw new RangeError(
      "Choose an existing session occurrence; closed, cancelled and unscheduled dates cannot be moved.",
    );
  const targetDay = inTerm(diary, change.newDate, "New date");
  if (isClosed(diary, change.newDate))
    throw new RangeError(
      "The new date is a school closure. Choose an open date.",
    );
  const start = minute(change.startTime, "New start time");
  const end = minute(change.endTime, "New end time");
  if (end <= start)
    throw new RangeError(
      "The moved session must end after it starts on the same day.",
    );
  const roomId = change.roomId === undefined ? original.roomId : change.roomId;
  const personId =
    change.personId === undefined ? original.personId : change.personId;
  resources(diary, roomId, personId);
  wallTimeToUtc(change.newDate, change.startTime);
  wallTimeToUtc(change.newDate, change.endTime);
  const replacement = {
    ...original,
    startDate: change.newDate,
    startTime: change.startTime,
    endTime: change.endTime,
    roomId,
    personId,
  };
  const changedIds = new Set();
  if (change.scope === "once") {
    capacity(diary.sessions.length + 1);
    diary.sessions[index] = {
      ...original,
      excludedDates: [...new Set([...original.excludedDates, change.date])],
    };
    replacement.id = makeId();
    replacement.repeat = "once";
    replacement.endDate = change.newDate;
    replacement.excludedDates = [];
    diary.sessions.push(replacement);
    changedIds.add(replacement.id);
  } else if (original.repeat === "once") {
    diary.sessions[index] = {
      ...replacement,
      endDate: change.newDate,
      excludedDates: [],
    };
    changedIds.add(original.id);
  } else {
    const sourceDay = day(change.date, "Original date");
    const delta = targetDay - sourceDay;
    const shift = (value) => dateText(day(value, "Cancelled date") + delta);
    for (const occurrence of occurrences.filter(
      (occurrence) => occurrence.date >= change.date,
    )) {
      const shiftedDate = shift(occurrence.date);
      inTerm(diary, shiftedDate, "Moved session date");
      if (isClosed(diary, shiftedDate))
        throw new RangeError(
          "A moved future session would fall on a school closure. Choose another date or move individual sessions.",
        );
    }
    // Only dates belonging to the current term can be moved. A rule's raw end
    // may be a Friday or lie beyond the term; neither creates extra lessons.
    const termEnd = day(diary.settings.termEnd, "Term end");
    const sourceEnd = Math.min(
      day(original.endDate, "Original end date"),
      termEnd,
    );
    const step = original.repeat === "fortnightly" ? 14 : 7;
    const closedDates = [];
    let lastMovedDay = targetDay;
    for (let current = sourceDay; current <= sourceEnd; current += step) {
      const movedDay = current + delta;
      // Real dates outside the term were rejected above. A cancelled trailing
      // date needs no replacement rule or exclusion beyond the visible term.
      if (movedDay > termEnd) continue;
      lastMovedDay = movedDay;
      const date = dateText(current);
      if (isClosed(diary, date)) closedDates.push(dateText(movedDay));
    }
    const shiftedEnd = dateText(lastMovedDay);
    const excluded = original.excludedDates
      .filter(
        (date) =>
          date >= change.date && day(date, "Cancelled date") <= sourceEnd,
      )
      .map((date) => day(date, "Cancelled date") + delta)
      .filter((movedDay) => movedDay >= targetDay && movedDay <= lastMovedDay)
      .map(dateText);
    replacement.id = makeId();
    replacement.endDate = shiftedEnd;
    replacement.excludedDates = [
      ...new Set([...excluded, ...closedDates]),
    ].sort();
    if (change.date === original.startDate)
      diary.sessions.splice(index, 1, replacement);
    else {
      capacity(diary.sessions.length + 1);
      diary.sessions[index] = {
        ...original,
        endDate: dateText(sourceDay - 1),
        excludedDates: original.excludedDates.filter(
          (date) => date < change.date,
        ),
      };
      diary.sessions.push(replacement);
    }
    changedIds.add(replacement.id);
  }
  return validatedChange(diary, changedIds);
}

/** Copy one pattern exactly, with a fresh identity and a bounded title suffix. */
export function duplicateDiarySession(input, sessionId, options = {}) {
  const diary = validateDiary(input);
  id(sessionId, "Session ID");
  const original = diary.sessions.find((session) => session.id === sessionId);
  if (!original) throw new RangeError("The session pattern no longer exists.");
  capacity(diary.sessions.length + 1);
  const makeId = newIds(diary, options);
  const title = original.title
    .slice(0, 115)
    .replace(/[\uD800-\uDBFF]$/u, "")
    .trimEnd();
  const copy = {
    ...original,
    id: makeId(),
    title: `${title} copy`,
    excludedDates: [...original.excludedDates],
  };
  diary.sessions.push(copy);
  return validatedChange(diary, new Set([copy.id]));
}

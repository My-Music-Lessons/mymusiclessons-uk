const DAY = 86_400_000;
const FORMAT = "mml-school-music-diary";
const MAX_OCCURRENCES = 5000;

function record(value, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) throw new TypeError(`${path} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))
      throw new TypeError(`${path} must contain plain data fields.`);
  }
  return value;
}

function list(value, path, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new TypeError(`${path} must be an array.`);
  if (value.length > max)
    throw new RangeError(`${path} can contain at most ${max} items.`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new TypeError(`${path} must contain plain data items.`);
  }
  return value;
}

function text(value, path, max = 120, required = false) {
  if (typeof value !== "string") throw new TypeError(`${path} must be text.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(value))
    throw new TypeError(`${path} contains unsupported control characters.`);
  const clean = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if ((required && !clean) || clean.length > max)
    throw new RangeError(`${path} must contain ${required ? "1" : "0"}–${max} characters.`);
  return clean;
}

function identifier(value, path, optional = false) {
  if (optional && value === "") return "";
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(value))
    throw new TypeError(`${path} must use 1–80 letters, numbers, underscores or hyphens.`);
  return value;
}

function dateDay(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new TypeError(`${path} must use YYYY-MM-DD.`);
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    year < 2020 || year > 2100 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) throw new RangeError(`${path} must be a real date between 2020 and 2100.`);
  return timestamp / DAY;
}

function dateText(day) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

function time(value, path) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value))
    throw new TypeError(`${path} must use a 24-hour HH:mm time.`);
  return value;
}

function uniqueIds(items, path) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new TypeError(`${path} contains a duplicate ID.`);
    ids.add(item.id);
  }
  return ids;
}

function resources(input, path) {
  const output = list(input, path, 30).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    record(item, itemPath);
    return {
      id: identifier(item.id, `${itemPath}.id`),
      name: text(item.name, `${itemPath}.name`, 80, true),
    };
  });
  uniqueIds(output, path);
  const names = new Set();
  for (const item of output) {
    const name = item.name.toLowerCase();
    if (names.has(name)) throw new TypeError(`${path} contains a duplicate name or role label. Use one resource for the same room or person/role.`);
    names.add(name);
  }
  return output;
}

function visitOccurrences(diary, from, to, visit) {
  const closures = diary.closures.map((item) => ({
    start: dateDay(item.start, "Closure start"),
    end: dateDay(item.end, "Closure end"),
  }));
  for (const session of diary.sessions) {
    const anchor = dateDay(session.startDate, "Session start");
    const last = Math.min(to, dateDay(session.endDate, "Session end"));
    const first = Math.max(from, anchor);
    if (first > last) continue;
    const step = session.repeat === "fortnightly" ? 14 : session.repeat === "weekly" ? 7 : 0;
    const start = step ? anchor + Math.ceil((first - anchor) / step) * step : anchor;
    if (start < first) continue;
    const excluded = new Set(session.excludedDates);
    for (let day = start; day <= last; day += step || 1) {
      const date = dateText(day);
      if (!excluded.has(date) && !closures.some((closure) => day >= closure.start && day <= closure.end))
        visit(session, date);
      if (!step) break;
    }
  }
}

/** Validate v1 diary data and return a fresh, bounded clone of known fields only. */
export function validateDiary(input) {
  record(input, "Diary");
  if (input.format !== FORMAT || input.version !== 1)
    throw new TypeError("Use a My Music Lessons school music diary in version 1 format.");
  record(input.settings, "Settings");
  record(input.resources, "Resources");
  const termStart = dateDay(input.settings.termStart, "Term start");
  const termEnd = dateDay(input.settings.termEnd, "Term end");
  if (termEnd < termStart || termEnd - termStart + 1 > 370)
    throw new RangeError("The term must be an inclusive range of 1–370 days.");
  const rooms = resources(input.resources.rooms, "Rooms");
  const people = resources(input.resources.people, "People");
  const roomIds = new Set(rooms.map((item) => item.id));
  const personIds = new Set(people.map((item) => item.id));
  const closures = list(input.closures, "Closures", 40).map((item, index) => {
    const path = `Closure ${index + 1}`;
    record(item, path);
    const start = dateDay(item.start, `${path} start`);
    const end = dateDay(item.end, `${path} end`);
    if (end < start) throw new RangeError(`${path} must end on or after its start.`);
    return {
      id: identifier(item.id, `${path} ID`),
      start: item.start,
      end: item.end,
      label: text(item.label, `${path} label`),
    };
  });
  uniqueIds(closures, "Closures");
  const sessions = list(input.sessions, "Sessions", 100).map((item, index) => {
    const path = `Session ${index + 1}`;
    record(item, path);
    const start = dateDay(item.startDate, `${path} start date`);
    const end = dateDay(item.endDate, `${path} end date`);
    if (end < start) throw new RangeError(`${path} must end on or after its start date.`);
    if (!["once", "weekly", "fortnightly"].includes(item.repeat))
      throw new TypeError(`${path} repeat must be once, weekly or fortnightly.`);
    if (item.repeat === "once" && start !== end)
      throw new RangeError(`${path} occurs once, so its start and end dates must match.`);
    const startTime = time(item.startTime, `${path} start time`);
    const endTime = time(item.endTime, `${path} end time`);
    if (endTime <= startTime) throw new RangeError(`${path} must end after it starts on the same day.`);
    const roomId = identifier(item.roomId, `${path} room`, true);
    const personId = identifier(item.personId, `${path} person`, true);
    if (roomId && !roomIds.has(roomId)) throw new TypeError(`${path} refers to a room that no longer exists.`);
    if (personId && !personIds.has(personId)) throw new TypeError(`${path} refers to a person or role that no longer exists.`);
    const excludedDates = list(item.excludedDates, `${path} excluded dates`, 370).map((date) => {
      dateDay(date, `${path} excluded date`);
      return date;
    });
    return {
      id: identifier(item.id, `${path} ID`),
      title: text(item.title, `${path} title`, 120, true),
      group: text(item.group, `${path} group`, 80),
      instrument: text(item.instrument, `${path} instrument`, 80),
      roomId,
      personId,
      startDate: item.startDate,
      endDate: item.endDate,
      startTime,
      endTime,
      repeat: item.repeat,
      excludedDates: [...new Set(excludedDates)].sort(),
    };
  });
  uniqueIds(sessions, "Sessions");
  const diary = {
    format: FORMAT,
    version: 1,
    calendarId: identifier(input.calendarId, "Calendar ID"),
    settings: {
      school: text(input.settings.school, "School", 120),
      termStart: input.settings.termStart,
      termEnd: input.settings.termEnd,
    },
    resources: { rooms, people },
    closures,
    sessions,
  };
  let count = 0;
  visitOccurrences(diary, termStart, termEnd, () => {
    if (++count > MAX_OCCURRENCES)
      throw new RangeError("The diary can contain at most 5,000 occurrences in a term. Shorten the term or remove session rules.");
  });
  return diary;
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Expand real scheduled sessions; closure dates and per-rule exclusions are omitted. */
export function expandDiary(input, options = {}) {
  const diary = validateDiary(input);
  record(options, "Date range");
  let from = dateDay(diary.settings.termStart, "Term start");
  let to = dateDay(diary.settings.termEnd, "Term end");
  const requestedFrom = options.from === undefined ? from : dateDay(options.from, "Range start");
  const requestedTo = options.to === undefined ? to : dateDay(options.to, "Range end");
  if (options.from !== undefined && options.to !== undefined && requestedTo < requestedFrom)
    throw new RangeError("The requested date range must end on or after its start.");
  from = Math.max(from, requestedFrom);
  to = Math.min(to, requestedTo);
  const occurrences = [];
  if (from <= to) visitOccurrences(diary, from, to, (session, date) => {
    occurrences.push({
      id: `${session.id}@${date}`,
      sessionId: session.id,
      date,
      title: session.title,
      group: session.group,
      instrument: session.instrument,
      roomId: session.roomId,
      personId: session.personId,
      startTime: session.startTime,
      endTime: session.endTime,
    });
  });
  return occurrences.sort((a, b) => compare(a.date, b.date) || compare(a.startTime, b.startTime) || compare(a.endTime, b.endTime) || compare(a.id, b.id));
}

/** Find half-open same-day overlaps sharing an assigned room, person/role or group. */
export function findConflicts(input) {
  const occurrences = list(input, "Occurrences", MAX_OCCURRENCES);
  const dates = new Map();
  const ids = new Set();
  const sessionIds = new Set();
  for (let index = 0; index < occurrences.length; index++) {
    const item = record(occurrences[index], `Occurrence ${index + 1}`);
    dateDay(item.date, "Occurrence date");
    identifier(item.sessionId, "Occurrence session ID");
    sessionIds.add(item.sessionId);
    if (sessionIds.size > 100) throw new RangeError("Occurrences can refer to at most 100 session rules.");
    if (item.id !== `${item.sessionId}@${item.date}` || ids.has(item.id))
      throw new TypeError("Occurrence IDs must be unique and match their session and date.");
    ids.add(item.id);
    time(item.startTime, "Occurrence start time");
    time(item.endTime, "Occurrence end time");
    if (item.endTime <= item.startTime) throw new RangeError("Occurrences must end after they start on the same day.");
    const occurrence = {
      id: item.id,
      sessionId: item.sessionId,
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      roomId: identifier(item.roomId, "Occurrence room", true),
      personId: identifier(item.personId, "Occurrence person", true),
      group: text(item.group, "Occurrence group", 80).toLowerCase(),
    };
    if (!dates.has(item.date)) dates.set(item.date, []);
    dates.get(item.date).push(occurrence);
  }
  const conflicts = [];
  for (const [date, items] of dates) {
    items.sort((a, b) => compare(a.id, b.id));
    for (let index = 0; index < items.length; index++) {
      const a = items[index];
      for (let other = index + 1; other < items.length; other++) {
        const b = items[other];
        if (a.startTime >= b.endTime || b.startTime >= a.endTime) continue;
        const types = [];
        if (a.roomId && a.roomId === b.roomId) types.push("room");
        if (a.personId && a.personId === b.personId) types.push("person");
        if (a.group && a.group === b.group) types.push("group");
        if (types.length) conflicts.push({
          id: `${a.id}~${b.id}`,
          date,
          occurrenceIds: [a.id, b.id],
          sessionIds: [a.sessionId, b.sessionId],
          types,
        });
      }
    }
  }
  return conflicts.sort((a, b) => compare(a.date, b.date) || compare(a.id, b.id));
}

import { validateDiary, expandDiary, findConflicts } from "./diary-model.js";
import { wallTimeToUtc } from "./diary-export.js";

const DAY = 86_400_000;

function record(value, path) {
  if (!value || typeof value !== "object" ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    throw new TypeError(`${path} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))
      throw new TypeError(`${path} must contain plain data fields.`);
  }
  return value;
}

function identifier(value, path) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(value))
    throw new TypeError(`${path} must use 1–80 letters, numbers, underscores or hyphens.`);
  return value;
}

function day(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new TypeError(`${path} must use YYYY-MM-DD.`);
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value ||
      value < "2020-01-01" || value > "2100-12-31")
    throw new RangeError(`${path} must be a real date between 2020 and 2100.`);
  return timestamp / DAY;
}

function inTerm(diary, value, path) {
  const result = day(value, path);
  if (value < diary.settings.termStart || value > diary.settings.termEnd)
    throw new RangeError(`${path} must be inside the diary term.`);
  return result;
}

function dateRange(diary, options) {
  record(options, "Date range");
  const from = inTerm(diary, options.from, "Range start");
  const to = inTerm(diary, options.to, "Range end");
  if (to < from || to - from + 1 > 370)
    throw new RangeError("Choose an inclusive date range of 1–370 days, ending on or after its start.");
  return { from, to };
}

function isClosed(diary, date) {
  return diary.closures.some((closure) => date >= closure.start && date <= closure.end);
}

function followsCadence(session, date) {
  if (date < session.startDate || date > session.endDate) return false;
  if (session.repeat === "once") return date === session.startDate;
  return (day(date, "Cancelled date") - day(session.startDate, "Session start")) %
    (session.repeat === "fortnightly" ? 14 : 7) === 0;
}

function checkTimes(occurrence) {
  wallTimeToUtc(occurrence.date, occurrence.startTime);
  wallTimeToUtc(occurrence.date, occurrence.endTime);
}

function selectedIds(diary, value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !value.length || value.length > 100)
    throw new RangeError("Select 1–100 session patterns.");
  // Inspect every descriptor before reading array items, including extra fields.
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))
      throw new TypeError("Selected session IDs must contain plain data items.");
  }
  const known = new Set(diary.sessions.map((session) => session.id));
  const selected = new Set();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) throw new TypeError("Selected session IDs must contain plain data items.");
    const id = identifier(descriptor.value, "Selected session ID");
    if (!known.has(id)) throw new RangeError("A selected session pattern no longer exists.");
    if (selected.has(id)) throw new TypeError("Selected session IDs must not contain duplicate IDs.");
    selected.add(id);
  }
  return selected;
}

function newIds(diary, options) {
  record(options, "Batch options");
  const factory = options.idFactory === undefined ? () => globalThis.crypto.randomUUID() : options.idFactory;
  if (typeof factory !== "function") throw new TypeError("The ID factory must be a function.");
  const used = new Set(diary.sessions.map((session) => session.id));
  return () => {
    const value = identifier(factory(), "New session ID");
    if (used.has(value)) throw new TypeError("The ID factory returned a duplicate session ID. Try again.");
    used.add(value);
    return value;
  };
}

/**
 * Prepare an immutable batch draft for an inclusive range fully inside the term.
 * Duplicate selected IDs are rejected. affectedOccurrences always describes the
 * real source dates; addedRuleIds identifies copies at their destination dates.
 */
export function prepareDiaryBatch(input, config, options = {}) {
  const diary = validateDiary(input);
  record(config, "Batch change");
  const makeId = newIds(diary, options);
  if (!["cancel", "copy"].includes(config.action))
    throw new TypeError("Choose cancel or copy for the batch action.");
  const range = dateRange(diary, config);
  const selected = selectedIds(diary, config.sessionIds);
  const affectedOccurrences = expandDiary(diary, { from: config.from, to: config.to })
    .filter((occurrence) => selected.has(occurrence.sessionId));
  if (!affectedOccurrences.length)
    throw new RangeError("There are no scheduled sessions for these patterns and dates after cancellations and school closures.");

  if (config.action === "cancel") {
    const cancellations = new Map();
    for (const occurrence of affectedOccurrences) {
      if (!cancellations.has(occurrence.sessionId)) cancellations.set(occurrence.sessionId, []);
      cancellations.get(occurrence.sessionId).push(occurrence.date);
    }
    for (const session of diary.sessions) {
      if (cancellations.has(session.id))
        session.excludedDates = [...new Set([...session.excludedDates, ...cancellations.get(session.id)])].sort();
    }
    const next = validateDiary(diary);
    const count = affectedOccurrences.length;
    return {
      diary: next, affectedOccurrences, addedRuleIds: [], conflicts: [],
      summary: `${count} session${count === 1 ? "" : "s"} cancelled. Session patterns are retained for review and restoration.`,
    };
  }

  const destinationStart = inTerm(diary, config.destinationDate, "Destination start");
  const delta = destinationStart - range.from;
  if (diary.sessions.length + affectedOccurrences.length > 100)
    throw new RangeError("The diary can contain at most 100 session patterns. Copy fewer dates or patterns.");
  // Check the whole proposed copy before generating IDs or changing the clone.
  const copies = affectedOccurrences.map((occurrence) => {
    const date = new Date((day(occurrence.date, "Source date") + delta) * DAY).toISOString().slice(0, 10);
    inTerm(diary, date, "Copied session date");
    if (isClosed(diary, date))
      throw new RangeError("A copied session would fall on a school closure. Choose another destination or a smaller source range.");
    checkTimes({ ...occurrence, date });
    return {
      title: occurrence.title, group: occurrence.group, instrument: occurrence.instrument,
      roomId: occurrence.roomId, personId: occurrence.personId,
      startTime: occurrence.startTime, endTime: occurrence.endTime,
      startDate: date, endDate: date, repeat: "once", excludedDates: [],
    };
  });
  const added = copies.map((copy) => ({ ...copy, id: makeId() }));
  const addedRuleIds = added.map((session) => session.id);
  const addedSet = new Set(addedRuleIds);
  const next = validateDiary({ ...diary, sessions: [...diary.sessions, ...added] });
  const conflicts = findConflicts(expandDiary(next)).filter((conflict) =>
    conflict.sessionIds.some((sessionId) => addedSet.has(sessionId)));
  const count = added.length;
  return {
    diary: next, affectedOccurrences, addedRuleIds, conflicts,
    summary: `${count} session${count === 1 ? "" : "s"} copied to ${count} new one-off pattern${count === 1 ? "" : "s"} · ${conflicts.length} clash pair${conflicts.length === 1 ? "" : "s"} to review.`,
  };
}

/** List explicit exclusions belonging to the rule cadence and the diary term. */
export function listDiaryCancellations(input, options) {
  const diary = validateDiary(input);
  dateRange(diary, options);
  const entries = [];
  for (const session of diary.sessions) {
    for (const date of session.excludedDates) {
      if (date < options.from || date > options.to || !followsCadence(session, date)) continue;
      entries.push({
        sessionId: session.id, date, title: session.title, group: session.group,
        instrument: session.instrument, roomId: session.roomId, personId: session.personId,
        startTime: session.startTime, endTime: session.endTime, closed: isClosed(diary, date),
      });
    }
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return entries.sort((a, b) => compare(a.date, b.date) || compare(a.startTime, b.startTime) ||
    compare(a.endTime, b.endTime) || compare(a.sessionId, b.sessionId));
}

/** Remove one real manual cancellation; a school closure still suppresses it. */
export function restoreDiaryCancellation(input, change) {
  const diary = validateDiary(input);
  record(change, "Restore cancellation");
  const sessionId = identifier(change.sessionId, "Session ID");
  inTerm(diary, change.date, "Cancelled date");
  const session = diary.sessions.find((item) => item.id === sessionId);
  if (!session || !session.excludedDates.includes(change.date) || !followsCadence(session, change.date))
    throw new RangeError("Choose an explicit cancelled date that belongs to this session pattern.");
  const restored = !isClosed(diary, change.date);
  if (restored) checkTimes({ ...session, date: change.date });
  session.excludedDates = session.excludedDates.filter((date) => date !== change.date);
  const next = validateDiary(diary);
  const conflicts = restored
    ? findConflicts(expandDiary(next, { from: change.date, to: change.date }))
      .filter((conflict) => conflict.sessionIds.includes(sessionId))
    : [];
  return { diary: next, conflicts, restored };
}

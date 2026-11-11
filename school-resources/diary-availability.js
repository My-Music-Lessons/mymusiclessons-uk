import { validateDiary, expandDiary } from "./diary-model.js";
import { wallTimeToUtc } from "./diary-export.js";

const MAX_OCCURRENCES = 5000;
const OCCURRENCE_FIELDS = [
  "id", "sessionId", "date", "title", "group", "instrument",
  "roomId", "personId", "startTime", "endTime",
];

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

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new TypeError("Search date must use YYYY-MM-DD.");
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value ||
    value < "2020-01-01" || value > "2100-12-31")
    throw new RangeError("Search date must be a real date between 2020 and 2100.");
  return value;
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
    throw new RangeError(`${path} must be a whole number from ${min} to ${max}.`);
  return value;
}

function groupText(value) {
  if (typeof value !== "string") throw new TypeError("Group must be text.");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(value))
    throw new TypeError("Group contains unsupported control characters.");
  const clean = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (clean.length > 80) throw new RangeError("Group must contain 0–80 characters.");
  return clean;
}

function resourceId(value, collection, path) {
  if (value === "") return "";
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(value))
    throw new TypeError(`${path} must use 1–80 letters, numbers, underscores or hyphens.`);
  if (!collection.some((resource) => resource.id === value))
    throw new TypeError(`${path} refers to a resource that no longer exists.`);
  return value;
}

/**
 * Find diary-only clear slots against every actual occurrence on the selected date.
 * Closed dates return an empty result with a reason. Invalid input still throws.
 * Clock-change gaps, folds and intervals crossing a clock change are excluded.
 * This does not establish real-world availability, supervision or suitability.
 */
export function findDiarySlots(input, options) {
  const diary = validateDiary(input);
  record(options, "Slot search");
  const searchDate = date(options.date);
  if (searchDate < diary.settings.termStart || searchDate > diary.settings.termEnd)
    throw new RangeError("Search date must be inside the diary term.");
  const start = minute(options.startTime, "Window start");
  const end = minute(options.endTime, "Window end");
  if (end <= start) throw new RangeError("The search window must end after it starts on the same day.");
  const duration = whole(options.durationMinutes, "Duration", 1, 1439);
  const step = whole(options.stepMinutes === undefined ? 10 : options.stepMinutes, "Search step", 1, 120);
  const limit = whole(options.limit === undefined ? 12 : options.limit, "Result limit", 1, 50);
  const roomId = resourceId(options.roomId === undefined ? "" : options.roomId, diary.resources.rooms, "Room");
  const personId = resourceId(options.personId === undefined ? "" : options.personId, diary.resources.people, "Staff role");
  const group = groupText(options.group === undefined ? "" : options.group);
  if (!roomId && !personId && !group)
    throw new RangeError("Choose at least one room, staff role or group to check.");
  if (diary.closures.some((closure) => searchDate >= closure.start && searchDate <= closure.end))
    return { slots: [], totalMatches: 0, summary: "No clear slots: this date is closed in the diary." };

  const normalizedGroup = group.toLowerCase();
  // Expand the diary itself so board visibility and filters cannot hide allocations.
  const blockers = expandDiary(diary, { from: searchDate, to: searchDate }).filter((item) =>
    (roomId && item.roomId === roomId) ||
    (personId && item.personId === personId) ||
    (normalizedGroup && item.group.toLowerCase() === normalizedGroup));
  const slots = [];
  let totalMatches = 0;
  const utcTimes = new Map();
  const utc = (time) => {
    if (!utcTimes.has(time)) {
      let epoch = null;
      try { epoch = Date.parse(wallTimeToUtc(searchDate, time)); }
      catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
      utcTimes.set(time, epoch);
    }
    return utcTimes.get(time);
  };
  // A same-day window and a step of at least one minute bound this below 1,440.
  for (let candidate = start; candidate + duration <= end; candidate += step) {
    const startTime = timeText(candidate);
    const endTime = timeText(candidate + duration);
    const startUtc = utc(startTime);
    const endUtc = utc(endTime);
    if (startUtc === null || endUtc === null || endUtc - startUtc !== duration * 60_000) continue;
    if (blockers.some((item) => startTime < item.endTime && item.startTime < endTime)) continue;
    totalMatches++;
    if (slots.length < limit) slots.push({ date: searchDate, startTime, endTime, roomId, personId, group });
  }
  const summary = totalMatches
    ? `${totalMatches} clear ${totalMatches === 1 ? "slot" : "slots"} found for the entered allocations in this diary.${totalMatches > slots.length ? ` Showing the first ${slots.length}.` : ""}`
    : "No clear slots fit the entered date, window and allocations in this diary.";
  return { slots, totalMatches, summary };
}

/**
 * Summarize a selected subset of actual diary occurrences, rejecting stale or
 * invented rows. Minutes are summed session durations, including any overlaps;
 * they are not unique occupied minutes, available capacity or utilization.
 * Resource totals retain diary order, including unused resources with zero.
 */
export function diaryOverview(input, occurrences) {
  const diary = validateDiary(input);
  if (!Array.isArray(occurrences) || Object.getPrototypeOf(occurrences) !== Array.prototype)
    throw new TypeError("Overview occurrences must be an array.");
  if (occurrences.length > MAX_OCCURRENCES)
    throw new RangeError("Overview can contain at most 5,000 occurrences.");
  const actual = new Map(expandDiary(diary).map((item) => [item.id, item]));
  const seen = new Set();
  const selected = [];
  for (let index = 0; index < occurrences.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(occurrences, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new TypeError("Overview occurrences must contain plain data items.");
    const row = record(descriptor.value, `Overview occurrence ${index + 1}`);
    const match = actual.get(row.id);
    if (!match || OCCURRENCE_FIELDS.some((field) => row[field] !== match[field]))
      throw new TypeError("Overview occurrences must match actual sessions in the current diary.");
    if (seen.has(row.id)) throw new TypeError("Overview occurrences must have unique IDs; duplicate rows are not allowed.");
    seen.add(row.id);
    selected.push(match);
  }

  const roomMinutes = diary.resources.rooms.map(({ id, name }) => ({ id, name, minutes: 0 }));
  const staffMinutes = diary.resources.people.map(({ id, name }) => ({ id, name, minutes: 0 }));
  const rooms = new Map(roomMinutes.map((row) => [row.id, row]));
  const staff = new Map(staffMinutes.map((row) => [row.id, row]));
  const groups = new Set();
  let totalMinutes = 0;
  let unassignedRooms = 0;
  let unassignedStaffRoles = 0;
  for (const row of selected) {
    const minutes = minute(row.endTime, "Session end") - minute(row.startTime, "Session start");
    totalMinutes += minutes;
    if (row.group) groups.add(row.group.toLowerCase());
    if (row.roomId) rooms.get(row.roomId).minutes += minutes;
    else unassignedRooms++;
    if (row.personId) staff.get(row.personId).minutes += minutes;
    else unassignedStaffRoles++;
  }
  return {
    sessions: selected.length, totalMinutes, groups: groups.size,
    unassignedRooms, unassignedStaffRoles, roomMinutes, staffMinutes,
  };
}

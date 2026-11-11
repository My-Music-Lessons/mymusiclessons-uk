import { validateDiary, expandDiary, findConflicts } from "./diary-model.js";

const MAX_OCCURRENCES = 5000;
const OCCURRENCE_FIELDS = [
  "id",
  "sessionId",
  "date",
  "title",
  "group",
  "instrument",
  "roomId",
  "personId",
  "startTime",
  "endTime",
];

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

// Freezing a Map does not protect its entries. Keep the backing Map private and
// expose its reading API only; forEach also receives this protected view.
function readOnlyMap(map) {
  const view = {
    size: map.size,
    get: (key) => map.get(key),
    has: (key) => map.has(key),
    keys: () => map.keys(),
    values: () => map.values(),
    entries: () => map.entries(),
    [Symbol.iterator]: () => map[Symbol.iterator](),
    forEach(callback, thisArg) {
      map.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
  };
  return Object.freeze(view);
}

function indexByDate(rows) {
  const dates = new Map();
  for (const row of rows) {
    if (!dates.has(row.date)) dates.set(row.date, []);
    dates.get(row.date).push(row);
  }
  for (const rowsOnDate of dates.values()) Object.freeze(rowsOnDate);
  return readOnlyMap(dates);
}

function minute(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function project(input) {
  // Use the canonical validators, limits, expansion and clash semantics once
  // per source identity. The validated clone also owns normalized resource names.
  const diary = validateDiary(input);
  const occurrences = Object.freeze(
    expandDiary(diary).map((row) => Object.freeze(row)),
  );
  const conflicts = Object.freeze(
    findConflicts(occurrences).map((row) => {
      Object.freeze(row.occurrenceIds);
      Object.freeze(row.sessionIds);
      Object.freeze(row.types);
      return Object.freeze(row);
    }),
  );
  const actual = new Map(occurrences.map((row) => [row.id, row]));
  const roomIndexes = new Map(
    diary.resources.rooms.map((row, index) => [row.id, index]),
  );
  const staffIndexes = new Map(
    diary.resources.people.map((row, index) => [row.id, index]),
  );
  const durations = new Map(
    occurrences.map((row) => [
      row.id,
      minute(row.endTime) - minute(row.startTime),
    ]),
  );

  function overview(rows) {
    if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype)
      throw new TypeError("Overview occurrences must be an array.");
    if (rows.length > MAX_OCCURRENCES)
      throw new RangeError("Overview can contain at most 5,000 occurrences.");
    const seen = new Set();
    const groups = new Set();
    const roomMinutes = diary.resources.rooms.map(({ id, name }) => ({
      id,
      name,
      minutes: 0,
    }));
    const staffMinutes = diary.resources.people.map(({ id, name }) => ({
      id,
      name,
      minutes: 0,
    }));
    let totalMinutes = 0;
    let unassignedRooms = 0;
    let unassignedStaffRoles = 0;
    for (let index = 0; index < rows.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(rows, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value"))
        throw new TypeError(
          "Overview occurrences must contain plain data items.",
        );
      const row = record(descriptor.value, `Overview occurrence ${index + 1}`);
      const id = Object.getOwnPropertyDescriptor(row, "id")?.value;
      const match = actual.get(id);
      if (
        !match ||
        OCCURRENCE_FIELDS.some((field) => {
          const fieldDescriptor = Object.getOwnPropertyDescriptor(row, field);
          return !fieldDescriptor || fieldDescriptor.value !== match[field];
        })
      )
        throw new TypeError(
          "Overview occurrences must match actual sessions in the current diary.",
        );
      if (seen.has(id))
        throw new TypeError(
          "Overview occurrences must have unique IDs; duplicate rows are not allowed.",
        );
      seen.add(id);
      const minutes = durations.get(id);
      totalMinutes += minutes;
      if (match.group) groups.add(match.group.toLowerCase());
      if (match.roomId)
        roomMinutes[roomIndexes.get(match.roomId)].minutes += minutes;
      else unassignedRooms++;
      if (match.personId)
        staffMinutes[staffIndexes.get(match.personId)].minutes += minutes;
      else unassignedStaffRoles++;
    }
    return {
      sessions: rows.length,
      totalMinutes,
      groups: groups.size,
      unassignedRooms,
      unassignedStaffRoles,
      roomMinutes,
      staffMinutes,
    };
  }

  return Object.freeze({
    occurrences,
    conflicts,
    lookup: readOnlyMap(actual),
    byDate: indexByDate(occurrences),
    conflictsByDate: indexByDate(conflicts),
    overview,
  });
}

/**
 * Cache term-derived data by immutable diary identity. Callers must replace the
 * diary object for every committed edit/import/recovery; in-place source edits
 * are intentionally not detected. Weak keys let discarded history be collected.
 * Failed builds are never cached. clear() discards all remembered identities.
 */
export function createDiaryProjectionCache() {
  let cache = new WeakMap();
  return Object.freeze({
    get(diary) {
      if (cache.has(diary)) return cache.get(diary);
      const projection = project(diary);
      cache.set(diary, projection);
      return projection;
    },
    clear() {
      cache = new WeakMap();
    },
  });
}

import { expandDiary, findConflicts, validateDiary } from "./diary-model.js";
import { wallTimeToUtc } from "./diary-export.js";

const MAX_BYTES = 1_048_576;
const MAX_ROWS = 100;
const MAX_COLUMNS = 20;
const encoder = new TextEncoder();
const FIELDS = [
  "title",
  "group",
  "instrument",
  "date",
  "end_date",
  "start_time",
  "end_time",
  "repeat",
  "room",
  "staff_role",
];
const REQUIRED_FIELDS = ["title", "date", "start_time", "end_time"];
const CONTROLS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;
const ALIASES = {
  title: [
    "title",
    "session title",
    "lesson title",
    "activity",
    "session",
    "lesson",
  ],
  group: ["group", "group label", "class", "class group"],
  instrument: ["instrument"],
  date: ["date", "start date", "session date", "lesson date"],
  end_date: ["end date", "repeat until", "until date", "last date"],
  start_time: ["start time", "start", "time start", "from time"],
  end_time: ["end time", "end", "time end", "to time"],
  repeat: ["repeat", "recurrence", "frequency"],
  room: ["room", "room label", "location"],
  staff_role: [
    "staff role",
    "staffrole",
    "role",
    "staff role label",
    "teacher role",
  ],
};

/** Fictional example only: group and staff-role labels, without pupil records. */
export const DIARY_CSV_TEMPLATE = `${FIELDS.join(",")}\r\nFictional brass club,Example group A,Brass,2026-09-07,2026-12-14,15:00,15:30,weekly,Example music room,Example club lead\r\n`;

function plainRecord(value, name) {
  if (
    value === null ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(`${name} must be a plain data object.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")
    ) {
      throw new TypeError(`${name} must contain plain data fields.`);
    }
  }
  return value;
}

function plainArray(value, name, max) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new TypeError(`${name} must be an array.`);
  }
  if (value.length > max)
    throw new RangeError(`${name} can contain at most ${max} items.`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new TypeError(`${name} must contain plain data items.`);
  }
  return value;
}

function normalizedLabel(value) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function normalizedHeader(value) {
  return normalizedLabel(value)
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function validateHeaders(input) {
  const headers = plainArray(input, "CSV headers", MAX_COLUMNS);
  if (!headers.length) throw new TypeError("CSV must have a header row.");
  const seen = new Set();
  return headers.map((header) => {
    if (typeof header !== "string" || CONTROLS.test(header))
      throw new TypeError("CSV headers must be plain text.");
    const key = normalizedHeader(header);
    if (!key) throw new TypeError("CSV headers must not be blank.");
    if (seen.has(key))
      throw new TypeError(
        "CSV has duplicate headers. Give each column a different heading.",
      );
    seen.add(key);
    return header;
  });
}

function rowError(index, error) {
  const ErrorType = error instanceof RangeError ? RangeError : TypeError;
  return new ErrorType(`CSV row ${index + 2}: ${error.message}`);
}

/**
 * Parse RFC4180-style comma-separated text without interpreting cells.
 * Bound: 1 MiB UTF-8, 20 columns and 100 data records. A BOM, CRLF or LF,
 * escaped quotes, quoted newlines and completely empty trailing rows are accepted.
 * Bare CR, malformed quoting, duplicate headings and uneven records are rejected.
 */
export function parseDiaryCsv(text) {
  if (typeof text !== "string") throw new TypeError("CSV must be text.");
  if (text.length > MAX_BYTES || encoder.encode(text).length > MAX_BYTES) {
    throw new RangeError(
      "CSV size must be at most 1 MiB (1,048,576 UTF-8 bytes).",
    );
  }
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  let headers = null;
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let started = false;
  let recordNumber = 1;
  let emptyRow = 0;
  const fail = (message) => {
    throw new TypeError(`CSV row ${recordNumber}: ${message}`);
  };
  const finishField = () => {
    row.push(field);
    if (row.length > MAX_COLUMNS)
      throw new RangeError(`CSV row ${recordNumber}: use at most 20 columns.`);
    field = "";
    started = false;
    afterQuote = false;
  };
  const finishRecord = () => {
    finishField();
    if (headers === null) headers = validateHeaders(row);
    else if (row.every((cell) => cell === "")) emptyRow ||= recordNumber;
    else {
      if (emptyRow)
        throw new TypeError(
          `CSV row ${emptyRow}: remove empty rows from the middle of the timetable.`,
        );
      if (row.length !== headers.length)
        fail(`expected ${headers.length} columns, found ${row.length}.`);
      if (rows.length >= MAX_ROWS)
        throw new RangeError(
          `CSV row ${recordNumber}: use at most 100 data rows.`,
        );
      rows.push(row);
    }
    row = [];
    recordNumber++;
  };

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\r" && source[index + 1] !== "\n")
      fail("use CRLF or LF line endings, without a bare carriage return.");
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += char;
        if (char === "\r") {
          field += "\n";
          index++;
        }
      }
    } else if (char === ",") finishField();
    else if (char === "\n" || char === "\r") {
      finishRecord();
      if (char === "\r") index++;
    } else if (afterQuote)
      fail("only a comma or line ending may follow a closing quote.");
    else if (char === '"') {
      if (started)
        fail(
          "quotes must surround the whole field; escape a quote as two quotes.",
        );
      inQuotes = true;
      started = true;
    } else {
      field += char;
      started = true;
    }
  }
  if (inQuotes) fail("a quoted field was not closed.");
  if (started || afterQuote || row.length || headers === null) finishRecord();
  return { headers, rows };
}

function pupilNameHeader(value) {
  const header = normalizedHeader(value);
  return (
    /\b(?:pupil|student|child|children|learner)\b.*\b(?:names?|forenames?|surnames?)\b/u.test(
      header,
    ) ||
    /^(?:pupil|student|child|children|learner)(?:full|first|last|given|family|middle)?names?$/u.test(
      header.replace(/\s+/gu, ""),
    )
  );
}

/** Return column indices or ''; multiple aliases for one field require a manual choice. */
export function inferDiaryCsvMapping(input) {
  const headers = validateHeaders(input);
  const mapping = {};
  for (const field of FIELDS) {
    const matches = headers.flatMap((header, index) =>
      !pupilNameHeader(header) &&
      ALIASES[field].includes(normalizedHeader(header))
        ? [index]
        : [],
    );
    mapping[field] = matches.length === 1 ? matches[0] : "";
  }
  return mapping;
}

function validateParsed(input) {
  const parsed = plainRecord(input, "Parsed CSV");
  const headers = validateHeaders(parsed.headers);
  const rows = plainArray(parsed.rows, "CSV data rows", MAX_ROWS);
  // Minimum CSV representation: header commas, then one newline and row commas.
  let bytes =
    headers.length -
    1 +
    headers.reduce((sum, header) => sum + encoder.encode(header).length, 0);
  const cleanRows = rows.map((row, index) => {
    try {
      plainArray(row, "Columns", MAX_COLUMNS);
      if (row.length !== headers.length)
        throw new TypeError(
          `expected ${headers.length} columns, found ${row.length}.`,
        );
      return row.map((cell) => {
        if (typeof cell !== "string")
          throw new TypeError("Every CSV cell must be text.");
        if (cell.length > MAX_BYTES)
          throw new RangeError("CSV size must be at most 1 MiB.");
        bytes += encoder.encode(cell).length + 1;
        if (bytes > MAX_BYTES)
          throw new RangeError("CSV size must be at most 1 MiB.");
        return cell;
      });
    } catch (error) {
      throw rowError(index, error);
    }
  });
  if (!cleanRows.length)
    throw new TypeError("CSV has no timetable data rows to import.");
  return { headers, rows: cleanRows };
}

function resolveMapping(input, headers) {
  const mapping = plainRecord(input, "CSV mapping");
  const output = {};
  const used = new Set();
  for (const field of FIELDS) {
    const value = mapping[field];
    if (value === "" || value === undefined) {
      output[field] = "";
      continue;
    }
    const index =
      typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)
        ? Number(value)
        : value;
    if (!Number.isInteger(index) || index < 0 || index >= headers.length) {
      throw new TypeError(
        `CSV mapping for ${field} must select an existing column.`,
      );
    }
    if (used.has(index))
      throw new TypeError(
        "CSV mapping must use a different column for each field.",
      );
    if (pupilNameHeader(headers[index]))
      throw new TypeError(
        "Do not map pupil-name columns. Use group and staff-role labels only.",
      );
    used.add(index);
    output[field] = index;
  }
  for (const field of REQUIRED_FIELDS) {
    if (output[field] === "")
      throw new TypeError(`CSV mapping requires a ${field} column.`);
  }
  return output;
}

function resourceLabel(value) {
  if (CONTROLS.test(value))
    throw new TypeError(
      "Room and staff-role labels contain unsupported control characters.",
    );
  const label = normalizedLabel(value);
  if (label.length > 80)
    throw new RangeError(
      "Room and staff-role labels must contain at most 80 characters.",
    );
  return label;
}

let fallbackSerial = 0;
function defaultIdFactory(kind) {
  const random =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${(++fallbackSerial).toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${random}`;
}

/**
 * Build an append-only import preview; this function never changes its input or saves it.
 * Required mappings: title, date, start_time, end_time. Blank repeat means once.
 * Repeats support once/weekly/fortnightly only. A repeating row with no end_date
 * uses the diary's termEnd; summary.termEndFallbacks makes that choice reviewable.
 * Labels are literal text. Unmapped columns are discarded, and no data is sent.
 * Returns a validated diary, added IDs/occurrences, relevant clashes and counts.
 */
export function importDiaryCsv(
  input,
  parsedInput,
  mappingInput,
  { idFactory = defaultIdFactory } = {},
) {
  let diary = validateDiary(input);
  const parsed = validateParsed(parsedInput);
  const mapping = resolveMapping(mappingInput, parsed.headers);
  if (typeof idFactory !== "function")
    throw new TypeError("The import ID factory must be a function.");
  const originalRooms = diary.resources.rooms.length;
  const originalRoles = diary.resources.people.length;
  const ids = new Set([
    diary.calendarId,
    ...diary.closures.map((item) => item.id),
    ...diary.sessions.map((item) => item.id),
    ...diary.resources.rooms.map((item) => item.id),
    ...diary.resources.people.map((item) => item.id),
  ]);
  const addedRuleIds = [];
  const rowForId = new Map();
  let termEndFallbacks = 0;
  const nextId = (kind) => {
    const id = idFactory(kind);
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(id)) {
      throw new TypeError(
        "Generated IDs must use 1–80 letters, numbers, underscores or hyphens.",
      );
    }
    if (ids.has(id))
      throw new TypeError(
        "Generated ID duplicates an existing ID. Try the import again.",
      );
    ids.add(id);
    return id;
  };
  const getResource = (collection, value, kind) => {
    const name = resourceLabel(value);
    if (!name) return "";
    const existing = diary.resources[collection].find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return existing.id;
    if (diary.resources[collection].length >= 30)
      throw new RangeError(
        "The diary supports at most 30 rooms and 30 staff roles.",
      );
    const resource = { id: nextId(kind), name };
    diary.resources[collection].push(resource);
    return resource.id;
  };

  for (let index = 0; index < parsed.rows.length; index++) {
    try {
      if (diary.sessions.length >= 100)
        throw new RangeError(
          "The diary supports at most 100 session rules in total.",
        );
      const row = parsed.rows[index];
      const cell = (field) =>
        mapping[field] === "" ? "" : row[mapping[field]];
      const repeat = cell("repeat").trim().toLowerCase() || "once";
      if (!["once", "weekly", "fortnightly"].includes(repeat))
        throw new TypeError("Repeat must be once, weekly or fortnightly.");
      const endDate =
        cell("end_date") ||
        (repeat === "once" ? cell("date") : diary.settings.termEnd);
      if (repeat !== "once" && !cell("end_date")) termEndFallbacks++;
      const session = {
        id: nextId("session"),
        title: cell("title"),
        group: cell("group"),
        instrument: cell("instrument"),
        startDate: cell("date"),
        endDate,
        startTime: cell("start_time"),
        endTime: cell("end_time"),
        repeat,
        roomId: getResource("rooms", cell("room"), "room"),
        personId: getResource("people", cell("staff_role"), "role"),
        excludedDates: [],
      };
      diary = validateDiary({
        ...diary,
        sessions: [...diary.sessions, session],
      });
      addedRuleIds.push(session.id);
      rowForId.set(session.id, index);
    } catch (error) {
      throw rowError(index, error);
    }
  }

  const allOccurrences = expandDiary(diary);
  const occurrences = allOccurrences.filter((item) =>
    rowForId.has(item.sessionId),
  );
  for (const item of occurrences) {
    try {
      wallTimeToUtc(item.date, item.startTime);
      wallTimeToUtc(item.date, item.endTime);
    } catch (error) {
      throw rowError(rowForId.get(item.sessionId), error);
    }
  }
  const conflicts = findConflicts(allOccurrences).filter((item) =>
    item.sessionIds.some((id) => rowForId.has(id)),
  );
  return {
    diary,
    addedRuleIds,
    occurrences,
    conflicts,
    summary: {
      rows: parsed.rows.length,
      addedRules: addedRuleIds.length,
      addedOccurrences: occurrences.length,
      addedRooms: diary.resources.rooms.length - originalRooms,
      addedStaffRoles: diary.resources.people.length - originalRoles,
      termEndFallbacks,
      conflicts: conflicts.length,
    },
  };
}

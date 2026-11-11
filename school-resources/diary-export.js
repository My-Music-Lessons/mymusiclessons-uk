import { expandDiary, validateDiary } from './diary-model.js';

const london = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const encoder = new TextEncoder();
const CRLF = '\r\n';

function londonParts(epoch) {
  const parts = {};
  for (const part of london.formatToParts(epoch)) if (part.type !== 'literal') parts[part.type] = part.value;
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Convert a Europe/London wall time to ISO UTC; reject clock-change gaps and folds. */
export function wallTimeToUtc(date, time) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError('Enter a valid date in YYYY-MM-DD form.');
  }
  const day = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Invalid date: ${date}.`);
  }
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new RangeError('Enter a valid time in HH:mm form (00:00 to 23:59).');
  }
  const target = `${date}T${time}:00`;
  const wallEpoch = Date.parse(`${target}.000Z`);
  // Ask Intl for the offsets either side of the date; do not infer BST from a month.
  const offsets = new Set([-36, 0, 36].map((hours) => {
    const sample = wallEpoch + hours * 3600000;
    return Date.parse(`${londonParts(sample)}.000Z`) - sample;
  }));
  const candidates = [...offsets].map((offset) => wallEpoch - offset)
    .filter((epoch) => londonParts(epoch) === target);
  if (!candidates.length) {
    throw new RangeError(`${date} ${time} does not exist in Europe/London because the clocks move forward. Choose another time.`);
  }
  if (candidates.length > 1) {
    throw new RangeError(`${date} ${time} is ambiguous in Europe/London because the clocks move back. Choose a time outside the repeated hour.`);
  }
  return new Date(candidates[0]).toISOString();
}

function icsDate(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function stampToIcs(stamp = new Date()) {
  let date;
  if (stamp instanceof Date) {
    date = stamp;
  } else if (typeof stamp === 'string') {
    const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
    const iso = compact ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z` : stamp;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(iso)) {
      throw new RangeError('The export stamp must be a valid UTC timestamp ending in Z.');
    }
    date = new Date(iso);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== iso.slice(0, 19)) {
      throw new RangeError('The export stamp must be a valid UTC timestamp ending in Z.');
    }
  }
  if (!date || !Number.isFinite(date.getTime()) || date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) {
    throw new RangeError('The export stamp must be a valid UTC timestamp ending in Z.');
  }
  return icsDate(date.toISOString());
}

// RFC 5545 §§3.1 and 3.3.11: TEXT escaping precedes UTF-8-aware line folding.
function escapeText(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, '\\$&');
}

function foldLine(line) {
  const lines = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines.join(CRLF);
}

function eventUid(calendarId, occurrenceId) {
  // Lossless encoding avoids hash collisions and keeps identity independent of editable content.
  const identity = encoder.encode(JSON.stringify([calendarId, occurrenceId]));
  return `diary-${Array.from(identity, (byte) => byte.toString(16).padStart(2, '0')).join('')}@mymusiclessons.uk`;
}

function exportData(diary, { from, to }) {
  const validated = validateDiary(diary);
  return {
    diary: validated,
    occurrences: expandDiary(validated, { from, to }),
    rooms: new Map(validated.resources.rooms.map((room) => [room.id, room.name])),
    people: new Map(validated.resources.people.map((person) => [person.id, person.name])),
  };
}

/** Download snapshot only: stable UIDs do not promise any calendar client's import behaviour. */
export function diaryToIcs(diary, options = {}) {
  const data = exportData(diary, options);
  const stamp = stampToIcs(options.stamp);
  const school = Array.from(data.diary.settings.school.trim()).slice(0, 120).join('');
  const name = school ? `${school} — School music diary` : 'School music diary';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//My Music Lessons//School Music Diary//EN',
    'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const occurrence of data.occurrences) {
    const description = [
      occurrence.group ? `Group: ${occurrence.group}` : '',
      occurrence.instrument ? `Instrument: ${occurrence.instrument}` : '',
      data.people.get(occurrence.personId) ? `Staff role: ${data.people.get(occurrence.personId)}` : '',
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT', `UID:${eventUid(data.diary.calendarId, occurrence.id)}`, `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(wallTimeToUtc(occurrence.date, occurrence.startTime))}`,
      `DTEND:${icsDate(wallTimeToUtc(occurrence.date, occurrence.endTime))}`,
      `SUMMARY:${escapeText(occurrence.title)}`,
    );
    if (data.rooms.get(occurrence.roomId)) lines.push(`LOCATION:${escapeText(data.rooms.get(occurrence.roomId))}`);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

function csvCell(value) {
  let text = String(value ?? '');
  // Quoting alone does not stop spreadsheet applications evaluating formula cells.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Expanded dates and HH:mm values are Europe/London local school times. */
export function diaryToCsv(diary, options = {}) {
  const data = exportData(diary, options);
  const rows = [['date', 'start', 'end', 'title', 'group', 'instrument', 'room', 'staffrole']];
  for (const occurrence of data.occurrences) rows.push([
    occurrence.date, occurrence.startTime, occurrence.endTime, occurrence.title,
    occurrence.group, occurrence.instrument,
    data.rooms.get(occurrence.roomId) || '', data.people.get(occurrence.personId) || '',
  ]);
  return `${rows.map((row) => row.map(csvCell).join(',')).join(CRLF)}${CRLF}`;
}

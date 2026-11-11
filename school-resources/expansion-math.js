export const INSTRUMENTS = Object.freeze([
  { id: 'guitar', label: 'Guitar' },
  { id: 'piano', label: 'Piano' },
  { id: 'vocals', label: 'Vocals' },
  { id: 'drums', label: 'Drums' },
  { id: 'ukulele', label: 'Ukulele' },
].map(Object.freeze));

export function parseWhole(value, label, min = 0, max = 10000) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label}: enter a whole number from ${min.toLocaleString('en-GB')} to ${max.toLocaleString('en-GB')}.`);
  }
  return number;
}

export function parseMoney(value, label) {
  if (value === '' || (typeof value === 'string' && !value.trim())) return null;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || Number(text) > 1000000) {
    throw new Error(`${label}: enter £0 to £1,000,000 with at most two decimal places, or leave it blank for unknown.`);
  }
  const [pounds, fraction = ''] = text.split('.');
  return Number(pounds) * 100 + Number(fraction.padEnd(2, '0'));
}

export function calculateDemand({ rotations, rows }) {
  const rotationCount = parseWhole(rotations, 'Rotations', 1, 100);
  if (!Array.isArray(rows) || rows.length !== INSTRUMENTS.length || rows.some((row, index) => row?.instrument !== INSTRUMENTS[index].id)) {
    throw new Error('Use one row for each of the nine listed instruments.');
  }
  const calculated = rows.map((row, index) => {
    const { id, label } = INSTRUMENTS[index];
    const demand = parseWhole(row.demand, `${label} interest`);
    const available = parseWhole(row.available, `${label} equipment available`);
    const quotePennies = parseMoney(row.unitQuote, `${label} unit quote`);
    const capacity = available * rotationCount;
    const feasible = Math.min(demand, capacity);
    const extraEquipment = Math.max(0, Math.ceil(demand / rotationCount) - available);
    return {
      instrument: id, label, demand, available, rotations: rotationCount, capacity, feasible,
      gap: demand - feasible, extraEquipment,
      windows: demand === 0 ? 0 : capacity === 0 ? null : Math.ceil(demand / capacity),
      quotePennies,
      estimatePennies: quotePennies === null ? null : quotePennies * extraEquipment,
    };
  });
  return {
    rotations: rotationCount, rows: calculated,
    totalDemand: calculated.reduce((sum, row) => sum + row.demand, 0),
    totalFeasible: calculated.reduce((sum, row) => sum + row.feasible, 0),
    totalGap: calculated.reduce((sum, row) => sum + row.gap, 0),
    extraEquipment: calculated.reduce((sum, row) => sum + row.extraEquipment, 0),
    knownEstimatePennies: calculated.reduce((sum, row) => sum + (row.estimatePennies ?? 0), 0),
    missingQuotes: calculated.filter(row => row.extraEquipment > 0 && row.quotePennies === null).length,
    knownQuotes: calculated.filter(row => row.extraEquipment > 0 && row.quotePennies !== null).length,
  };
}

function shortText(value, label, fallback) {
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error(`${label}: use up to 80 characters of ordinary text.`);
  }
  return value.trim() || fallback;
}

export function calculateTrust(rows) {
  if (!Array.isArray(rows) || rows.length > 8) throw new Error('Plan for up to eight schools at a time.');
  const calculated = rows.map((row, index) => {
    const school = shortText(row.school, `School ${index + 1} label`, `School ${index + 1}`);
    const role = shortText(row.role, `${school} responsible role`, 'To agree');
    const participants = parseWhole(row.participants, `${school} planned participants`);
    const weeklyPlaces = parseWhole(row.weeklyPlaces, `${school} weekly places`);
    const setupPennies = parseMoney(row.setup, `${school} setup estimate`);
    const weeklyPennies = parseMoney(row.weekly, `${school} weekly estimate`);
    if (!['Explore', 'Prepare', 'Review'].includes(row.phase)) throw new Error(`${school}: choose Explore, Prepare or Review.`);
    return {
      school, role, participants, weeklyPlaces, setupPennies, weeklyPennies, phase: row.phase,
      gap: Math.max(0, participants - weeklyPlaces),
      windows: participants === 0 ? 0 : weeklyPlaces === 0 ? null : Math.ceil(participants / weeklyPlaces),
    };
  });
  const setupMissing = calculated.filter(row => row.setupPennies === null).length;
  const weeklyMissing = calculated.filter(row => row.weeklyPennies === null).length;
  return {
    rows: calculated,
    totalParticipants: calculated.reduce((sum, row) => sum + row.participants, 0),
    totalWeeklyPlaces: calculated.reduce((sum, row) => sum + row.weeklyPlaces, 0),
    totalGap: calculated.reduce((sum, row) => sum + row.gap, 0),
    setupKnownPennies: calculated.reduce((sum, row) => sum + (row.setupPennies ?? 0), 0),
    weeklyKnownPennies: calculated.reduce((sum, row) => sum + (row.weeklyPennies ?? 0), 0),
    setupMissing, weeklyMissing, missingEstimates: setupMissing + weeklyMissing,
  };
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function csvCell(value) {
  let text = String(value ?? '');
  // A leading apostrophe prevents spreadsheet formulas, including after hidden whitespace.
  if (/^[\s\u0000-\u001f\u007f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const csvRows = rows => rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
const csvMoney = pennies => pennies === null ? 'Unknown' : (pennies / 100).toFixed(2);
const csvWindows = row => row.windows === null ? 'No equipment' : row.windows;

export function demandCsv(result) {
  return csvRows([
    ['Instrument', 'Interested pupils (interest selections)', 'Available at once', 'Rotations per window', 'Feasible places', 'Unmet interest', 'Extra equipment to cover one window', 'Repeated windows needed', 'Unit quote GBP', 'Extra equipment estimate GBP'],
    ...result.rows.map(row => [row.label, row.demand, row.available, row.rotations, row.feasible, row.gap, row.extraEquipment, csvWindows(row), csvMoney(row.quotePennies), csvMoney(row.estimatePennies)]),
    ['Known extra-equipment subtotal GBP', (result.knownEstimatePennies / 100).toFixed(2)],
    ['Instrument gaps missing unit quotes', result.missingQuotes],
    ['Planning note', 'Counts are interest selections, not necessarily unique pupils. Equipment-only model; no allocation, staffing ratio or platform concurrency is assumed. Quotes are user estimates for the chosen sourcing option.'],
  ]);
}

export function trustCsv(result) {
  return csvRows([
    ['School label', 'Responsible role', 'Phase', 'Planned participants', 'Assumed places per weekly window', 'First-window gap', 'Repeated weekly windows needed', 'Setup estimate GBP', 'Weekly estimate GBP'],
    ...result.rows.map(row => [row.school, row.role, row.phase, row.participants, row.weeklyPlaces, row.gap, row.windows === null ? 'No weekly places' : row.windows, csvMoney(row.setupPennies), csvMoney(row.weeklyPennies)]),
    ['Known setup subtotal GBP', (result.setupKnownPennies / 100).toFixed(2)],
    ['Setup estimates missing', result.setupMissing],
    ['Known weekly subtotal GBP', (result.weeklyKnownPennies / 100).toFixed(2)],
    ['Weekly estimates missing', result.weeklyMissing],
    ['Planning note', 'School-entered assumptions only. Phase is a chosen discussion label, not an assessed readiness score. Unknown costs are excluded from known subtotals. Repeated windows assume different participants each time.'],
  ]);
}

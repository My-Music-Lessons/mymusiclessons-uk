function number(value, min, max, whole = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (whole && !Number.isInteger(value))
  )
    throw new RangeError("Use a number within the stated range.");
  return value;
}
export function capacityPlan(input) {
  const window = number(input.window, 1, 480, true),
    lesson = number(input.lesson, 1, 240, true),
    turnaround = number(input.turnaround, 0, 120, true);
  const stations = number(input.stations, 1, 30, true),
    pupils = number(input.pupils, 1, 10000, true);
  const slots = Math.floor((window + turnaround) / (lesson + turnaround));
  const places = slots * stations;
  const slotsAt = Array.from({ length: slots }, (_, i) => ({
    start: i * (lesson + turnaround),
    end: i * (lesson + turnaround) + lesson,
  }));
  return {
    slots,
    places,
    windows: places ? Math.ceil(pupils / places) : null,
    usedMinutes: slots ? slotsAt.at(-1).end : 0,
    slotsAt,
  };
}
export function budgetPlan(input) {
  const setup = Math.round(number(input.setup, 0, 1000000) * 100);
  const staffHours = number(input.staffHours, 0, 168),
    hourlyRate = Math.round(number(input.hourlyRate, 0, 10000) * 100);
  const software = Math.round(number(input.softwareWeekly, 0, 1000000) * 100),
    other = Math.round(number(input.otherWeekly, 0, 1000000) * 100);
  const weeks = number(input.weeks, 1, 104, true),
    pupils = number(input.pupils, 1, 10000, true);
  const weekly = Math.round(staffHours * hourlyRate) + software + other,
    recurring = weekly * weeks,
    total = setup + recurring;
  return {
    weekly,
    recurring,
    setup,
    total,
    perPupil: Math.round(total / pupils),
  };
}

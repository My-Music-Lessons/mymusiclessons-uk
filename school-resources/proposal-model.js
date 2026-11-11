import { capacityPlan, budgetPlan } from "./resource-math.js";
export const costKeys = [
  "setup",
  "staffHours",
  "hourlyRate",
  "softwareWeekly",
  "otherWeekly",
];
export function planningFile(kind, values) {
  if (!["capacity", "budget"].includes(kind))
    throw Error("Unknown planning file type.");
  if (kind === "capacity") capacityPlan(values);
  else budgetPlan(values);
  return { format: "mml-planning-input", version: 1, kind, values };
}
export function parsePlanningFile(text) {
  if (typeof text !== "string" || text.length > 32768)
    throw Error("Use a planning input file smaller than 32 KB.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("This is not a valid planning input file.");
  }
  if (
    data?.format !== "mml-planning-input" ||
    data.version !== 1 ||
    !data.values ||
    typeof data.values !== "object"
  )
    throw Error(
      "Choose a figures file exported by the My Music Lessons session or budget planner.",
    );
  const keys =
    data.kind === "capacity"
      ? ["window", "lesson", "turnaround", "stations", "pupils"]
      : data.kind === "budget"
        ? [...costKeys, "weeks", "pupils"]
        : null;
  if (!keys) throw Error("Unknown planning file type.");
  return planningFile(
    data.kind,
    Object.fromEntries(keys.map((key) => [key, data.values[key]])),
  );
}
export function makeProposal(values) {
  const capacity = capacityPlan(values);
  if (!Number.isInteger(values.weeks) || values.weeks < 1 || values.weeks > 104)
    throw RangeError("Use between 1 and 104 whole weeks.");
  const missing = costKeys.filter(
    (key) =>
      values[key] === "" || values[key] === null || values[key] === undefined,
  );
  // Even partial cost estimates must pass the same numeric validation as a full budget.
  const completed = { ...values };
  for (const key of missing) completed[key] = 0;
  const checked = budgetPlan(completed),
    budget = missing.length ? null : checked;
  const notes = [];
  if (!capacity.places)
    notes.push(
      "No individual session fits this window. Revise the timing before approving the plan.",
    );
  if (
    budget &&
    capacity.windows &&
    values.staffHours < (capacity.windows * values.window) / 60
  )
    notes.push(
      "The staff-hours estimate is lower than the total weekly session windows in this scenario. Review supervision, setup and administrative time with the school.",
    );
  if (missing.length)
    notes.push(
      "The budget is incomplete. Missing estimates remain unknown; they have not been treated as a zero-cost programme.",
    );
  return { capacity, budget, missing, notes };
}

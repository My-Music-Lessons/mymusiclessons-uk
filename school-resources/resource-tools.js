import { capacityPlan, budgetPlan } from "./resource-math.js";
import { planningFile } from "./proposal-model.js";
import { downloadText } from "./planning-download.js";
const money = (cents) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    cents / 100,
  );
const item = (parent, tag, text, className = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  parent.append(e);
  return e;
};
for (const root of document.querySelectorAll(
  "[data-capacity-tool],[data-budget-tool]",
)) {
  const inputs = [...root.querySelectorAll("input")],
    result = root.querySelector("[data-tool-result]"),
    message = root.querySelector("[data-tool-message]"),
    print = root.querySelector("[data-print-plan]"),
    download = root.querySelector("[data-download-figures]");
  let lastValues;
  const hide = () => {
    result.hidden = true;
    print.disabled = true;
    download.disabled = true;
    lastValues = null;
    message.textContent =
      "Your assumptions changed. Calculate again to update the plan.";
  };
  inputs.forEach((input) => input.addEventListener("input", hide));
  root.querySelector("[data-calculate]").addEventListener("click", () => {
    const invalid = inputs.find((input) => !input.checkValidity());
    if (invalid) {
      hide();
      message.textContent =
        "Complete each field using the stated range. Enter zero explicitly where that is your cost assumption.";
      invalid.reportValidity();
      return;
    }
    try {
      const values = Object.fromEntries(
        inputs.map((input) => [input.name, input.valueAsNumber]),
      );
      const summary = root.querySelector("[data-result-summary]");
      summary.replaceChildren();
      if (root.hasAttribute("data-capacity-tool")) {
        const plan = capacityPlan(values),
          rows = root.querySelector("[data-slot-rows]");
        rows.replaceChildren();
        item(
          summary,
          "strong",
          `${plan.places} individual places per window`,
          "resource-result-number",
        );
        item(
          summary,
          "p",
          plan.places
            ? `${plan.slots} rotation${plan.slots === 1 ? "" : "s"} at each of ${values.stations} station${values.stations === 1 ? "" : "s"}. ${plan.windows} identical window${plan.windows === 1 ? "" : "s"} to give ${values.pupils} pupils one session each.`
            : "The playing time is longer than the available window. Increase the window or change your timing assumption.",
        );
        for (const [index, slot] of plan.slotsAt.entries()) {
          const row = document.createElement("tr");
          item(row, "th", String(index + 1)).scope = "row";
          item(row, "td", `${slot.start}–${slot.end} minutes`);
          item(row, "td", String(values.stations));
          rows.append(row);
        }
        root.querySelector("[data-result-assumptions]").textContent =
          `Assumptions: ${values.window}-minute window; ${values.lesson} minutes per learner; ${values.turnaround}-minute changeover between rotations; ${values.stations} stations; ${values.pupils} planned pupils. ${plan.usedMinutes} minutes used; ${values.window - plan.usedMinutes} minutes left as buffer. Each pupil receives one individual slot in this model. This does not establish a safe staffing ratio or available teaching capacity.`;
      } else {
        const plan = budgetPlan(values);
        item(summary, "strong", money(plan.total), "resource-result-number");
        item(
          summary,
          "p",
          `Total working estimate for ${values.weeks} weeks and ${values.pupils} planned participants. ${money(plan.perPupil)} per planned pupil for this period.`,
        );
        const breakdown = root.querySelector("[data-budget-breakdown]");
        breakdown.replaceChildren();
        for (const [label, value] of [
          ["One-off setup", plan.setup],
          ["Weekly running costs", plan.weekly],
          ["Running costs for the planned period", plan.recurring],
          ["Total including setup", plan.total],
        ]) {
          const row = item(breakdown, "div", "");
          item(row, "dt", label);
          item(row, "dd", money(value));
        }
        root.querySelector("[data-result-assumptions]").textContent =
          `Your inputs: setup ${money(plan.setup)}; staff ${values.staffHours} hours/week at ${money(Math.round(values.hourlyRate * 100))}/hour; software ${money(Math.round(values.softwareWeekly * 100))}/week; other ${money(Math.round(values.otherWeekly * 100))}/week. ${values.weeks} weeks; ${values.pupils} participants. No VAT has been added. These are your estimates, not My Music Lessons prices or a recommended family charge.`;
      }
      result.hidden = false;
      print.disabled = false;
      download.disabled = false;
      lastValues = values;
      message.textContent =
        "Your plan is ready below. You can print it or save it as a PDF using your browser.";
    } catch {
      hide();
      message.textContent =
        "Check the figures and use numbers within the stated ranges.";
    }
  });
  download.addEventListener("click", () => {
    if (!lastValues) return;
    const kind = root.hasAttribute("data-capacity-tool")
      ? "capacity"
      : "budget";
    downloadText(
      `mml-${kind}-figures.json`,
      JSON.stringify(planningFile(kind, lastValues), null, 2),
      "application/json",
    );
  });
}
const action = document.querySelector("[data-action-tool]");
if (action) {
  action.classList.add("resource-enhanced");
  function update() {
    action.querySelector("[data-action-school-output]").textContent =
      action.querySelector("[data-action-school]").value.trim() ||
      "Your school";
    const period = action.querySelector("[data-action-period]").value.trim();
    action.querySelector("[data-action-period-output]").textContent = period
      ? " · " + period
      : "";
    for (const key of ["current", "next", "role", "review"])
      for (const field of action.querySelectorAll(`[data-action-${key}]`))
        action.querySelector(
          `[data-action-${key}-output="${field.dataset["action" + key[0].toUpperCase() + key.slice(1)]}"]`,
        ).textContent = field.value.trim() || "To discuss";
  }
  action.addEventListener("input", update);
  update();
}

import { makeProposal, parsePlanningFile, costKeys } from "./proposal-model.js";
import { downloadText } from "./planning-download.js";
const root = document.querySelector("[data-proposal-tool]");
if (root) {
  let current = 0,
    lastText = "";
  const steps = [...root.querySelectorAll("[data-proposal-step]")],
    buttons = [...root.querySelectorAll("[data-proposal-goto]")],
    result = root.querySelector("[data-proposal-result]"),
    status = root.querySelector("[data-proposal-status]");
  const field = (name) => root.querySelector(`[name="${name}"]`);
  const money = (cents) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(cents / 100);
  function showStep(index, focus = false) {
    current = index;
    steps.forEach((step, i) => {
      step.hidden = i !== index;
    });
    buttons.forEach((button, i) => {
      if (i === index) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    root.querySelector("[data-proposal-back]").disabled = index === 0;
    root.querySelector("[data-proposal-next]").hidden = index === 3;
    root.querySelector("[data-proposal-generate]").hidden = index !== 3;
    if (focus) steps[index].querySelector("input,textarea,select")?.focus();
  }
  function invalidate() {
    result.hidden = true;
    lastText = "";
    status.textContent =
      "Your plan changed. Build the proposal again when the sections are ready.";
  }
  function valid(step) {
    const bad = [...step.querySelectorAll("input,textarea,select")].find(
      (e) => !e.checkValidity(),
    );
    if (bad) {
      showStep(steps.indexOf(step));
      bad.reportValidity();
      return false;
    }
    return true;
  }
  for (const button of buttons)
    button.addEventListener("click", () =>
      showStep(Number(button.dataset.proposalGoto), true),
    );
  root.querySelector("[data-proposal-next]").addEventListener("click", () => {
    if (valid(steps[current])) showStep(current + 1, true);
  });
  root
    .querySelector("[data-proposal-back]")
    .addEventListener("click", () => showStep(Math.max(0, current - 1), true));
  root.querySelector(".proposal-editor").addEventListener("input", invalidate);
  function values() {
    return Object.fromEntries(
      [...root.querySelectorAll('.proposal-editor input[type="number"]')].map(
        (e) => [e.name, e.value === "" ? "" : e.valueAsNumber],
      ),
    );
  }
  const text = (name) => field(name).value.trim();
  root
    .querySelector("[data-proposal-generate]")
    .addEventListener("click", () => {
      if (!steps.every(valid)) return;
      try {
        const input = values(),
          plan = makeProposal(input),
          instruments = [
            ...root.querySelectorAll('[name="instrument"]:checked'),
          ].map((e) => e.value);
        const model = {
          undecided: "Instruction provider or system to be confirmed.",
          school:
            "Explore school-arranged tuition with a teacher or external provider. Confirm the provider, staffing and commercial arrangements.",
          mml:
            "Explore My Music Lessons in-school teaching. Agree instruments, teacher availability, lesson format, practical arrangements and costs with MML before starting.",
        }[field("model").value];
        const title = `School music proposal: ${text("school") || "school discussion"}`;
        const blocks = [
          [
            "Purpose and scope",
            `${text("goal")}\nPlanning period: ${text("period") || "To agree"}.\nInstruments to discuss: ${instruments.join(", ") || "To choose"}.\n${model}`,
          ],
          [
            "People and responsibilities",
            `Programme lead role: ${text("lead") || "To agree"}.\nApproval role: ${text("approver") || "To agree"}.\nThe school arranges supervision, practical instrument support, room access, communication and its approval process. A teaching arrangement and an adult supervising the room are separate decisions.`,
          ],
          [
            "Weekly capacity scenario",
            `${input.pupils} planned pupils; one individual slot per pupil each week.\n${input.stations} complete practice stations, ${input.window}-minute window, ${input.lesson} minutes per learner and ${input.turnaround} minutes between learners.\n${plan.capacity.slots} rotations per station; ${plan.capacity.places} places per window.\n${plan.capacity.windows === null ? "No slot fits. Revise the timings." : `${plan.capacity.windows} identical windows needed each week for this group.`}\nThis is a planning model, not a staffing ratio or confirmed teaching capacity.`,
          ],
          [
            "Budget and assumptions",
            plan.budget
              ? `One-off setup: ${money(plan.budget.setup)}.\nWeekly running estimate: ${money(plan.budget.weekly)} (${input.staffHours} staff hours at ${money(Math.round(input.hourlyRate * 100))}/hour; software ${money(Math.round(input.softwareWeekly * 100))}; other ${money(Math.round(input.otherWeekly * 100))}).\n${input.weeks} weeks: ${money(plan.budget.total)} including setup. Planned cost per participant for this period: ${money(plan.budget.perPupil)}.\nSchool-entered estimates, not My Music Lessons rates or a recommended family charge. No VAT added.`
              : `Budget not complete. Estimates still needed: ${plan.missing.map((key) => ({ setup: "setup", staffHours: "weekly staff hours", hourlyRate: "hourly staff cost", softwareWeekly: "software allowance", otherWeekly: "other weekly costs" })[key]).join(", ")}.\nKnown entries: ${
                  costKeys
                    .filter((key) => !plan.missing.includes(key))
                    .map(
                      (key) =>
                        ({
                          setup: "setup",
                          staffHours: "staff hours/week",
                          hourlyRate: "hourly cost",
                          softwareWeekly: "software/week",
                          otherWeekly: "other costs/week",
                        })[key] +
                        " = " +
                        (key === "staffHours"
                          ? input[key]
                          : money(Math.round(input[key] * 100))),
                    )
                    .join("; ") || "none supplied"
                }.
No overall total or cost per pupil is asserted.`,
          ],
          [
            "Decisions before a launch",
            `1. Agree musical purpose and suitable learners with the music lead.\n2. Confirm tuition, staff supervision, room, instruments, device/audio setup and the school approval process.\n3. Check availability, repair, loan or hire options and any quotes before purchasing.\n4. Confirm the timetable, budget basis and family communication before offering places.\n5. Review at: ${text("review") || "A point the school agrees"}.\nOpen questions: ${text("open") || "Record the remaining decisions with the school team."}`,
          ],
          [
            "Points to resolve",
            plan.notes.join("\n") ||
              "No arithmetic conflicts detected. This is not confirmation of educational, safety, accessibility or procurement suitability.",
          ],
        ];
        if (field("model").value === "mml")
          blocks.push([
            "My Music Lessons option to explore",
            "Request a school-specific discussion and quotation. Using this proposal does not book teaching or commit the school to payment.",
          ]);
        const paper = root.querySelector("[data-proposal-paper]");
        paper.replaceChildren();
        const heading = document.createElement("h3");
        heading.textContent = text("school") || "School planning discussion";
        paper.append(heading);
        for (const [label, body] of blocks) {
          const section = document.createElement("section"),
            h = document.createElement("h4"),
            p = document.createElement("p");
          h.textContent = label;
          p.textContent = body;
          section.append(h, p);
          paper.append(section);
        }
        lastText = [
          title,
          "School-entered planning paper — check and edit before sharing.",
          ...blocks.flatMap(([label, body]) => ["", label.toUpperCase(), body]),
          "",
          "Free school music planning resources: mymusiclessons.uk/resources/",
        ].join("\n");
        result.hidden = false;
        status.textContent =
          "Your proposal is ready below. Review the assumptions and open decisions before sharing.";
        result.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
          block: "start",
        });
      } catch (e) {
        invalidate();
        status.textContent = "Check the timing and cost fields. " + e.message;
      }
    });
  root
    .querySelector("[data-proposal-download]")
    .addEventListener("click", () => {
      if (lastText) downloadText("school-music-proposal.txt", lastText);
    });
  root
    .querySelector("[data-proposal-import]")
    .addEventListener("change", async (event) => {
      const feedback = root.querySelector("[data-import-status]");
      try {
        const files = [...event.target.files];
        if (!files.length) return;
        if (files.length > 2 || files.some((f) => f.size > 32768))
          throw Error(
            "Choose at most one session file and one budget file, each under 32 KB.",
          );
        const imports = await Promise.all(
          files.map(async (f) => parsePlanningFile(await f.text())),
        );
        if (new Set(imports.map((x) => x.kind)).size !== imports.length)
          throw Error("Use only one file of each kind at a time.");
        const capacity = imports.find((x) => x.kind === "capacity"),
          budget = imports.find((x) => x.kind === "budget");
        for (const data of [...imports].sort((a, b) =>
          a.kind === "budget" ? -1 : 1,
        ))
          for (const [key, value] of Object.entries(data.values)) {
            if (field(key)) field(key).value = String(value);
          }
        const notes = imports.map((x) =>
          x.kind === "capacity" ? "session figures" : "budget figures",
        );
        if (
          capacity &&
          budget &&
          capacity.values.pupils !== budget.values.pupils
        )
          feedback.textContent = `Imported ${notes.join(" and ")}. The session file used ${capacity.values.pupils} pupils and the budget file ${budget.values.pupils}. This proposal currently uses ${capacity.values.pupils}; review the common group size and cost assumptions.`;
        else
          feedback.textContent = `Imported ${notes.join(" and ")}. Check all assumptions in the sections below.`;
        invalidate();
        showStep(0);
      } catch (e) {
        feedback.textContent = e.message;
      } finally {
        event.target.value = "";
      }
    });
  showStep(0);
}

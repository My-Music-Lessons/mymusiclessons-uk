export const LAUNCH_STATES = Object.freeze([
  Object.freeze({ value: "notyet", label: "Not explored yet" }),
  Object.freeze({ value: "planning", label: "We are working on it" }),
  Object.freeze({ value: "known", label: "We have a working answer" }),
]);

export const LAUNCH_QUESTIONS = Object.freeze([
  Object.freeze({ id: "purpose", label: "Is the musical purpose clear?", hint: "A first musical aim the school team can explain, such as practising a part and playing together." }),
  Object.freeze({ id: "interest", label: "Is pupil interest understood?", hint: "A school-level picture of the instruments and opportunities pupils would like to explore." }),
  Object.freeze({ id: "equipment", label: "Has the equipment been checked?", hint: "What is usable now, what can be shared, and what may need repair, loan, hire or purchase." }),
  Object.freeze({ id: "timing", label: "Has the weekly timing been checked?", hint: "A realistic window, individual playing time and changeovers for the group you have in mind." }),
  Object.freeze({ id: "budget", label: "Has the budget been checked?", hint: "A working view of setup, staff time and running costs, with unknown figures left open." }),
  Object.freeze({ id: "roles", label: "Have school roles and approval been considered?", hint: "Who leads the discussion, who supervises, and which school decisions are still needed. A working answer does not mean approval." }),
]);

const resources = {
  action: { id: "action", title: "School music action worksheet", href: "/school-music-action-plan/", task: "Write the first musical aim, one next action, a responsible school role and a review point." },
  interest: { id: "interest", title: "Free sign-up poster", href: "/student-interest-poster/", task: "Prepare a poster and use the school’s own approved route to gather interest. Keep pupil responses with the school." },
  equipment: { id: "equipment", title: "Instrument demand and equipment planner", href: "/school-music-instrument-planner/", task: "Compare aggregate instrument interest with usable equipment. Discuss reuse, repair, loans, hire and phased starts before buying." },
  timing: { id: "timing", title: "Music club session planner", href: "/music-club-planner/", task: "Test a weekly window using available stations, individual playing time and changeovers. Confirm staffing and practical arrangements separately." },
  budget: { id: "budget", title: "School music budget planner", href: "/music-club-budget/", task: "List setup, weekly staff time and running costs on a consistent basis. Check estimates and keep missing quotes open." },
  proposal: { id: "proposal", title: "School music proposal builder", href: "/school-music-proposal/", task: "Bring the purpose, capacity and cost assumptions into a discussion paper. Record the school roles and decisions still needed." },
  trust: { id: "trust", title: "Trust music rollout planner", href: "/trust-music-rollout-planner/", task: "Compare school-entered time and resource assumptions across settings, then discuss a phased rollout and local responsibilities." },
};

const reasons = {
  purpose: {
    notyet: "A first musical purpose gives the team something concrete to plan around before it chooses equipment or a timetable.",
    planning: "You are shaping the purpose. Recording one practical next action can turn that discussion into a manageable first step.",
  },
  interest: {
    notyet: "Understanding interest helps the team plan instruments and a realistic first group before it offers places.",
    planning: "You are exploring interest. A poster gives the school a clear invitation while it gathers the remaining picture.",
  },
  equipment: {
    notyet: "Comparing interest with usable equipment makes resource gaps visible before the team assumes every interested pupil can play at once.",
    planning: "Your equipment check is in progress. Comparing the working counts can show which gaps need a quote, loan enquiry or smaller start.",
  },
  timing: {
    notyet: "A rotation model helps the team see how individual playing time and changeovers fit into the weekly window.",
    planning: "You are working on timing. Test the proposed window so the next discussion has a clear capacity assumption.",
  },
  budget: {
    notyet: "A full-period estimate brings setup and weekly running costs into the same conversation, including the school’s staff time.",
    planning: "Your budget is taking shape. Bringing the estimates together helps identify missing costs and figures that still need checking.",
  },
  roles: {
    notyet: "A discussion paper can make the lead, supervision arrangements and school approval route explicit before a launch decision.",
    planning: "You are considering roles and approval. A proposal records the current assumptions and open decisions for that conversation.",
  },
};

const reviewReasons = {
  proposal: "Bring your working answers and remaining open questions into a discussion paper so colleagues can review the current assumptions together.",
  action: "Keep the working answers useful by recording the next action, a responsible role and when the school will review progress.",
  budget: "Revisit the budget against the current group, period and staffing assumptions before the team relies on the estimate.",
  timing: "Review the weekly capacity against the current group and usable stations so a changed assumption is visible.",
  equipment: "Review the current inventory alongside interest to keep resource gaps and sourcing decisions visible.",
  interest: "Use a fresh school-managed invitation if the proposed group or musical opportunities have changed since interest was gathered.",
  trust: "A multi-school plan benefits from a shared view of each setting’s assumptions, with school-specific responsibilities still recorded.",
};

/** An ordered planning suggestion from staff self-report; no readiness assessment. */
export function makeLaunchPath(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Use a set of school-level planning answers.");
  }
  const scope = input.scope === undefined ? "school" : input.scope;
  if (!["school", "trust"].includes(scope)) throw new RangeError("Choose one school or several schools / a trust.");
  const answers = LAUNCH_QUESTIONS.map(({ id, label }) => {
    const state = input[id] === undefined ? "notyet" : input[id];
    const choice = LAUNCH_STATES.find((item) => item.value === state);
    if (!choice) throw new RangeError(`Choose a listed answer for: ${label}`);
    return { id, question: label, state, answer: choice.label };
  });
  const steps = [];
  const add = (id, why) => {
    if (!steps.some((step) => step.id === id)) steps.push({ ...resources[id], why });
  };
  for (const answer of answers.slice(0, 5)) {
    if (answer.state !== "known") add(answer.id === "purpose" ? "action" : answer.id, reasons[answer.id][answer.state]);
  }
  const roles = answers.find((answer) => answer.id === "roles");
  if (scope === "trust") add("trust", reviewReasons.trust);
  else add("proposal", roles.state === "known" ? reviewReasons.proposal : reasons.roles[roles.state]);
  for (const id of ["proposal", "action", "budget", "timing", "equipment", "interest"]) {
    if (steps.length >= 3) break;
    add(id, id === "proposal" && roles.state !== "known" ? reasons.roles[roles.state] : reviewReasons[id]);
  }
  return {
    scope,
    scopeLabel: scope === "trust" ? "Several schools / a trust" : "One school or setting",
    answers,
    steps,
    notice: "This route is based on staff self-report. It is a planning suggestion, not an assessment, school approval or confirmation of service availability. The school team decides what to do next.",
  };
}

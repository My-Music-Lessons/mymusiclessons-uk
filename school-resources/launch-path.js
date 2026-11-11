import { makeLaunchPath } from "./launch-path-model.js";

const root = document.querySelector("[data-launch-path-tool]");
if (root) {
  const controls = root.querySelector(".launch-path-controls");
  const status = root.querySelector("[data-launch-status]");
  const print = root.querySelector("[data-launch-print]");
  const stale = root.querySelector("[data-launch-stale]");
  const title = root.querySelector("[data-launch-result-title]");
  let hasRoute = false;
  root.querySelector("[data-launch-build]").hidden = false;
  root.querySelector("[data-launch-reset]").hidden = false;
  print.hidden = false;
  status.textContent = "Choose your school team’s current answers, then find your next actions. The linked starting route is also available.";

  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };

  function buildRoute(focus = true) {
    try {
      const input = Object.fromEntries([...root.querySelectorAll("[data-launch-answer]")].map((select) => [select.dataset.launchAnswer, select.value]));
      input.scope = root.querySelector("[data-launch-scope]").value;
      const route = makeLaunchPath(input);
      const items = route.steps.map((step, index) => {
        const li = node("li");
        const number = node("span", String(index + 1).padStart(2, "0"), "launch-path-number");
        number.setAttribute("aria-hidden", "true");
        const body = node("div"), heading = node("h4"), link = node("a", step.title);
        link.href = step.href;
        const arrow = node("span", " ↗");
        arrow.setAttribute("aria-hidden", "true");
        link.append(arrow);
        heading.append(link);
        const why = node("p", step.why, "launch-path-why");
        const task = node("p", undefined, "launch-path-task");
        task.append(node("strong", "Bring back: "), document.createTextNode(step.task));
        body.append(heading, why, task, node("span", `mymusiclessons.uk${step.href}`, "launch-path-print-url"));
        li.append(number, body);
        return li;
      });
      root.querySelector("[data-launch-route]").replaceChildren(...items);
      const answers = route.answers.map((answer) => {
        const row = node("div");
        row.append(node("dt", answer.question), node("dd", answer.answer));
        return row;
      });
      root.querySelector("[data-launch-answers]").replaceChildren(...answers);
      root.querySelector("[data-launch-scope-output]").textContent = `Planning for: ${route.scopeLabel}.`;
      root.querySelector("[data-launch-record]").hidden = false;
      root.querySelector("[data-launch-notice]").textContent = route.notice;
      title.textContent = "Your next school music actions.";
      root.querySelector("[data-launch-summary]").textContent = `${route.steps.length} suggested actions for ${route.scope === "trust" ? "your multi-school discussion" : "your school discussion"}. Follow the order that helps your team; each link opens a free planning resource.`;
      stale.hidden = true;
      print.disabled = false;
      hasRoute = true;
      status.textContent = `Your ${route.steps.length}-action route is ready. It includes the answers used. Review it below, then print if you want to keep it.`;
      if (focus) title.focus();
    } catch (error) {
      print.disabled = true;
      stale.hidden = !hasRoute;
      status.textContent = `Check your answers. ${error.message}`;
    }
  }

  controls.addEventListener("change", () => {
    print.disabled = true;
    stale.hidden = !hasRoute;
    status.textContent = hasRoute
      ? "Your answers changed. Find your next actions again before printing this route."
      : "Your answers are set in this page. Choose Find my next actions to tailor the route.";
  });
  root.querySelector("[data-launch-build]").addEventListener("click", () => buildRoute());
  root.querySelector("[data-launch-reset]").addEventListener("click", () => {
    for (const select of root.querySelectorAll("[data-launch-answer]")) select.value = "notyet";
    root.querySelector("[data-launch-scope]").value = "school";
    buildRoute(false);
    status.textContent = "Answers reset to Not explored yet for one school. The starting route and its answer record are ready.";
    root.querySelector("[data-launch-answer]").focus();
  });
  print.addEventListener("click", () => {
    if (hasRoute && !print.disabled) window.print();
  });
  // The browser's own Print command also receives the current answer record.
  window.addEventListener("beforeprint", () => buildRoute(false));
}

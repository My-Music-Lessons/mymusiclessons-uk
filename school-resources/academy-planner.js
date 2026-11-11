(() => {
  const planner = document.querySelector("[data-academy-planner]");
  if (!planner) return;
  planner.classList.add("planner-enhanced");
  const selectedLabel = (name) =>
    planner.querySelector(`input[name="${name}"]:checked`).dataset.label;
  let announceTimer;
  function update(announce = true) {
    const instruments = [
      ...planner.querySelectorAll("[data-plan-instrument]:checked"),
    ];
    const posterLink = planner.querySelector("[data-student-poster-link]");
    if (posterLink) {
      const names = {
        Guitar: "guitar",
        Piano: "piano",
        Vocals: "vocals",
        Bass: "bass",
        Drums: "drums",
        Violin: "violin",
        Ukulele: "ukulele",
        Trumpet: "trumpet",
        Clarinet: "clarinet",
      };
      posterLink.href =
        "/student-interest-poster/" +
        (instruments.length
          ? "?instruments=" +
            instruments.map((input) => names[input.value]).join(",")
          : "");
    }
    const checks = [...planner.querySelectorAll("[data-plan-check]")];
    const remaining = checks.filter((input) => !input.checked);
    const lineup = planner.querySelector("[data-plan-lineup]");
    lineup.replaceChildren(
      ...instruments.map((input) => {
        const item = document.createElement("li");
        item.textContent = input.value;
        return item;
      }),
    );
    planner.querySelector("[data-instrument-count]").textContent =
      instruments.length;
    planner.querySelector("[data-instrument-unit]").textContent =
      instruments.length === 1 ? "instrument" : "instruments";
    planner.querySelector("[data-plan-empty]").hidden = instruments.length > 0;
    planner.querySelector("[data-plan-group]").textContent =
      selectedLabel("academy-group");
    planner.querySelector("[data-plan-session]").textContent =
      selectedLabel("academy-session");
    planner.querySelector("[data-plan-goal]").textContent =
      selectedLabel("academy-goal");
    const next = planner.querySelector("[data-plan-next]");
    next.replaceChildren(
      ...remaining.map((input) => {
        const item = document.createElement("li");
        item.textContent = input.dataset.label;
        return item;
      }),
    );
    next.hidden = remaining.length === 0;
    planner.querySelector("[data-plan-done]").hidden = remaining.length > 0;
    const count = checks.length - remaining.length;
    planner.querySelector("[data-check-count]").textContent =
      `${count} of 6 practical pieces noted`;
    planner.querySelector("[data-plan-progress]").value = count;
    planner.querySelector("[data-plan-progress]").textContent = `${count} of 6`;
    if (announce) {
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => {
        planner.querySelector("[data-plan-announcement]").textContent =
          `Plan updated. ${instruments.length} instruments selected. ${count} of 6 practical pieces noted.`;
      }, 250);
    }
  }
  planner.addEventListener("change", update);
  planner.querySelector("[data-plan-reset]").addEventListener("click", () => {
    planner.querySelectorAll("input").forEach((input) => {
      input.checked = input.defaultChecked;
    });
    update();
  });
  update(false);
})();

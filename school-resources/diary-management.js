import { expandDiary } from "./diary-model.js";
import { findDiarySlots } from "./diary-availability.js";
import {
  prepareDiaryBatch,
  listDiaryCancellations,
  restoreDiaryCancellation,
} from "./diary-operations.js";

/** Reviewed local operations; shared diary state/undo/saving belongs to the main controller. */
export function mountDiaryManagement({
  root,
  getDiary,
  getView,
  commit,
  safeEditor,
  message,
  navigate,
  prefillSession,
}) {
  const $ = (key) => root.querySelector(`[${key}]`);
  const make = (tag, text = "", className = "") => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (className) e.className = className;
    return e;
  };
  const signature = () => JSON.stringify(getDiary());
  const button = (text, hook, value) => {
    const b = make("button", text, "diary-button diary-button-small");
    b.type = "button";
    b.dataset[hook] = value;
    return b;
  };
  let source = "",
    selected = new Set(),
    draft = null,
    slotDraft = null,
    cancelledLimit = 100;
  function options(select, items) {
    const previous = select.value;
    select.replaceChildren();
    const blank = make("option", "Unassigned");
    blank.value = "";
    select.append(blank);
    for (const item of items) {
      const o = make("option", item.name);
      o.value = item.id;
      select.append(o);
    }
    select.value = items.some((x) => x.id === previous) ? previous : "";
  }
  function clearBatch(reason = "") {
    draft = null;
    $("data-batch-apply").disabled = true;
    $("data-batch-accept-clashes").checked = false;
    $("data-batch-clash-consent").hidden = true;
    $("data-batch-summary").textContent = reason;
    $("data-batch-items").replaceChildren();
  }
  function clearSlots(reason = "") {
    slotDraft = null;
    $("data-slot-results").replaceChildren();
    $("data-slot-summary").textContent = reason;
  }
  function openPanel(key, focusKey) {
    const panel = $(key);
    panel.open = true;
    panel.scrollIntoView({ block: "start" });
    $(focusKey)?.focus({ preventScroll: true });
  }
  for (const [buttonKey, panelKey, focusKey] of [
    ["data-diary-open-slots", "data-slot-panel", "data-slot-date"],
    ["data-diary-open-batch", "data-batch-panel", "data-batch-search"],
    [
      "data-diary-open-cancelled",
      "data-cancelled-panel",
      "data-cancelled-from",
    ],
  ])
    $(buttonKey).addEventListener("click", () => openPanel(panelKey, focusKey));
  $("data-slot-use-view").addEventListener("click", () => {
    $("data-slot-date").value = getView().from;
    clearSlots("Current view date selected. Search again.");
  });
  $("data-batch-use-view").addEventListener("click", () => {
    const view = getView();
    $("data-batch-from").value = view.from;
    $("data-batch-to").value = view.to;
    clearBatch("Current view dates selected. Preview again.");
  });
  $("data-cancelled-use-view").addEventListener("click", () => {
    const view = getView();
    $("data-cancelled-from").value = view.from;
    $("data-cancelled-to").value = view.to;
    cancelledLimit = 100;
    renderCancelled();
  });

  function matchingPatterns() {
    const q = $("data-batch-search").value.trim().toLowerCase();
    return getDiary().sessions.filter(
      (s) =>
        !q ||
        [s.title, s.group, s.instrument, s.repeat]
          .join(" ")
          .toLowerCase()
          .includes(q),
    );
  }
  function renderSelection() {
    const list = $("data-batch-patterns"),
      patterns = matchingPatterns(),
      diary = getDiary();
    list.replaceChildren();
    if (!patterns.length)
      list.append(
        make("p", "No patterns match this search.", "diary-list-empty"),
      );
    for (const s of patterns) {
      const label = make("label", "", "diary-batch-pattern"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.batchId = s.id;
      input.checked = selected.has(s.id);
      const text = make("span");
      text.append(
        make("strong", s.title),
        make(
          "small",
          `${s.group || "No group"} · ${s.repeat} · ${s.startDate}${s.repeat === "once" ? "" : " to " + s.endDate} · ${s.startTime}–${s.endTime}`,
        ),
      );
      const room =
        diary.resources.rooms.find((x) => x.id === s.roomId)?.name ||
        "Unassigned room";
      text.append(make("small", room));
      label.append(input, text);
      list.append(label);
    }
    updateSelectionCount(patterns);
  }
  function updateSelectionCount(patterns = matchingPatterns()) {
    const shown = new Set(patterns.map((s) => s.id)),
      hidden = [...selected].filter((id) => !shown.has(id)).length;
    $("data-batch-count").textContent =
      `${selected.size} pattern${selected.size === 1 ? "" : "s"} selected${hidden ? ` · ${hidden} hidden by this search` : ""}. Date range controls which actual sessions are affected.`;
  }
  $("data-batch-search").addEventListener("input", renderSelection);
  $("data-batch-patterns").addEventListener("change", (event) => {
    const input = event.target.closest("[data-batch-id]");
    if (!input) return;
    input.checked
      ? selected.add(input.dataset.batchId)
      : selected.delete(input.dataset.batchId);
    clearBatch("Selection changed. Preview again.");
    updateSelectionCount();
  });
  $("data-batch-select-all").addEventListener("click", () => {
    for (const s of matchingPatterns()) selected.add(s.id);
    clearBatch("Selection changed. Preview again.");
    renderSelection();
  });
  $("data-batch-clear").addEventListener("click", () => {
    selected.clear();
    clearBatch();
    renderSelection();
  });
  $("data-batch-panel").addEventListener("input", (event) => {
    if (
      event.target.matches(
        "[data-batch-search],[data-batch-accept-clashes],[data-batch-id]",
      )
    )
      return;
    clearBatch("Inputs changed. Preview again.");
  });
  $("data-batch-action").addEventListener("change", () => {
    $("data-batch-copy-controls").hidden =
      $("data-batch-action").value !== "copy";
  });
  $("data-batch-preview").addEventListener("click", () => {
    clearBatch();
    if (!safeEditor()) return;
    try {
      const base = signature(),
        result = prepareDiaryBatch(getDiary(), {
          action: $("data-batch-action").value,
          sessionIds: [...selected],
          from: $("data-batch-from").value,
          to: $("data-batch-to").value,
          destinationDate: $("data-batch-destination").value,
        });
      draft = { ...result, base, action: $("data-batch-action").value };
      const copied = new Set(result.addedRuleIds),
        items =
          draft.action === "copy"
            ? expandDiary(result.diary).filter((o) => copied.has(o.sessionId))
            : result.affectedOccurrences;
      $("data-batch-summary").textContent =
        `${result.summary} Nothing has changed yet. Review ${items.length} affected date${items.length === 1 ? "" : "s"} before applying.`;
      for (const o of items.slice(0, 30))
        $("data-batch-items").append(
          make(
            "li",
            `${o.date} · ${o.startTime}–${o.endTime} · ${o.title} · ${o.group || "No group"}`,
            "diary-preview-item",
          ),
        );
      if (items.length > 30)
        $("data-batch-items").append(
          make(
            "li",
            `Showing the first 30 of ${items.length} dates. The full reviewed range is applied.`,
          ),
        );
      const lookup = new Map(expandDiary(result.diary).map((o) => [o.id, o]));
      for (const c of result.conflicts.slice(0, 8))
        $("data-batch-items").append(
          make(
            "li",
            `Clash: ${c.date} · ${c.occurrenceIds.map((id) => lookup.get(id)?.title || "Session").join(" and ")} share ${c.types.map((t) => ({ room: "a room", person: "a staff role", group: "a group" })[t]).join(", ")}.`,
          ),
        );
      if (result.conflicts.length > 8)
        $("data-batch-items").append(
          make(
            "li",
            `${result.conflicts.length} clash pairs in total; review them in the diary after applying.`,
          ),
        );
      $("data-batch-clash-consent").hidden = !result.conflicts.length;
      $("data-batch-apply").disabled = false;
    } catch (e) {
      clearBatch("No batch change prepared. " + e.message);
    }
  });
  $("data-batch-apply").addEventListener("click", () => {
    if (!draft || draft.base !== signature()) {
      clearBatch("The diary changed. Preview again.");
      return;
    }
    if (!safeEditor()) return;
    if (draft.conflicts.length && !$("data-batch-accept-clashes").checked) {
      message(
        "Review the clashes and acknowledge them before applying this copy.",
      );
      return;
    }
    const ready = draft,
      date =
        ready.action === "copy"
          ? expandDiary(ready.diary).find((o) =>
              ready.addedRuleIds.includes(o.sessionId),
            )?.date
          : ready.affectedOccurrences[0]?.date;
    if (
      commit(
        ready.diary,
        ready.action === "copy"
          ? "Reviewed session dates copied. Their originals are unchanged."
          : "Reviewed dates cancelled. Restore them from Cancelled dates or use Undo.",
      )
    )
      navigate(date);
  });

  $("data-slot-panel").addEventListener("input", () =>
    clearSlots("Inputs changed. Search again."),
  );
  $("data-slot-find").addEventListener("click", () => {
    clearSlots();
    try {
      const base = signature(),
        result = findDiarySlots(getDiary(), {
          date: $("data-slot-date").value,
          startTime: $("data-slot-start").value,
          endTime: $("data-slot-end").value,
          durationMinutes: Number($("data-slot-duration").value),
          stepMinutes: Number($("data-slot-step").value),
          roomId: $("data-slot-room").value,
          personId: $("data-slot-person").value,
          group: $("data-slot-group").value,
          limit: 12,
        });
      slotDraft = { ...result, base };
      $("data-slot-summary").textContent = result.summary;
      result.slots.forEach((slot, index) => {
        const li = make("li", "", "diary-slot-item");
        li.append(
          make("span", `${slot.date} · ${slot.startTime}–${slot.endTime}`),
          button("Use this slot", "slotUse", String(index)),
        );
        $("data-slot-results").append(li);
      });
    } catch (e) {
      clearSlots("No search completed. " + e.message);
    }
  });
  $("data-slot-results").addEventListener("click", (event) => {
    const b = event.target.closest("[data-slot-use]");
    if (!b) return;
    if (!slotDraft || slotDraft.base !== signature()) {
      clearSlots("The diary changed. Search again.");
      return;
    }
    if (!safeEditor()) return;
    const slot = slotDraft.slots[Number(b.dataset.slotUse)];
    if (!slot) return;
    prefillSession(slot);
    message(
      "Clear slot copied into Add a session. Enter a title, review the details and save. No session has been booked yet.",
    );
  });

  function renderCancelled() {
    const list = $("data-cancelled-list");
    list.replaceChildren();
    try {
      const entries = listDiaryCancellations(getDiary(), {
        from: $("data-cancelled-from").value,
        to: $("data-cancelled-to").value,
      });
      $("data-cancelled-summary").textContent =
        `${entries.length} manually cancelled date${entries.length === 1 ? "" : "s"} in this range. ${entries.length > cancelledLimit ? `Showing the first ${cancelledLimit}. ` : ""}School closures are managed separately.`;
      if (!entries.length)
        list.append(
          make(
            "li",
            "No manual cancellations match this date range.",
            "diary-list-empty",
          ),
        );
      for (const o of entries.slice(0, cancelledLimit)) {
        const li = make("li", "", "diary-cancelled-item"),
          body = make("div");
        body.append(
          make("strong", `${o.date} · ${o.startTime}–${o.endTime}`),
          make("p", `${o.title} · ${o.group || "No group"}`),
        );
        if (o.closed)
          body.append(
            make(
              "small",
              "This date is also covered by a school closure. Removing the cancellation will not schedule a session while that closure remains.",
            ),
          );
        const b = button(
          o.closed ? "Remove cancellation" : "Review restore",
          "cancelledRestore",
          o.sessionId,
        );
        b.dataset.cancelledDate = o.date;
        li.append(body, b);
        list.append(li);
      }
      if (entries.length > cancelledLimit) {
        const li = make("li");
        li.append(button("Show 100 more", "cancelledMore", ""));
        list.append(li);
      }
    } catch (e) {
      $("data-cancelled-summary").textContent =
        "Choose a valid cancellation range. " + e.message;
    }
  }
  $("data-cancelled-refresh").addEventListener("click", () => {
    cancelledLimit = 100;
    renderCancelled();
  });
  for (const key of ["data-cancelled-from", "data-cancelled-to"])
    $(key).addEventListener("change", () => {
      cancelledLimit = 100;
      renderCancelled();
    });
  $("data-cancelled-panel").addEventListener("toggle", () => {
    if ($("data-cancelled-panel").open) renderCancelled();
  });
  $("data-cancelled-list").addEventListener("click", (event) => {
    if (event.target.closest("[data-cancelled-more]")) {
      cancelledLimit += 100;
      renderCancelled();
      return;
    }
    const b = event.target.closest("[data-cancelled-restore]");
    if (!b || !safeEditor()) return;
    try {
      const result = restoreDiaryCancellation(getDiary(), {
        sessionId: b.dataset.cancelledRestore,
        date: b.dataset.cancelledDate,
      });
      const text = result.restored
        ? `Restore this session on ${b.dataset.cancelledDate}? ${result.conflicts.length} clash pairs would affect it. Review the school arrangements before using the timetable.`
        : `Remove this manual cancellation on ${b.dataset.cancelledDate}? The school closure still keeps the session out of the timetable.`;
      if (!confirm(text)) return;
      commit(
        result.diary,
        result.restored
          ? "Cancelled date restored. Review any clash warnings."
          : "Manual cancellation removed. The school closure still applies.",
      );
    } catch (e) {
      message("No cancellation was changed. " + e.message);
    }
  });
  function stateChanged() {
    const diary = getDiary(),
      next = signature();
    if (next === source) return;
    const first = !source;
    source = next;
    const ids = new Set(diary.sessions.map((s) => s.id));
    selected = new Set([...selected].filter((id) => ids.has(id)));
    clearBatch(
      first ? "" : "The diary changed. Preview again before applying.",
    );
    clearSlots(
      first ? "" : "The diary changed. Search again before using a result.",
    );
    options($("data-slot-room"), diary.resources.rooms);
    options($("data-slot-person"), diary.resources.people);
    if (first) {
      const view = getView();
      $("data-slot-date").value = view.from;
      for (const key of ["data-batch-from", "data-cancelled-from"])
        $(key).value = view.from;
      for (const key of ["data-batch-to", "data-cancelled-to"])
        $(key).value = view.to;
      $("data-batch-destination").value = view.from;
    }
    for (const key of [
      "data-slot-date",
      "data-batch-from",
      "data-batch-to",
      "data-batch-destination",
      "data-cancelled-from",
      "data-cancelled-to",
    ]) {
      const input = $(key);
      input.min = diary.settings.termStart;
      input.max = diary.settings.termEnd;
      if (input.value < diary.settings.termStart)
        input.value = diary.settings.termStart;
      if (input.value > diary.settings.termEnd)
        input.value = diary.settings.termEnd;
    }
    renderSelection();
    if ($("data-cancelled-panel").open) renderCancelled();
    else {
      $("data-cancelled-list").replaceChildren();
      $("data-cancelled-summary").textContent =
        "Open this panel to review manual cancellations in the chosen range.";
    }
  }
  stateChanged();
  return { stateChanged };
}

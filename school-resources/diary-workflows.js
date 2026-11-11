import { expandDiary, findConflicts } from "./diary-model.js";
import { buildDiaryDraft, rescheduleDiary } from "./diary-planner.js";
import {
  DIARY_CSV_TEMPLATE,
  parseDiaryCsv,
  inferDiaryCsvMapping,
  importDiaryCsv,
} from "./diary-import.js";
import { downloadText } from "./planning-download.js";

/** Reviewable mass changes. The main diary controller owns state and persistence. */
export function mountDiaryWorkflows({
  root,
  getDiary,
  commit,
  safeEditor,
  message,
  navigate,
}) {
  const $ = (key) => root.querySelector(`[${key}]`);
  const make = (tag, text = "") => {
    const e = document.createElement(tag);
    e.textContent = text;
    return e;
  };
  const signature = () => JSON.stringify(getDiary());
  const drafts = { builder: null, csv: null, move: null };
  const builderStatus = make("p");
  $("data-builder-result").prepend(builderStatus);
  let parsed = null,
    moveSource = null,
    firstState = true;
  const mappingFields = {
    title: "Session title (required)",
    group: "Group label",
    instrument: "Instrument",
    date: "First date (required)",
    end_date: "Final repeat date",
    start_time: "Start time (required)",
    end_time: "End time (required)",
    repeat: "Repeat",
    room: "Room label",
    staff_role: "Staff role label",
  };
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
  function invalidate(kind, reason = "") {
    drafts[kind] = null;
    $(`data-${kind}-apply`).disabled = true;
    $(`data-${kind}-clash-consent`).hidden = true;
    $(`data-${kind}-accept-clashes`).checked = false;
    if (kind === "move") {
      $("data-move-result").textContent = reason;
      return;
    }
    $(`data-${kind}-summary`).textContent = reason;
    $(`data-${kind}-items`).replaceChildren();
    if (kind === "builder") builderStatus.textContent = reason;
  }
  function previewList(target, occurrences, conflicts, diary) {
    target.replaceChildren();
    const room = (id) =>
      diary.resources.rooms.find((x) => x.id === id)?.name || "Unassigned room";
    for (const o of occurrences.slice(0, 18)) {
      const li = make(
        "li",
        `${o.date} · ${o.startTime}–${o.endTime} · ${o.title} · ${o.group || "No group"} · ${room(o.roomId)}`,
      );
      li.className = "diary-preview-item";
      target.append(li);
    }
    if (occurrences.length > 18)
      target.append(
        make(
          "li",
          `Showing 18 of ${occurrences.length} added sessions. The full draft is included when applied.`,
        ),
      );
    if (conflicts.length) {
      const lookup = new Map(expandDiary(diary).map((o) => [o.id, o]));
      for (const c of conflicts.slice(0, 8)) {
        const a = lookup.get(c.occurrenceIds[0]),
          b = lookup.get(c.occurrenceIds[1]);
        target.append(
          make(
            "li",
            `Clash: ${c.date} · ${a?.title || "Session"} and ${b?.title || "session"} share ${c.types.map((t) => ({ room: "a room", person: "a staff role", group: "a group" })[t]).join(", ")}.`,
          ),
        );
      }
      if (conflicts.length > 8)
        target.append(
          make(
            "li",
            `${conflicts.length} clash pairs in total. Review the diary after applying.`,
          ),
        );
    }
  }
  function remember(kind, result, base) {
    drafts[kind] = { ...result, base };
    const clashes = result.conflicts.length;
    $(`data-${kind}-clash-consent`).hidden = !clashes;
    $(`data-${kind}-accept-clashes`).checked = false;
    $(`data-${kind}-apply`).disabled = false;
  }
  function ready(kind) {
    const draft = drafts[kind];
    if (!draft || draft.base !== signature()) {
      invalidate(
        kind,
        "The diary or inputs changed. Preview this draft again.",
      );
      return null;
    }
    if (!safeEditor()) return null;
    if (draft.conflicts.length && !$(`data-${kind}-accept-clashes`).checked) {
      message(
        "Review the clashes and select the acknowledgement before applying, or change the draft.",
      );
      return null;
    }
    return draft;
  }
  $("data-diary-open-builder").addEventListener("click", () => {
    const panel = $("data-diary-builder-panel");
    panel.open = true;
    panel.scrollIntoView({ block: "start" });
    $("data-builder-title").focus({ preventScroll: true });
  });
  $("data-diary-open-import").addEventListener("click", () => {
    const panel = $("data-diary-csv-panel");
    panel.open = true;
    panel.scrollIntoView({ block: "start" });
    $("data-csv-file").focus({ preventScroll: true });
  });
  $("data-diary-builder-panel").addEventListener("input", (event) => {
    if (!event.target.matches("[data-builder-accept-clashes]"))
      invalidate(
        "builder",
        "Inputs changed. Preview the timetable before adding it.",
      );
  });
  $("data-builder-preview").addEventListener("click", () => {
    invalidate("builder");
    if (!safeEditor()) return;
    try {
      const base = signature();
      const config = {};
      for (const [key, hook] of Object.entries({
        title: "title",
        instrument: "instrument",
        firstDate: "first-date",
        lastDate: "last-date",
        startTime: "start-time",
        endTime: "end-time",
        roomId: "room",
        personId: "person",
        mode: "mode",
        breakStart: "break-start",
        breakEnd: "break-end",
      }))
        config[key] = $("data-builder-" + hook).value;
      config.groups = $("data-builder-groups")
        .value.split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      config.durationMinutes = Number($("data-builder-duration").value);
      config.changeoverMinutes = Number($("data-builder-changeover").value);
      const result = buildDiaryDraft(getDiary(), config);
      if (!result.occurrences.length)
        throw Error(
          "No sessions fall on open dates in this range. Change the dates or closures.",
        );
      remember("builder", result, base);
      builderStatus.textContent = "Draft ready. Nothing has been added yet.";
      $("data-builder-summary").textContent =
        `${result.summary} ${result.diary.sessions.length}/100 session patterns after adding.`;
      previewList(
        $("data-builder-items"),
        result.occurrences,
        result.conflicts,
        result.diary,
      );
    } catch (e) {
      invalidate("builder", "Draft not created. " + e.message);
    }
  });
  $("data-builder-apply").addEventListener("click", () => {
    const draft = ready("builder");
    if (!draft) return;
    if (
      commit(
        draft.diary,
        "Timetable draft added. Review the sessions and any clash warnings.",
      )
    )
      navigate(draft.occurrences[0]?.date);
  });
  $("data-csv-template").addEventListener("click", () =>
    downloadText(
      "mml-diary-import-template.csv",
      DIARY_CSV_TEMPLATE,
      "text/csv;charset=utf-8",
    ),
  );
  $("data-csv-file").addEventListener("change", async (event) => {
    parsed = null;
    invalidate("csv");
    $("data-csv-mapping").replaceChildren();
    $("data-csv-mapping").hidden = true;
    $("data-csv-preview").disabled = true;
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 1048576) throw Error("Choose a CSV smaller than 1 MB.");
      const text = await file.text();
      if (event.target.files[0] !== file) return;
      parsed = parseDiaryCsv(text);
      const suggested = inferDiaryCsvMapping(parsed.headers);
      for (const [key, label] of Object.entries(mappingFields)) {
        const wrap = make("label", label),
          select = document.createElement("select");
        select.dataset.csvColumn = key;
        const blank = make("option", "Not included");
        blank.value = "";
        select.append(blank);
        parsed.headers.forEach((header, index) => {
          const o = make("option", header);
          o.value = String(index);
          select.append(o);
        });
        select.value =
          suggested[key] === undefined ? "" : String(suggested[key]);
        wrap.append(select);
        $("data-csv-mapping").append(wrap);
      }
      $("data-csv-mapping").hidden = false;
      $("data-csv-preview").disabled = false;
      $("data-csv-summary").textContent =
        `${parsed.rows.length} rows read locally. Match the columns, then preview. Only mapped fields are added; remove any personal or pupil information before import.`;
    } catch (e) {
      $("data-csv-summary").textContent = "CSV not loaded. " + e.message;
    }
  });
  $("data-csv-mapping").addEventListener("change", () =>
    invalidate("csv", "Column choices changed. Preview again."),
  );
  $("data-csv-preview").addEventListener("click", () => {
    invalidate("csv");
    if (!safeEditor() || !parsed) return;
    try {
      const mapping = {};
      $("data-csv-mapping")
        .querySelectorAll("select")
        .forEach((e) => (mapping[e.dataset.csvColumn] = e.value));
      const base = signature(),
        result = importDiaryCsv(getDiary(), parsed, mapping);
      if (!result.occurrences.length)
        throw Error(
          "No imported sessions occur on open dates in this term. Check the date columns and closures.",
        );
      remember("csv", result, base);
      const s = result.summary;
      $("data-csv-summary").textContent =
        typeof s === "string"
          ? s
          : `${s.addedRules} patterns · ${s.addedOccurrences} sessions · ${s.addedRooms} new rooms · ${s.addedStaffRoles} new staff roles. ${s.termEndFallbacks ? `${s.termEndFallbacks} repeating rows use the term end date. ` : ""}${result.conflicts.length} clash pairs to review. Nothing is added until you apply.`;
      previewList(
        $("data-csv-items"),
        result.occurrences,
        result.conflicts,
        result.diary,
      );
    } catch (e) {
      invalidate("csv", "Import preview failed. " + e.message);
    }
  });
  $("data-csv-apply").addEventListener("click", () => {
    const draft = ready("csv");
    if (!draft) return;
    if (
      commit(
        draft.diary,
        "Spreadsheet sessions added. Review the imported timetable.",
      )
    )
      navigate(draft.occurrences[0]?.date);
  });
  const moveDialog = $("data-diary-move-dialog");
  function moveOpen(sessionId, date, { newDate = date } = {}) {
    if (!safeEditor()) return;
    const session = getDiary().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    moveSource = { sessionId, date };
    invalidate("move");
    $("data-move-description").textContent =
      `${session.title} · ${date} · ${session.startTime}–${session.endTime}. Earlier dates stay in place when you move this and future dates.`;
    $("data-move-date").value = newDate;
    $("data-move-start-time").value = session.startTime;
    $("data-move-end-time").value = session.endTime;
    $("data-move-room").value = session.roomId;
    $("data-move-person").value = session.personId;
    $("data-move-scope").value = "once";
    moveDialog.showModal();
    $("data-move-date").focus();
  }
  root.addEventListener("click", (event) => {
    const b = event.target.closest("[data-move-occurrence]");
    if (b) moveOpen(b.dataset.moveOccurrence, b.dataset.occurrenceDate);
  });
  moveDialog.addEventListener("input", (event) => {
    if (!event.target.matches("[data-move-accept-clashes]"))
      invalidate("move", "Changes need a new preview.");
  });
  $("data-move-cancel").addEventListener("click", () => moveDialog.close());
  moveDialog.addEventListener("close", () => {
    moveSource = null;
    invalidate("move");
  });
  $("data-move-preview").addEventListener("click", () => {
    invalidate("move");
    if (!moveSource) return;
    try {
      const before = getDiary(),
        base = signature(),
        next = rescheduleDiary(before, {
          ...moveSource,
          scope: $("data-move-scope").value,
          newDate: $("data-move-date").value,
          startTime: $("data-move-start-time").value,
          endTime: $("data-move-end-time").value,
          roomId: $("data-move-room").value,
          personId: $("data-move-person").value,
        });
      const originalOccurrences = new Map(
          expandDiary(before).map((o) => [o.id, o]),
        ),
        occurrences = expandDiary(next),
        changed = new Set(
          occurrences
            .filter(
              (o) =>
                JSON.stringify(o) !==
                JSON.stringify(originalOccurrences.get(o.id)),
            )
            .map((o) => o.id),
        ),
        conflicts = findConflicts(occurrences).filter((c) =>
          c.occurrenceIds.some((id) => changed.has(id)),
        );
      remember("move", { diary: next, conflicts }, base);
      $("data-move-result").textContent =
        `Ready to move ${$("data-move-scope").value === "once" ? "this date only" : "this and future dates"} to ${$("data-move-date").value} at ${$("data-move-start-time").value}–${$("data-move-end-time").value}. ${conflicts.length} clash pairs affect the changed dates. Nothing changes until you apply.`;
    } catch (e) {
      invalidate("move", "Move not prepared. " + e.message);
    }
  });
  $("data-move-apply").addEventListener("click", () => {
    const draft = ready("move");
    if (!draft) return;
    const date = $("data-move-date").value;
    if (
      commit(draft.diary, "Session move applied. Earlier dates are preserved.")
    ) {
      moveDialog.close();
      navigate(date);
    }
  });
  function stateChanged() {
    const diary = getDiary();
    for (const prefix of ["builder", "move"]) {
      options($(`data-${prefix}-room`), diary.resources.rooms);
      options($(`data-${prefix}-person`), diary.resources.people);
    }
    if (firstState) {
      $("data-builder-first-date").value = diary.settings.termStart;
      $("data-builder-last-date").value = diary.settings.termEnd;
      firstState = false;
    }
    for (const key of ["first-date", "last-date"]) {
      $("data-builder-" + key).min = diary.settings.termStart;
      $("data-builder-" + key).max = diary.settings.termEnd;
    }
    $("data-move-date").min = diary.settings.termStart;
    $("data-move-date").max = diary.settings.termEnd;
    for (const kind of ["builder", "csv", "move"])
      if (drafts[kind] && drafts[kind].base !== signature())
        invalidate(kind, "The diary changed. Preview again before applying.");
  }
  stateChanged();
  return { stateChanged, moveOpen };
}

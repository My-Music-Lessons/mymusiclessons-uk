const TOOLS = [
  ["editor", "diary-session-setup", "[data-session-title]"],
  ["setup", "diary-programme-setup", "[data-diary-school]"],
  ["builder", "diary-timetable-builder", "[data-builder-title]"],
  ["csv", "diary-spreadsheet-import", "[data-csv-file]"],
  ["patterns", "diary-all-sessions", "button"],
  ["slots", "diary-clear-slot", "[data-slot-date]"],
  ["batch", "diary-batch", "[data-batch-search]"],
  ["cancelled", "diary-cancelled", "[data-cancelled-from]"],
  ["saving", "diary-save-settings", "[data-diary-autosave]"],
];

/** Move existing task nodes, retaining their values, listeners and source checks. */
export function mountDiaryPremium({
  root,
  hasEditorChanges = () => false,
  message = () => {},
  addSession = () => {},
}) {
  const doc = root?.ownerDocument,
    win = doc?.defaultView,
    drawer = root?.querySelector("dialog[data-premium-drawer]"),
    content = drawer?.querySelector("[data-premium-drawer-content]"),
    title = drawer?.querySelector("[data-premium-drawer-title]"),
    toolSelect = drawer?.querySelector("[data-premium-tool-select]"),
    closeButton = drawer?.querySelector("[data-premium-close]"),
    drawerMessage = drawer?.querySelector("[data-premium-message]"),
    entries = TOOLS.map(([key, id, focus]) => ({
      key,
      panel: root?.querySelector(`#${id}`),
      focus,
      placeholder: null,
    })),
    byKey = new Map(entries.map((entry) => [entry.key, entry])),
    byPanel = new Map(entries.map((entry) => [entry.panel, entry]));
  if (
    !win ||
    typeof drawer?.showModal !== "function" ||
    typeof drawer?.close !== "function" ||
    !content ||
    !title ||
    !toolSelect ||
    !closeButton ||
    entries.some(({ panel }) => panel?.tagName !== "DETAILS")
  )
    return { stateChanged() {}, closeTool() {}, destroy() {} };

  const listeners = [],
    $ = (selector) => root.querySelector(selector),
    focusButton = $("[data-premium-focus]"),
    focusLabel =
      focusButton?.querySelector("[data-premium-focus-label]") || focusButton,
    focusText = focusLabel?.textContent,
    filterInputs = [
      "[data-diary-room-filter]",
      "[data-diary-person-filter]",
      "[data-diary-group-filter]",
      "[data-diary-search]",
    ]
      .map($)
      .filter(Boolean);
  let active = null,
    lastTool = "editor",
    opener = null,
    lastTrigger = null,
    enabled = true,
    destroyed = false,
    reconcileQueued = false,
    printState = null,
    focusScroll = null;

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }
  function focus(node) {
    if (
      node?.isConnected &&
      !node.disabled &&
      !node.closest("[hidden], [inert]") &&
      node.getClientRects().length &&
      win.getComputedStyle(node).visibility !== "hidden"
    ) {
      node.focus({ preventScroll: true });
      return doc.activeElement === node;
    }
    return false;
  }
  function restore(entry) {
    if (!entry) return;
    entry.panel.open = false;
    if (entry.placeholder?.parentNode)
      entry.placeholder.replaceWith(entry.panel);
    entry.placeholder = null;
    entry.panel.classList.remove("diary-premium-active-panel");
  }
  function stateChanged() {
    if (destroyed) return;
    for (const button of root.querySelectorAll("[data-premium-task]")) {
      const selected =
        drawer.open && active?.key === button.dataset.premiumTask;
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute("aria-expanded", String(selected));
    }
    $("[data-premium-tools]")?.setAttribute(
      "aria-expanded",
      String(drawer.open),
    );
    if (active) toolSelect.value = active.key;
    const mode = $("[data-diary-view]")?.value;
    for (const button of root.querySelectorAll("[data-premium-view]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.premiumView === mode),
      );
    const count = filterInputs.filter((input) => input.value.trim()).length,
      badge = $("[data-premium-filter-count], [data-premium-count]"),
      clear = $("[data-premium-clear-filters]");
    if (badge) {
      badge.textContent = count ? String(count) : "";
      badge.setAttribute(
        "aria-label",
        `${count} active filter${count === 1 ? "" : "s"}`,
      );
    }
    $("[data-premium-filters]")?.setAttribute(
      "data-active-count",
      String(count),
    );
    if (clear) clear.disabled = count === 0;
    focusButton?.setAttribute(
      "aria-pressed",
      String(doc.body.classList.contains("diary-focus-mode")),
    );
  }
  function closeDrawer({ restoreFocus = true, quiet = false } = {}) {
    const previous = active,
      returnTo = opener;
    active = null;
    opener = null;
    restore(previous);
    if (drawer.open) drawer.close();
    stateChanged();
    if (!quiet && hasEditorChanges())
      message(
        "Your unsaved session edit is kept in this tab. Reopen Add / edit a session to continue.",
      );
    if (restoreFocus && !focus(returnTo))
      focus($("[data-premium-add]")) ||
        focus($("[data-premium-tools]")) ||
        focus(focusButton);
  }
  function openTool(key, { trigger = null, focusTarget = null } = {}) {
    const next = byKey.get(key);
    if (!enabled || destroyed || !next) return;
    // A second native modal owns focus until it has been closed.
    if (
      [...root.querySelectorAll("dialog[open]")].some((node) => node !== drawer)
    ) {
      next.panel.open = false;
      return;
    }
    if (!active)
      opener =
        trigger ||
        lastTrigger ||
        (doc.activeElement !== doc.body ? doc.activeElement : null);
    if (!drawer.open && drawerMessage) drawerMessage.hidden = true;
    if (active !== next) {
      restore(active);
      active = next;
      next.placeholder = doc.createComment(`diary-tool:${key}`);
      next.panel.before(next.placeholder);
      content.append(next.panel);
      next.panel.classList.add("diary-premium-active-panel");
      content.scrollTop = 0;
      drawer.scrollTop = 0;
    }
    next.panel.open = true;
    lastTool = key;
    title.textContent =
      next.panel.querySelector("summary strong")?.textContent ||
      toolSelect.querySelector(`option[value="${key}"]`)?.textContent ||
      "Diary tool";
    toolSelect.value = key;
    if (!drawer.open) {
      try {
        drawer.showModal();
      } catch {
        // Native details remain usable if a browser cannot enter a modal state.
        closeDrawer({ restoreFocus: false, quiet: true });
        enabled = false;
        root.classList.remove("premium-ready");
        next.panel.open = true;
        return;
      }
    }
    stateChanged();
    const currentFocus = doc.activeElement;
    if (focusTarget && drawer.contains(focusTarget)) focus(focusTarget);
    else if (!next.panel.contains(currentFocus))
      focus(next.panel.querySelector(next.focus) || closeButton);
  }
  function reconcile() {
    reconcileQueued = false;
    if (!enabled || destroyed) return;
    const otherModal = [...root.querySelectorAll("dialog[open]")].find(
      (node) => node !== drawer,
    );
    if (otherModal) {
      if (active) closeDrawer({ restoreFocus: false, quiet: true });
      return;
    }
    // Named details close the previous panel before opening the next. Inspect
    // the settled group, so its queued close event cannot close the new tool.
    const opened = entries.find(
      (entry) => entry.panel.open && entry !== active,
    );
    if (opened) openTool(opened.key);
    else if (active && (!active.panel.open || !drawer.open)) closeDrawer();
  }
  function queueReconcile() {
    if (reconcileQueued || destroyed || !enabled) return;
    reconcileQueued = true;
    win.queueMicrotask(reconcile);
  }
  function add() {
    if (hasEditorChanges()) {
      openTool("editor");
      message(
        "Your unsaved session edit is still here. Save it or clear it before starting another session.",
      );
      return;
    }
    addSession();
    openTool("editor");
  }
  function toggleFocus() {
    const previousScroll = { left: win.scrollX, top: win.scrollY };
    const focused = doc.body.classList.toggle("diary-focus-mode");
    if (focusLabel)
      focusLabel.textContent = focused ? "Exit focused workspace" : focusText;
    if (focused) {
      focusScroll = previousScroll;
      root.scrollIntoView({ block: "start" });
    } else if (focusScroll) {
      win.scrollTo(focusScroll);
      focusScroll = null;
    }
    stateChanged();
  }

  listen(
    root,
    "click",
    (event) => {
      if (!enabled || !(event.target instanceof win.Element)) return;
      const target = event.target.closest("button, summary");
      if (!target) return;
      if (!drawer.contains(target)) lastTrigger = target;
      if (target.matches("[data-premium-add]")) {
        event.preventDefault();
        add();
      } else if (target.matches("[data-premium-add-teacher]")) {
        event.preventDefault();
        const input = $("[data-diary-person-name]");
        openTool("setup", { focusTarget: input });
        input?.scrollIntoView({ block: "center", inline: "nearest" });
      } else if (target.matches("[data-premium-task]")) {
        event.preventDefault();
        openTool(target.dataset.premiumTask, { trigger: target });
      } else if (target.matches("[data-premium-tools]")) {
        event.preventDefault();
        openTool(lastTool, { trigger: target });
      } else if (target.matches("[data-premium-close]")) {
        event.preventDefault();
        closeDrawer();
      } else if (target.matches("[data-premium-focus]")) {
        event.preventDefault();
        toggleFocus();
      } else if (target.matches("[data-premium-view]")) {
        event.preventDefault();
        const select = $("[data-diary-view]");
        if (select && select.value !== target.dataset.premiumView) {
          select.value = target.dataset.premiumView;
          select.dispatchEvent(new win.Event("change", { bubbles: true }));
        }
        stateChanged();
      } else if (target.matches("[data-premium-clear-filters]")) {
        event.preventDefault();
        for (const input of filterInputs) input.value = "";
        // All values are reset before the existing controller renders once.
        const input = $("[data-diary-search]") || filterInputs[0];
        input?.dispatchEvent(
          new win.Event(input.type === "search" ? "input" : "change", {
            bubbles: true,
          }),
        );
        stateChanged();
      } else if (
        target.tagName === "SUMMARY" &&
        byPanel.has(target.parentElement)
      ) {
        event.preventDefault();
        const entry = byPanel.get(target.parentElement);
        if (active === entry && drawer.open) closeDrawer();
        else openTool(entry.key, { trigger: target });
      }
    },
    true,
  );
  listen(toolSelect, "change", () =>
    openTool(toolSelect.value, { focusTarget: toolSelect }),
  );
  listen(drawer, "cancel", (event) => {
    event.preventDefault();
    closeDrawer();
  });
  listen(drawer, "close", () => {
    if (!drawer.open && active) closeDrawer();
  });
  listen(
    root,
    "toggle",
    (event) => {
      if (byPanel.has(event.target)) queueReconcile();
    },
    true,
  );
  listen(
    root,
    "beforetoggle",
    (event) => {
      if (
        event.target !== drawer &&
        event.target.tagName === "DIALOG" &&
        event.newState === "open" &&
        active
      )
        closeDrawer({ restoreFocus: false, quiet: true });
    },
    true,
  );
  listen(root, "input", (event) => {
    if (event.target !== toolSelect) stateChanged();
  });
  listen(root, "change", stateChanged);
  listen(root, "keydown", (event) => {
    if (
      !enabled ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.repeat
    )
      return;
    if (
      event.target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      )
    )
      return;
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      add();
    } else if (event.key === "/" && !drawer.open) {
      event.preventDefault();
      focus($("[data-diary-search]"));
    }
  });
  listen(win, "beforeprint", () => {
    if (!drawer.open || !active) return;
    printState = {
      key: active.key,
      focusTarget: doc.activeElement,
      trigger: opener,
    };
    closeDrawer({ restoreFocus: false, quiet: true });
  });
  listen(win, "afterprint", () => {
    if (!printState || destroyed || !enabled) return;
    const previous = printState;
    printState = null;
    openTool(previous.key, previous);
  });
  const observer = new win.MutationObserver((records) => {
    if (
      records.some(
        ({ target }) => byPanel.has(target) || target.tagName === "DIALOG",
      )
    )
      queueReconcile();
  });
  observer.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  const mainMessage = $("[data-diary-message]"),
    messageObserver = new win.MutationObserver(() => {
      // Attribute reconciliation opens a requested tool first. Its source
      // message can then be announced inside the modal instead of inert main.
      win.queueMicrotask(() => {
        if (!destroyed && drawer.open && drawerMessage && mainMessage) {
          drawerMessage.textContent = mainMessage.textContent;
          drawerMessage.hidden = !mainMessage.textContent.trim();
        }
      });
    });
  if (mainMessage && drawerMessage)
    messageObserver.observe(mainMessage, {
      childList: true,
      characterData: true,
      subtree: true,
    });

  root.classList.add("premium-ready");
  stateChanged();
  reconcile();
  return {
    stateChanged,
    closeTool: closeDrawer,
    destroy() {
      if (destroyed) return;
      closeDrawer({ restoreFocus: false, quiet: true });
      destroyed = true;
      observer.disconnect();
      messageObserver.disconnect();
      for (const remove of listeners) remove();
      root.classList.remove("premium-ready");
      doc.body.classList.remove("diary-focus-mode");
      if (focusLabel) focusLabel.textContent = focusText;
    },
  };
}

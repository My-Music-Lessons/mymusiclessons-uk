document.addEventListener("click", (event) => {
  if (event.target.closest("[data-print-plan]")) window.print();
});

// The expanded menu starts below the real header, including its larger logo.
(() => {
  const header = document.querySelector(".website-nav");
  const menu = header?.querySelector(".website-menu");
  if (!header || !menu) return;
  const trigger = menu.querySelector("summary");
  const background = [
    document.querySelector("main"),
    document.querySelector("footer"),
  ].filter(Boolean);
  const desktop = window.matchMedia("(min-width: 1280px)");
  let pendingFrame;
  function alignMenu() {
    const logo = header.querySelector(".brand img");
    const bottom = Math.max(
      header.getBoundingClientRect().bottom,
      logo?.getBoundingClientRect().bottom ?? 0,
    );
    header.style.setProperty(
      "--mml-resources-menu-top",
      `${Math.max(0, Math.ceil(bottom))}px`,
    );
  }
  function scheduleAlignment() {
    if (!menu.open) return;
    cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(alignMenu);
  }
  function syncMenu() {
    alignMenu();
    document.body.classList.toggle("mml-resources-menu-open", menu.open);
    trigger.setAttribute("aria-label", menu.open ? "Close menu" : "Open menu");
    trigger.setAttribute("aria-expanded", String(menu.open));
    background.forEach((element) => {
      element.inert = menu.open;
    });
  }
  menu.addEventListener("toggle", syncMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open) return;
    event.preventDefault();
    menu.open = false;
    syncMenu();
    trigger.focus({ preventScroll: true });
  });
  menu.querySelectorAll(".website-menu-sheet a").forEach((link) => {
    link.addEventListener("click", () => {
      menu.open = false;
      syncMenu();
    });
  });
  desktop.addEventListener("change", () => {
    if (desktop.matches) menu.open = false;
    syncMenu();
  });
  window.addEventListener("resize", scheduleAlignment, { passive: true });
  window.addEventListener("scroll", scheduleAlignment, { passive: true });
  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(scheduleAlignment).observe(header);
  document.fonts?.ready.then(alignMenu);
  syncMenu();
})();


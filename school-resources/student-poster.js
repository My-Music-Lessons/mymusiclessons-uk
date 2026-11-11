(() => {
  const root = document.querySelector("[data-student-poster]");
  if (!root) return;
  const artwork = root.querySelector(".student-poster");
  const school = root.querySelector("[data-poster-school]");
  const contact = root.querySelector("[data-poster-contact]");
  const link = root.querySelector("[data-poster-link]");
  const checks = [...root.querySelectorAll("[data-poster-instrument]")];
  const requested = new URLSearchParams(location.search).get("instruments");
  if (requested) {
    const slugs = requested.split(",");
    checks.forEach((c) => (c.checked = slugs.includes(c.dataset.slug)));
  }
  let previousLink = "";
  function update() {
    root.querySelector("[data-poster-school-output]").textContent =
      school.value.trim() || "Your school’s music programme";
    root.querySelector("[data-poster-contact-output]").textContent =
      contact.value.trim() ||
      "Speak to your school’s music lead to register your interest.";
    artwork.dataset.style = root.querySelector(
      '[name="poster-style"]:checked',
    ).value;
    root.querySelector("[data-poster-lineup]").replaceChildren(
      ...checks
        .filter((c) => c.checked)
        .map((c) => {
          const li = document.createElement("li");
          li.textContent = c.value;
          return li;
        }),
    );
    const iconLibrary = root.querySelector("[data-poster-icons]");
    if (iconLibrary) {
      const art = root.querySelector(".student-poster-art");
      const stamp = art.querySelector("i");
      const illustrations = checks
        .filter((c) => c.checked)
        .slice(0, 3)
        .map((c) => {
          const span = document.createElement("span");
          span.append(
            iconLibrary.content
              .querySelector(`[data-icon="${c.dataset.slug}"]`)
              .cloneNode(true),
          );
          return span;
        });
      art.replaceChildren(...illustrations);
      if (stamp) art.append(stamp);
    }
    const raw = link.value.trim();
    if (raw === previousLink) return;
    previousLink = raw;
    const holder = root.querySelector("[data-poster-qr]"),
      wrap = root.querySelector("[data-poster-qr-wrap]"),
      error = root.querySelector("#poster-link-error");
    holder.replaceChildren();
    wrap.hidden = true;
    error.hidden = true;
    link.removeAttribute("aria-invalid");
    if (!raw) return;
    try {
      const url = new URL(raw);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.href.length > 500
      )
        throw Error("Unsupported URL");
      if (
        url.hostname === location.hostname ||
        /(^|\.)mymusiclessons\.uk$/i.test(url.hostname)
      )
        throw Error("Use the school registration page");
      const qr = qrcode(0, "M");
      qr.addData(url.href);
      qr.make();
      holder.innerHTML = qr.createSvgTag({
        cellSize: 4,
        margin: 16,
        scalable: true,
      });
      const svg = holder.querySelector("svg");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "QR code for the school sign-up page");
      wrap.hidden = false;
    } catch {
      error.textContent =
        "Use your school’s own complete HTTPS sign-up link, up to 500 characters. A QR code has not been added.";
      error.hidden = false;
      link.setAttribute("aria-invalid", "true");
    }
  }
  root.addEventListener("input", update);
  root.addEventListener("change", update);
  root.querySelector("[data-poster-print]").addEventListener("click", () => {
    update();
    window.print();
  });
  root.querySelector("[data-poster-reset]").addEventListener("click", () => {
    school.value = "";
    contact.value = contact.defaultValue;
    link.value = "";
    checks.forEach((c) => (c.checked = true));
    root.querySelector('[name="poster-style"][value="colour"]').checked = true;
    update();
  });
  update();
})();

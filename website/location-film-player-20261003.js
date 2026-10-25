/* Small progressive enhancement for the static locations site; no portal runtime. */
(() => {
  const video = document.getElementById("location-film-video");
  const button = document.getElementById("location-film-play");
  const chip = document.querySelector(".location-film-chip");
  if (!(video instanceof HTMLVideoElement) || !button) return;

  button.addEventListener("click", () => {
    button.hidden = true;
    if (chip) chip.hidden = true;
    video.controls = true;
    video.focus();
    // Native controls remain available if playback is declined or interrupted.
    video.play().catch(() => {});
  });
  video.controls = false;
  button.hidden = false;
  if (chip) chip.hidden = false;
})();

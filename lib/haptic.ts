// A short haptic tick, where the platform allows one from the web.
//
// Android: the Vibration API. iOS Safari has no Vibration API, but since
// iOS 18 a native `<input type="checkbox" switch>` plays the system haptic
// when toggled, including via a click on its label — so toggle a throwaway
// one. Elsewhere this is a no-op.
export function haptic() {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(10);
    return;
  }
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.appendChild(input);
  document.body.appendChild(label);
  label.click();
  label.remove();
}

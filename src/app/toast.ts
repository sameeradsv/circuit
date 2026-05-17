export function showToast(message: string, durationMs = 2800): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('visible');
  window.setTimeout(() => el!.classList.remove('visible'), durationMs);
}

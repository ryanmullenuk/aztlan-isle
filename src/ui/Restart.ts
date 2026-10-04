/** Keep a visible, usable transition while the browser loads the next island. */
export function showRestart(url: string): void {
  document.getElementById('restart-screen')?.remove();
  const screen = document.createElement('div');
  screen.id = 'restart-screen';
  screen.setAttribute('role', 'status');
  const title = document.createElement('h1');
  title.textContent = 'AZTLAN ISLE';
  const message = document.createElement('p');
  message.textContent = 'Starting your island…';
  const retry = document.createElement('a');
  retry.href = url;
  retry.textContent = 'Tap here if loading does not continue';
  screen.append(title, message, retry);
  document.body.append(screen);
}

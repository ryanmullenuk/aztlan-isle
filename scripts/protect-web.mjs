import { readFileSync, writeFileSync } from 'node:fs';

// SHA-256 of the owner-selected web password. Native builds remain ungated.
const passwordHash = '9cb0dbd0bdefa61764489f4695331e7c4ccaf65f581a4e8a22572b6c0718ee84';
const game = readFileSync('dist/index.html', 'utf8');
const payload = JSON.stringify(game).replace(/</g, '\\u003c');
writeFileSync('dist/index.html', `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0a0d"><title>Aztlan Isle — Enter password</title>
<link rel="icon" href="./icon-32.png?v=4">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at top,#291319,#0b0a0d 65%);color:#f4f1f6;font-family:system-ui,sans-serif}main{width:100%;max-width:380px}h1{font-size:36px;margin:12px 0}p{color:#b6aebd;line-height:1.5}label{display:block;margin:28px 0 8px}input,button{width:100%;font:inherit;border-radius:10px;padding:14px}input{background:#18141c;color:white;border:1px solid #746778}button{margin-top:16px;background:#e3141c;color:white;border:0;font-weight:700;cursor:pointer}button:disabled{opacity:.6}a{color:#c9bfce}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:4px}#error{min-height:24px;color:#ffb5b8}.brand{font-size:13px;letter-spacing:.12em}
</style></head><body><main>
<a class="brand" href="/">REDHEAD GAMES</a><h1>Aztlan Isle</h1><p>Enter the password to play.</p>
<form id="unlock-form"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required aria-describedby="error"><button id="unlock" type="submit">Unlock game</button><p id="error" role="status" aria-live="polite"></p></form>
<noscript><p>Please enable JavaScript to unlock and play.</p></noscript>
</main><script>
const gameHTML = ${payload};
document.getElementById('unlock-form').addEventListener('submit', async function(event) {
  event.preventDefault();
  const input = document.getElementById('password');
  const button = document.getElementById('unlock');
  const error = document.getElementById('error');
  button.disabled = true; error.textContent = '';
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.value));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== '${passwordHash}') {
      error.textContent = 'Incorrect password. Please try again.';
      input.value = ''; input.focus(); button.disabled = false; return;
    }
    input.value = '';
    document.open(); document.write(gameHTML); document.close();
  } catch (err) {
    error.textContent = 'Unable to unlock. Please reload the page and try again.';
    button.disabled = false;
  }
});
</script></body></html>`);
console.log('Added browser password gate to dist/index.html');

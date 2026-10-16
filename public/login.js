document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  const err = document.getElementById('err');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  err.textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('pw').value })
    });
    if (r.ok) return location.replace('/');
    err.textContent = (await r.json().catch(() => ({}))).error || 'Could not sign in.';
  } catch {
    err.textContent = 'Could not reach the server. Try again in a few seconds.';
  }
  btn.disabled = false;
  btn.textContent = 'Enter';
});

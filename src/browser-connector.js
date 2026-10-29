async function connectTensorTonic(config) {
  if (!['https://www.tensortonic.com', 'https://tensortonic.com'].includes(location.origin)) {
    throw new Error('Run this only on your signed-in TensorTonic website.');
  }
  if (window.__tensorTonicVSCode) window.__tensorTonicVSCode.abort();
  const controller = new AbortController();
  window.__tensorTonicVSCode = controller;
  const key = '?key=' + encodeURIComponent(config.token);
  const base = config.base;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || !/^[a-f0-9]{64}$/.test(config.token)) {
    throw new Error('Invalid local connection configuration.');
  }
  const slug = '[a-zA-Z0-9][a-zA-Z0-9-]{0,199}';
  const allowed = (p, method) => {
    if (typeof p !== 'string' || !p.startsWith('/api/') || /[\\#%]/.test(p)) return false;
    const u = new URL(p, 'https://api.tensortonic.com');
    if (u.origin !== 'https://api.tensortonic.com') return false;
    if (method === 'GET') {
      if (u.pathname === '/api/problems/list') return [...u.searchParams].every(([k, v]) =>
        ['page', 'limit'].includes(k) ? /^\d{1,4}$/.test(v) : k === 'planId' && new RegExp(`^${slug}$`).test(v));
      return !u.search && new RegExp(`^/api/(?:study-plans(?:/${slug}(?:/problems/${slug})?)?|problems/${slug})$`).test(u.pathname);
    }
    return method === 'POST' && !u.search && new RegExp(`^/api/(?:study-plans/${slug}/problems/${slug}/(?:run|submit)|problems/${slug}/(?:run-cases|submit))$`).test(u.pathname);
  };
  console.info('TensorTonic VS Code: connecting to your local editor. Keep this tab open. To disconnect: window.__tensorTonicVSCode.abort()');
  console.info('TensorTonic VS Code: if your browser asks for local-network access, allow it so this tab can reach VS Code on this computer.');
  try {
    while (!controller.signal.aborted) {
      const queue = await fetch(base + '/poll' + key, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]), cache: 'no-store',
      });
      if (!queue.ok) throw new Error('Local editor rejected this connection (' + queue.status + ').');
      const command = await queue.json();
      if (command.stop) break;
      if (command.heartbeat) continue;
      let result;
      try {
        if (!allowed(command.path, command.method)) throw new Error('Unsupported editor request');
        const response = await fetch('https://api.tensortonic.com' + command.path, {
          method: command.method, credentials: 'include', redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(160000)]),
          ...(command.method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command.body) } : {}),
        });
        const data = await response.json();
        result = { id: command.id, status: response.status, data };
      } catch (error) { result = { id: command.id, error: error.message }; }
      const receipt = await fetch(base + '/result' + key, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify(result),
      });
      if (!receipt.ok) console.warn('TensorTonic VS Code: editor no longer waiting for this result.');
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('TensorTonic VS Code disconnected:', error.message);
      console.error('TensorTonic VS Code: check local-network access for this site, keep VS Code and this browser on the same computer, then run a fresh connection code.');
    }
  } finally {
    if (window.__tensorTonicVSCode === controller) delete window.__tensorTonicVSCode;
    console.info('TensorTonic VS Code: disconnected.');
  }
}

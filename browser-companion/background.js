'use strict';

// Persistent capabilities are readable only by extension-owned contexts, never
// by arbitrary content scripts. The popup is a trusted extension context, but
// its UI/messages never expose secrets. Messages below disclose a record
// only to this extension's top-frame script on the paired exact HTTPS origin.
importScripts('shared.js');
const shared = TensorTonicCompanionShared;
const ORIGINS = ['https://www.tensortonic.com/*', 'https://tensortonic.com/*'];
const SCRIPT_ID = 'tensortonic-remembered-connection';
const KEY = 'rememberedPairing';
const REVOKE = 'pendingRevocation';
const LEASE = 'connectionOwner';
let serial = Promise.resolve();
let forgetting = false;
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
function enqueue(fn) {
  const result = serial.then(() => ready).then(fn);
  serial = result.catch(() => {});
  return result;
}
function pageOrigin(sender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab && sender.tab.id) ||
      !shared.isTensorTonicPage(sender.url)) return undefined;
  return new URL(sender.url).origin;
}
function popup(sender) { return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html') && !sender.tab; }
async function records() {
  const values = await chrome.storage.local.get([KEY, REVOKE]);
  function valid(record) {
    try {
      shared.validateRecord({ base: record.base, resumeKey: record.resumeKey, expiresAt: record.expiresAt });
      return shared.isTensorTonicPage(record.origin) && new URL(record.origin).origin === record.origin;
    } catch (_) { return false; }
  }
  if (values[KEY] && !valid(values[KEY])) { await chrome.storage.local.remove(KEY); delete values[KEY]; }
  const raw = values[REVOKE];
  const pending = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(valid);
  if (pending.length) {
    values[REVOKE] = pending;
    if (!Array.isArray(raw) || raw.length !== pending.length) await chrome.storage.local.set({ [REVOKE]: pending });
  } else { if (raw) await chrome.storage.local.remove(REVOKE); delete values[REVOKE]; }
  return values;
}
async function queueRevocation(record, values) {
  const pending = values[REVOKE] || [];
  if (!pending.some(item => item.base === record.base && item.resumeKey === record.resumeKey)) pending.push(record);
  await chrome.storage.local.set({ [REVOKE]: pending });
}
async function register() {
  const matches = [];
  for (const origin of ORIGINS) if (await chrome.permissions.contains({ origins: [origin] })) matches.push(origin);
  const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) {
    if (scripts.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  const script = { id: SCRIPT_ID, matches, js: ['shared.js', 'connector.js', 'companion.js'],
    runAt: 'document_idle', allFrames: false, world: 'ISOLATED', persistAcrossSessions: true };
  if (scripts.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}
function broadcastStop() {
  // No capability or website content is sent to the popup or page DOM.
  chrome.tabs.query({ url: ORIGINS }).then(tabs => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'forget-pairing' }, { frameId: 0 }).catch(() => {});
  }).catch(() => {});
}
async function forget() {
  forgetting = true;
  broadcastStop();
  const values = await records();
  if (values[KEY]) await queueRevocation(values[KEY], values);
  await chrome.storage.local.remove(KEY);
  await chrome.storage.session.remove(LEASE);
  forgetting = false;
  broadcastStop();
  return { phase: 'disconnected', pendingRevocation: !!(values[KEY] || values[REVOKE]) };
}
async function handle(message, sender) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('INVALID_MESSAGE');
  const isPopup = popup(sender);
  const origin = pageOrigin(sender);
  if (isPopup) {
    if (message.type === 'register') { await register(); return { ok: true }; }
    if (message.type === 'forget') return forget();
    if (message.type === 'summary') {
      const values = await records();
      return { remembered: !!values[KEY], expiresAt: values[KEY] && values[KEY].expiresAt,
        pendingRevocation: !!values[REVOKE] };
    }
    throw new Error('INVALID_MESSAGE');
  }
  if (!origin) throw new Error('WRONG_PAGE');
  if (message.type === 'forget') return forget();
  const values = await records();
  if (message.type === 'revoked') {
    const pending = (values[REVOKE] || []).filter(item => !(item.origin === origin && item.resumeKey === message.resumeKey));
    if (pending.length) await chrome.storage.local.set({ [REVOKE]: pending });
    else await chrome.storage.local.remove(REVOKE);
    return { ok: true };
  }
  if (message.type === 'invalid') {
    if (values[KEY] && values[KEY].origin === origin && values[KEY].resumeKey === message.resumeKey) {
      await chrome.storage.local.remove(KEY);
      await chrome.storage.session.remove(LEASE);
    }
    return { ok: true };
  }
  const pendings = (values[REVOKE] || []).filter(item => item.origin === origin);
  const pending = pendings[0];
  if (message.type === 'revocations') return { pending, pendings };
  if (message.type === 'abandon') {
    const record = shared.validateRecord(message.record);
    if (values[KEY] && values[KEY].resumeKey === record.resumeKey) {
      await chrome.storage.local.remove(KEY);
      await chrome.storage.session.remove(LEASE);
    }
    await queueRevocation({ ...record, origin }, values);
    return { ok: true };
  }
  if (forgetting) throw new Error('FORGET_INCOMPLETE');
  if (!(await chrome.permissions.contains({ origins: [origin + '/*'] }))) throw new Error('PERMISSION_REQUIRED');
  const owner = (await chrome.storage.session.get(LEASE))[LEASE];
  const owns = !owner || owner.tabId === sender.tab.id || owner.until <= Date.now();
  if (message.type === 'claim') {
    if (pending) return { pending, pendings };
    if (!values[KEY] || values[KEY].origin !== origin || !owns) return { busy: !!values[KEY] };
    await chrome.storage.session.set({ [LEASE]: { tabId: sender.tab.id, until: Date.now() + 60000 } });
    return { record: values[KEY] };
  }
  if (message.type === 'reserve') {
    if (values[REVOKE] || !owns || (values[KEY] && (values[KEY].base !== message.base || values[KEY].origin !== origin))) {
      throw new Error('FORGET_PREVIOUS_PAIRING');
    }
    const reservation = crypto.randomUUID();
    await chrome.storage.session.set({ [LEASE]: { tabId: sender.tab.id, until: Date.now() + 60000, reservation } });
    return { ok: true, reservation };
  }
  if (message.type === 'save') {
    const record = shared.validateRecord(message.record);
    if (!owner || owner.tabId !== sender.tab.id || !owner.reservation || owner.reservation !== message.reservation || owner.until <= Date.now() ||
        values[REVOKE] || (values[KEY] && (values[KEY].base !== record.base || values[KEY].origin !== origin))) {
      throw new Error('FORGET_PREVIOUS_PAIRING');
    }
    await chrome.storage.local.set({ [KEY]: { ...record, origin } });
    await chrome.storage.session.set({ [LEASE]: { tabId: sender.tab.id, until: Date.now() + 60000 } });
    return { ok: true };
  }
  throw new Error('INVALID_MESSAGE');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  enqueue(() => handle(message, sender)).then(respond, () => respond({ error: 'PAIRING_STORAGE_OR_PERMISSION_ERROR' }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  enqueue(async () => {
    const owner = (await chrome.storage.session.get(LEASE))[LEASE];
    if (owner && owner.tabId === tabId) await chrome.storage.session.remove(LEASE);
  }).catch(() => {});
});
chrome.permissions.onRemoved.addListener(permissions => {
  if (permissions.origins && permissions.origins.some(origin => ORIGINS.includes(origin))) {
    enqueue(async () => { await forget(); await register(); }).catch(() => {});
  }
});
chrome.runtime.onInstalled.addListener(() => enqueue(register).catch(() => {}));
chrome.runtime.onStartup.addListener(() => enqueue(register).catch(() => {}));
// Also restore registration after a service worker upgrade without startup.
enqueue(register).catch(() => {});

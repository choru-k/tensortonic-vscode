'use strict';

const form = document.getElementById('pair-form');
const ticketInput = document.getElementById('ticket');
const connectButton = document.getElementById('connect');
const disconnectButton = document.getElementById('disconnect');
const statusLine = document.getElementById('status');
let selectedTab;
let busy = false;
let timer;
let uiGeneration = 0;
let localTicketError = false;

function showStatus(result) {
  let phase = result && result.phase || 'idle';
  // Background idle/error polls must not erase actionable local validation.
  // A real connection lifecycle change still takes precedence.
  if (['pairing', 'connecting', 'connected', 'disconnected'].includes(phase)) localTicketError = false;
  if (localTicketError) phase = 'error';
  const invalidTicket = localTicketError || result && result.errorCode === 'INVALID_TICKET';
  const messages = {
    idle: 'Ready to connect. Paste the one-use code from VS Code.',
    pairing: 'Checking the one-use pairing code…',
    connecting: 'Connection requested. Check your browser for a local-network permission prompt and check VS Code.',
    connected: 'Connected to VS Code. Keep this TensorTonic tab open.',
    disconnected: 'Disconnected. Copy a new code from VS Code to reconnect.',
    error: 'Could not connect. Check that you are signed in, using the same computer, and have local-network permission. Then copy a new code from VS Code.',
  };
  statusLine.textContent = invalidTicket
    ? 'Invalid pairing code format. Copy a new code from VS Code and paste the complete code starting with TT1:.'
    : messages[phase] || messages.error;
  statusLine.dataset.error = phase === 'error' ? 'true' : 'false';
  const active = ['pairing', 'connecting', 'connected'].includes(phase);
  connectButton.disabled = busy || !selectedTab || active;
  ticketInput.disabled = busy || !selectedTab || active;
  disconnectButton.disabled = busy || !selectedTab || !active;
}

async function invoke(method, value) {
  if (!selectedTab || !TensorTonicCompanionShared.isTensorTonicPage(selectedTab.url)) throw new Error('WRONG_PAGE');
  const result = await chrome.scripting.executeScript({
    target: { tabId: selectedTab.id, frameIds: [0] }, world: 'ISOLATED',
    func: (operation, argument) => {
      if (!['https://www.tensortonic.com', 'https://tensortonic.com'].includes(location.origin) || window !== window.top) {
        return { phase: 'error', errorCode: 'WRONG_PAGE' };
      }
      const companion = globalThis.__tensorTonicCompanion;
      if (!companion) return { phase: 'idle' };
      if (operation === 'connect') return companion.connect(argument);
      if (operation === 'disconnect') return companion.disconnect();
      return companion.status();
    },
    args: [method, value === undefined ? null : value],
  });
  return result[0] && result[0].result || { phase: 'error' };
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  let ticket = ticketInput.value;
  uiGeneration += 1;
  localTicketError = false;
  ticketInput.value = ''; // Never retain a consumed or rejected ticket in the UI.
  busy = true;
  showStatus({ phase: 'pairing' });
  let failureCode = 'INVALID_TICKET';
  try {
    TensorTonicCompanionShared.parseTicket(ticket);
    failureCode = 'PAIRING_FAILED';
    if (!selectedTab || !TensorTonicCompanionShared.isTensorTonicPage(selectedTab.url)) throw new Error('WRONG_PAGE');
    await chrome.scripting.executeScript({
      target: { tabId: selectedTab.id, frameIds: [0] }, world: 'ISOLATED',
      files: ['shared.js', 'connector.js', 'companion.js'],
    });
    const result = await invoke('connect', ticket);
    ticket = '';
    busy = false;
    showStatus(result);
  } catch (_) {
    busy = false;
    localTicketError = failureCode === 'INVALID_TICKET';
    showStatus({ phase: 'error', errorCode: failureCode });
  } finally {
    ticket = '';
    ticketInput.value = '';
  }
});

ticketInput.addEventListener('input', () => {
  if (!localTicketError) return;
  uiGeneration += 1;
  localTicketError = false;
  showStatus({ phase: 'idle' });
});

disconnectButton.addEventListener('click', async () => {
  if (busy) return;
  uiGeneration += 1;
  busy = true;
  showStatus({ phase: 'connecting' });
  try {
    const result = await invoke('disconnect');
    busy = false;
    showStatus(result);
  } catch (_) {
    busy = false;
    showStatus({ phase: 'error' });
  }
});

async function initialize() {
  connectButton.disabled = true;
  ticketInput.disabled = true;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !Number.isInteger(tab.id) || !TensorTonicCompanionShared.isTensorTonicPage(tab.url)) {
    statusLine.textContent = 'Reopen this extension on a signed-in https://www.tensortonic.com tab.';
    statusLine.dataset.error = 'true';
    return;
  }
  selectedTab = { id: tab.id, url: tab.url };
  showStatus(await invoke('status'));
  timer = setInterval(async () => {
    if (busy) return;
    const generation = uiGeneration;
    try {
      const result = await invoke('status');
      if (!busy && generation === uiGeneration) showStatus(result);
    } catch (_) {
      if (!busy && generation === uiGeneration) showStatus({ phase: 'error' });
    }
  }, 1000);
}

window.addEventListener('pagehide', () => {
  uiGeneration += 1;
  ticketInput.value = '';
  if (timer) clearInterval(timer);
});
initialize().catch(() => showStatus({ phase: 'error' }));

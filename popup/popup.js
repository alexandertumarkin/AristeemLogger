// popup/popup.js (MV3, module)
const DEFAULT_PERIOD_MINUTES = 2;

const $ = (sel) => document.querySelector(sel);
const input = $('#interval');
const saveBtn = $('#save');
const exportBtn = $('#export');
const statusEl = $('#status');

function showStatus(text, ok = true) {
  statusEl.textContent = text;
  statusEl.className = ok ? 'muted ok' : 'muted err';
}

async function loadInterval() {
  const { periodMinutes } = await chrome.storage.sync.get({ periodMinutes: DEFAULT_PERIOD_MINUTES });
  input.value = periodMinutes;
  showStatus(`Current interval: ${periodMinutes} min`);
}

async function saveInterval() {
  let val = Number(input.value);
  if (!Number.isFinite(val)) {
    showStatus('Enter a number 1–10', false);
    return;
  }
  val = Math.round(val);
  if (val < 1) val = 1;
  if (val > 10) val = 10;

  await chrome.storage.sync.set({ periodMinutes: val });
  showStatus(`Saved: ${val} min`);

  // по желанию можно закрыть popup:
  // window.close();
}

async function exportNow() {
  try {
    await chrome.runtime.sendMessage({ __ARISTEEM_EXPORT_NOW__: true });
    window.close();
  } catch (e) {
    showStatus(`Export error: ${e?.message || e}`, false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadInterval().catch(console.error);
  saveBtn.addEventListener('click', () => saveInterval().catch(console.error));
  exportBtn.addEventListener('click', () => exportNow().catch(console.error));
});

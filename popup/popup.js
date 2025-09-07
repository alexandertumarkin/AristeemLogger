// popup.js (Manifest V3, type="module")

const $ = (s) => document.querySelector(s);

const chkAdvanced    = $('#advanced');
const inputExportMin = $('#exportEveryMin');  // минуты, 1–10
const inputStatsSec  = $('#statsPeriodSec');  // секунды, 1–10
const btnApply       = $('#apply');
const btnExport      = $('#export');
const statusEl       = $('#status');

const DEFAULTS = {
  advanced: false,
  periodMinutes: 2,   // авто-экспорт каждые N минут
  statsPeriodSec: 3   // период опроса getStats() в Advanced
};

function showStatus(text, ok = true) {
  statusEl.textContent = text;
  statusEl.className = ok ? 'muted ok' : 'muted err';
}

function clamp(n, lo, hi) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function loadSettings() {
  const saved = await chrome.storage.sync.get(['advanced', 'periodMinutes', 'statsPeriodSec']);
  const s = { ...DEFAULTS, ...saved };

  chkAdvanced.checked   = !!s.advanced;
  inputExportMin.value  = String(s.periodMinutes);
  inputStatsSec.value   = String(s.statsPeriodSec);
}

async function applyAndSave() {
  const advanced       = !!chkAdvanced.checked;
  const periodMinutes  = clamp(inputExportMin.value, 1, 10);
  const statsPeriodSec = clamp(inputStatsSec.value,  1, 10);

  // ВАЖНО: service_worker.js слушает ключ periodMinutes
  await chrome.storage.sync.set({ advanced, periodMinutes, statsPeriodSec });

  // Отправляем конфиг на активную вкладку (через content.js → inpage.js)
  try {
    const tabId = await getActiveTabId();
    if (tabId) {
      await chrome.tabs.sendMessage(tabId, {
        __ARISTEEM_SET_CONFIG__: true,
        config: { advanced, statsPeriodSec }
      });
    }
  } catch {
    // если контент-скрипта нет — не страшно, настройки всё равно сохранились
  }

  showStatus('Saved & applied ✓');
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
  loadSettings().catch(console.error);

  btnApply.addEventListener('click',  () => applyAndSave().catch(console.error));
  btnExport.addEventListener('click', () => exportNow().catch(console.error));
});

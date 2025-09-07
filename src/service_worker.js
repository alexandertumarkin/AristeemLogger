// src/service_worker.js (ES module, MV3)

const DEFAULT_PERIOD_MINUTES = 2;
const MIN_ALLOWED = 1;
const MAX_ALLOWED = 10;

const EXPORT_ALARM = 'aristeem_export_alarm';
const buffer = [];
const MAX_BUFFER = 50_000;

// ---- Diagnostics (удобно при отладке)
console.log('[sw] loaded');

// === Алгоритм планирования будильника ===
function clampInterval(mins) {
  if (!Number.isFinite(mins)) return DEFAULT_PERIOD_MINUTES;
  mins = Math.round(mins);
  if (mins < MIN_ALLOWED) mins = MIN_ALLOWED;
  if (mins > MAX_ALLOWED) mins = MAX_ALLOWED;
  return mins;
}

function scheduleAlarm(periodMinutes) {
  const p = clampInterval(periodMinutes);
  chrome.alarms.clear(EXPORT_ALARM, () => {
    chrome.alarms.create(EXPORT_ALARM, { periodInMinutes: p });
    console.log(`[sw] alarm scheduled: every ${p} min`);
  });
}

function scheduleFromStorage() {
  chrome.storage.sync.get({ periodMinutes: DEFAULT_PERIOD_MINUTES }, ({ periodMinutes }) => {
    scheduleAlarm(periodMinutes);
  });
}

// При установке/обновлении
chrome.runtime.onInstalled.addListener(() => {
  console.log('[sw] onInstalled');
  scheduleFromStorage();
});

// При старте браузера
chrome.runtime.onStartup.addListener(() => {
  console.log('[sw] onStartup');
  scheduleFromStorage();
});

// Реакция на изменение настроек (popup -> storage)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.periodMinutes) {
    const newVal = changes.periodMinutes.newValue;
    console.log('[sw] periodMinutes changed ->', newVal);
    scheduleAlarm(newVal);
  }
});

// === Приём событий от content.js и команды экспорта ===
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.__ARISTEEM__) {
    buffer.push({ ...msg, receivedAt: Date.now() });
    if (buffer.length > MAX_BUFFER) {
      buffer.splice(0, buffer.length - MAX_BUFFER);
    }
  }
  if (msg?.__ARISTEEM_EXPORT_NOW__) {
    console.log('[sw] export requested via message');
    exportLogs();
  }
});

// === Экспорт по будильнику ===
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === EXPORT_ALARM) {
    console.log('[sw] alarm fired -> export');
    exportLogs();
  }
});

// === Экспорт по клику по иконке — опционально (если уберёшь popup и захочешь прямой клик)
// chrome.action.onClicked.addListener(() => exportLogs());

// === Сохранение JSON в downloads ===
function exportLogs() {
  console.log('[sw] exportLogs start, buffer length =', buffer.length);
  if (!buffer.length) {
    console.log('[sw] buffer empty -> skip export');
    return;
  }

  const payload = {
    version: '0.0.1',
    exportedAt: new Date().toISOString(),
    count: buffer.length,
    events: buffer
  };

  const json = JSON.stringify(payload, null, 2);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  const url = `data:application/json;base64,${base64}`;

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  chrome.downloads.download({
    url,
    filename: `aristeem-logs/aristeem-log-${timestamp}.json`,
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('[sw] downloads.download error:', chrome.runtime.lastError);
    } else {
      console.log('[sw] download started, id =', downloadId);
    }
  });

  // очищаем буфер после экспорта (rolling log не нужен)
  buffer.length = 0;
  console.log('[sw] buffer cleared');
}

// src/service_worker.js (ES module, MV3)

// ===== Constants & defaults =====
const DEFAULT_PERIOD_MINUTES = 2;
const MIN_ALLOWED = 1;
const MAX_ALLOWED = 10;

const EXPORT_ALARM = 'aristeem_export_alarm';

// In-memory buffer (можно заменить на storage при желании)
const buffer = [];
const MAX_BUFFER = 50_000; // защитный предел на случай шторма событий

// ===== Diagnostics =====
console.log('[sw] loaded');

// ===== Alarm scheduling =====
function clampInterval(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n)) return DEFAULT_PERIOD_MINUTES;
  return Math.max(MIN_ALLOWED, Math.min(MAX_ALLOWED, n));
}

async function scheduleAlarm(periodMinutes) {
  const pm = clampInterval(periodMinutes);
  try {
    await chrome.alarms.clear(EXPORT_ALARM);
  } catch {}
  await chrome.alarms.create(EXPORT_ALARM, { periodInMinutes: pm });
  console.log('[sw] alarm scheduled:', EXPORT_ALARM, 'every', pm, 'min');
}

async function scheduleFromStorage() {
  const { periodMinutes = DEFAULT_PERIOD_MINUTES } = await chrome.storage.sync.get('periodMinutes');
  await scheduleAlarm(periodMinutes);
}

// Восстановить расписание при старте/установке
chrome.runtime.onInstalled.addListener(() => scheduleFromStorage().catch(console.error));
chrome.runtime.onStartup.addListener(() => scheduleFromStorage().catch(console.error));

// Реакция на изменение настроек (popup -> storage)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.periodMinutes) {
    const newVal = changes.periodMinutes.newValue;
    console.log('[sw] periodMinutes changed ->', newVal);
    scheduleAlarm(newVal).catch(console.error);
  }
});

// ===== Receive events & commands =====

// 1) Лог-события от content.js (пересланные из inpage.js через window.postMessage)
chrome.runtime.onMessage.addListener((msg, sender) => {
  try {
    if (msg && msg.__ARISTEEM__ && msg.type) {
      if (buffer.length < MAX_BUFFER) {
        buffer.push({
          ts: msg.ts || Date.now(),
          type: msg.type,
          payload: msg.payload,
          // немного контекста источника
          _ctx: {
            tabId: sender?.tab?.id,
            url: sender?.tab?.url
          }
        });
      } else {
        // защитный отсекатель
        console.warn('[sw] buffer overflow, dropping event:', msg.type);
      }
      return; // ничего не отвечаем
    }

    // 2) Ручной экспорт (из popup.js)
    if (msg && msg.__ARISTEEM_EXPORT_NOW__) {
      console.log('[sw] export requested via message');
      exportLogs().catch(console.error);
      return;
    }

    // (опционально) привет от контент-скрипта
    if (msg && msg.__ARISTEEM_HELLO__) {
      console.log('[sw] content hello:', msg.href);
      return;
    }
  } catch (e) {
    console.error('[sw] onMessage error:', e);
  }
});

// 3) Таймер авто-экспорта
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === EXPORT_ALARM) {
    console.log('[sw] alarm fired -> export');
    exportLogs().catch(console.error);
  }
});

// ===== Export logic =====
async function exportLogs() {
  try {
    const count = buffer.length;
    console.log('[sw][export] buffer count =', count);
    if (!count) {
      console.warn('[sw][export] nothing to export (buffer empty)');
      return;
    }

    const payload = {
      meta: { exportedAt: new Date().toISOString(), count },
      events: buffer.slice()
    };

    const json = JSON.stringify(payload, null, 2);
    // ВАЖНО: data:-URL; не используем URL.createObjectURL в SW
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: `aristeem-logs/aristeem-log-${ts}.json`,
        saveAs: false,
        conflictAction: 'uniquify'
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('[sw] downloads.download error:', chrome.runtime.lastError);
        } else {
          console.log('[sw] download started, id =', downloadId);
        }
      }
    );

    buffer.length = 0;
    console.log('[sw] buffer cleared');
  } catch (e) {
    console.error('[sw][export] unexpected error:', e, chrome.runtime.lastError);
  }
}

// ===== Optional: download change tracing (для отладки) =====
chrome.downloads.onChanged.addListener((delta) => {
  if (delta && (delta.state || delta.error || delta.filename)) {
    console.log('[sw][dl]', JSON.stringify(delta));
  }
});

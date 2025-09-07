// src/content.js

// --- 1) Инъекция кода в контекст страницы ---
// (только так можно пропатчить native WebSocket/RTCPeerConnection)
(function injectInpage() {
  const INJECTED_FLAG_ID = '__aristeem_inpage_injected__';
  if (document.documentElement.hasAttribute(INJECTED_FLAG_ID)) return; // защита от двойной инъекции
  document.documentElement.setAttribute(INJECTED_FLAG_ID, '1');

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/inpage.js'); // путь из web_accessible_resources
  script.async = false; // гарантируем порядок выполнения
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
})();

// --- 2) Релеим сообщения от inpage.js в сервис-воркер ---
window.addEventListener('message', (event) => {
  // важная проверка: берём только сообщения из текущего окна
  if (event.source !== window) return;

  const msg = event.data;
  if (!msg || msg.__ARISTEEM__ !== true) return;

  // добавим немного контекста страницы
  const enriched = {
    ...msg,
    page: {
      href: location.href,
      origin: location.origin,
      title: document.title
    }
  };

  try {
    chrome.runtime.sendMessage(enriched);
  } catch (e) {
    // бывает при перезагрузках/детачах фрейма — игнорируем
  }
}, false);

// --- 3) (необязательно) Сообщим SW, что контент-скрипт активен ---
// Это может пригодиться, если SW хочет отправлять команды на страницу.
try {
  chrome.runtime.sendMessage({ __ARISTEEM_HELLO__: true, href: location.href });
} catch (_) {}

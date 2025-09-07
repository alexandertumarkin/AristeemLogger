// inpage.js
(function () {
  // ------------------ Config ------------------
  const DEFAULT_CFG = {
    advanced: false,
    wsMaxText: 4000,      // превью текстовых сообщений по WS
    statsPeriodSec: 3     // период опроса getStats() в advanced
  };
  let CFG = { ...DEFAULT_CFG };

  const peers = new Map(); // id -> { pc, timerId? }
  let nextId = 1;

  function send(type, payload) {
    window.postMessage({ __ARISTEEM__: true, type, payload, ts: Date.now() }, "*");
  }

  function previewData(data) {
    if (typeof data === 'string') return data.slice(0, CFG.wsMaxText);
    return '[binary]';
  }

  // Приём конфига от content.js/popup.js
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.__ARISTEEM_CONFIG__ && d.config) {
      CFG = { ...DEFAULT_CFG, ...d.config };
      send('CFG_APPLIED', { cfg: CFG });

      // Перезапуск таймеров getStats под новый конфиг
      peers.forEach((entry, id) => {
        if (entry.timerId) clearInterval(entry.timerId);
        entry.timerId = null;
        if (CFG.advanced) {
          entry.timerId = setInterval(() => collectAndSendStats(id, entry.pc),
            Math.max(1, CFG.statsPeriodSec) * 1000);
        }
      });
    }
  }, false);

  // ------------------ WebSocket hook ------------------
  const NativeWS = window.WebSocket;
  if (NativeWS) {
    window.WebSocket = function (url, protocols) {
      const ws = protocols ? new NativeWS(url, protocols) : new NativeWS(url);
      send("WS_OPEN", { url, protocols });

      const origSend = ws.send;
      ws.send = function (data) {
        send("WS_SEND", { url, data: previewData(data) });
        return origSend.apply(this, arguments);
      };

      ws.addEventListener("message", (ev) => {
        send("WS_MESSAGE", { url, data: previewData(ev.data) });
      });

      ws.addEventListener("close", (ev) => {
        send("WS_CLOSE", { url, code: ev.code, reason: ev.reason });
      });

      ws.addEventListener("error", () => {
        send("WS_ERROR", { url });
      });

      // Advanced: мониторинг bufferedAmount (здоровье канала)
      if (CFG.advanced) {
        let last = 0;
        const tick = () => {
          try {
            const v = ws.bufferedAmount;
            if ((v >= 256 * 1024 && last < 256 * 1024) || (last >= 256 * 1024 && v < 128 * 1024)) {
              send("WS_BUFFERED_AMOUNT", { url, bufferedAmount: v });
            }
            last = v;
            if (ws.readyState === NativeWS.CLOSED) clearInterval(intId);
          } catch {}
        };
        const intId = setInterval(tick, 1000);
      }

      return ws;
    };
    window.WebSocket.prototype = NativeWS.prototype;
  }

  // ------------------ RTCPeerConnection hook ------------------
  const NativePC = window.RTCPeerConnection;
  if (NativePC) {
    window.RTCPeerConnection = function (config) {
      const id = String(nextId++);
      const pc = new NativePC(config);
      send("RTC_CREATE", { id, config });

      // Всегда логируем базовые события
      pc.addEventListener("icecandidate", (ev) => {
        const cand = ev.candidate ? ev.candidate.candidate : null;
        send("RTC_ICE", { id, candidate: cand });
      });

      const origCreateOffer = pc.createOffer;
      pc.createOffer = async function () {
        const offer = await origCreateOffer.apply(this, arguments);
        send('RTC_OFFER', { id, sdp: offer?.sdp });
        return offer;
      };

      const origCreateAnswer = pc.createAnswer;
      pc.createAnswer = async function () {
        const answer = await origCreateAnswer.apply(this, arguments);
        send('RTC_ANSWER', { id, sdp: answer?.sdp });
        return answer;
      };

      const origSetLocal = pc.setLocalDescription;
      pc.setLocalDescription = async function (desc) {
        const res = await origSetLocal.apply(this, arguments);
        const p = desc ? { type: desc.type, sdp: desc.sdp } : null;
        send('RTC_SET_LOCAL', { id, ...p });
        return res;
      };

      const origSetRemote = pc.setRemoteDescription;
      pc.setRemoteDescription = async function (desc) {
        const res = await origSetRemote.apply(this, arguments);
        const p = desc ? { type: desc.type, sdp: desc.sdp } : null;
        send('RTC_SET_REMOTE', { id, ...p });
        return res;
      };

      // Advanced: все расширенные состояния и перехваты
      const setupAdvanced = () => {
        if (!CFG.advanced) return;

        pc.addEventListener('connectionstatechange', () => {
          send('RTC_STATE', { id, state: pc.connectionState });
        });
        pc.addEventListener('iceconnectionstatechange', () => {
          send('RTC_ICE_STATE', { id, state: pc.iceConnectionState });
        });
        pc.addEventListener('signalingstatechange', () => {
          send('RTC_SIGNALING_STATE', { id, state: pc.signalingState });
        });
        pc.addEventListener('icegatheringstatechange', () => {
          send('RTC_ICE_GATHERING', { id, state: pc.iceGatheringState });
        });
        pc.addEventListener('negotiationneeded', () => {
          send('RTC_NEGOTIATION_NEEDED', { id });
        });
        pc.addEventListener('icecandidateerror', (e) => {
          send('RTC_ICE_ERROR', {
            id,
            hostCandidate: e.hostCandidate,
            url: e.url,
            errorCode: e.errorCode,
            errorText: e.errorText
          });
        });

        // Перехват входящих ICE
        const origAddIce = pc.addIceCandidate;
        pc.addIceCandidate = function () {
          try {
            const candObj = arguments[0];
            const str = candObj && typeof candObj.candidate === 'string' ? candObj.candidate : null;
            send('RTC_ADD_ICE', { id, candidate: str });
          } catch {}
          return origAddIce.apply(this, arguments);
        };

        // Hook close()
        const origClose = pc.close;
        pc.close = function () {
          try { send('RTC_CLOSE', { id }); } catch {}
          const entry = peers.get(id);
          if (entry?.timerId) clearInterval(entry.timerId);
          peers.delete(id);
          return origClose.apply(this, arguments);
        };
      };
      setupAdvanced();

      // Periodic getStats() в advanced
      peers.set(id, { pc, timerId: null });
      if (CFG.advanced) {
        const tid = setInterval(() => collectAndSendStats(id, pc),
          Math.max(1, CFG.statsPeriodSec) * 1000);
        peers.get(id).timerId = tid;
      }

      return pc;
    };
    window.RTCPeerConnection.prototype = NativePC.prototype;
  }

  // ------------------ Stats collector (расширенный набор полей) ------------------
  async function collectAndSendStats(id, pc) {
    try {
      const report = await pc.getStats();
      const stats = [];
      const byId = new Map();
      report.forEach((v, k) => byId.set(k, v));

      report.forEach((item) => {
        const base = { id: item.id, type: item.type, timestamp: item.timestamp };

        if (item.type === 'inbound-rtp' || item.type === 'outbound-rtp') {
          stats.push({
            ...base,
            kind: item.kind,
            ssrc: item.ssrc,
            packetsReceived: item.packetsReceived,
            packetsSent: item.packetsSent,
            bytesReceived: item.bytesReceived,
            bytesSent: item.bytesSent,
            jitter: item.jitter,
            roundTripTime: item.roundTripTime,
            framesDecoded: item.framesDecoded,
            framesDropped: item.framesDropped,
            framesPerSecond: item.framesPerSecond,
            keyFramesDecoded: item.keyFramesDecoded,
            framesEncoded: item.framesEncoded,
            keyFramesSent: item.keyFramesSent,
            totalDecodeTime: item.totalDecodeTime,
            totalInterFrameDelay: item.totalInterFrameDelay,
            jitterBufferDelay: item.jitterBufferDelay,
            jitterBufferEmittedCount: item.jitterBufferEmittedCount,
            nackCount: item.nackCount,
            pliCount: item.pliCount,
            firCount: item.firCount,
            retransmittedPacketsSent: item.retransmittedPacketsSent,
            retransmittedPacketsReceived: item.retransmittedPacketsReceived,
            qualityLimitationReason: item.qualityLimitationReason,
            packetsLost: item.packetsLost,
            qpSum: item.qpSum,
            totalEncodeTime: item.totalEncodeTime,
            hugeFramesSent: item.hugeFramesSent
          });
        } else if (item.type === 'candidate-pair' && item.state === 'succeeded') {
          const entry = {
            ...base,
            selected: item.selected,
            currentRoundTripTime: item.currentRoundTripTime,
            availableOutgoingBitrate: item.availableOutgoingBitrate,
            availableIncomingBitrate: item.availableIncomingBitrate,
            requestsReceived: item.requestsReceived,
            responsesReceived: item.responsesReceived,
            localCandidateId: item.localCandidateId,
            remoteCandidateId: item.remoteCandidateId
          };

          // Дополнительно подтягиваем детали кандидатов
          const lc = byId.get(item.localCandidateId);
          const rc = byId.get(item.remoteCandidateId);
          if (lc) {
            entry.local = {
              type: lc.candidateType,
              protocol: lc.protocol,
              networkType: lc.networkType,
              ip: lc.ip,
              port: lc.port
            };
          }
          if (rc) {
            entry.remote = {
              type: rc.candidateType,
              protocol: rc.protocol,
              networkType: rc.networkType,
              ip: rc.ip,
              port: rc.port
            };
          }

          stats.push(entry);
        }
      });

      send("RTC_STATS", { id, stats });
    } catch (e) {
      send('RTC_STATS_ERROR', { id, message: String(e?.message || e) });
    }
  }
})();

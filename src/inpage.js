// src/inpage.js

(function () {
  function send(type, payload) {
    window.postMessage(
      { __ARISTEEM__: true, type, payload, ts: Date.now() },
      "*"
    );
  }

  // ==========================
  //  WebSocket
  // ==========================
  const NativeWS = window.WebSocket;
  if (NativeWS) {
    window.WebSocket = function (url, protocols) {
      const ws = protocols ? new NativeWS(url, protocols) : new NativeWS(url);
      send("WS_OPEN", { url, protocols });

      const origSend = ws.send;
      ws.send = function (data) {
        let preview =
          typeof data === "string" ? data.slice(0, 1000) : "[binary]";
        send("WS_SEND", { url, data: preview });
        return origSend.apply(this, arguments);
      };

      ws.addEventListener("message", (ev) => {
        const preview =
          typeof ev.data === "string" ? ev.data.slice(0, 1000) : "[binary]";
        send("WS_MESSAGE", { url, data: preview });
      });

      ws.addEventListener("close", (ev) => {
        send("WS_CLOSE", { url, code: ev.code, reason: ev.reason });
      });

      ws.addEventListener("error", () => {
        send("WS_ERROR", { url });
      });

      return ws;
    };
    window.WebSocket.prototype = NativeWS.prototype;
  }

  // ==========================
  //  RTCPeerConnection
  // ==========================
  const NativePC = window.RTCPeerConnection;
  if (NativePC) {
    window.RTCPeerConnection = function (config) {
      const pc = new NativePC(config);
      const id = Math.random().toString(36).slice(2);

      send("RTC_CREATE", { id, config });

      const origCreateOffer = pc.createOffer.bind(pc);
      pc.createOffer = async function (...args) {
        const offer = await origCreateOffer(...args);
        send("RTC_OFFER", { id, sdp: offer.sdp });
        return offer;
      };

      const origCreateAnswer = pc.createAnswer.bind(pc);
      pc.createAnswer = async function (...args) {
        const answer = await origCreateAnswer(...args);
        send("RTC_ANSWER", { id, sdp: answer.sdp });
        return answer;
      };

      const origSetLocal = pc.setLocalDescription.bind(pc);
      pc.setLocalDescription = async function (desc) {
        send("RTC_SET_LOCAL", { id, type: desc?.type, sdp: desc?.sdp });
        return origSetLocal(desc);
      };

      const origSetRemote = pc.setRemoteDescription.bind(pc);
      pc.setRemoteDescription = async function (desc) {
        send("RTC_SET_REMOTE", { id, type: desc?.type, sdp: desc?.sdp });
        return origSetRemote(desc);
      };

      pc.addEventListener("icecandidate", (e) => {
        if (e.candidate) {
          send("RTC_ICE", { id, candidate: e.candidate.candidate });
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        send("RTC_STATE", { id, state: pc.connectionState });
      });

      // --- перехват getStats() ---
      const origGetStats = pc.getStats.bind(pc);
      pc.getStats = async function (...args) {
        const report = await origGetStats(...args);

        const stats = [];
        report.forEach((v) => {
          const entry = {
            id: v.id,
            type: v.type,
            timestamp: v.timestamp
          };

          if (v.type === "inbound-rtp" || v.type === "outbound-rtp") {
            entry.ssrc = v.ssrc;
            entry.kind = v.kind;
            entry.bytesSent = v.bytesSent;
            entry.bytesReceived = v.bytesReceived;
            entry.packetsSent = v.packetsSent;
            entry.packetsReceived = v.packetsReceived;
            entry.jitter = v.jitter;
            entry.roundTripTime = v.roundTripTime;
          } else if (v.type === "candidate-pair" && v.state === "succeeded") {
            entry.currentRoundTripTime = v.currentRoundTripTime;
            entry.availableOutgoingBitrate = v.availableOutgoingBitrate;
            entry.availableIncomingBitrate = v.availableIncomingBitrate;
          }

          stats.push(entry);
        });

        send("RTC_STATS", { id, stats });
        return report;
      };

      return pc;
    };
    window.RTCPeerConnection.prototype = NativePC.prototype;
  }
})();

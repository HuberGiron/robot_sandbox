(() => {
  "use strict";

  const WORLD = {
    xMin: -500,
    xMax: 500,
    yMin: -300,
    yMax: 300
  };

  const ROBOT_COLORS = ["#8b1e3f", "#176b45", "#2559a6", "#c06a00"];
  const DEFAULT_TOPICS = [
    "public/robot-sandbox/robot1/goal",
    "public/robot-sandbox/robot2/goal",
    "public/robot-sandbox/robot3/goal",
    "public/robot-sandbox/robot4/goal"
  ];

  const DEFAULT_POSES = [
    { x: -320, y:  160, thetaDeg:   0 },
    { x: -320, y: -160, thetaDeg:   0 },
    { x:  320, y:  160, thetaDeg: 180 },
    { x:  320, y: -160, thetaDeg: 180 }
  ];

  const robots = DEFAULT_POSES.map((p, i) => new UnicycleRobot({
    id: i + 1,
    ...p,
    color: ROBOT_COLORS[i],
    lookahead: 50,
    gain: 0.9,
    dt: 0.02
  }));

  const state = {
    robotCount: 4,
    mqttClient: null,
    connected: false,
    subscriptions: new Set(),
    topics: [...DEFAULT_TOPICS],
    lastFrame: performance.now(),
    accumulator: 0,
    fixedDt: 0.02,
    selectedRobot: 0
  };

  const el = (id) => document.getElementById(id);
  const canvas = el("sandboxCanvas");
  const ctx = canvas.getContext("2d");

  const brokerUrl = el("brokerUrl");
  const mqttUser = el("mqttUser");
  const mqttPassword = el("mqttPassword");
  const connectBtn = el("connectBtn");
  const disconnectBtn = el("disconnectBtn");
  const mqttBadge = el("mqttBadge");
  const robotCount = el("robotCount");
  const robotCards = el("robotCards");
  const statusGrid = el("statusGrid");
  const legend = el("legend");
  const mqttLog = el("mqttLog");

  function log(message) {
    const ts = new Date().toLocaleTimeString("es-MX", { hour12: false });
    mqttLog.textContent += `[${ts}] ${message}\n`;
    const lines = mqttLog.textContent.split("\n");
    if (lines.length > 180) {
      mqttLog.textContent = lines.slice(-160).join("\n");
    }
    mqttLog.scrollTop = mqttLog.scrollHeight;
  }

  function setMqttStatus(kind, text) {
    mqttBadge.className = `status-badge ${kind}`;
    mqttBadge.textContent = text;
    connectBtn.disabled = kind === "online" || kind === "connecting";
    disconnectBtn.disabled = kind !== "online" && kind !== "connecting";
  }

  function clampGoal(x, y) {
    return {
      x: Math.max(WORLD.xMin, Math.min(WORLD.xMax, x)),
      y: Math.max(WORLD.yMin, Math.min(WORLD.yMax, y))
    };
  }

  function parseGoalPayload(raw) {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }

    let source = obj;
    if (obj && typeof obj.goal === "object") source = obj.goal;

    const x = Number(source?.x);
    const y = Number(source?.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return clampGoal(x, y);
  }

  function buildRobotUI() {
    robotCards.innerHTML = "";
    statusGrid.innerHTML = "";
    legend.innerHTML = "";

    robots.forEach((robot, i) => {
      const card = document.createElement("div");
      card.className = `robot-card ${i >= state.robotCount ? "inactive" : ""}`;
      card.dataset.robot = String(i);

      card.innerHTML = `
        <div class="robot-card-head">
          <div class="robot-name">
            <span class="robot-dot" style="background:${robot.color}"></span>
            Robot ${i + 1}
          </div>
          <div class="robot-meta" id="robotMeta${i}">esperando objetivo</div>
        </div>
        <label class="field">
          <span>Tópico de objetivo</span>
          <div class="topic-row">
            <input
              id="topic${i}"
              class="topic-input"
              data-index="${i}"
              type="text"
              value="${escapeHtml(state.topics[i])}"
              spellcheck="false">
            <button type="button" class="copy-topic" data-index="${i}" title="Copiar tópico">Copiar</button>
          </div>
        </label>
      `;
      robotCards.appendChild(card);

      const status = document.createElement("div");
      status.className = `status-card ${i >= state.robotCount ? "inactive" : ""}`;
      status.dataset.robot = String(i);
      status.innerHTML = `
        <strong><span class="robot-dot" style="background:${robot.color}; margin-right:6px"></span>Robot ${i + 1}</strong>
        <div class="status-row"><span>Pose</span><code id="pose${i}">—</code></div>
        <div class="status-row"><span>Objetivo</span><code id="goal${i}">—</code></div>
        <div class="status-row"><span>Control</span><code id="control${i}">—</code></div>
      `;
      statusGrid.appendChild(status);

      const legendItem = document.createElement("div");
      legendItem.className = "legend-item";
      legendItem.dataset.robot = String(i);
      legendItem.innerHTML = `
        <span class="robot-dot" style="background:${robot.color}"></span>
        R${i + 1}
      `;
      if (i >= state.robotCount) legendItem.style.display = "none";
      legend.appendChild(legendItem);
    });

    document.querySelectorAll(".topic-input").forEach(input => {
      input.addEventListener("change", async (event) => {
        const i = Number(event.currentTarget.dataset.index);
        const next = event.currentTarget.value.trim();
        if (!next) {
          event.currentTarget.value = state.topics[i];
          return;
        }
        const old = state.topics[i];
        state.topics[i] = next;
        if (state.connected) {
          await resubscribeTopic(old, next);
        }
      });
    });

    document.querySelectorAll(".copy-topic").forEach(button => {
      button.addEventListener("click", async () => {
        const i = Number(button.dataset.index);
        try {
          await navigator.clipboard.writeText(state.topics[i]);
          button.textContent = "Copiado";
          setTimeout(() => (button.textContent = "Copiar"), 900);
        } catch {
          log(`No se pudo copiar el tópico de R${i + 1}.`);
        }
      });
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function subscribeActiveTopics() {
    if (!state.mqttClient || !state.connected) return;

    for (let i = 0; i < state.robotCount; i++) {
      const topic = state.topics[i];
      await new Promise(resolve => {
        state.mqttClient.subscribe(topic, { qos: 0 }, err => {
          if (err) {
            log(`SUB error R${i + 1}: ${err.message}`);
          } else {
            state.subscriptions.add(topic);
            log(`SUB R${i + 1}: ${topic}`);
          }
          resolve();
        });
      });
    }
  }

  async function unsubscribeInactiveTopics() {
    if (!state.mqttClient || !state.connected) return;

    const active = new Set(state.topics.slice(0, state.robotCount));
    const stale = [...state.subscriptions].filter(topic => !active.has(topic));

    for (const topic of stale) {
      await new Promise(resolve => {
        state.mqttClient.unsubscribe(topic, err => {
          if (!err) {
            state.subscriptions.delete(topic);
            log(`UNSUB: ${topic}`);
          }
          resolve();
        });
      });
    }
  }

  async function resubscribeTopic(oldTopic, newTopic) {
    if (!state.mqttClient || !state.connected) return;

    if (oldTopic && state.subscriptions.has(oldTopic)) {
      await new Promise(resolve => {
        state.mqttClient.unsubscribe(oldTopic, () => {
          state.subscriptions.delete(oldTopic);
          resolve();
        });
      });
    }

    await new Promise(resolve => {
      state.mqttClient.subscribe(newTopic, { qos: 0 }, err => {
        if (err) {
          log(`SUB error: ${newTopic} · ${err.message}`);
        } else {
          state.subscriptions.add(newTopic);
          log(`SUB actualizado: ${newTopic}`);
        }
        resolve();
      });
    });
  }

  function connectMqtt() {
    if (state.mqttClient) {
      try { state.mqttClient.end(true); } catch {}
      state.mqttClient = null;
    }

    const url = brokerUrl.value.trim();
    if (!url) return;

    const options = {
      clientId: `robot-sandbox-${Math.random().toString(16).slice(2)}`,
      clean: true,
      reconnectPeriod: 1800,
      connectTimeout: 8000,
      keepalive: 30
    };

    const user = mqttUser.value.trim();
    const pass = mqttPassword.value;
    if (user) options.username = user;
    if (pass) options.password = pass;

    setMqttStatus("connecting", "Conectando MQTT…");
    log(`Conectando a ${url}`);

    try {
      state.mqttClient = mqtt.connect(url, options);
    } catch (err) {
      state.mqttClient = null;
      setMqttStatus("offline", "MQTT desconectado");
      log(`ERROR: ${err.message || err}`);
      return;
    }

    const client = state.mqttClient;

    client.on("connect", async () => {
      state.connected = true;
      state.subscriptions.clear();
      setMqttStatus("online", "MQTT conectado");
      log(`CONNECT · clientId=${options.clientId}`);
      await subscribeActiveTopics();
    });

    client.on("message", (topic, payloadBuffer) => {
      const raw = payloadBuffer.toString();
      const indexes = state.topics
        .map((t, i) => ({ topic: t, index: i }))
        .filter(item => item.index < state.robotCount && item.topic === topic)
        .map(item => item.index);

      if (indexes.length === 0) {
        log(`RX sin robot asignado · ${topic}`);
        return;
      }

      const goal = parseGoalPayload(raw);
      if (!goal) {
        log(`RX inválido · ${topic} · ${raw}`);
        return;
      }

      indexes.forEach(index => {
        robots[index].setGoal(goal.x, goal.y, raw);
      });

      const targets = indexes.map(index => `R${index + 1}`).join(", ");
      log(`RX ${targets} → (${goal.x.toFixed(1)}, ${goal.y.toFixed(1)})`);
    });

    client.on("reconnect", () => {
      state.connected = false;
      setMqttStatus("connecting", "Reconectando MQTT…");
    });

    client.on("offline", () => {
      state.connected = false;
      setMqttStatus("offline", "MQTT offline");
    });

    client.on("close", () => {
      state.connected = false;
      state.subscriptions.clear();
      setMqttStatus("offline", "MQTT desconectado");
    });

    client.on("error", err => {
      log(`MQTT error: ${err.message || err}`);
    });
  }

  function disconnectMqtt() {
    if (!state.mqttClient) return;

    log("Desconectando MQTT.");
    try {
      state.mqttClient.end(true);
    } catch {}

    state.mqttClient = null;
    state.connected = false;
    state.subscriptions.clear();
    setMqttStatus("offline", "MQTT desconectado");
  }

  function updateActiveRobotUI() {
    document.querySelectorAll("[data-robot]").forEach(node => {
      const i = Number(node.dataset.robot);
      const active = i < state.robotCount;

      if (node.classList.contains("robot-card") || node.classList.contains("status-card")) {
        node.classList.toggle("inactive", !active);
      } else if (node.classList.contains("legend-item")) {
        node.style.display = active ? "" : "none";
      }
    });
  }

  function resetRobots() {
    robots.forEach(r => r.resetPose());
  }

  function clearTrails() {
    robots.forEach(r => r.clearTrajectory());
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(240, Math.round(rect.height));

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas._cssWidth = width;
    canvas._cssHeight = height;
  }

  function worldToCanvas(x, y) {
    const w = canvas._cssWidth || canvas.clientWidth;
    const h = canvas._cssHeight || canvas.clientHeight;

    return {
      x: (x - WORLD.xMin) / (WORLD.xMax - WORLD.xMin) * w,
      y: h - (y - WORLD.yMin) / (WORLD.yMax - WORLD.yMin) * h
    };
  }

  function drawGrid() {
    const w = canvas._cssWidth || canvas.clientWidth;
    const h = canvas._cssHeight || canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e8ecef";
    ctx.fillStyle = "#7b8792";
    ctx.font = "10px system-ui";

    for (let x = WORLD.xMin; x <= WORLD.xMax; x += 100) {
      const p1 = worldToCanvas(x, WORLD.yMin);
      const p2 = worldToCanvas(x, WORLD.yMax);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      if (x !== WORLD.xMax) {
        ctx.fillText(String(x), p1.x + 3, h - 7);
      }
    }

    for (let y = WORLD.yMin; y <= WORLD.yMax; y += 100) {
      const p1 = worldToCanvas(WORLD.xMin, y);
      const p2 = worldToCanvas(WORLD.xMax, y);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      if (y !== WORLD.yMin) {
        ctx.fillText(String(y), 5, p1.y - 4);
      }
    }

    // Ejes
    ctx.strokeStyle = "#b4bdc6";
    ctx.lineWidth = 1.5;

    const xAxisA = worldToCanvas(WORLD.xMin, 0);
    const xAxisB = worldToCanvas(WORLD.xMax, 0);
    ctx.beginPath();
    ctx.moveTo(xAxisA.x, xAxisA.y);
    ctx.lineTo(xAxisB.x, xAxisB.y);
    ctx.stroke();

    const yAxisA = worldToCanvas(0, WORLD.yMin);
    const yAxisB = worldToCanvas(0, WORLD.yMax);
    ctx.beginPath();
    ctx.moveTo(yAxisA.x, yAxisA.y);
    ctx.lineTo(yAxisB.x, yAxisB.y);
    ctx.stroke();
  }

  function drawTrajectory(robot) {
    if (robot.trajectory.length < 2) return;

    ctx.strokeStyle = robot.color;
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = 2;
    ctx.beginPath();

    robot.trajectory.forEach((point, i) => {
      const p = worldToCanvas(point.x, point.y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });

    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawGoal(robot, index) {
    const p = worldToCanvas(robot.goal.x, robot.goal.y);
    const s = 8;

    ctx.strokeStyle = robot.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - s, p.y);
    ctx.lineTo(p.x + s, p.y);
    ctx.moveTo(p.x, p.y - s);
    ctx.lineTo(p.x, p.y + s);
    ctx.stroke();

    ctx.fillStyle = robot.color;
    ctx.font = "700 11px system-ui";
    ctx.fillText(`G${index + 1}`, p.x + 10, p.y - 8);
  }

  function drawRobot(robot, index) {
    const center = worldToCanvas(robot.x, robot.y);
    const cpWorld = robot.getControlPoint();
    const cp = worldToCanvas(cpWorld.x, cpWorld.y);

    // Línea al punto de control.
    ctx.strokeStyle = robot.color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(cp.x, cp.y);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(-robot.theta);

    ctx.fillStyle = robot.color;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-10, -9);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-10, 9);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 9px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), center.x - 1, center.y);

    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = robot.color;
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function updateStatusCards() {
    for (let i = 0; i < state.robotCount; i++) {
      const r = robots[i].getState();
      el(`pose${i}`).textContent =
        `(${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.thetaDeg.toFixed(1)}°)`;
      el(`goal${i}`).textContent =
        `(${r.goal.x.toFixed(1)}, ${r.goal.y.toFixed(1)})`;
      el(`control${i}`).textContent =
        `v=${r.v.toFixed(1)} · ω=${r.w.toFixed(2)}`;

      const meta = el(`robotMeta${i}`);
      if (!robots[i].lastCommandAt) {
        meta.textContent = "esperando objetivo";
      } else {
        const elapsed = (Date.now() - robots[i].lastCommandAt) / 1000;
        meta.textContent = `último MQTT hace ${elapsed.toFixed(1)} s`;
      }
    }
  }

  function render() {
    drawGrid();

    for (let i = 0; i < state.robotCount; i++) {
      drawTrajectory(robots[i]);
    }

    for (let i = 0; i < state.robotCount; i++) {
      drawGoal(robots[i], i);
      drawRobot(robots[i], i);
    }

    updateStatusCards();
  }

  function simulationLoop(now) {
    let frameDt = (now - state.lastFrame) / 1000;
    state.lastFrame = now;

    frameDt = Math.min(frameDt, 0.1);
    state.accumulator += frameDt;

    let guard = 0;
    while (state.accumulator >= state.fixedDt && guard < 8) {
      for (let i = 0; i < state.robotCount; i++) {
        robots[i].step(state.fixedDt);
      }
      state.accumulator -= state.fixedDt;
      guard++;
    }

    render();
    requestAnimationFrame(simulationLoop);
  }

  connectBtn.addEventListener("click", connectMqtt);
  disconnectBtn.addEventListener("click", disconnectMqtt);

  robotCount.addEventListener("change", async () => {
    state.robotCount = Number(robotCount.value);
    updateActiveRobotUI();

    if (state.connected) {
      await unsubscribeInactiveTopics();
      await subscribeActiveTopics();
    }
  });

  el("resetBtn").addEventListener("click", resetRobots);
  el("clearTrailsBtn").addEventListener("click", clearTrails);

  window.addEventListener("resize", () => {
    resizeCanvas();
    render();
  });

  buildRobotUI();
  updateActiveRobotUI();
  setMqttStatus("offline", "MQTT desconectado");
  resizeCanvas();
  resetRobots();
  log("Sandbox listo. Conecta MQTT para comenzar.");
  requestAnimationFrame(simulationLoop);
})();

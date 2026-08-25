(() => {
  'use strict';

  const WORLD = { xMin: -500, xMax: 500, yMin: -300, yMax: 300 };
  const ROBOT_COLORS = ['#8b1e3f', '#176b45', '#2559a6', '#c06a00'];
  const DEFAULT_TOPICS = [
    'public/robot-sandbox/robot1/goal',
    'public/robot-sandbox/robot2/goal',
    'public/robot-sandbox/robot3/goal',
    'public/robot-sandbox/robot4/goal'
  ];
  const DEFAULT_POSES = [
    { startX: -300, startY: 150, thetaDeg: 0 },
    { startX: -300, startY: -150, thetaDeg: 0 },
    { startX: 300, startY: 150, thetaDeg: 180 },
    { startX: 300, startY: -150, thetaDeg: 180 }
  ];

  const robots = DEFAULT_POSES.map((p, i) => new UnicycleRobot({
    id: i + 1,
    ...p,
    color: ROBOT_COLORS[i],
    l: 50,
    k: 0.5,
    dt: 0.05
  }));

  const state = {
    enabled: [true, false, false, false],
    topics: [...DEFAULT_TOPICS],
    mqttClient: null,
    connected: false,
    subscriptions: new Set(),
    lastFrame: performance.now(),
    accumulator: 0,
    fixedDt: 0.05,
    simTime: 0,
    lastChartUpdate: 0
  };

  const el = id => document.getElementById(id);
  const canvas = el('sandboxCanvas');
  const ctx = canvas.getContext('2d');
  const brokerUrl = el('brokerUrl');
  const mqttUser = el('mqttUser');
  const mqttPassword = el('mqttPassword');
  const connectBtn = el('connectBtn');
  const disconnectBtn = el('disconnectBtn');
  const mqttBadge = el('mqttBadge');
  const robotCards = el('robotCards');
  const statusGrid = el('statusGrid');
  const legend = el('legend');
  const mqttLog = el('mqttLog');

  const robotImg = new Image();
  robotImg.src = 'robot.png';
  let robotImageOk = false;
  robotImg.onload = () => { robotImageOk = true; render(); };
  robotImg.onerror = () => {
    robotImageOk = false;
    log('Falta robot.png en la raíz del repositorio; usando marcador temporal.');
  };

  function log(message) {
    const ts = new Date().toLocaleTimeString('es-MX', { hour12: false });
    mqttLog.textContent += `[${ts}] ${message}\n`;
    const lines = mqttLog.textContent.split('\n');
    if (lines.length > 180) mqttLog.textContent = lines.slice(-160).join('\n');
    mqttLog.scrollTop = mqttLog.scrollHeight;
  }

  function setMqttStatus(kind, text) {
    mqttBadge.className = `status-badge ${kind}`;
    mqttBadge.textContent = text;
    connectBtn.disabled = kind === 'online' || kind === 'connecting';
    disconnectBtn.disabled = kind !== 'online' && kind !== 'connecting';
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function buildRobotUI() {
    robotCards.innerHTML = '';
    statusGrid.innerHTML = '';
    legend.innerHTML = '';

    robots.forEach((robot, i) => {
      const card = document.createElement('div');
      card.className = 'robot-card';
      card.dataset.robot = String(i);
      card.innerHTML = `
        <div class="robot-card-head">
          <label class="robot-enable">
            <input type="checkbox" class="enable-robot" data-index="${i}" ${state.enabled[i] ? 'checked' : ''}>
            <span class="robot-dot" style="background:${robot.color}"></span>
            <strong>Robot ${i + 1}</strong>
          </label>
          <span class="robot-meta" id="robotMeta${i}">${state.enabled[i] ? 'habilitado' : 'deshabilitado'}</span>
        </div>
        <label class="field">
          <span>Tópico de objetivo</span>
          <div class="topic-row">
            <input id="topic${i}" class="topic-input" data-index="${i}" type="text" value="${escapeHtml(state.topics[i])}" spellcheck="false" ${state.enabled[i] ? '' : 'disabled'}>
            <button type="button" class="copy-topic" data-index="${i}">Copiar</button>
          </div>
        </label>
      `;
      robotCards.appendChild(card);

      const status = document.createElement('div');
      status.className = `status-card ${state.enabled[i] ? '' : 'inactive'}`;
      status.dataset.robot = String(i);
      status.innerHTML = `
        <strong><span class="robot-dot" style="background:${robot.color}; margin-right:6px"></span>Robot ${i + 1}</strong>
        <div class="status-row"><span>Pose</span><code id="pose${i}">—</code></div>
        <div class="status-row"><span>Objetivo</span><code id="goal${i}">—</code></div>
        <div class="status-row"><span>Control</span><code id="control${i}">—</code></div>
      `;
      statusGrid.appendChild(status);

      const legendItem = document.createElement('div');
      legendItem.className = 'legend-item';
      legendItem.dataset.robot = String(i);
      legendItem.style.display = state.enabled[i] ? '' : 'none';
      legendItem.innerHTML = `<span class="robot-dot" style="background:${robot.color}"></span>R${i + 1}`;
      legend.appendChild(legendItem);
    });

    document.querySelectorAll('.enable-robot').forEach(box => {
      box.addEventListener('change', async e => {
        const i = Number(e.currentTarget.dataset.index);
        const next = e.currentTarget.checked;
        const activeCount = state.enabled.filter(Boolean).length;

        if (!next && activeCount === 1) {
          e.currentTarget.checked = true;
          log('Debe permanecer al menos un robot habilitado.');
          return;
        }

        state.enabled[i] = next;
        if (next) {
          robots[i].resetPose();
          clearRobotChartData(i);
        }
        refreshRobotUI();
        await syncSubscriptions();
      });
    });

    document.querySelectorAll('.topic-input').forEach(input => {
      input.addEventListener('change', async e => {
        const i = Number(e.currentTarget.dataset.index);
        const next = e.currentTarget.value.trim();
        if (!next) {
          e.currentTarget.value = state.topics[i];
          return;
        }
        state.topics[i] = next;
        await syncSubscriptions();
      });
    });

    document.querySelectorAll('.copy-topic').forEach(button => {
      button.addEventListener('click', async () => {
        const i = Number(button.dataset.index);
        try {
          await navigator.clipboard.writeText(state.topics[i]);
          button.textContent = 'Copiado';
          setTimeout(() => button.textContent = 'Copiar', 900);
        } catch {
          log(`No se pudo copiar el tópico de R${i + 1}.`);
        }
      });
    });
  }

  function refreshRobotUI() {
    robots.forEach((robot, i) => {
      const input = el(`topic${i}`);
      if (input) input.disabled = !state.enabled[i];
      const meta = el(`robotMeta${i}`);
      if (meta) meta.textContent = state.enabled[i] ? 'habilitado' : 'deshabilitado';

      document.querySelectorAll(`.status-card[data-robot="${i}"]`).forEach(node => node.classList.toggle('inactive', !state.enabled[i]));
      document.querySelectorAll(`.legend-item[data-robot="${i}"]`).forEach(node => node.style.display = state.enabled[i] ? '' : 'none');
    });
    setChartRobotVisibility(state.enabled);
  }

  function activeTopics() {
    return [...new Set(state.topics.filter((_, i) => state.enabled[i]))];
  }

  async function syncSubscriptions() {
    if (!state.mqttClient || !state.connected) return;
    const wanted = new Set(activeTopics());

    for (const topic of [...state.subscriptions]) {
      if (!wanted.has(topic)) {
        await new Promise(resolve => state.mqttClient.unsubscribe(topic, () => resolve()));
        state.subscriptions.delete(topic);
        log(`UNSUB ${topic}`);
      }
    }

    for (const topic of wanted) {
      if (state.subscriptions.has(topic)) continue;
      await new Promise(resolve => {
        state.mqttClient.subscribe(topic, { qos: 0 }, err => {
          if (err) log(`SUB error ${topic}: ${err.message}`);
          else {
            state.subscriptions.add(topic);
            log(`SUB ${topic}`);
          }
          resolve();
        });
      });
    }
  }

  function parseGoalPayload(raw) {
    try {
      const obj = JSON.parse(raw);
      const source = obj && typeof obj.goal === 'object' ? obj.goal : obj;
      const x = Number(source?.x);
      const y = Number(source?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        x: Math.max(WORLD.xMin, Math.min(WORLD.xMax, x)),
        y: Math.max(WORLD.yMin, Math.min(WORLD.yMax, y))
      };
    } catch {
      return null;
    }
  }

  function connectMqtt() {
    const url = brokerUrl.value.trim();
    if (!url) return;

    if (state.mqttClient) {
      try { state.mqttClient.end(true); } catch {}
      state.mqttClient = null;
    }

    const options = {
      clientId: `robot-sandbox-${Math.random().toString(16).slice(2)}`,
      clean: true,
      reconnectPeriod: 1500,
      connectTimeout: 8000,
      keepalive: 30
    };
    if (mqttUser.value.trim()) options.username = mqttUser.value.trim();
    if (mqttPassword.value) options.password = mqttPassword.value;

    setMqttStatus('connecting', 'Conectando MQTT…');
    log(`Conectando a ${url}`);

    state.mqttClient = mqtt.connect(url, options);
    const client = state.mqttClient;

    client.on('connect', async () => {
      state.connected = true;
      state.subscriptions.clear();
      setMqttStatus('online', 'MQTT conectado');
      log(`CONNECT · ${options.clientId}`);
      await syncSubscriptions();
    });

    client.on('message', (topic, payloadBuffer) => {
      const raw = payloadBuffer.toString();
      const goal = parseGoalPayload(raw);
      if (!goal) {
        log(`RX inválido · ${topic} · ${raw}`);
        return;
      }

      const indexes = state.topics
        .map((t, i) => ({ t, i }))
        .filter(item => state.enabled[item.i] && item.t === topic)
        .map(item => item.i);

      indexes.forEach(i => robots[i].setGoal(goal.x, goal.y, raw));
      if (indexes.length) log(`RX ${indexes.map(i => `R${i + 1}`).join(', ')} → (${goal.x.toFixed(1)}, ${goal.y.toFixed(1)})`);
    });

    client.on('reconnect', () => setMqttStatus('connecting', 'Reconectando MQTT…'));
    client.on('offline', () => setMqttStatus('offline', 'MQTT offline'));
    client.on('close', () => {
      state.connected = false;
      state.subscriptions.clear();
      setMqttStatus('offline', 'MQTT desconectado');
    });
    client.on('error', err => log(`MQTT error: ${err.message || err}`));
  }

  function disconnectMqtt() {
    if (!state.mqttClient) return;
    try { state.mqttClient.end(true); } catch {}
    state.mqttClient = null;
    state.connected = false;
    state.subscriptions.clear();
    setMqttStatus('offline', 'MQTT desconectado');
    log('MQTT desconectado.');
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

  function worldScale() {
    return (canvas._cssWidth || canvas.clientWidth) / (WORLD.xMax - WORLD.xMin);
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
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#555';
    ctx.font = '11px Arial';

    for (let x = WORLD.xMin; x <= WORLD.xMax; x += 100) {
      const a = worldToCanvas(x, WORLD.yMin);
      const b = worldToCanvas(x, WORLD.yMax);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (x < WORLD.xMax) ctx.fillText(String(x), a.x + 4, h - 8);
    }
    for (let y = WORLD.yMin; y <= WORLD.yMax; y += 100) {
      const a = worldToCanvas(WORLD.xMin, y);
      const b = worldToCanvas(WORLD.xMax, y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (y > WORLD.yMin) ctx.fillText(String(y), 5, a.y - 4);
    }

    ctx.strokeStyle = '#777';
    ctx.beginPath();
    let a = worldToCanvas(WORLD.xMin, 0), b = worldToCanvas(WORLD.xMax, 0);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    a = worldToCanvas(0, WORLD.yMin); b = worldToCanvas(0, WORLD.yMax);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  function drawTrajectory(robot) {
    const traj = robot.getTrajectory();
    if (traj.length < 2) return;
    ctx.save();
    ctx.strokeStyle = robot.color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 3;
    ctx.beginPath();
    traj.forEach((p, idx) => {
      const q = worldToCanvas(p.x, p.y);
      if (idx === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawGoal(robot, i) {
    const p = worldToCanvas(robot.goal.x, robot.goal.y);
    ctx.save();
    ctx.strokeStyle = robot.color;
    ctx.fillStyle = robot.color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '700 11px Arial';
    ctx.fillText(`G${i + 1}`, p.x + 9, p.y - 7);
    ctx.restore();
  }

  function drawRobot(robot, i) {
    const pos = worldToCanvas(robot.x, robot.y);
    const scale = worldScale();
    const robotWidthMm = 220;
    const robotWidthPx = robotWidthMm * scale;
    const robotHeightPx = robotImageOk ? robotImg.height * robotWidthPx / robotImg.width : 70 * scale;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(-robot.theta);

    if (robotImageOk) {
      const xOffsetMm = robot.l - robotWidthMm + 30;
      ctx.drawImage(robotImg, xOffsetMm * scale, -robotHeightPx / 2, robotWidthPx, robotHeightPx);
    } else {
      ctx.fillStyle = robot.color;
      ctx.beginPath();
      ctx.moveTo(18, 0); ctx.lineTo(-12, -10); ctx.lineTo(-12, 10); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    const cp = worldToCanvas(...Object.values(robot.getExtensionPoint()));
    ctx.fillStyle = robot.color;
    ctx.beginPath(); ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = robot.color;
    ctx.font = '800 12px Arial';
    ctx.fillText(`R${i + 1}`, pos.x + 10, pos.y - 10);
  }

  function render() {
    drawGrid();
    robots.forEach((r, i) => { if (state.enabled[i]) drawTrajectory(r); });
    robots.forEach((r, i) => {
      if (!state.enabled[i]) return;
      drawGoal(r, i);
      drawRobot(r, i);
    });
    updateStatusCards();
  }

  function updateStatusCards() {
    robots.forEach((robot, i) => {
      if (!state.enabled[i]) return;
      const s = robot.getState();
      el(`pose${i}`).textContent = `(${s.controlPoint.x.toFixed(1)}, ${s.controlPoint.y.toFixed(1)}, ${s.thetaDeg.toFixed(1)}°)`;
      el(`goal${i}`).textContent = `(${s.goal.x.toFixed(1)}, ${s.goal.y.toFixed(1)})`;
      el(`control${i}`).textContent = `V=${s.v.toFixed(1)} · W=${s.w.toFixed(3)}`;

      const meta = el(`robotMeta${i}`);
      if (meta) {
        if (!robot.lastCommandAt) meta.textContent = 'habilitado · esperando MQTT';
        else meta.textContent = `habilitado · ${((Date.now() - robot.lastCommandAt) / 1000).toFixed(1)} s`;
      }
    });
  }

  function simulationLoop(now) {
    let frameDt = Math.min((now - state.lastFrame) / 1000, 0.15);
    state.lastFrame = now;
    state.accumulator += frameDt;

    let steps = 0;
    while (state.accumulator >= state.fixedDt && steps < 6) {
      state.simTime += state.fixedDt;
      robots.forEach((robot, i) => {
        if (!state.enabled[i]) return;
        const sample = robot.step();
        appendRobotChartPoint(i, state.simTime, sample);
      });
      state.accumulator -= state.fixedDt;
      steps++;
    }

    if (now - state.lastChartUpdate > 120) {
      updateAllCharts();
      state.lastChartUpdate = now;
    }

    render();
    requestAnimationFrame(simulationLoop);
  }

  connectBtn.addEventListener('click', connectMqtt);
  disconnectBtn.addEventListener('click', disconnectMqtt);
  el('resetBtn').addEventListener('click', () => {
    robots.forEach((r, i) => { if (state.enabled[i]) r.resetPose(); });
    state.simTime = 0;
    clearAllChartData();
  });
  el('clearTrailsBtn').addEventListener('click', () => robots.forEach((r, i) => { if (state.enabled[i]) r.clearTrajectory(); }));
  el('clearChartsBtn').addEventListener('click', () => {
    state.simTime = 0;
    clearAllChartData();
  });

  window.addEventListener('resize', () => { resizeCanvas(); render(); });

  buildRobotUI();
  initCharts(ROBOT_COLORS);
  refreshRobotUI();
  setMqttStatus('offline', 'MQTT desconectado');
  resizeCanvas();
  render();
  log('Sandbox listo. R1 habilitado por defecto.');
  requestAnimationFrame(simulationLoop);
})();

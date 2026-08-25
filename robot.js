class UnicycleRobot {
  constructor({
    id,
    x = 0,
    y = 0,
    thetaDeg = 0,
    color = "#333333",
    lookahead = 50,
    gain = 0.9,
    dt = 0.02
  }) {
    this.id = id;
    this.color = color;

    this.defaultPose = { x, y, thetaDeg };
    this.x = x;
    this.y = y;
    this.theta = thetaDeg * Math.PI / 180;

    this.lookahead = lookahead;
    this.gain = gain;
    this.dt = dt;

    this.goal = { x, y };
    this.lastCommandAt = null;
    this.lastPayload = null;

    this.v = 0;
    this.w = 0;
    this.error = 0;

    this.trajectory = [];
    this.maxTrajectoryPoints = 2500;
    this.resetPose();
  }

  resetPose() {
    const p = this.defaultPose;
    this.x = p.x;
    this.y = p.y;
    this.theta = p.thetaDeg * Math.PI / 180;
    this.goal = { x: p.x, y: p.y };
    this.v = 0;
    this.w = 0;
    this.error = 0;
    this.clearTrajectory();
  }

  setDefaultPose(x, y, thetaDeg) {
    this.defaultPose = { x, y, thetaDeg };
  }

  clearTrajectory() {
    const p = this.getControlPoint();
    this.trajectory = [{ x: p.x, y: p.y }];
  }

  setGoal(x, y, payload = null) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    this.goal.x = x;
    this.goal.y = y;
    this.lastCommandAt = Date.now();
    this.lastPayload = payload;
    return true;
  }

  getControlPoint() {
    return {
      x: this.x + this.lookahead * Math.cos(this.theta),
      y: this.y + this.lookahead * Math.sin(this.theta)
    };
  }

  step(dt = this.dt) {
    const cp = this.getControlPoint();

    const ex = this.goal.x - cp.x;
    const ey = this.goal.y - cp.y;
    this.error = Math.hypot(ex, ey);

    // Control cartesiano proporcional sobre el punto de extensión.
    const ux = this.gain * ex;
    const uy = this.gain * ey;

    // Inversa analítica:
    // [ux] = [cos(theta), -l sin(theta)] [v]
    // [uy]   [sin(theta),  l cos(theta)] [w]
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    const l = this.lookahead;

    let v = c * ux + s * uy;
    let w = (-s * ux + c * uy) / l;

    // Límites numéricos para mantener una simulación estable y legible.
    const maxV = 260;      // mm/s
    const maxW = 3.2;      // rad/s
    v = Math.max(-maxV, Math.min(maxV, v));
    w = Math.max(-maxW, Math.min(maxW, w));

    // Zona muerta pequeña cerca del objetivo.
    if (this.error < 2.0) {
      v = 0;
      w = 0;
    }

    this.v = v;
    this.w = w;

    // Modelo cinemático del uniciclo:
    // x_dot = v cos(theta)
    // y_dot = v sin(theta)
    // theta_dot = w
    this.x += v * Math.cos(this.theta) * dt;
    this.y += v * Math.sin(this.theta) * dt;
    this.theta += w * dt;

    // Normaliza theta a [-pi, pi].
    this.theta = Math.atan2(Math.sin(this.theta), Math.cos(this.theta));

    const p = this.getControlPoint();
    this.trajectory.push({ x: p.x, y: p.y });
    if (this.trajectory.length > this.maxTrajectoryPoints) {
      this.trajectory.splice(0, this.trajectory.length - this.maxTrajectoryPoints);
    }
  }

  getState() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      theta: this.theta,
      thetaDeg: this.theta * 180 / Math.PI,
      v: this.v,
      w: this.w,
      error: this.error,
      goal: { ...this.goal }
    };
  }
}

window.UnicycleRobot = UnicycleRobot;

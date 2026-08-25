class UnicycleRobot {
  constructor({ id, startX = 0, startY = 0, thetaDeg = 0, color = '#333333', l = 50, k = 0.5, dt = 0.05 }) {
    this.id = id;
    this.color = color;
    this.l = l;
    this.k = k;
    this.dt = dt;
    this.defaultPose = { startX, startY, thetaDeg };
    this.trajectory = [];
    this.maxTrajectoryPoints = 5000;
    this.lastCommandAt = null;
    this.lastPayload = null;
    this.goal = { x: startX, y: startY };
    this.v = 0;
    this.w = 0;
    this.ex = 0;
    this.ey = 0;
    this.resetPose();
  }

  setInitialConditionsFromExtension(xExt, yExt, thetaDeg) {
    this.theta = thetaDeg * Math.PI / 180;
    this.x = xExt - this.l * Math.cos(this.theta);
    this.y = yExt - this.l * Math.sin(this.theta);
    this.trajectory = [{ x: xExt, y: yExt }];
  }

  resetPose() {
    const p = this.defaultPose;
    this.setInitialConditionsFromExtension(p.startX, p.startY, p.thetaDeg);
    this.goal = { x: p.startX, y: p.startY };
    this.v = 0;
    this.w = 0;
    this.ex = 0;
    this.ey = 0;
    this.lastCommandAt = null;
    this.lastPayload = null;
  }

  clearTrajectory() {
    const ext = this.getExtensionPoint();
    this.trajectory = [{ x: ext.x, y: ext.y }];
  }

  setGoal(x, y, payload = null) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    this.goal = { x, y };
    this.lastCommandAt = Date.now();
    this.lastPayload = payload;
    return true;
  }

  calculateControl(xs, ys) {
    const xExt = this.x + this.l * Math.cos(this.theta);
    const yExt = this.y + this.l * Math.sin(this.theta);

    const ex = xExt - xs;
    const ey = yExt - ys;
    const ux = -this.k * ex;
    const uy = -this.k * ey;

    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);

    const V = c * ux + s * uy;
    const W = (-s * ux + c * uy) / this.l;

    this.theta += W * this.dt;
    this.x += V * Math.cos(this.theta) * this.dt;
    this.y += V * Math.sin(this.theta) * this.dt;

    this.v = V;
    this.w = W;
    this.ex = ex;
    this.ey = ey;

    const extNow = this.getExtensionPoint();
    this.trajectory.push({ x: extNow.x, y: extNow.y });
    if (this.trajectory.length > this.maxTrajectoryPoints + 500) {
      this.trajectory.splice(0, this.trajectory.length - this.maxTrajectoryPoints);
    }

    return { ex, ey, V, W, v: V, w: W, controlPoint: extNow };
  }

  step() {
    return this.calculateControl(this.goal.x, this.goal.y);
  }

  getCurrentPosition() {
    return { x: this.x, y: this.y };
  }

  getExtensionPoint() {
    return {
      x: this.x + this.l * Math.cos(this.theta),
      y: this.y + this.l * Math.sin(this.theta)
    };
  }

  getTrajectory() {
    return this.trajectory;
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
      ex: this.ex,
      ey: this.ey,
      goal: { ...this.goal },
      controlPoint: this.getExtensionPoint()
    };
  }
}

window.UnicycleRobot = UnicycleRobot;

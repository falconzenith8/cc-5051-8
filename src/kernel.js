// 维修跨越内核：连接图规划 + 动作执行 + 几何/接触验证 + 失败反馈
// 不依赖 DOM，浏览器与 Node 均可运行。

export const ACTION_INFO = {
  walk:     { label: '步行',     cap: null },
  climb:    { label: '攀梯',     cap: 'climb' },
  crawl:    { label: '钻管',     cap: 'crawl' },
  traction: { label: '牵引跨越', cap: 'traction' },
};

export const EPS = 1e-6;
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const platformAt = (level, id) => level.platforms.find(p => p.id === id);

// 连接在两个平台上的端点位置
export function connEnds(level, conn) {
  if (conn.type === 'climb') {
    const a = platformAt(level, conn.a);
    const b = platformAt(level, conn.b);
    return { [conn.a]: [conn.x, a.y], [conn.b]: [conn.x, b.y] };
  }
  return { [conn.a]: conn.entry, [conn.b]: conn.exit };
}

// 能力与空间前提检查，返回每一项依据（界面“允许进入的依据”也用它）
export function checkConnection(level, conn, robot) {
  const checks = [];
  const info = ACTION_INFO[conn.type];
  if (info.cap) {
    checks.push({ text: `能力「${info.label}」`, pass: !!robot.caps[info.cap] });
  }
  if (conn.type === 'climb') {
    checks.push({ text: `机宽 ${robot.width}m ≤ 梯面宽 ${conn.width}m`, pass: robot.width <= conn.width + EPS });
  }
  if (conn.type === 'crawl') {
    checks.push({ text: `机高 ${robot.height}m ≤ 管道净高 ${conn.clearance}m`, pass: robot.height <= conn.clearance + EPS });
  }
  if (conn.type === 'traction') {
    const ends = connEnds(level, conn);
    const dA = dist(conn.anchor, ends[conn.a]);
    const dB = dist(conn.anchor, ends[conn.b]);
    checks.push({ text: `锚点距 ${conn.a} 端 ${dA.toFixed(1)}m ≤ 索长 ${conn.cable}m`, pass: dA <= conn.cable + EPS });
    checks.push({ text: `锚点距 ${conn.b} 端 ${dB.toFixed(1)}m ≤ 索长 ${conn.cable}m`, pass: dB <= conn.cable + EPS });
  }
  const ends = connEnds(level, conn);
  for (const pid of [conn.a, conn.b]) {
    const p = platformAt(level, pid);
    const e = ends[pid];
    checks.push({
      text: `端点 (${e[0].toFixed(1)}, ${e[1].toFixed(1)}) 在平台 ${pid} 表面`,
      pass: e[0] >= p.x1 - EPS && e[0] <= p.x2 + EPS && Math.abs(e[1] - p.y) < 0.05,
    });
  }
  return { ok: checks.every(c => c.pass), checks };
}

function makeWalkStep(platformId, from, to, robot) {
  return { kind: 'walk', platform: platformId, from: [...from], to: [...to], duration: dist(from, to) / robot.speed.walk };
}

function makeActionStep(level, conn, robot, fromPid) {
  const ends = connEnds(level, conn);
  const toPid = fromPid === conn.a ? conn.b : conn.a;
  const entry = ends[fromPid];
  const exit = ends[toPid];
  return {
    kind: conn.type, connId: conn.id,
    platformFrom: fromPid, platformTo: toPid,
    entry: [...entry], exit: [...exit],
    duration: dist(entry, exit) / robot.speed[conn.type],
  };
}

// 计划几何链校验：每段的退出位置与接触平台必须满足下一段的进入条件
export function validatePlan(level, steps) {
  const problems = [];
  let cur = null; // { platform, pos }
  steps.forEach((s, i) => {
    const tag = s.kind === 'walk' ? `步行#${i}` : `${s.connId}#${i}`;
    if (s.kind === 'walk') {
      const p = platformAt(level, s.platform);
      for (const [label, pt] of [['起点', s.from], ['终点', s.to]]) {
        if (pt[0] < p.x1 - EPS || pt[0] > p.x2 + EPS || Math.abs(pt[1] - p.y) > 0.05) {
          problems.push(`${tag} ${label}不在平台 ${p.id} 表面`);
        }
      }
      if (cur && (cur.platform !== s.platform || dist(cur.pos, s.from) > 0.05)) {
        problems.push(`${tag} 与上一段退出位置/接触不衔接`);
      }
      cur = { platform: s.platform, pos: s.to };
    } else {
      const from = platformAt(level, s.platformFrom);
      const to = platformAt(level, s.platformTo);
      if (!(s.entry[0] >= from.x1 - EPS && s.entry[0] <= from.x2 + EPS && Math.abs(s.entry[1] - from.y) < 0.05)) {
        problems.push(`${tag} 进入位置不在平台 ${from.id} 表面`);
      }
      if (!(s.exit[0] >= to.x1 - EPS && s.exit[0] <= to.x2 + EPS && Math.abs(s.exit[1] - to.y) < 0.05)) {
        problems.push(`${tag} 退出位置不在平台 ${to.id} 表面`);
      }
      if (cur && (cur.platform !== s.platformFrom || dist(cur.pos, s.entry) > 0.05)) {
        problems.push(`${tag} 进入位置与上一段退出位置/接触不衔接`);
      }
      cur = { platform: s.platformTo, pos: s.exit };
    }
  });
  return { ok: problems.length === 0, problems };
}

// 端口图 Dijkstra：节点为连接端口+起点+终点，同平台步行边、连接动作边
function dijkstra(level, robot, startPid, startX, goalPid, goalX, blockedIds) {
  const avail = level.connections.filter(c => !blockedIds.has(c.id) && checkConnection(level, c, robot).ok);
  const sp = platformAt(level, startPid);
  const gp = platformAt(level, goalPid);
  const nodes = [
    { key: 'S', platform: startPid, pos: [startX, sp.y], conn: null },
    { key: 'G', platform: goalPid, pos: [goalX, gp.y], conn: null },
  ];
  for (const conn of avail) {
    const ends = connEnds(level, conn);
    nodes.push({ key: `${conn.id}@${conn.a}`, platform: conn.a, pos: ends[conn.a], conn });
    nodes.push({ key: `${conn.id}@${conn.b}`, platform: conn.b, pos: ends[conn.b], conn });
  }
  const idx = new Map(nodes.map((n, i) => [n.key, i]));
  const adj = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].platform === nodes[j].platform) {
        const w = dist(nodes[i].pos, nodes[j].pos) / robot.speed.walk;
        adj[i].push({ to: j, cost: w, kind: 'walk' });
        adj[j].push({ to: i, cost: w, kind: 'walk' });
      }
    }
  }
  for (const conn of avail) {
    const i = idx.get(`${conn.id}@${conn.a}`);
    const j = idx.get(`${conn.id}@${conn.b}`);
    const ends = connEnds(level, conn);
    const w = dist(ends[conn.a], ends[conn.b]) / robot.speed[conn.type];
    adj[i].push({ to: j, cost: w, kind: 'action', conn });
    adj[j].push({ to: i, cost: w, kind: 'action', conn });
  }
  const n = nodes.length;
  const distTo = Array(n).fill(Infinity);
  const prev = Array(n).fill(null);
  const done = Array(n).fill(false);
  distTo[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || distTo[i] < distTo[u])) u = i;
    if (u < 0 || distTo[u] === Infinity) break;
    done[u] = true;
    if (u === 1) break;
    for (const e of adj[u]) {
      const nd = distTo[u] + e.cost;
      if (nd < distTo[e.to]) { distTo[e.to] = nd; prev[e.to] = { from: u, edge: e }; }
    }
  }
  if (distTo[1] === Infinity) return { ok: false, cost: Infinity };
  const chain = [];
  let cur = 1;
  while (cur !== 0) { chain.push(prev[cur]); cur = prev[cur].from; }
  chain.reverse();
  const steps = [];
  for (const { from, edge } of chain) {
    const a = nodes[from];
    const b = nodes[edge.to];
    if (edge.kind === 'walk') {
      if (dist(a.pos, b.pos) < EPS) continue;
      steps.push(makeWalkStep(a.platform, a.pos, b.pos, robot));
    } else {
      steps.push(makeActionStep(level, edge.conn, robot, a.platform));
    }
  }
  return { ok: true, steps, cost: distTo[1] };
}

export function createKernel(level, robot) {
  const kernel = {
    level, robot,
    time: 0,
    failures: [],   // 执行失败反馈，规划器会回避
    events: [],
    plan: null,
    goal: null,
    exec: null,
    onEvent: null,
  };

  function emit(type, text) {
    const ev = { t: kernel.time, type, text };
    kernel.events.push(ev);
    if (kernel.onEvent) kernel.onEvent(ev);
  }

  function setRobot(next) {
    kernel.robot = next;
    kernel.failures.length = 0; // 参数变化后既往失败重新评估
    emit('robot-changed', `机器人参数更新：${next.name}`);
  }

  function describeConnections() {
    return level.connections.map(conn => ({ conn, ...checkConnection(level, conn, kernel.robot) }));
  }

  const blockedIds = () => new Set(kernel.failures.map(f => f.connId));

  function planVia(startPid, startX, goalPid, goalX, viaConnId) {
    const conn = level.connections.find(c => c.id === viaConnId);
    const avail = checkConnection(level, conn, kernel.robot);
    if (!avail.ok) return { ok: false, reason: `必经跨点 ${conn.id} 当前不可用`, checks: avail.checks };
    const ends = connEnds(level, conn);
    const options = [];
    for (const [first, second] of [[conn.a, conn.b], [conn.b, conn.a]]) {
      const blocked = new Set([...blockedIds(), conn.id]);
      const p1 = dijkstra(level, kernel.robot, startPid, startX, first, ends[first][0], blocked);
      if (!p1.ok) continue;
      const cross = makeActionStep(level, conn, kernel.robot, first);
      const p2 = dijkstra(level, kernel.robot, second, ends[second][0], goalPid, goalX, blocked);
      if (!p2.ok) continue;
      options.push({ ok: true, steps: [...p1.steps, cross, ...p2.steps], cost: p1.cost + cross.duration + p2.cost });
    }
    if (!options.length) return { ok: false, reason: `无法经由 ${conn.id} 衔接起点与终点` };
    options.sort((a, b) => a.cost - b.cost);
    return options[0];
  }

  function planRoute(startPid, startX, goalPid, goalX, viaConnId = null) {
    const result = viaConnId
      ? planVia(startPid, startX, goalPid, goalX, viaConnId)
      : dijkstra(level, kernel.robot, startPid, startX, goalPid, goalX, blockedIds());
    if (!result.ok) {
      kernel.plan = null;
      kernel.goal = { pid: goalPid, x: goalX };
      return { ok: false, reason: result.reason || '不可达：当前能力与空间条件下没有可用连接链', checks: result.checks };
    }
    const v = validatePlan(level, result.steps);
    if (!v.ok) {
      kernel.plan = null;
      return { ok: false, reason: `规划未通过几何链校验：${v.problems.join('；')}` };
    }
    kernel.plan = result;
    kernel.goal = { pid: goalPid, x: goalX };
    return result;
  }

  function reportFailure(connId, reason) {
    kernel.failures.push({ connId, reason, t: kernel.time });
    emit('failure-feedback', `失败已反馈内核：${connId}（${reason}），后续规划将回避该连接`);
  }

  function attemptReplan() {
    const ex = kernel.exec;
    const g = kernel.goal;
    const result = dijkstra(level, kernel.robot, ex.contact.platform, ex.pos[0], g.pid, g.x, blockedIds());
    if (result.ok && validatePlan(level, result.steps).ok) {
      kernel.plan = result;
      ex.steps = result.steps;
      ex.i = 0;
      emit('replanned', `内核已重规划：${result.steps.length} 段，预计 ${result.cost.toFixed(1)}s`);
      enterStep();
      return;
    }
    ex.phase = 'failed';
    emit('replan-failed', '重规划失败：当前能力与空间条件下目标不可达');
  }

  function enterStep() {
    const ex = kernel.exec;
    const s = ex.steps[ex.i];
    if (!s) {
      ex.phase = 'done';
      emit('exec-done', `到达目标平台 ${ex.contact.platform}，位置 (${ex.pos[0].toFixed(1)}, ${ex.pos[1].toFixed(1)})`);
      return;
    }
    if (s.kind === 'walk') {
      ex.phase = 'walk';
      emit('step-enter', `步行：平台 ${s.platform}，(${s.from[0].toFixed(1)} → ${s.to[0].toFixed(1)})，预计 ${s.duration.toFixed(1)}s`);
      return;
    }
    // 动作段进入前：用当前参数复检能力与空间前提 + 接触状态
    const conn = level.connections.find(c => c.id === s.connId);
    const avail = checkConnection(level, conn, kernel.robot);
    if (!avail.ok) {
      emit('entry-denied', `进入 ${conn.id} 被拒绝：${avail.checks.filter(c => !c.pass).map(c => c.text).join('；')}`);
      reportFailure(conn.id, '进入复检失败');
      attemptReplan();
      return;
    }
    if (ex.contact.platform !== s.platformFrom) {
      emit('entry-denied', `接触状态不符：当前接触 ${ex.contact.platform}，${conn.id} 入口要求 ${s.platformFrom}`);
      reportFailure(conn.id, '接触状态不符');
      attemptReplan();
      return;
    }
    ex.phase = 'action';
    emit('action-enter', `进入 ${conn.id}（${ACTION_INFO[conn.type].label}），预计 ${s.duration.toFixed(1)}s，退出位置 (${s.exit[0].toFixed(1)}, ${s.exit[1].toFixed(1)})`);
  }

  function advance(pos, target, maxStep) {
    const d = dist(pos, target);
    if (d <= maxStep + EPS) return [[...target], true];
    const k = maxStep / d;
    return [[pos[0] + (target[0] - pos[0]) * k, pos[1] + (target[1] - pos[1]) * k], false];
  }

  function startExecution() {
    if (!kernel.plan || !kernel.plan.ok) {
      emit('exec-rejected', '没有可执行的有效计划');
      return false;
    }
    const v = validatePlan(level, kernel.plan.steps);
    if (!v.ok) {
      emit('exec-rejected', `计划几何链校验失败：${v.problems.join('；')}`);
      return false;
    }
    const steps = kernel.plan.steps;
    const first = steps[0];
    const startPlatform = first ? (first.kind === 'walk' ? first.platform : first.platformFrom) : kernel.goal.pid;
    const startPos = first ? (first.kind === 'walk' ? first.from : first.entry) : [kernel.goal.x, platformAt(level, kernel.goal.pid).y];
    kernel.exec = {
      steps, i: 0, phase: 'idle',
      pos: [...startPos],
      contact: { platform: startPlatform },
      retreatTarget: null, retreatSpeed: 1, retreatStep: null,
    };
    emit('exec-started', `开始执行：${steps.length} 段，预计 ${kernel.plan.cost.toFixed(1)}s`);
    enterStep();
    return true;
  }

  function tick(dt) {
    const ex = kernel.exec;
    if (!ex || ex.phase === 'done' || ex.phase === 'failed' || ex.phase === 'idle') return;
    kernel.time += dt;
    const s = ex.steps[ex.i];

    if (ex.phase === 'walk') {
      const [np, arrived] = advance(ex.pos, s.to, kernel.robot.speed.walk * dt);
      ex.pos = np;
      if (arrived) {
        ex.pos = [...s.to];
        emit('step-done', `步行到达 (${s.to[0].toFixed(1)}, ${s.to[1].toFixed(1)})`);
        ex.i++;
        enterStep();
      }
      return;
    }

    if (ex.phase === 'action') {
      const conn = level.connections.find(c => c.id === s.connId);
      // 执行期间持续用当前参数复检：能力被关闭则中止并原路退回，不传送
      const avail = checkConnection(level, conn, kernel.robot);
      if (!avail.ok) {
        emit('action-aborted', `${conn.id} 执行中前提失效：${avail.checks.filter(c => !c.pass).map(c => c.text).join('；')}，原路退回入口`);
        reportFailure(conn.id, '执行中前提失效');
        ex.phase = 'retreat';
        ex.retreatTarget = [...s.entry];
        ex.retreatSpeed = kernel.robot.speed[conn.type] || 1.0;
        ex.retreatStep = s;
        return;
      }
      const [np, arrived] = advance(ex.pos, s.exit, kernel.robot.speed[conn.type] * dt);
      ex.pos = np;
      if (arrived) {
        // 到达验证：核验退出位置与接触状态，而不是“动画播完就算到”
        const d = dist(ex.pos, s.exit);
        if (d > 0.06) {
          emit('verify-failed', `${conn.id} 退出位置偏差 ${d.toFixed(2)}m，拒绝认定到达`);
          ex.phase = 'failed';
          return;
        }
        ex.pos = [...s.exit];
        ex.contact = { platform: s.platformTo };
        emit('exit-verified', `${conn.id} 退出位置 (${s.exit[0].toFixed(1)}, ${s.exit[1].toFixed(1)}) 核验通过，接触 → 平台 ${s.platformTo}`);
        ex.i++;
        const next = ex.steps[ex.i];
        if (next) {
          const nPlatform = next.kind === 'walk' ? next.platform : next.platformFrom;
          const nPos = next.kind === 'walk' ? next.from : next.entry;
          if (nPlatform !== ex.contact.platform || dist(nPos, ex.pos) > 0.05) {
            emit('chain-broken', '退出位置/接触状态不满足后续路线几何条件，执行中止');
            ex.phase = 'failed';
            return;
          }
        }
        enterStep();
      }
      return;
    }

    if (ex.phase === 'retreat') {
      const [np, arrived] = advance(ex.pos, ex.retreatTarget, ex.retreatSpeed * dt);
      ex.pos = np;
      if (arrived) {
        ex.pos = [...ex.retreatTarget];
        ex.contact = { platform: ex.retreatStep.platformFrom };
        emit('retreat-done', `已沿原连接退回平台 ${ex.contact.platform}，请求内核重规划`);
        attemptReplan();
      }
    }
  }

  function reset() {
    kernel.plan = null;
    kernel.exec = null;
    kernel.failures.length = 0;
    kernel.events.length = 0;
    kernel.time = 0;
  }

  return Object.assign(kernel, {
    setRobot, describeConnections, planRoute, startExecution, tick, reset,
    checkCurrent: conn => checkConnection(level, conn, kernel.robot),
  });
}

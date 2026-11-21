// 游戏回放内核：脚本化动画消息（完成/取消回调）与几何落地碰撞分开驱动。
// 回调到达顺序可在脚本中调整；提交策略可切换，用于复现与修复“旧动画晚到回调”缺陷。
// 不依赖 DOM，浏览器与 Node 均可运行。
import { LEVEL } from './level.js';
import { ROBOT_MODELS, cloneRobot } from './robots.js';
import { connEnds, platformAt, dist, EPS } from './kernel.js';

// 两个连接共用同一片段：修复只能依据动作实例的提交资格，不能按片段名压动作
export const SHARED_CLIP = 'airborne-cross-v3';
export const POLICIES = {
  instance: '按实例拒收旧回调（落点确认时原子提交）',
  legacy: '旧内核：来回调即受理（复现缺陷）',
  'clip-name': '按动画片段名去重（错误依据）',
  'cooldown-timer': '固定等待冷却（错误依据）',
};
const COOLDOWN = 1.5; // cooldown-timer 的固定等待秒数，刻意长于梯口到牵引口的步行时间
const FIXED_DT = 0.025;

function connOf(id) {
  return LEVEL.connections.find(c => c.id === id);
}
function exitPlatform(conn) {
  return platformAt(LEVEL, conn.b);
}

// 轨迹脚本：攀梯 L2（B→C），梯口 (12,5) 步行 2m 到牵引口 (14,5)，牵引 T2（C→D）
export function buildScript(name, robot = ROBOT_MODELS.RX7, opts = {}) {
  const r = cloneRobot(robot);
  const l2 = connOf('L2');
  const t2 = connOf('T2');
  const l2Ends = connEnds(LEVEL, l2);
  const t2Ends = connEnds(LEVEL, t2);
  const l2Entry = l2Ends[l2.a]; // [12,0] B
  const l2Exit = l2Ends[l2.b]; // [12,5] C
  const t2Entry = t2Ends[t2.a]; // [14,5] C
  const t2Exit = t2Ends[t2.b]; // [20,5] D
  const climbDur = dist(l2Entry, l2Exit) / r.speed.climb;
  const walkDur = dist(l2Exit, t2Entry) / r.speed.walk;
  const tractDur = dist(t2Entry, t2Exit) / r.speed.traction;
  const tLand1 = climbDur;
  const tAct2 = tLand1 + walkDur;
  const tEnd2 = tAct2 + tractDur;
  const prefix = name === 'completed-control' ? 'ctl' : 'act';
  const inst1 = `${prefix}-1`;
  const inst2 = `${prefix}-2`;

  const instances = {
    [inst1]: { id: inst1, connId: 'L2', clip: SHARED_CLIP, entry: [...l2Entry], exit: [...l2Exit], start: 0 },
    [inst2]: { id: inst2, connId: 'T2', clip: SHARED_CLIP, entry: [...t2Entry], exit: [...t2Exit], start: tAct2 },
  };
  // 身体运动的解析轨道（动作弦 + 平台步行），与帧长无关，保证变速重播确定性
  const tracks = [
    { kind: 'action', instance: inst1, t0: 0, t1: tLand1, from: [...l2Entry], to: [...l2Exit] },
    { kind: 'walk', t0: tLand1, t1: tAct2, from: [...l2Exit], to: [...t2Entry] },
    { kind: 'action', instance: inst2, t0: tAct2, t1: tEnd2, from: [...t2Entry], to: [...t2Exit] },
  ];
  const collisions = [
    { t: tLand1, instance: inst1, connId: 'L2', pos: [...l2Exit], platform: exitPlatform(l2).id },
    { t: tEnd2, instance: inst2, connId: 'T2', pos: [...t2Exit], platform: exitPlatform(t2).id },
  ];

  let messages;
  if (name === 'cancelled-late') {
    const cancelT = Math.min(1.5, tLand1 - 0.5);
    // late：旧攀梯动画的完成回调在牵引进行中才到（身体悬空）；early：在梯口落地前到
    const earlyT = Math.min(cancelT + 0.2, tLand1 - 1.0);
    const lateT = opts.callbackOrder === 'early'
      ? Math.max(0.5, earlyT)
      : tAct2 + tractDur * 0.375;
    messages = [
      { t: 0, type: 'start', instance: inst1 },
      { t: cancelT, type: 'cancel', instance: inst1 },
      { t: tAct2, type: 'start', instance: inst2 },
      { t: lateT, type: 'complete', instance: inst1, late: true },
      { t: tEnd2, type: 'complete', instance: inst2 },
    ];
  } else {
    messages = [
      { t: 0, type: 'start', instance: inst1 },
      { t: tLand1, type: 'ping', seq: 'p1' }, // 与落地同刻，用于验证同刻消息顺序可调
      { t: tLand1, type: 'complete', instance: inst1 },
      { t: tAct2, type: 'start', instance: inst2 },
      { t: tEnd2, type: 'complete', instance: inst2 },
    ];
  }
  return {
    name, robot: r, instances, tracks, collisions, messages,
    start: { platform: 'B', pos: [...l2Entry], t: 0 },
    bounds: { tEnd: tEnd2 + 0.5 },
  };
}

export const SCRIPT_INFO = {
  'cancelled-late': '攀梯被取消但身体仍在半空，旧动画完成回调晚到',
  'completed-control': '对照：攀梯确实完成，合法紧接牵引',
};

function bodyAt(script, t) {
  for (const seg of script.tracks) {
    if (t <= seg.t1 + EPS) {
      if (t <= seg.t0 + EPS) return [...seg.from];
      const k = (t - seg.t0) / (seg.t1 - seg.t0);
      return [seg.from[0] + (seg.to[0] - seg.from[0]) * k, seg.from[1] + (seg.to[1] - seg.from[1]) * k];
    }
  }
  const last = script.tracks[script.tracks.length - 1];
  return [...last.to];
}

export function createReplayer(scriptName, opts = {}) {
  const script = buildScript(scriptName, opts.robot || ROBOT_MODELS.RX7, { callbackOrder: opts.callbackOrder });
  const policy = opts.policy || 'instance';
  const speed = opts.speed || 1;
  const tieReversed = opts.tieOrder === 'reversed';
  const state = {
    policy: policy,
    t: 0,
    paused: false,
    finished: false,
    body: [...script.start.pos],
    support: { ...script.start }, // 真实支撑点：只由几何落地碰撞更新
    claimedSupport: null,         // 旧内核合成落地所声称的支撑（可能与真实支撑不符）
    active: null,
    instances: {},
    edges: {},                   // connId -> { heldBy, releases: {valid, invalid}, reserves }
    ledger: [],                  // 全部提交/拒收记录，单次追加、只增不改
    msgCursor: 0,
    colCursor: 0,
    lastClipEnd: {},
  };
  for (const inst of Object.values(script.instances)) {
    state.instances[inst.id] = { ...inst, status: 'idle' }; // idle|active|cancelled|committed
  }

  function append(entry) {
    state.ledger.push({ t: state.t, ...entry });
  }
  function edge(connId) {
    return state.edges[connId] || (state.edges[connId] = { heldBy: null, reserves: 0, releases: { valid: 0, invalid: 0 } });
  }
  // 可接续时刻：最近一次改变身体/支撑状态的有效提交时间（边预订等簿记事件不可作为恢复点）
  function resumeTime() {
    for (let i = state.ledger.length - 1; i >= 0; i--) {
      const e = state.ledger[i];
      if (e.valid && (e.kind === 'landing-commit' || e.kind === 'action-cancelled')) return e.t;
    }
    return 0;
  }
  function snapshot() {
    return {
      t: state.t,
      paused: state.paused,
      body: [...state.body],
      airborne: !onSurface(state.body),
      resumeTime: resumeTime(),
      trueSupport: state.support ? { ...state.support } : null,
      claimedSupport: state.claimedSupport ? { ...state.claimedSupport } : null,
      active: state.active,
      heldEdges: Object.entries(state.edges).filter(([, e]) => e.heldBy).map(([connId, e]) => ({ connId, by: e.heldBy })),
      finished: state.finished,
    };
  }

  function onSurface(p) {
    return LEVEL.platforms.some(pl => p[0] >= pl.x1 - EPS && p[0] <= pl.x2 + EPS && Math.abs(p[1] - pl.y) < 0.05);
  }

  // 落点确认：位置、支撑平台、导航边释放打包为一次原子提交
  function landingCommit(col) {
    const inst = state.instances[col.instance];
    const wasCancelled = inst.status === 'cancelled';
    const held = edge(col.connId);
    const releaseEdge = held.heldBy === col.instance ? { connId: col.connId, reason: 'landing' } : null;
    if (releaseEdge) {
      held.heldBy = null;
      held.releases.valid++;
    }
    state.body = [...col.pos];
    state.support = { platform: col.platform, pos: [...col.pos], t: col.t };
    // 几何落地不等于动作实例完成：被取消的实例只算身体落地（landed），其晚到回调仍按旧实例拒收
    inst.status = wasCancelled ? 'landed' : 'committed';
    if (state.active === col.instance) state.active = null;
    const bundled = releaseEdge ? ['pos', 'support', 'edge'] : ['pos', 'support'];
    append({
      kind: 'landing-commit', valid: true, reason: 'collision',
      instance: col.instance, clip: inst.clip, connId: col.connId,
      pos: [...col.pos], support: col.platform,
      edgeRelease: releaseEdge,
      bundled, // 相关状态一次提交，不拆成多笔
    });
  }

  function rejectCallback(msg, reason) {
    const inst = state.instances[msg.instance];
    append({
      kind: 'callback-rejected', valid: true, reason,
      instance: msg.instance, clip: inst ? inst.clip : null, connId: inst ? inst.connId : null,
      collision: false,
    });
  }

  function startInstance(id) {
    const inst = state.instances[id];
    if (inst.status !== 'idle') {
      append({ kind: 'start-denied', valid: false, reason: 'instance-not-idle', instance: id, clip: inst.clip, connId: inst.connId });
      return;
    }
    if (policy === 'clip-name') {
      const used = Object.values(state.instances).some(o => o.id !== id && o.clip === inst.clip && ['active', 'committed', 'cancelled'].includes(o.status));
      if (used) {
        append({ kind: 'start-denied', valid: false, reason: 'suppressed-clip', instance: id, clip: inst.clip, connId: inst.connId });
        return;
      }
    }
    if (policy === 'cooldown-timer') {
      const last = state.lastClipEnd[inst.clip];
      if (last !== undefined && state.t - last < COOLDOWN) {
        append({ kind: 'start-denied', valid: false, reason: 'suppressed-cooldown', instance: id, clip: inst.clip, connId: inst.connId, cooldown: COOLDOWN });
        return;
      }
    }
    const e = edge(inst.connId);
    e.heldBy = id;
    e.reserves++;
    inst.status = 'active';
    state.active = id;
    append({ kind: 'edge-reserve', valid: true, instance: id, clip: inst.clip, connId: inst.connId });
  }

  // 旧内核的缺陷处理：不看实例资格，晚到的完成回调被当作新的落地，并释放当前占用的导航边
  function legacySyntheticLanding(msg, reason) {
    const inst = state.instances[msg.instance];
    const heldConn = Object.entries(state.edges).find(([, e]) => e.heldBy)?.[0] || null;
    let edgeRelease = null;
    if (heldConn) {
      const e = edge(heldConn);
      e.heldBy = null;
      e.releases.invalid++;
      edgeRelease = { connId: heldConn, reason: 'stale-callback', valid: false };
    }
    state.claimedSupport = { platform: exitPlatform(connOf(inst.connId)).id, pos: [...inst.exit], t: state.t };
    append({
      kind: 'landing-commit', valid: false,
      reasons: [reason, 'no-collision'],
      reason,
      instance: msg.instance, clip: inst.clip, connId: inst.connId,
      claimedPos: [...inst.exit], bodyAt: [...state.body],
      collision: false,
      edgeRelease,
    });
  }

  // 合法的同实例重复完成回调（身体已在其落点表面且真实支撑匹配）：仅确认，不重复提交
  function harmlessDuplicate(inst) {
    const landed = ['committed', 'landed'].includes(inst.status);
    return landed && onSurface(state.body) &&
      state.support && dist(state.support.pos, inst.exit) < 0.05;
  }

  function handleMessage(msg) {
    const inst = state.instances[msg.instance];
    if (msg.type === 'ping') {
      append({ kind: 'ping', valid: true, seq: msg.seq });
      return;
    }
    if (msg.type === 'start') {
      startInstance(msg.instance);
      return;
    }
    if (msg.type === 'cancel') {
      if (inst.status !== 'active') { rejectCallback(msg, 'cancel-not-active'); return; }
      inst.status = 'cancelled';
      if (state.active === inst.id) state.active = null;
      const e = edge(inst.connId);
      let edgeRelease = null;
      if (e.heldBy === inst.id) {
        e.heldBy = null;
        e.releases.valid++;
        edgeRelease = { connId: inst.connId, reason: 'cancel' };
      }
      // 身体不传送：沿原弦继续，真实支撑保持上一次落地
      append({ kind: 'action-cancelled', valid: true, instance: inst.id, clip: inst.clip, connId: inst.connId, edgeRelease, body: [...state.body] });
      return;
    }
    // complete 回调
    if (policy === 'legacy') {
      if (harmlessDuplicate(inst)) {
        append({ kind: 'callback-ack', valid: true, instance: inst.id, clip: inst.clip, connId: inst.connId });
      } else if (inst.status === 'active') {
        legacySyntheticLanding(msg, 'no-collision-yet'); // 旧内核“播完就算到”
      } else {
        legacySyntheticLanding(msg, 'stale-instance');  // 旧实例回调重新落地、提前放开下一段预约
      }
      return;
    }
    if (policy === 'cooldown-timer' && !harmlessDuplicate(inst) && inst.status !== 'active') {
      // 固定等待策略只在启动处加闸，回调仍走旧逻辑：旧回调仍会造成错误提交
      legacySyntheticLanding(msg, 'stale-instance');
      return;
    }
    // instance / clip-name：按实例当前资格判定
    if (harmlessDuplicate(inst)) {
      append({ kind: 'callback-ack', valid: true, instance: inst.id, clip: inst.clip, connId: inst.connId });
    } else if (inst.status === 'active') {
      rejectCallback(msg, 'no-collision-yet'); // 动画播完不等于到达，等几何落点确认
    } else {
      rejectCallback(msg, 'stale-instance');  // 已取消/关闭实例的旧回调一律拒收
    }
  }

  function nextEvents() {
    const groups = [];
    if (state.msgCursor < script.messages.length) {
      const m = script.messages[state.msgCursor];
      const same = script.messages.slice(state.msgCursor).filter(x => Math.abs(x.t - m.t) < EPS);
      groups.push({ t: m.t, type: 'msg', items: tieReversed ? [...same].reverse() : same });
    }
    if (state.colCursor < script.collisions.length) {
      const c = script.collisions[state.colCursor];
      groups.push({ t: c.t, type: 'col', items: [c] });
    }
    groups.sort((a, b) => a.t - b.t || (a.type === 'col' ? -1 : 1));
    return groups[0] || null;
  }

  function fire(group) {
    state.t = group.t;
    state.body = bodyAt(script, state.t);
    if (group.type === 'col') {
      landingCommit(group.items[0]);
      state.colCursor++;
      const inst = state.instances[group.items[0].instance];
      state.lastClipEnd[inst.clip] = state.t;
    } else {
      for (const msg of group.items) {
        handleMessage(msg);
        state.msgCursor++;
      }
    }
  }

  function advance(wallDt) {
    if (state.paused || state.finished) return;
    let budget = wallDt * speed;
    // 固定逻辑步长推进，事件在精确时刻插入，回放结果与播放速度无关
    while (budget > EPS && !state.finished) {
      const g = nextEvents();
      if (!g) {
        state.t = Math.min(state.t + budget, script.bounds.tEnd);
        budget = 0;
        break;
      }
      const wait = g.t - state.t;
      if (wait <= budget + EPS) {
        budget = Math.max(0, budget - Math.max(0, wait));
        fire(g);
      } else {
        state.t += budget;
        budget = 0;
      }
    }
    state.body = bodyAt(script, state.t);
    if (state.t >= script.bounds.tEnd - EPS &&
        state.msgCursor >= script.messages.length &&
        state.colCursor >= script.collisions.length) {
      state.finished = true;
    }
  }

  function runToEnd() {
    let guard = 0;
    while (!state.finished && guard++ < 1e5) advance(FIXED_DT);
    return result();
  }
  function pause() { state.paused = true; return snapshot(); }
  function resume() { state.paused = false; }

  function result() {
    const landingCommits = state.ledger.filter(e => e.kind === 'landing-commit');
    return {
      policy, script: script.name, finished: state.finished,
      support: state.support, claimedSupport: state.claimedSupport,
      invalidCount: state.ledger.filter(e => e.valid === false).length,
      firstInvalid: state.ledger.find(e => e.valid === false) || null,
      landingCommits,
      path: landingCommits.filter(e => e.valid).map(e => e.support),
      edges: Object.fromEntries(Object.entries(state.edges).map(([id, e]) => [id, { ...e, releases: { ...e.releases } }])),
      ledger: state.ledger,
      snapshot: snapshot(),
    };
  }

  return { script, state, opts, advance, runToEnd, pause, resume, snapshot, result, FIXED_DT };
}

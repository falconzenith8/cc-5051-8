// 界面：全部控件状态由维修跨越内核驱动；失败经内核反馈并反映到控件
import { LEVEL } from './level.js';
import { ROBOT_MODELS, cloneRobot } from './robots.js';
import { createKernel, connEnds, platformAt, ACTION_INFO, dist } from './kernel.js';

const SCALE = 26, OX = 34, OY = 522;
const toPx = (x, y) => [OX + x * SCALE, OY - y * SCALE];
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);

const ui = { startPid: 'A', goalPid: 'D', via: '', focusConn: null, speed: 1, paused: false };
let robot = cloneRobot(ROBOT_MODELS.RX7);
let kernel = createKernel(LEVEL, robot);
let lastPlanResult = null;
let lastLogCount = 0;
let lastPlanRef = null;
let lastStepIdx = -1;
let lastPhase = '';

// ---------- 控件初始化 ----------
for (const m of Object.values(ROBOT_MODELS)) {
  $('modelSel').insertAdjacentHTML('beforeend', `<option value="${m.id}">${m.name}</option>`);
}
for (const p of LEVEL.platforms) {
  $('startSel').insertAdjacentHTML('beforeend', `<option value="${p.id}">${p.label}</option>`);
  $('goalSel').insertAdjacentHTML('beforeend', `<option value="${p.id}">${p.label}</option>`);
}
$('viaSel').insertAdjacentHTML('beforeend', '<option value="">（无）</option>');
for (const c of LEVEL.connections) {
  $('viaSel').insertAdjacentHTML('beforeend', `<option value="${c.id}">${c.id} ${ACTION_INFO[c.type].label} ${c.a}↔${c.b}</option>`);
}
$('startSel').value = ui.startPid;
$('goalSel').value = ui.goalPid;

function syncCapsUI() {
  $('capClimb').checked = robot.caps.climb;
  $('capCrawl').checked = robot.caps.crawl;
  $('capTraction').checked = robot.caps.traction;
  $('robotParams').textContent =
    `机高 ${robot.height}m · 机宽 ${robot.width}m · 速度 走${robot.speed.walk} 梯${robot.speed.climb} 管${robot.speed.crawl} 索${robot.speed.traction} m/s`;
}
syncCapsUI();

function autoPlan() {
  if (kernel.exec && kernel.exec.phase !== 'done' && kernel.exec.phase !== 'failed') return; // 执行中不打断
  doPlan();
}
function doPlan() {
  const s = platformAt(LEVEL, ui.startPid);
  const g = platformAt(LEVEL, ui.goalPid);
  lastPlanResult = kernel.planRoute(ui.startPid, (s.x1 + s.x2) / 2, ui.goalPid, (g.x1 + g.x2) / 2, ui.via || null);
  renderPlanBox();
}

$('modelSel').addEventListener('change', e => {
  robot = cloneRobot(ROBOT_MODELS[e.target.value]);
  kernel.setRobot(robot);
  syncCapsUI();
  autoPlan();
});
for (const [id, cap] of [['capClimb', 'climb'], ['capCrawl', 'crawl'], ['capTraction', 'traction']]) {
  $(id).addEventListener('change', () => {
    robot = { ...robot, caps: { climb: $('capClimb').checked, crawl: $('capCrawl').checked, traction: $('capTraction').checked } };
    kernel.setRobot(robot); // 执行中切换：内核下一帧即按当前参数复检
    autoPlan();
  });
}
$('startSel').addEventListener('change', e => { ui.startPid = e.target.value; autoPlan(); });
$('goalSel').addEventListener('change', e => { ui.goalPid = e.target.value; autoPlan(); });
$('viaSel').addEventListener('change', e => { ui.via = e.target.value; autoPlan(); });
$('planBtn').addEventListener('click', doPlan);
$('execBtn').addEventListener('click', () => { if (kernel.startExecution()) ui.paused = false; renderPlanBox(); });
$('pauseBtn').addEventListener('click', () => { ui.paused = !ui.paused; });
$('resetBtn').addEventListener('click', () => {
  kernel.reset();
  lastPlanResult = null; lastLogCount = 0; lastPlanRef = null; lastStepIdx = -1; lastPhase = '';
  ui.paused = false;
  $('logBox').innerHTML = '';
  renderPlanBox();
});
$('speedRange').addEventListener('input', e => {
  ui.speed = parseFloat(e.target.value);
  $('speedVal').textContent = `${ui.speed}×`;
});
$('connList').addEventListener('click', e => {
  const row = e.target.closest('.conn-row');
  if (row) ui.focusConn = row.dataset.connId;
});
canvas.addEventListener('click', e => {
  const r = canvas.getBoundingClientRect();
  const mx = (e.clientX - r.left - OX) / SCALE;
  const my = (OY - (e.clientY - r.top)) / SCALE;
  const p = LEVEL.platforms.find(p => mx >= p.x1 && mx <= p.x2 && Math.abs(my - p.y) < 1.2);
  if (!p) return;
  if (e.shiftKey) { ui.startPid = p.id; $('startSel').value = p.id; }
  else { ui.goalPid = p.id; $('goalSel').value = p.id; }
  autoPlan();
});

// ---------- 画布 ----------
function drawPlatform(p) {
  const [x1, y] = toPx(p.x1, p.y);
  const [x2] = toPx(p.x2, p.y);
  ctx.strokeStyle = '#8b9bb4';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  ctx.fillStyle = '#5b6b8c';
  ctx.font = '12px monospace';
  ctx.fillText(p.label, x1 + 2, y + 16);
}
function drawConnection(d, t) {
  const { conn, ok } = d;
  const ends = connEnds(LEVEL, conn);
  const A = ends[conn.a], B = ends[conn.b];
  const active = kernel.exec && (kernel.exec.phase === 'action' || kernel.exec.phase === 'retreat') &&
    kernel.exec.steps[kernel.exec.i] && kernel.exec.steps[kernel.exec.i].connId === conn.id;
  const focus = ui.focusConn === conn.id;
  let alpha = ok ? 0.9 : 0.28;
  if (active) alpha = 0.6 + 0.4 * Math.sin(t * 6);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = focus ? 3.5 : 2;
  ctx.strokeStyle = active ? '#ffd166' : focus ? '#4cc9f0' : ok ? '#4ade80' : '#f87171';
  ctx.fillStyle = ctx.strokeStyle;
  if (conn.type === 'climb') {
    const [x, y1] = toPx(conn.x, platformAt(LEVEL, conn.a).y);
    const [, y2] = toPx(conn.x, platformAt(LEVEL, conn.b).y);
    const w = conn.width * SCALE / 2;
    ctx.beginPath(); ctx.moveTo(x - w, y1); ctx.lineTo(x - w, y2); ctx.moveTo(x + w, y1); ctx.lineTo(x + w, y2); ctx.stroke();
    for (let yy = Math.min(y1, y2) + 8; yy < Math.max(y1, y2); yy += 10) {
      ctx.beginPath(); ctx.moveTo(x - w, yy); ctx.lineTo(x + w, yy); ctx.stroke();
    }
    ctx.fillText(`${conn.id} 梯面`, x + w + 4, (y1 + y2) / 2);
  } else if (conn.type === 'crawl') {
    const [x1, y1] = toPx(A[0], A[1]);
    const [x2, y2] = toPx(B[0], B[1]);
    const h = conn.clearance * SCALE;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.moveTo(x1, y1 - h); ctx.lineTo(x2, y2 - h); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x1, y1 - h / 2, 3, h / 2, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x2, y2 - h / 2, 3, h / 2, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillText(`${conn.id} 狭管·净高${conn.clearance}m`, (x1 + x2) / 2 - 30, y1 - h - 6);
  } else {
    const [ax, ay] = toPx(conn.anchor[0], conn.anchor[1]);
    const [x1, y1] = toPx(A[0], A[1]);
    const [x2, y2] = toPx(B[0], B[1]);
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x1, y1); ctx.moveTo(ax, ay); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillText(`${conn.id} 牵引·索${conn.cable}m`, ax + 8, ay - 4);
  }
  if (!ok) { // 不可进入标记
    const [mx, my] = toPx((A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
    ctx.globalAlpha = 0.9;
    ctx.fillText('✕', mx - 4, my - 8);
  }
  ctx.restore();
}
function drawPlanOverlay() {
  if (!kernel.plan || !kernel.plan.ok) return;
  ctx.save();
  kernel.plan.steps.forEach((s, i) => {
    const cur = kernel.exec && i === kernel.exec.i && kernel.exec.phase !== 'done';
    ctx.globalAlpha = cur ? 1 : 0.55;
    if (s.kind === 'walk') {
      const [x1, y1] = toPx(s.from[0], s.from[1]);
      const [x2, y2] = toPx(s.to[0], s.to[1]);
      ctx.strokeStyle = '#7b87a5';
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(x1, y1 - 4); ctx.lineTo(x2, y2 - 4); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const [ex, ey] = toPx(s.entry[0], s.entry[1]);
      const [xx, xy] = toPx(s.exit[0], s.exit[1]);
      ctx.fillStyle = '#4ade80';
      ctx.beginPath(); ctx.arc(ex, ey - 10, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(xx - 4, xy - 14, 8, 8);
      ctx.fillStyle = '#eaf0ff';
      ctx.fillText(`${i + 1}.${ACTION_INFO[s.kind].label}`, (ex + xx) / 2 - 14, Math.min(ey, xy) - 20);
    }
  });
  ctx.restore();
}
function drawRobot(t) {
  const pos = kernel.exec ? kernel.exec.pos : (() => {
    const p = platformAt(LEVEL, ui.startPid);
    return [(p.x1 + p.x2) / 2, p.y];
  })();
  const [x, y] = toPx(pos[0], pos[1]);
  const w = robot.width * SCALE, h = robot.height * SCALE;
  const phase = kernel.exec ? kernel.exec.phase : 'idle';
  ctx.save();
  ctx.fillStyle = phase === 'failed' ? '#f87171' : phase === 'retreat' ? '#ffd166' : '#6ee7ff';
  ctx.strokeStyle = '#0b1020';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h, w, h, 3);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#0b1020';
  ctx.beginPath(); ctx.arc(x + w / 4, y - h * 0.65, 2.5, 0, Math.PI * 2); ctx.fill();
  // 牵引动作中画缆绳
  if (phase === 'action' || phase === 'retreat') {
    const s = kernel.exec.steps[kernel.exec.i];
    if (s && s.kind === 'traction') {
      const conn = LEVEL.connections.find(c => c.id === s.connId);
      const [ax, ay] = toPx(conn.anchor[0], conn.anchor[1]);
      ctx.strokeStyle = '#ffd166';
      ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(ax, ay); ctx.stroke();
    }
  }
  ctx.restore();
}
function drawFlags() {
  const g = platformAt(LEVEL, ui.goalPid);
  const [gx, gy] = toPx((g.x1 + g.x2) / 2, g.y);
  ctx.fillStyle = '#4ade80';
  ctx.beginPath(); ctx.moveTo(gx, gy - 26); ctx.lineTo(gx + 12, gy - 21); ctx.lineTo(gx, gy - 16); ctx.fill();
  ctx.strokeStyle = '#4ade80';
  ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 26); ctx.stroke();
  const s = platformAt(LEVEL, ui.startPid);
  const [sx, sy] = toPx((s.x1 + s.x2) / 2, s.y);
  ctx.fillStyle = '#7b87a5';
  ctx.fillText('S', sx - 4, sy - 30);
}
function draw(t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#1a2440';
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= 38; gx += 2) {
    const [px] = toPx(gx, 0);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height); ctx.stroke();
  }
  for (const d of kernel.describeConnections()) drawConnection(d, t);
  for (const p of LEVEL.platforms) drawPlatform(p);
  drawPlanOverlay();
  drawFlags();
  drawRobot(t);
}

// ---------- 面板 ----------
const PHASE_LABEL = { idle: '空闲', walk: '步行', action: '跨越动作', retreat: '原路退回', done: '完成', failed: '失败' };
const LOG_CLASS = {
  'action-aborted': 'bad', 'entry-denied': 'bad', 'replan-failed': 'bad', 'verify-failed': 'bad',
  'chain-broken': 'bad', 'exec-rejected': 'bad', 'failure-feedback': 'bad',
  'exit-verified': 'good', 'exec-done': 'good',
  'replanned': 'info', 'action-enter': 'info', 'retreat-done': 'info',
};
function renderStatus() {
  const ex = kernel.exec;
  const phase = ex ? ex.phase : 'idle';
  const pos = ex ? ex.pos : null;
  const contact = ex ? ex.contact.platform : ui.startPid;
  $('statusLine').innerHTML =
    `阶段 <b>${PHASE_LABEL[phase]}</b>` +
    (pos ? ` · 位置 (${pos[0].toFixed(2)}, ${pos[1].toFixed(2)})` : '') +
    ` · 接触状态 <b>平台 ${contact}</b> · 内核时钟 ${kernel.time.toFixed(1)}s` +
    (kernel.failures.length ? ` · <span style="color:var(--bad)">失败反馈 ${kernel.failures.length} 条</span>` : '');
}
function renderConnList() {
  const ex = kernel.exec;
  const activeId = ex && (ex.phase === 'action' || ex.phase === 'retreat') && ex.steps[ex.i] ? ex.steps[ex.i].connId : null;
  $('connList').innerHTML = kernel.describeConnections().map(d => {
    const c = d.conn;
    const first = d.checks.find(x => !x.pass);
    const st = d.ok ? '<span class="st-ok">可进入</span>' : `<span class="st-no">✕ ${first.text}</span>`;
    const cls = ['conn-row', ui.focusConn === c.id ? 'focus' : '', activeId === c.id ? 'active' : ''].join(' ');
    return `<div class="${cls}" data-conn-id="${c.id}"><span>${c.id} ${ACTION_INFO[c.type].label} ${c.a}↔${c.b}</span>${st}</div>`;
  }).join('');
}
function renderBasis() {
  const ex = kernel.exec;
  let conn = null, live = false;
  if (ex && (ex.phase === 'action' || ex.phase === 'retreat')) {
    const s = ex.steps[ex.i];
    if (s && s.connId) { conn = LEVEL.connections.find(c => c.id === s.connId); live = true; }
  }
  if (!conn && ui.focusConn) conn = LEVEL.connections.find(c => c.id === ui.focusConn);
  if (!conn) { $('basisBox').textContent = '—（执行跨越动作或点击连接行后显示）'; return; }
  const chk = kernel.checkCurrent(conn);
  const rows = chk.checks.map(c =>
    `<div class="check"><span class="${c.pass ? 'p' : 'f'}">${c.pass ? '✓' : '✗'}</span><span>${c.text}</span></div>`).join('');
  let extra = '';
  if (live) {
    const s = ex.steps[ex.i];
    const total = dist(s.entry, s.exit);
    const done = total - dist(ex.pos, s.exit);
    const pct = Math.max(0, Math.min(100, done / total * 100)).toFixed(0);
    extra = `<div>进度 ${pct}% · 退出位置 (${s.exit[0].toFixed(1)}, ${s.exit[1].toFixed(1)}) · 要求接触 平台 ${s.platformFrom}（当前 ${ex.contact.platform}）</div>`;
  }
  $('basisBox').innerHTML =
    `<div><b>${conn.id} ${ACTION_INFO[conn.type].label}</b>（${live ? '正在执行' : '预选跨点'}）→ ${chk.ok ? '<span style="color:var(--ok)">允许进入</span>' : '<span style="color:var(--bad)">禁止进入</span>'}</div>` +
    rows + extra;
}
function renderPlanBox() {
  const res = kernel.plan || lastPlanResult; // 执行中被内核重规划时，以内核当前计划为准
  let head = '';
  if (kernel.exec) {
    const ph = kernel.exec.phase;
    if (ph === 'done') head = '<div class="banner ok">跨越结果：成功到达</div>';
    else if (ph === 'failed') head = '<div class="banner bad">跨越结果：失败 / 不可达</div>';
    else head = `<div class="banner run">执行中：${PHASE_LABEL[ph]}</div>`;
  }
  if (!res) { $('planBox').innerHTML = head + '尚未规划'; return; }
  if (!res.ok) {
    const unavail = kernel.describeConnections().filter(d => !d.ok)
      .map(d => `${d.conn.id}（${d.checks.find(c => !c.pass).text}）`).join('、');
    $('planBox').innerHTML = head +
      `<div class="banner bad">规划失败：${res.reason}</div><div class="hint">当前不可用连接：${unavail || '无'}</div>`;
    return;
  }
  const ex = kernel.exec;
  const steps = res.steps.map((s, i) => {
    const cls = ex && i < ex.i ? 'step done' : ex && i === ex.i && ex.phase !== 'done' ? 'step cur' : 'step';
    const body = s.kind === 'walk'
      ? `步行 平台${s.platform} (${s.from[0].toFixed(1)}→${s.to[0].toFixed(1)}) · ${s.duration.toFixed(1)}s`
      : `${ACTION_INFO[s.kind].label} ${s.connId} · 进入(${s.entry[0].toFixed(1)},${s.entry[1].toFixed(1)}) → 退出(${s.exit[0].toFixed(1)},${s.exit[1].toFixed(1)}) · 执行期间 ${s.duration.toFixed(1)}s`;
    return `<div class="${cls}">${i + 1}. ${body}</div>`;
  }).join('');
  $('planBox').innerHTML = head + `<div>共 ${res.steps.length} 段 · 预计 ${res.cost.toFixed(1)}s</div>` + steps;
}
function renderLog() {
  if (kernel.events.length === lastLogCount) return;
  const box = $('logBox');
  for (const ev of kernel.events.slice(lastLogCount)) {
    const div = document.createElement('div');
    div.className = `log-line ${LOG_CLASS[ev.type] || ''}`;
    div.textContent = `[${ev.t.toFixed(1)}s] ${ev.text}`;
    box.appendChild(div);
  }
  lastLogCount = kernel.events.length;
  box.scrollTop = box.scrollHeight;
}
function renderButtons() {
  const running = kernel.exec && kernel.exec.phase !== 'done' && kernel.exec.phase !== 'failed';
  $('execBtn').disabled = !kernel.plan || running;
  $('pauseBtn').disabled = !running;
  $('pauseBtn').textContent = ui.paused ? '继续' : '暂停';
}

// ---------- 主循环 ----------
let lastTs = 0;
function frame(ts) {
  const dt = Math.min((ts - lastTs) / 1000 || 0, 0.1);
  lastTs = ts;
  if (!ui.paused && kernel.exec && kernel.exec.phase !== 'done' && kernel.exec.phase !== 'failed') {
    kernel.tick(dt * ui.speed);
  }
  draw(ts / 1000);
  renderStatus();
  renderConnList();
  renderBasis();
  renderLog();
  renderButtons();
  const phaseNow = kernel.exec ? kernel.exec.phase : '';
  if (kernel.plan !== lastPlanRef || (kernel.exec && kernel.exec.i !== lastStepIdx) || phaseNow !== lastPhase) {
    lastPlanRef = kernel.plan;
    lastStepIdx = kernel.exec ? kernel.exec.i : -1;
    lastPhase = phaseNow;
    renderPlanBox();
  }
  requestAnimationFrame(frame);
}
doPlan();
requestAnimationFrame(frame);

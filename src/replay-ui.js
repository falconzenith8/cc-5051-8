// 回放界面：选择轨迹/提交策略/回调顺序，暂停时分别读出可接续时刻与真实支撑点。
// 所有状态均由 src/replay.js 回放内核驱动；缺少面板元素时静默退出（兼容 DOM 桩测试）。
import { LEVEL } from './level.js';
import { createReplayer, POLICIES, SCRIPT_INFO, buildScript } from './replay.js';
import { platformAt } from './kernel.js';

const panel = document.getElementById('replayPanel');
if (panel) {
  const $ = id => document.getElementById(id);
  const canvas = $('rpCanvas');
  const ctx = canvas.getContext('2d');

  const ui = {
    script: 'cancelled-late', policy: 'instance',
    tieOrder: 'normal', callbackOrder: 'late', speed: 1,
  };
  let replayer = null;
  let lastLedgerLen = -1;
  let lastTs = 0;

  for (const [id, info] of Object.entries(SCRIPT_INFO)) {
    $('rpScript').insertAdjacentHTML('beforeend', `<option value="${id}">${id} · ${info}</option>`);
  }
  for (const [id, label] of Object.entries(POLICIES)) {
    $('rpPolicy').insertAdjacentHTML('beforeend', `<option value="${id}">${label}</option>`);
  }
  $('rpTie').insertAdjacentHTML('beforeend',
    '<option value="normal">同刻：先碰撞/先登记</option><option value="reversed">同刻：先动画回调</option>');
  $('rpOrder').insertAdjacentHTML('beforeend',
    '<option value="late">旧回调晚到（牵引进行中）</option><option value="early">旧回调提前（落地前）</option>');

  function build() {
    replayer = createReplayer(ui.script, {
      policy: ui.policy, tieOrder: ui.tieOrder,
      callbackOrder: ui.callbackOrder, speed: ui.speed,
    });
    lastLedgerLen = -1;
  }

  // ---------- 画布（只画本回放涉及的 B/C/D 与 L2/T2） ----------
  const SCALE = 16, OX = 26, OY = 196;
  const px = (x, y) => [OX + x * SCALE, OY - y * SCALE];
  function drawStatic() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '10px monospace';
    for (const id of ['B', 'C', 'D']) {
      const p = platformAt(LEVEL, id);
      const [x1, y] = px(p.x1, p.y);
      const [x2] = px(p.x2, p.y);
      ctx.strokeStyle = '#8b9bb4'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      ctx.fillStyle = '#7b87a5';
      ctx.fillText(`${id} y=${p.y}`, x1 + 2, y + 13);
    }
    // L2 梯面
    const l2 = LEVEL.connections.find(c => c.id === 'L2');
    const [lx, ly1] = px(l2.x, 0);
    const [, ly2] = px(l2.x, 5);
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lx - 5, ly1); ctx.lineTo(lx - 5, ly2); ctx.moveTo(lx + 5, ly1); ctx.lineTo(lx + 5, ly2); ctx.stroke();
    ctx.fillStyle = '#4ade80'; ctx.fillText('L2', lx + 8, (ly1 + ly2) / 2);
    // T2 牵引
    const t2 = LEVEL.connections.find(c => c.id === 'T2');
    const [ax, ay] = px(t2.anchor[0], t2.anchor[1]);
    const [e1x, e1y] = px(14, 5);
    ctx.strokeStyle = '#4cc9f0'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(e1x, e1y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#4cc9f0'; ctx.fillText('T2', e1x + 6, e1y - 6);
  }

  function drawBody() {
    const s = replayer.snapshot();
    const [x, y] = px(s.body[0], s.body[1]);
    // 真实支撑点：灰色实心标记，悬空时仍停在上次落地平台
    if (s.trueSupport) {
      const [sx, sy] = px(s.trueSupport.pos[0], s.trueSupport.pos[1]);
      ctx.strokeStyle = '#7b87a5'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy - 4, 5, 0, Math.PI * 2); ctx.stroke();
    }
    // 旧内核合成的“声称支撑”：红色叉
    if (s.claimedSupport) {
      const [cx, cy] = px(s.claimedSupport.pos[0], s.claimedSupport.pos[1]);
      ctx.strokeStyle = '#f87171'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 4, cy - 8); ctx.lineTo(cx + 4, cy); ctx.moveTo(cx + 4, cy - 8); ctx.lineTo(cx - 4, cy); ctx.stroke();
    }
    // 当前占用的导航边
    for (const h of s.heldEdges) {
      const c = LEVEL.connections.find(x => x.id === h.connId);
      const [hx, hy] = px(c.type === 'climb' ? c.x : c.entry[0], c.type === 'climb' ? 2.5 : c.entry[1]);
      ctx.fillStyle = '#ffd166';
      ctx.fillText(`占用:${h.connId}`, hx - 14, hy - 14);
    }
    ctx.fillStyle = s.airborne ? '#ffd166' : '#6ee7ff';
    ctx.beginPath(); ctx.arc(x, y - 6, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0b1020'; ctx.stroke();
    ctx.fillStyle = '#eaf0ff';
    ctx.fillText(s.airborne ? '悬空' : `在${s.trueSupport ? s.trueSupport.platform : ''}`, x + 8, y - 8);
  }

  // ---------- 读数与台账 ----------
  function readout() {
    const s = replayer.snapshot();
    const script = buildScript(ui.script);
    const held = s.heldEdges.map(h => h.connId).join(',') || '无';
    $('rpReadout').innerHTML =
      `<div><span class="k">回放时钟</span> ${s.t.toFixed(2)}s · <span class="k">片段</span> ${script.instances[Object.keys(script.instances)[0]].clip} · <span class="k">当前实例</span> ${s.active || '—'}</div>` +
      `<div><span class="k">身体位置</span> (${s.body[0].toFixed(2)}, ${s.body[1].toFixed(2)}) ${s.airborne ? '<span class="warn">（半空，不可作为恢复点）</span>' : '<span class="ok">（在平台表面）</span>'}</div>` +
      `<div><span class="k">可接续时刻</span> <b>${s.resumeTime.toFixed(2)}s</b>（最近一次状态提交；暂停后从此恢复）</div>` +
      `<div><span class="k">真实支撑点</span> 平台 <b>${s.trueSupport.platform}</b> (${s.trueSupport.pos[0].toFixed(1)}, ${s.trueSupport.pos[1].toFixed(1)}) @${s.trueSupport.t.toFixed(2)}s` +
      (s.claimedSupport ? ` <span class="bad">· 旧内核声称：平台 ${s.claimedSupport.platform}（与真实支撑不符）</span>` : '') + `</div>` +
      `<div><span class="k">导航边占用</span> ${held} · <span class="k">状态</span> ${s.finished ? '<span class="ok">回放结束</span>' : s.paused ? '<span class="warn">已暂停</span>' : '播放中'}</div>`;
  }

  const LEDGER_CLASS = {
    'landing-commit': e => (e.valid ? 'good' : 'bad'),
    'callback-rejected': 'info', 'callback-ack': 'dim',
    'edge-reserve': 'info', 'start-denied': 'bad',
    'action-cancelled': 'warn', 'ping': 'dim',
  };
  const TEXT = {
    'landing-commit': e => e.valid
      ? `落地提交 ${e.instance} → 支撑${e.support}，打包[${e.bundled.join(',')}]${e.edgeRelease ? `，释放边 ${e.edgeRelease.connId}` : ''}`
      : `非法落地提交 ${e.instance}：${e.reasons.join('+')}，提前释放边 ${e.edgeRelease ? e.edgeRelease.connId : '—'}，身体其实在 (${e.bodyAt.map(v => v.toFixed(1))})`,
    'callback-rejected': e => `拒收回调 ${e.instance}：${e.reason}`,
    'callback-ack': e => `确认重复回调 ${e.instance}（已在落点，不重复提交）`,
    'edge-reserve': e => `预订导航边 ${e.connId}（实例 ${e.instance}）`,
    'start-denied': e => `拒绝启动 ${e.instance}：${e.reason}`,
    'action-cancelled': e => `取消 ${e.instance}：身体不传送、保持轨迹，释放边 ${e.edgeRelease ? e.edgeRelease.connId : '—'}`,
    'ping': e => `同刻标记 ${e.seq}`,
  };
  function renderLedger() {
    const res = replayer.result();
    if (res.ledger.length === lastLedgerLen) return;
    lastLedgerLen = res.ledger.length;
    $('rpLedger').innerHTML = res.ledger.map(e => {
      const cls = typeof LEDGER_CLASS[e.kind] === 'function' ? LEDGER_CLASS[e.kind](e) : (LEDGER_CLASS[e.kind] || 'dim');
      return `<div class="rp-e ${cls}">[${e.t.toFixed(2)}s] ${TEXT[e.kind](e)}</div>`;
    }).join('');
    $('rpLedger').scrollTop = $('rpLedger').scrollHeight;
  }

  function frame(ts) {
    const dt = Math.min((ts - lastTs) / 1000 || 0, 0.1);
    lastTs = ts;
    if (replayer && !replayer.state.paused && !replayer.state.finished) replayer.advance(dt);
    drawStatic();
    if (replayer) { drawBody(); readout(); renderLedger(); }
    $('rpPause').textContent = replayer && replayer.state.paused ? '继续' : '暂停';
    requestAnimationFrame(frame);
  }

  $('rpScript').addEventListener('change', e => { ui.script = e.target.value; build(); });
  $('rpPolicy').addEventListener('change', e => { ui.policy = e.target.value; build(); });
  $('rpTie').addEventListener('change', e => { ui.tieOrder = e.target.value; build(); });
  $('rpOrder').addEventListener('change', e => { ui.callbackOrder = e.target.value; build(); });
  $('rpRun').addEventListener('click', () => { build(); replayer.resume(); });
  $('rpPause').addEventListener('click', () => {
    if (!replayer) return;
    if (replayer.state.paused) replayer.resume(); else replayer.pause();
  });
  $('rpSpeed').addEventListener('input', e => {
    ui.speed = parseFloat(e.target.value);
    $('rpSpeedVal').textContent = `${ui.speed}×`;
    build(); // 确定性回放：改变播放速度后台账仍逐条一致
    replayer.resume();
  });

  build();
  requestAnimationFrame(frame);
}

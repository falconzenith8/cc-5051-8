// 回放无头验证：
// 旧回调晚到的首次错误提交、按实例拒收、落点原子提交、暂停读数、变速确定性、
// 对照路线，以及“同片段不同实例”下错误依据（片段名/固定等待）必然压掉第二次动作。
import { createReplayer, buildScript, POLICIES, SHARED_CLIP } from '../src/replay.js';
import { dist } from '../src/kernel.js';

let pass = 0, fail = 0;
const ok = (c, n, extra = '') => {
  if (c) { pass++; console.log(`  ✔ ${n}`); }
  else { fail++; console.log(`  ✘ ${n} ${extra}`); }
};
const find = (res, kind) => res.ledger.find(e => e.kind === kind);
const findAll = (res, kind) => res.ledger.filter(e => e.kind === kind);

console.log('1. 故障轨迹（攀梯取消、身体悬空、旧回调晚到）：旧内核首次错误提交可溯源到动作实例+落地+导航边');
{
  const bug = createReplayer('cancelled-late', { policy: 'legacy' }).runToEnd();
  const bad = bug.firstInvalid;
  ok(bad && bad.kind === 'landing-commit', '存在非法落地提交');
  ok(bad.instance === 'act-1' && bad.connId === 'L2', `首次错误提交来自旧攀梯实例 ${bad.instance}/${bad.connId}`);
  ok(bad.reasons.includes('stale-instance') && bad.reasons.includes('no-collision'), '依据：旧实例 + 当时无落地碰撞');
  ok(dist(bad.bodyAt, bad.claimedPos) > 0.05, '声称落点与真实身体位置不符（身体当时不在落点）');
  ok(bad.edgeRelease && bad.edgeRelease.connId === 'T2' && !bad.edgeRelease.valid,
    `该提交提前放开下一段导航边 T2（实际释放 ${bad.edgeRelease && bad.edgeRelease.connId}）`);
  ok(bug.edges.T2.releases.invalid >= 1, 'T2 被记为一次非法释放');
  ok(bug.support.platform === 'D', '真实支撑点仍随几何落地推进，不被旧回调污染');
}

console.log('2. 修复：按实例拒收旧回调 + 落点确认时原子提交');
{
  const fixed = createReplayer('cancelled-late', { policy: 'instance' }).runToEnd();
  const rejected = findAll(fixed, 'callback-rejected');
  ok(rejected.some(e => e.instance === 'act-1' && e.reason === 'stale-instance'), '旧攀梯实例的晚到完成回调被拒收');
  const commits = findAll(fixed, 'landing-commit');
  ok(commits.every(e => e.valid) && commits.length === 2, '落地提交恰好 2 次且全部合法');
  const first = commits[0];
  ok(first.bundled.join('|') === 'pos|support' && first.edgeRelease === null,
    '取消实例落地时只打包位置+支撑（其导航边已在取消事件中合法释放）');
  ok(find(fixed, 'action-cancelled').edgeRelease.connId === 'L2', '取消事件已合法释放 L2');
  ok(commits[1].bundled.join('|') === 'pos|support|edge' && commits[1].edgeRelease.connId === 'T2',
    '牵引落点确认时位置/支撑/T2 边打包为一次提交');
  ok(fixed.path.join('→') === 'C→D', `角色实际使用的路径为 C→D（实际 ${fixed.path.join('→')}）`);
  ok(fixed.edges.T2.heldBy === null && fixed.edges.T2.releases.invalid === 0 && fixed.edges.T2.releases.valid === 1,
    'T2 只在自身落点确认时合法释放一次，无提前释放');
  ok(fixed.invalidCount === 0, '整段回放无非法提交');
  ok(!fixed.claimedSupport, '不再产生与真实支撑不符的“声称支撑点”');
}

console.log('3. 对照路线：攀梯确实完成、合法紧接牵引');
{
  const ctl = createReplayer('completed-control', { policy: 'instance' }).runToEnd();
  ok(ctl.path.join('→') === 'C→D', '对照路径同样为 C→D');
  ok(findAll(ctl, 'landing-commit').length === 2, '两段动作各落地提交一次');
  ok(find(ctl, 'action-cancelled') === undefined, '对照轨迹无取消事件');
  ok(ctl.edges.L2.releases.valid === 1 && ctl.edges.T2.releases.valid === 1, '两条导航边各合法交还一次');
  const acks = findAll(ctl, 'callback-ack');
  ok(acks.length === 2, '两个完成回调均被正常确认');
}

console.log('4. 两个连接使用相同动画片段、不同动作实例：修复只看提交资格');
{
  const fixed = createReplayer('completed-control', { policy: 'instance' }).runToEnd();
  const clips = new Set(findAll(fixed, 'edge-reserve').map(e => e.clip));
  ok(clips.size === 1 && clips.has(SHARED_CLIP), `两动作同片段 ${SHARED_CLIP}`);
  ok(new Set(findAll(fixed, 'edge-reserve').map(e => e.instance)).size === 2, '但动作实例不同');
  const byName = createReplayer('completed-control', { policy: 'clip-name' }).runToEnd();
  const denied = find(byName, 'start-denied');
  ok(denied && denied.instance === 'ctl-2' && denied.reason === 'suppressed-clip',
    '按片段名去重错误地压掉了本应发生的第二次动作');
  const byTimer = createReplayer('completed-control', { policy: 'cooldown-timer' }).runToEnd();
  const tDenied = find(byTimer, 'start-denied');
  ok(tDenied && tDenied.instance === 'ctl-2' && tDenied.reason === 'suppressed-cooldown',
    '固定等待冷却同样压掉了第二次动作（梯口步行时间短于冷却）');
  const timerBug = createReplayer('cancelled-late', { policy: 'cooldown-timer' }).runToEnd();
  ok(timerBug.invalidCount > 0, '而固定等待又挡不住故障轨迹的晚到旧回调（错误依据两头不讨好）');
}

console.log('5. 变速重播：同一条轨迹不同速度，结果与提交台账完全一致、通行权只交还一次');
{
  const speeds = [0.25, 1, 4];
  const outs = speeds.map(sp => {
    const r = createReplayer('cancelled-late', { policy: 'instance', speed: sp });
    let guard = 0;
    while (!r.state.finished && guard++ < 200000) r.advance(r.FIXED_DT * 0.37);
    return r.result();
  });
  const ref = JSON.stringify(outs[0].ledger);
  ok(outs.every(o => JSON.stringify(o.ledger) === ref), '三种速度下提交台账逐条一致（时间/实例/边均相同）');
  ok(outs.every(o => o.edges.T2.releases.valid === 1 && o.edges.T2.releases.invalid === 0), '任何速度下 T2 只交还一次');
  ok(outs.every(o => o.edges.L2.releases.valid === 1), '任何速度下 L2 也只交还一次');
  const ctlOuts = speeds.map(sp => {
    const r = createReplayer('completed-control', { policy: 'instance', speed: sp });
    let guard = 0;
    while (!r.state.finished && guard++ < 200000) r.advance(r.FIXED_DT * 1.7);
    return r.result();
  });
  ok(ctlOuts.every(o => JSON.stringify(o.ledger) === JSON.stringify(ctlOuts[0].ledger)), '对照轨迹变速同样确定');
}

console.log('6. 暂停画面：可接续时刻与真实支撑点分别读出，且与身体所在位置区分');
{
  const r = createReplayer('cancelled-late', { policy: 'instance' });
  const script = buildScript('cancelled-late');
  const cancelMsg = script.messages.find(m => m.type === 'cancel');
  while (r.state.t < cancelMsg.t + 0.25) r.advance(0.05); // 取消后、落地前：身体悬空
  const snap = r.pause();
  ok(snap.airborne, '暂停时身体处于半空');
  ok(snap.trueSupport.platform === 'B', `真实支撑点仍是 B（实际 ${snap.trueSupport.platform}）`);
  const cancelT = script.messages.find(m => m.type === 'cancel').t;
  ok(Math.abs(snap.resumeTime - cancelT) < 1e-6, `可接续时刻为最近状态提交（取消事件 ${cancelT.toFixed(2)}s），而非当前时钟`);
  ok(snap.resumeTime < snap.t, '可接续时刻早于暂停时钟：半空中的帧不可作为恢复点');
  ok(dist(snap.body, snap.trueSupport.pos) > 1, '身体位置与真实支撑点明显不同，二者分开显示');
  r.resume();
  while (r.state.t < script.collisions[0].t + 0.05) r.advance(0.05);
  const snap2 = r.pause();
  ok(snap2.trueSupport.platform === 'C' && Math.abs(snap2.resumeTime - script.collisions[0].t) < 1e-6,
    `梯口落地后：真实支撑 C，可接续时刻 ${snap2.resumeTime.toFixed(2)}s`);
  // 暂停期间推进不改变状态
  const before = JSON.stringify(r.snapshot());
  r.advance(1); r.advance(1);
  ok(JSON.stringify(r.snapshot()) === before, '暂停中 advance 不产生任何状态变化');
}

console.log('7. 回调顺序可调：同刻消息的先后由脚本顺序决定，且修复后两种顺序都不产生错误提交');
{
  const a = createReplayer('completed-control', { policy: 'legacy', tieOrder: 'normal' }).runToEnd();
  const b = createReplayer('completed-control', { policy: 'legacy', tieOrder: 'reversed' }).runToEnd();
  const idxA = a.ledger.findIndex(e => e.kind === 'ping');
  const idxB = b.ledger.findIndex(e => e.kind === 'ping');
  ok(idxA !== idxB, `同刻消息顺序可调（ping 位置 ${idxA} vs ${idxB}）`);
  const early = createReplayer('cancelled-late', { policy: 'instance', callbackOrder: 'early' }).runToEnd();
  const late = createReplayer('cancelled-late', { policy: 'instance' }).runToEnd();
  ok(early.invalidCount === 0 && late.invalidCount === 0, '无论旧回调提前还是晚到，按实例拒收后均无非法提交');
  ok(findAll(early, 'callback-rejected').some(e => e.reason === 'stale-instance'), '提前到达的旧回调同样按实例拒收');
}

console.log('8. 修复策略对比总表：只有按实例策略在两条轨迹上全部合法、且第二次动作不被压掉');
{
  for (const [policy, name] of Object.entries(POLICIES)) {
    const bug = createReplayer('cancelled-late', { policy }).runToEnd();
    const ctl = createReplayer('completed-control', { policy }).runToEnd();
    const secondActionStarted = find(ctl, 'start-denied') === undefined;
    const clean = bug.invalidCount === 0 && ctl.invalidCount === 0 &&
      ctl.path.join('→') === 'C→D' && secondActionStarted;
    ok(policy === 'instance' ? clean : !clean,
      `${name}：${policy === 'instance' ? '两条轨迹均合法' : '存在被误压或错误提交（符合预期）'}`);
  }
}

console.log('9. 导航边占用记账：每条边预订/释放配对，故障轨迹修复后无悬空占用');
{
  const fixed = createReplayer('cancelled-late', { policy: 'instance' }).runToEnd();
  for (const connId of ['L2', 'T2']) {
    const e = fixed.edges[connId];
    ok(e.heldBy === null, `${connId} 最终无人占用`);
    ok(e.reserves >= 1 && e.releases.valid === e.reserves, `${connId} 预订 ${e.reserves} 次、合法释放 ${e.releases.valid} 次，配平`);
  }
  const bug = createReplayer('cancelled-late', { policy: 'legacy' }).runToEnd();
  ok(bug.edges.T2.releases.invalid > 0, '旧内核下 T2 存在非法释放记录');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);

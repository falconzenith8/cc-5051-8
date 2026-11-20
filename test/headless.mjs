// 无头验证：替代路线、不可达、空间前提、执行连续性（无传送）、失败反馈、几何校验
import { LEVEL } from '../src/level.js';
import { ROBOT_MODELS, cloneRobot } from '../src/robots.js';
import { createKernel, checkConnection, dist } from '../src/kernel.js';

let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${extra}`); }
}
function runToEnd(kernel, dt = 0.05, maxT = 300) {
  let t = 0;
  const positions = [];
  while (kernel.exec && kernel.exec.phase !== 'done' && kernel.exec.phase !== 'failed' && t < maxT) {
    kernel.tick(dt);
    positions.push([...kernel.exec.pos]);
    t += dt;
  }
  return positions;
}
const center = pid => {
  const p = LEVEL.platforms.find(p => p.id === pid);
  return (p.x1 + p.x2) / 2;
};

console.log('1. 全能机型规划 A→D，计划含进入动作/执行期间/退出位置');
{
  const k = createKernel(LEVEL, cloneRobot(ROBOT_MODELS.RX7));
  const res = k.planRoute('A', center('A'), 'D', center('D'));
  ok(res.ok, '规划成功');
  const actions = res.steps.filter(s => s.kind !== 'walk');
  ok(actions.some(s => s.kind === 'climb') && actions.some(s => s.kind === 'traction'), '路线含攀梯与牵引');
  ok(actions.every(s => Array.isArray(s.entry) && Array.isArray(s.exit) && s.duration > 0), '每段动作带进入位置/退出位置/执行期间');
}

console.log('2. 缺能力时的替代路线：钻管 vs 牵引');
{
  const crawlOnly = { ...cloneRobot(ROBOT_MODELS.MN2), caps: { climb: false, crawl: true, traction: false } };
  const k1 = createKernel(LEVEL, crawlOnly);
  const r1 = k1.planRoute('A', center('A'), 'B', center('B'));
  const tractOnly = { ...cloneRobot(ROBOT_MODELS.TR5), caps: { climb: false, crawl: false, traction: true } };
  const k2 = createKernel(LEVEL, tractOnly);
  const r2 = k2.planRoute('A', center('A'), 'B', center('B'));
  ok(r1.ok && r1.steps.some(s => s.connId === 'P1'), '只会钻管 → 走狭管 P1');
  ok(r2.ok && r2.steps.some(s => s.connId === 'T1'), '只会牵引 → 改走牵引点 T1（替代路线）');
}

console.log('3. 空间前提：有钻管能力但机身过高仍不可进管');
{
  const k = createKernel(LEVEL, cloneRobot(ROBOT_MODELS.SC3)); // 有 crawl 能力但高 1.5m
  const p2 = LEVEL.connections.find(c => c.id === 'P2');
  const chk = checkConnection(LEVEL, p2, k.robot);
  ok(!chk.ok && chk.checks.some(c => !c.pass && c.text.includes('净高')), 'P2 因净高不足被拒绝');
  // E 的唯一另一入口 L3 在 D 上，而 D 只能牵引到达，SC-3 无牵引 → 不可达
  const res = k.planRoute('B', center('B'), 'E', center('E'));
  ok(!res.ok, 'SC-3 无法 B→E（管太矮、又无牵引绕上 D）');
}

console.log('4. 不可达：无任何能力的机型');
{
  const k = createKernel(LEVEL, cloneRobot(ROBOT_MODELS.BS0));
  const res = k.planRoute('A', center('A'), 'B', center('B'));
  ok(!res.ok && res.reason.includes('不可达'), 'BS-0 出不了本舱，报告不可达');
}

console.log('5. 几何不可达：T3 牵引索长不足，F 平台对任何机型不可达');
{
  const k = createKernel(LEVEL, cloneRobot(ROBOT_MODELS.RX7));
  const t3 = k.describeConnections().find(d => d.conn.id === 'T3');
  ok(!t3.ok && t3.checks.some(c => !c.pass && c.text.includes('索长')), 'T3 因索长不足不可用');
  const res = k.planRoute('A', center('A'), 'F', center('F'));
  ok(!res.ok, 'A→F 不可达');
}

console.log('6. 替代路线（多层）：RX-7 钻不进 P2 狭管，绕行 梯+牵引+梯 到 E');
{
  const k = createKernel(LEVEL, cloneRobot(ROBOT_MODELS.RX7));
  const res = k.planRoute('B', center('B'), 'E', center('E'));
  ok(res.ok, '规划成功');
  ok(res.steps.some(s => s.connId === 'L3') && !res.steps.some(s => s.connId === 'P2'), '绕行 L3 而非 P2');
  const k2 = createKernel(LEVEL, cloneRobot(ROBOT_MODELS.MN2));
  const res2 = k2.planRoute('B', center('B'), 'E', center('E'));
  ok(res2.ok && res2.steps.some(s => s.connId === 'P2'), 'MN-2 够矮，直接钻 P2');
}

console.log('7. 执行连续性：位置逐帧积分，无传送；退出位置与接触状态核验');
{
  const k = createKernel(LEVEL, cloneRobot(ROBOT_MODELS.RX7));
  k.planRoute('A', center('A'), 'C', center('C'));
  ok(k.startExecution(), '执行启动');
  const dt = 0.05;
  const positions = runToEnd(k, dt);
  const maxStep = 2.4 * dt + 1e-6;
  const jumps = positions.filter((p, i) => i > 0 && dist(p, positions[i - 1]) > maxStep);
  ok(jumps.length === 0, '逐帧位移均 ≤ 速度×dt，无传送', `越界 ${jumps.length} 次`);
  ok(k.exec.phase === 'done', '执行完成');
  ok(dist(k.exec.pos, [center('C'), 5]) < 1e-6, `最终位置 (${k.exec.pos}) 等于目标点`);
  ok(k.exec.contact.platform === 'C', '接触状态为平台 C');
  ok(k.events.some(e => e.type === 'exit-verified'), '存在退出位置核验记录（不是播完动画就算到）');
}

console.log('8. 执行中能力被关闭：中止→原路退回→反馈内核→重规划');
{
  // 以 MN-2 为底加装牵引索的改装机：先只会钻管
  const base = cloneRobot(ROBOT_MODELS.MN2);
  const robot = { ...base, speed: { ...base.speed, traction: 2.0 }, caps: { climb: false, crawl: true, traction: false } };
  const k = createKernel(LEVEL, robot);
  k.planRoute('A', center('A'), 'B', center('B'));
  k.startExecution();
  let guard = 0;
  while (k.exec.phase !== 'action' && guard++ < 500) k.tick(0.05);
  ok(k.exec.phase === 'action' && k.exec.steps[k.exec.i].connId === 'P1', '正在钻管 P1');
  k.setRobot({ ...robot, caps: { climb: false, crawl: false, traction: false } }); // 执行中关掉钻管能力
  k.tick(0.05);
  ok(k.exec.phase === 'retreat', '前提失效 → 原路退回（不传送）');
  runToEnd(k);
  ok(k.exec.phase === 'failed', '无可用能力 → 重规划失败');
  ok(k.events.some(e => e.type === 'action-aborted') && k.events.some(e => e.type === 'failure-feedback'), '中止与失败反馈均已记录');
  ok(k.failures.some(f => f.connId === 'P1'), '失败已反馈内核（P1 被回避）');
  // 恢复牵引能力后从当前位置重规划并成功
  k.setRobot({ ...robot, caps: { climb: false, crawl: false, traction: true } });
  const res = k.planRoute('A', k.exec.pos[0], 'B', center('B'));
  ok(res.ok && res.steps.some(s => s.connId === 'T1'), '内核改用 T1 重规划');
  k.startExecution();
  runToEnd(k);
  ok(k.exec.phase === 'done' && k.exec.contact.platform === 'B', '经 T1 到达 B');
}

console.log('9. 篡改计划会被几何链校验拒绝（退出位置必须真实满足后续路线）');
{
  const k = createKernel(LEVEL, cloneRobot(ROBOT_MODELS.RX7));
  k.planRoute('A', center('A'), 'C', center('C'));
  const climb = k.plan.steps.find(s => s.kind === 'climb');
  climb.exit = [climb.exit[0], 99]; // 伪造退出位置
  ok(!k.startExecution(), '退出位置不在平台表面 → 拒绝执行');
  ok(k.events.some(e => e.type === 'exec-rejected'), '拒绝原因已记录');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);

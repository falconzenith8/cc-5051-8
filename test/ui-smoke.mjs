// UI 冒烟测试：用最小 DOM 桩加载 src/ui.js，验证 初始化→规划→执行→完成 链路
// （无浏览器环境的替代检查；真实交互请在浏览器中确认）

const ctxStub = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? () => {} : undefined), set: () => true });
const elements = {};
function makeEl(id) {
  const el = {
    id, children: [], listeners: [], textContent: '', value: '', checked: false,
    disabled: false, className: '', dataset: {}, scrollTop: 0, scrollHeight: 0,
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    insertAdjacentHTML(pos, chunk) { html += chunk; },
    appendChild(c) { this.children.push(c); this.scrollHeight += 10; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    getContext() { return ctxStub; },
  };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) { html = v; el.children.length = 0; }, // 与真实 DOM 一致：赋值清空子节点
  });
  return el;
}
globalThis.document = {
  getElementById: id => (elements[id] ??= makeEl(id)),
  createElement: () => makeEl('div'),
};
const rafCbs = new Set();
let rafCb = null;
globalThis.requestAnimationFrame = cb => { rafCbs.add(cb); rafCb = cb; };
globalThis.cancelAnimationFrame = cb => rafCbs.delete(cb);
const pump = ts => rafCbs.forEach(cb => cb(ts));

let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : fail++; console.log(`  ${c ? '✔' : '✘'} ${n}`); };
const fire = (id, type = 'click') => (elements[id].listeners[type] || []).forEach(fn => fn({ target: elements[id] }));

await import('../src/ui.js');
await import('../src/replay-ui.js');
console.log('UI 冒烟');
ok(rafCb !== null, '模块初始化并启动渲染循环');
let ts = 0, done = false;
ts += 50; pump(ts); // 推进第一帧，让面板渲染
ok(elements.connList.innerHTML.includes('T3'), '连接一览由内核驱动渲染（含 T3）');
ok(elements.connList.innerHTML.includes('✕'), '不可用连接在列表中标记');
ok(elements.planBox.innerHTML.includes('攀梯') || elements.planBox.innerHTML.includes('牵引'), '初始自动规划已出计划（含进入/退出/期间）');

elements.goalSel.value = 'D';
fire('planBtn');
ok(elements.planBox.innerHTML.includes('段'), '规划按钮生成计划');

fire('execBtn');
done = false;
for (let i = 0; i < 3000; i++) {
  ts += 50;
  pump(ts);
  if (elements.statusLine.innerHTML.includes('完成')) { done = true; break; }
}
ok(done, '执行跑完，状态行显示完成');
ok(elements.planBox.innerHTML.includes('成功到达'), '结果区呈现跨越结果：成功到达');
ok(elements.logBox.children.length > 5, `事件日志有记录（${elements.logBox.children.length} 条）`);
ok([...elements.logBox.children].some(c => c.textContent.includes('核验通过')), '日志含退出位置核验记录');

fire('resetBtn');
ts += 50; pump(ts);
ok(elements.statusLine.innerHTML.includes('空闲'), '重置后回到空闲');
ok(elements.logBox.children.length === 0, '重置清空日志');

console.log('回放面板冒烟');
ok(elements.rpScript.innerHTML.includes('cancelled-late') && elements.rpScript.innerHTML.includes('completed-control'), '两条轨迹可选（故障 + 对照）');
ok(elements.rpPolicy.innerHTML.includes('instance') && elements.rpPolicy.innerHTML.includes('legacy'), '提交策略可选（含旧内核与修复）');
ok(elements.rpTie.innerHTML.includes('reversed'), '同刻回调顺序可调');
ok(elements.rpReadout.innerHTML.includes('可接续时刻') && elements.rpReadout.innerHTML.includes('真实支撑点'),
  '暂停读数分别显示可接续时刻与真实支撑点');
// 切到旧内核策略，故障轨迹应出现非法落地提交台账
elements.rpPolicy.value = 'legacy';
fire('rpPolicy', 'change');
fire('rpRun');
for (let i = 0; i < 600; i++) { ts += 50; pump(ts); }
ok(elements.rpLedger.innerHTML.includes('非法落地提交'), '旧内核策略复现非法落地提交（提前放开下一段导航边）');
ok(elements.rpReadout.innerHTML.includes('与真实支撑不符'), '读数同时呈现旧内核的声称支撑与真实支撑差异');
// 切回按实例修复：台账无非法提交
elements.rpPolicy.value = 'instance';
fire('rpPolicy', 'change');
fire('rpRun');
for (let i = 0; i < 600; i++) { ts += 50; pump(ts); }
ok(!elements.rpLedger.innerHTML.includes('非法落地提交'), '按实例拒收后无非法落地提交');
ok(elements.rpLedger.innerHTML.includes('拒收回调'), '旧动画晚到回调被按实例拒收');
// 对照轨迹：第二次动作不会被压掉
elements.rpScript.value = 'completed-control';
fire('rpScript', 'change');
fire('rpRun');
for (let i = 0; i < 600; i++) { ts += 50; pump(ts); }
ok(elements.rpLedger.innerHTML.includes('T2') && !elements.rpLedger.innerHTML.includes('拒绝启动'),
  '对照路线中第二个同片段动作实例正常启动（不按片段名/冷却压制）');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);

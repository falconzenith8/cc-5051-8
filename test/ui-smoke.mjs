// UI 冒烟测试：用最小 DOM 桩加载 src/ui.js，验证 初始化→规划→执行→完成 链路
// （无浏览器环境的替代检查；真实交互请在浏览器中确认）

const ctxStub = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? () => {} : undefined), set: () => true });
const elements = {};
function makeEl(id) {
  const el = {
    id, children: [], listeners: [], textContent: '', value: '', checked: false,
    disabled: false, className: '', dataset: {}, scrollTop: 0, scrollHeight: 0,
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    insertAdjacentHTML(pos, html) { this._innerHTML += html; },
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
let rafCb = null;
globalThis.requestAnimationFrame = cb => { rafCb = cb; };

let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : fail++; console.log(`  ${c ? '✔' : '✘'} ${n}`); };
const fire = (id, type = 'click') => (elements[id].listeners[type] || []).forEach(fn => fn({ target: elements[id] }));

await import('../src/ui.js');
console.log('UI 冒烟');
ok(rafCb !== null, '模块初始化并启动渲染循环');
let ts = 0, done = false;
ts += 50; rafCb(ts); // 推进第一帧，让面板渲染
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
  rafCb(ts);
  if (elements.statusLine.innerHTML.includes('完成')) { done = true; break; }
}
ok(done, '执行跑完，状态行显示完成');
ok(elements.planBox.innerHTML.includes('成功到达'), '结果区呈现跨越结果：成功到达');
ok(elements.logBox.children.length > 5, `事件日志有记录（${elements.logBox.children.length} 条）`);
ok([...elements.logBox.children].some(c => c.textContent.includes('核验通过')), '日志含退出位置核验记录');

fire('resetBtn');
ts += 50; rafCb(ts);
ok(elements.statusLine.innerHTML.includes('空闲'), '重置后回到空闲');
ok(elements.logBox.children.length === 0, '重置清空日志');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);

// 演示关卡：七号维修舱段（侧视图，单位米）
// 含狭管（P1/P2）、梯面（L1/L2/L3）、牵引点（T1/T2/T3）
export const LEVEL = {
  name: '七号维修舱段',
  platforms: [
    { id: 'A', x1: 0,  x2: 8,  y: 0, label: 'A 下层左舱' },
    { id: 'B', x1: 10, x2: 18, y: 0, label: 'B 下层右舱' },
    { id: 'C', x1: 4,  x2: 14, y: 5, label: 'C 中层平台' },
    { id: 'D', x1: 20, x2: 26, y: 5, label: 'D 中层右台' },
    { id: 'E', x1: 20, x2: 26, y: 0, label: 'E 隔离间' },
    { id: 'F', x1: 30, x2: 36, y: 8, label: 'F 高位平台' },
  ],
  connections: [
    { id: 'L1', type: 'climb', a: 'A', b: 'C', x: 6,  width: 1.0 },
    { id: 'L2', type: 'climb', a: 'B', b: 'C', x: 12, width: 1.0 },
    { id: 'P1', type: 'crawl', a: 'A', b: 'B', entry: [8, 0],  exit: [10, 0], clearance: 0.7 },
    { id: 'T1', type: 'traction', a: 'A', b: 'B', anchor: [9, 6.5],  entry: [8, 0],  exit: [10, 0], cable: 8 },
    { id: 'P2', type: 'crawl', a: 'B', b: 'E', entry: [18, 0], exit: [20, 0], clearance: 0.55 },
    { id: 'L3', type: 'climb', a: 'D', b: 'E', x: 23, width: 1.0 },
    { id: 'T2', type: 'traction', a: 'C', b: 'D', anchor: [17, 11], entry: [14, 5], exit: [20, 5], cable: 8 },
    // T3 索长不足（锚距 D 端约 10.3m > 9m）：任何机型都无法进入，用于演示几何不可达
    { id: 'T3', type: 'traction', a: 'D', b: 'F', anchor: [31, 14], entry: [26, 5], exit: [30, 8], cable: 9 },
  ],
};

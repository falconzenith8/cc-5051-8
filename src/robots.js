// 机器人型号：同一连接对不同型号的可用性不同（能力 + 机身尺寸）
export const ROBOT_MODELS = {
  RX7: { id: 'RX7', name: 'RX-7 全能维修机', caps: { climb: true,  crawl: true,  traction: true  }, height: 0.9, width: 0.8, speed: { walk: 2.4, climb: 1.1, crawl: 0.9, traction: 2.0 } },
  SC3: { id: 'SC3', name: 'SC-3 高个攀爬机', caps: { climb: true,  crawl: true,  traction: false }, height: 1.5, width: 0.8, speed: { walk: 2.0, climb: 1.4, crawl: 0.7, traction: 0   } },
  MN2: { id: 'MN2', name: 'MN-2 微型钻探机', caps: { climb: false, crawl: true,  traction: false }, height: 0.5, width: 0.6, speed: { walk: 1.8, climb: 0,   crawl: 1.2, traction: 0   } },
  TR5: { id: 'TR5', name: 'TR-5 牵引工程机', caps: { climb: false, crawl: false, traction: true  }, height: 1.1, width: 0.9, speed: { walk: 2.2, climb: 0,   crawl: 0,   traction: 2.6 } },
  BS0: { id: 'BS0', name: 'BS-0 基础巡检机', caps: { climb: false, crawl: false, traction: false }, height: 1.0, width: 0.8, speed: { walk: 2.6, climb: 0,   crawl: 0,   traction: 0   } },
};

export function cloneRobot(model) {
  return { ...model, caps: { ...model.caps }, speed: { ...model.speed } };
}

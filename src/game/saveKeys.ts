/**
 * 存档键名的**唯一权威清单**（第 24 轮收尾）。
 *
 * 为什么要有这个文件：`tr→tf`、`tl/tt/tq→tmf/ttier`、`mp/pc→mpc`
 * 已经**撞过三次名**，每次都是"写到一半被 tsc 的 TS1117（同一对象字面量里
 * 重复属性）拦下、再回去改名"。tsc 能拦住错误，但拦不住"我又想用一个短键"。
 *
 * 所以把清单写进代码，并在冒烟里断言它与 `serialize()` 的真实输出**逐键一致**：
 *   - 序列化出来的每个键都必须在这里登记（防止偷偷加键）；
 *   - 这里登记的每个键都必须真的被序列化（防止清单过期）；
 *   - 两边的键数必须相同。
 * 于是"这个短键是不是已经有人用了"从**试错**变成**查表**。
 *
 * 值是该键的用途（取自 `serialize()` 里的赋值表达式，所以不会漂）。
 * 注意 `r` / `m` 是简写属性（资源表 / 材料表），也一并登记。
 */
export const SAVE_KEYS: Record<string, string> = {
  v: 'SAVE_VERSION',
  at: 'state.savedAt',
  b: '{ ...state.buildings }',
  ub: '{ ...state.unlockedBuildings }',
  ur: '{ ...state.discoveredRealms }',
  pl: '{ ...state.pills }',
  ar: '{ ...state.artifacts }',
  mn: '功法（设定集第 7 章）：完整功法 `mn`、碎片 `mf` | { ...state.manuals }',
  mf: '{ ...state.manualFragments }',
  gr: '装备库存 gr / 丹炉 fn + fd（设定集第 8.7 / 11 章） | { ...state.gears }',
  tmf: '符箓库存 tmf 与制符品阶 ttier（需求 8：这两个键名都是先查过整份表才定的） | { ...state.talismans }',
  ttier: 'state.talismanTier',
  fn: '[...state.furnaces]',
  fd: 'state.furnaceId',
  fm: '---- 声望 / 特质 / 外交 / 结局（设定集第 1 / 9 / 10 章） ---- | state.fame',
  fs: 'state.fameShop.offers.map((o) => ({ g: o.goodId, p: o.price }))',
  fst: 'state.fameShop.secondsLeft',
  tf: '特质 tf（不是 tr —— tr 已经被 sec.totalRecruited 用了，同名极易看错） | [...state.traits]',
  to: '[...state.traitOffer]',
  le: '[...state.legacyEndings]',
  ns: 'state.npcSects.map((s) => ({',
  ew: 'state.everDeclaredWar',
  mpc: 'state.everMadePeace',
  aw: '[...state.atWarWith]',
  wm: 'state.warTimer',
  pc: '{ ...state.parleyCooldowns }',
  rr: '{ ...state.realmRuns }',
  hp: 'state.happiness',
  sw: '{ ...state.spatialWards }',
  cv: 'state.caravan ?? undefined',
  cvt: 'state.caravanTimer',
  sa: 'state.sectArrayOn',
  gc: '{ ...state.gearCharges }',
  ri: 'state.realmIndex',
  li: 'state.layer',
  gb: 'state.globalBreakthroughBonus',
  mi: 'state.mind',
  mp: 'state.mindProgress',
  sv: '{ ...state.servants }',
  inj: 'state.injurySeconds',
  pv: 'state.personalTravel',
  ap: 'state.autoRefineProgress',
  art: '{ ...state.autoRefineTargets }',
  // 第 28 轮：自动的开关（与目标存量 art/act 分开）
  aro: '自动合成的开关（键 → true 即开着）',
  aco: '自动炼制的开关（键 → true 即开着）',
  // 第 27 轮（需求 3）：自动炼制。⚠️ act / art 只差一个字母，
  // 它们分别是"炼制"与"合成"的目标表 —— 语义写在这里，别再靠猜。
  act: '自动炼制的目标存量（丹药/器物/符箓 id → 目标数）',
  actm: '自动炼制的节拍（秒）',
  sd: '{ ...state.seeds }',
  pg: 'state.plantings',
  plt: 'state.plotTiers',
  npi: 'state.nextPlantingId',
  tc: '{ ...state.techs }',
  rs: 'state.research',
  bpr: '{ ...state.blueprints }',
  sh: 'state.shop',
  rc: '{ ...state.realmCooldowns }',
  or: '{ ...state.openedRealms }',
  df: 'state.discoveryFailures',
  bq: '[...state.buildQueue]',
  tl: 'state.tiangongLevel',
  ka: '善恶值与随机遭遇（需求 2）：ka 善恶值 / pe 待选遭遇 / et 遭遇判定计时 | state.karma',
  pe: 'state.pendingEncounter',
  et: 'state.encounterTimer',
  ed: 'state.encounterDeadline',
  en: '{ ...state.enlightenment }',
  eg: 'state.enlightening',
  sr: 'state.spaceRings',
  lj: 'state.lastTimeJump',
  ae: 'state.arenaEnabled',
  arn: 'state.arenaTimer',
  arb: 'state.arenaBuffSeconds',
  se: 'state.sectEventTimer',
  sn: '`wt` 天象 id / `ws` 天象剩余秒数 / `wr` 距下次天象判定秒数 | state.season',
  ss: 'state.seasonSeconds',
  wt: 'state.weatherId',
  ws: 'state.weatherSeconds',
  wr: 'state.weatherTimer',
  dy: 'state.daoYun.toString()',
  asc: 'state.ascensions',
  tq: 'state.totalQi.toString()',
  lq: 'state.lifetimeQi.toString()',
  sec: '{',
  ex: 'state.expeditions',
  jr: 'state.journal',
  al: 'state.alchemyTier',
  rf: 'state.refiningTier',
  bf: 'state.buffs',
  pt: 'state.playTime',
  nid: 'state.nextDiscipleId',
  r: '资源表（简写属性）',
  m: '材料表（简写属性）',
};

/** 键总数（冒烟用来对照序列化结果） */
export const SAVE_KEY_COUNT = Object.keys(SAVE_KEYS).length;

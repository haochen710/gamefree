/**
 * 弟子系统（需求 4 / 7）
 *
 * 一名弟子的一生由三件事驱动：
 *   资质  → 决定修炼速度和能修到的最高境界
 *   时间  → 每真实秒推进 30 游戏天，按速度累积修为
 *   寿元  → 到境界对应的寿元上限还没突破，就寿元耗尽而亡
 *
 * 这三条合起来，让"招收 → 培养 → 逐出低资质、补入高资质"成为长期决策：
 * 凡品灵根弟子也会慢慢变强，但永远追不上天灵根，而且会先老死。
 */
import Decimal, { D } from './decimal';
import { gameRandom, type RandomSource } from './random';
import {
  APTITUDE_MAP,
  APTITUDE_ORDER,
  COMBAT_TALENT_IDS,
  COMBAT_TALENT_MAP,
  DEMON_MAX,
  DEMON_MIN,
  DEMON_PER_ALLY_DEATH,
  DEMON_RELIEF_PER_BREAKTHROUGH,
  DEMON_RELIEF_PER_EXPEDITION,
  DESERT_CHANCE,
  DESERT_LOOT_RATIO,
  EXPEDITION_CULTIVATION_BONUS,
  FARM_TALENT_IDS,
  GAME_DAYS_PER_SECOND,
  GAME_DAYS_PER_YEAR,
  INSIGHT_SPEED_PER_POINT,
  LOYALTY_GAIN_EXPEDITION,
  LOYALTY_IDLE_DECAY,
  LOYALTY_IDLE_DECAY_SECONDS,
  LOYALTY_INITIAL,
  LOYALTY_LOSS_ALLY_DEATH,
  LOYALTY_MAX,
  MANUAL_MAP,
  LOYALTY_MIN,
  LOYALTY_NEGLECT_FLOOR,
  PERSONALITY_IDS,
  PERSONALITY_MAP,
  PILL_MAP,
  REALMS,
  demonTierOf,
  discipleCapBySect,
  loyaltyFloorOf,
  loyaltyTierOf,
  randomDiscipleName,
  recruitCost,
  rollAptitude,
} from './content';
import { getGearCasualtyReduction, getGearCultivationBonus, getGearPower } from './gear';
import {
  fameRecruitDiscount,
  getArtifactBonuses,
  getCultivationSpeedMultiplier,
  getInsightMax,
  getDiscipleCapacity,
  getDiscipleHousing,
  getStructureBonus,
  getTraitEffect,
hasTraitEffect,
} from './engine';
import {
  JOURNAL_LIMIT,
  type Disciple,
  type GameState,
  type JournalEntry,
} from './state';
import type { MaterialId } from './content';

/** 弟子一生最多一次跨多少个境界（防止极端离线时间把循环跑爆） */
const MAX_REALM_JUMPS = 32;

/**
 * 弟子的境界上限 = min(自身资质上限, 掌门当前境界)。
 *
 * 「弟子不得超越掌门」是修仙小说的通行设定，同时也解决了一个真实的平衡问题：
 * 没有这条限制，天灵根弟子会在两三天内修到仙人，把玩家自己的修行
 * 和整个宗门养成线彻底架空。加上之后，弟子的成长就跟着主线走。
 */
export function getDiscipleRealmCap(state: GameState, disciple: Disciple): number {
  return Math.min(APTITUDE_MAP[disciple.aptitude].capRealm, state.realmIndex);
}

/** 弟子停止成长的原因，用于界面提示 */
export function getDiscipleCapReason(
  state: GameState,
  disciple: Disciple,
): 'aptitude' | 'master' | null {
  if (disciple.realmIndex < getDiscipleRealmCap(state, disciple)) return null;
  return APTITUDE_MAP[disciple.aptitude].capRealm <= state.realmIndex ? 'aptitude' : 'master';
}

/* ------------------------------------------------------------------ */
/* 生成与招收                                                          */
/* ------------------------------------------------------------------ */

export function rollDisciple(
  sectLevel: number,
  id: number,
  random: RandomSource = gameRandom,
  /**
   * 「上古血脉」先天特质：新弟子资质上偏一档。
   *
   * ⚠️ 做成参数而不是在这里读 `state`：`rollDisciple` 的签名是
   * (宗门品阶, 编号, 随机源)，它**故意不持有 state** —— 模拟器与冒烟测试
   * 都直接调它来造弟子。为了一个特质就把它改成收 state，会让所有调用点
   * 都要先造一个假 state。所以由调用方（`recruitDisciple`）把结果传进来。
   */
  aptitudeUp = false,
): Disciple {
  let aptitude = rollAptitude(sectLevel, random);
  if (aptitudeUp) {
    // 抽两次取更好的那一次：相当于一次免费重抽，效果可解释
    const reroll = rollAptitude(sectLevel, random);
    if (APTITUDE_ORDER.indexOf(reroll) > APTITUDE_ORDER.indexOf(aptitude)) aptitude = reroll;
  }
  const [loyaltyMin, loyaltyMax] = LOYALTY_INITIAL[aptitude];
  return {
    id: `d${id}`,
    name: randomDiscipleName(random),
    aptitude,
    /*
     * 三个随机维度（设定集第 8 章）：战斗天赋、种田天赋、性格。
     * 加上资质，一名弟子就有四个互相独立的随机面 ——
     * "招到一个资质好、性格也好、天赋还对口的人"因此变成一个值得期待的事件。
     */
    combatTalent: COMBAT_TALENT_IDS[Math.floor(random() * COMBAT_TALENT_IDS.length)],
    farmTalent: FARM_TALENT_IDS[Math.floor(random() * FARM_TALENT_IDS.length)],
    personality: PERSONALITY_IDS[Math.floor(random() * PERSONALITY_IDS.length)],
    // 初始忠诚按资质给区间（资质越高越死心塌地）
    loyalty: loyaltyMin + random() * (loyaltyMax - loyaltyMin),
    // 新弟子心魔从 0 起（心魔是"练出来的"，不是天生的）
    demon: 0,
    // 功法要靠玩家去挣（碎片合成 / 秘境掉落），新弟子一律空手
    cultivationManual: '',
    combatManual: '',
    // 装备要靠玩家炼（设定集第 8.7 章），新弟子一律空手
    gear: { gain: '', attack: '', defense: '', pill1: '', pill2: '' },
    idleSeconds: 0,
    realmIndex: 0,
    // 给一点随机初始进度，免得同一批弟子永远整齐划一地一起突破
    progress: random() * 5,
    age: 16 + Math.floor(random() * 14),
    status: 'idle',
    insight: 0,
  };
}

/**
 * 心得带来的修行速度加成（需求 4：弟子探索后增加心得，加快进境）。
 *
 * 每点心得 +0.5%，上限随掌门境界增长（见 engine.getInsightMax）：
 * 炼气期 30 点（+15%）→ 渡劫期 270 点（+135%）。
 * （300 是「仙人」那一档，也就是 INSIGHT_MAX_ABSOLUTE，只用于存档清洗。）
 *
 * 早先上限写死 100 点（+100%），既是个墙（探索到顶之后心得就不涨了），
 * 又因为秘境从 8 处扩到 44 处而被摊薄到摸不着（实测最高 52）。
 * 现在上限跟着境界走，单点收益从 +1% 降到 +0.5% ——
 * 上限放开的同时不能让修行倍率随境界一起失控。
 */
export function getInsightSpeedBonus(state: GameState, disciple: Disciple): number {
  const capped = Math.min(disciple.insight, getInsightMax(state));
  return capped * INSIGHT_SPEED_PER_POINT;
}

/**
 * 弟子的综合修行速度倍率。
 *
 * = 资质 × (建筑 + 大比 + 心得 + 性格 + 忠诚档 + 修炼功法) × 心魔档
 *
 * ⚠️ 这里原来是 `资质 × (1 + 心得) × 建筑大比` —— 心得和建筑是**两个乘区**，
 * 而且大比在建筑那一项里又是乘算 ×2，三者互相放大：
 * 满配时 (1 + 心得) × (1 + 建筑) × 2 能到 ×9 以上（更早一版的实测是 ×7.4）。
 * 现在全部并进同一个加算池：
 *   1 + 功法殿 80% + 讲道堂 50% + 大比 50% + 心得 135% = ×4.15
 * 好处不只是"数字变小"：加算池不会随着以后再加内容而互相放大。
 *
 * 三个"池子"的分工（**这一条被写错过一次**，所以在此写明）：
 *   - **加算池**：建筑 / 大比 / 心得 / 性格 / **忠诚档** / 修炼功法 ——
 *     它们都是"加一点速度"，性质相同，加在一起才不会互相放大（单项 ±2%~30%）；
 *   - **乘区**：心魔 —— 它是"状态"而不是"加成"，用乘法才让高段位真正致命（×0.96 → ×0.75）；
 *   - **资质**：最外层的基底。
 *
 * 注释原先写着"忠诚档是乘区"，与代码不符 —— 忠诚档的数值本来就是小百分比
 * （离心 −5%、叛离 −12%、死忠 +5%），放进加算池才是它应有的分量。
 */
export function getDiscipleSpeed(state: GameState, disciple: Disciple): number {
  const aptitude = APTITUDE_MAP[disciple.aptitude].speed;
  const personality = PERSONALITY_MAP[disciple.personality];
  const loyaltyTier = loyaltyTierOf(disciple.loyalty);
  const demonTier = demonTierOf(disciple.demon);
  // 先天特质（星象亲和 +5% / 万载灵泉 +8%）也进这个加算池
  const additive =
    getCultivationSpeedMultiplier(state) +
    getInsightSpeedBonus(state, disciple) +
    getTraitEffect(state, 'cultivationBonus', 0);
  /*
   * 功法（设定集第 7 章）：修炼功法走**加算**（它本来就是"功法"这一类，
   * 与建筑/大比/心得同一性质），与性格一起进那个池子。
   */
  const manual = MANUAL_MAP[disciple.cultivationManual]?.cultivationBonus ?? 0;
  // 装备的增益栏（设定集第 8.7 章）：修行加成，与功法同一性质，进同一个加算池
  const gearBonus = getGearCultivationBonus(disciple);
  return (
    aptitude *
    (additive + personality.cultivationBonus + loyaltyTier.cultivationBonus + manual + gearBonus) *
    demonTier.cultivationMult
  );
}

/**
 * 弟子突破到下一境界所需的修为（年）。
 *
 * 设定集里的「小境界所需修为 −5% / −8%」（《碧髓凝真章》《九天归元秘》）
 * 就是作用在这一格上的：本作弟子的"小境界"就是这条进度。
 * 单独抽成函数是因为**界面也要用它**（如果界面按 `REALMS[r].cultivationYears`
 * 直接显示，装了减耗功法的弟子就会显示成"进度条永远差一点"）。
 */
export function getDiscipleRealmNeed(disciple: Disciple, realmIndex: number): number {
  const base = REALMS[Math.min(realmIndex, REALMS.length - 1)].cultivationYears;
  let reduction = 0;
  for (const id of [disciple.cultivationManual, disciple.combatManual]) {
    reduction += MANUAL_MAP[id]?.needReduction ?? 0;
  }
  return base * (1 - Math.min(0.3, reduction));
}

/**
 * 弟子**自己**受到的秘境伤亡率削减（战斗天赋 + 性格 + 忠诚档 + 功法）。
 *
 * 为什么挂"每人一份"而不是全宗一个系数：秘境的伤亡本来就是逐人掷骰
 * （`expeditions.resolveExpedition` 里对每个弟子各掷一次），
 * 所以把天赋挂在本人的骰子上最自然，也天然免疫"带 50 个人就无伤"。
 *
 * 上限 0.35 是一条**安全轨**，不是当前内容的实际天花板：
 * 现有内容里最高的一个人是「浴血奋战/铁甲体魄 3.5% + 好战 2% + 死忠 2%
 * + 《天地战章》12%」≈ **19.5%**（护山大阵另有减免口径，且是队伍级的另一层）。
 * 留这个数是为了以后加内容时不会悄悄突破到"免死"。
 */
export const MAX_PERSONAL_CASUALTY_REDUCTION = 0.35;

export function getDiscipleCasualtyReduction(disciple: Disciple): number {
  const talent = COMBAT_TALENT_MAP[disciple.combatTalent].casualtyReduction;
  const personality = PERSONALITY_MAP[disciple.personality].casualtyReduction;
  const loyalty = loyaltyTierOf(disciple.loyalty).casualtyReduction;
  // 战斗功法与修炼功法都可能带减伤（见 content/manuals.ts）
  let manuals = 0;
  for (const id of [disciple.cultivationManual, disciple.combatManual]) {
    manuals += MANUAL_MAP[id]?.casualtyReduction ?? 0;
  }
  // 装备的防御栏也在这里（设定集第 8.7 章：防御栏降低伤亡）
  const gear = getGearCasualtyReduction(disciple);
  return Math.min(MAX_PERSONAL_CASUALTY_REDUCTION, talent + personality + loyalty + manuals + gear);
}

/**
 * 队伍里所有弟子的**产出类**天赋加成（按项目取最高一项，不叠加）。
 *
 * 设定集里"同功法不可叠加，只取最高品级效果"，这里是同一个思路：
 * 一支队伍带上一个兽语通晓的和带十个，产出加成一样 —— 否则
 * "凑 50 个兽语通晓"就会变成唯一正解。
 */
export function getPartyTalentYieldBonus(state: GameState, ids: string[]): number {
  const byId = new Map(state.sect.disciples.map((d) => [d.id, d]));
  const party: Disciple[] = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (d) party.push(d);
  }
  return getPartyTalentYieldBonusOf(party);
}

/**
 * 同上，但直接收弟子对象。
 *
 * 秘境结算为了"逐人掷伤亡"已经把队伍取出来过一次了，
 * 再按 id 去全宗名册里找一遍是白费一趟 O(全宗人数) ——
 * 千人宗门下这一趟要被走上万次，模拟器就是这么慢下来的。
 */
export function getPartyTalentYieldBonusOf(party: Disciple[]): number {
  let talent = 0;
  let personality = 0;
  for (const d of party) {
    talent = Math.max(talent, COMBAT_TALENT_MAP[d.combatTalent].yieldBonus);
    personality = Math.max(personality, PERSONALITY_MAP[d.personality].yieldBonus);
  }
  return talent + personality;
}

/**
 * 全宗范围内的宗门防御贡献（**取最高一项**，不叠加）。
 *
 * 由 `encounter.getSectDefense` 读取 —— 也就是说战斗天赋与性格里的
 * 「宗门防御判定 +N」真的会进入妖兽袭宗 / 敌方偷袭的结算。
 */
export function getSectTalentDefense(state: GameState): number {
  let best = 0;
  for (const d of state.sect.disciples) {
    best = Math.max(best, COMBAT_TALENT_MAP[d.combatTalent].sectDefense);
    best = Math.max(best, PERSONALITY_MAP[d.personality].sectDefense);
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 忠诚度与心魔：读写工具                                                */
/* ------------------------------------------------------------------ */

export function clampLoyalty(value: number): number {
  return Math.min(LOYALTY_MAX, Math.max(LOYALTY_MIN, value));
}

export function clampDemon(value: number): number {
  return Math.min(DEMON_MAX, Math.max(DEMON_MIN, value));
}

/** 修改某名弟子的忠诚（自动夹到 0~100 与性格下限之间） */
export function adjustLoyalty(disciple: Disciple, delta: number): Disciple {
  const personality = PERSONALITY_MAP[disciple.personality];
  const floor = loyaltyFloorOf(disciple.aptitude, personality);
  const scaled = delta > 0 ? delta * personality.gainMult : delta * personality.decayMult;
  return { ...disciple, loyalty: Math.max(floor, clampLoyalty(disciple.loyalty + scaled)) };
}

/** 修改某名弟子的心魔（性格、天赋与功法都会放大/削减增长，下降不受影响） */
export function adjustDemon(disciple: Disciple, delta: number): Disciple {
  const personality = PERSONALITY_MAP[disciple.personality];
  let manualGuard = 0;
  for (const id of [disciple.cultivationManual, disciple.combatManual]) {
    manualGuard += MANUAL_MAP[id]?.demonGuard ?? 0;
  }
  const guard =
    COMBAT_TALENT_MAP[disciple.combatTalent].demonGuard + personality.demonGuard + manualGuard;
  if (delta > 0) {
    const mult = personality.demonMult * Math.max(0.2, 1 - guard);
    return { ...disciple, demon: clampDemon(disciple.demon + delta * mult) };
  }
  return { ...disciple, demon: clampDemon(disciple.demon + delta) };
}

/**
 * 批量结算：同小队弟子陨落 → 幸存者忠诚与心魔都受创；平安归来 → 忠诚小涨、心魔稍定。
 *
 * 一次探索只调一次（在 `resolveExpedition` 里），所以这里的复杂度是 O(队伍)。
 */
export function settlePartyAfterExpedition(
  state: GameState,
  survivorIds: string[],
  perished: number,
  lostAlly: boolean,
): GameState {
  if (survivorIds.length === 0) return state;
  const set = new Set(survivorIds);
  return {
    ...state,
    sect: {
      ...state.sect,
      disciples: state.sect.disciples.map((d) => {
        if (!set.has(d.id)) return d;
        const personality = PERSONALITY_MAP[d.personality];
        let next = d;
        if (lostAlly) {
          // 同门陨落：忠诚下跌（重义翻倍），心神受创
          next = adjustLoyalty(next, -LOYALTY_LOSS_ALLY_DEATH * personality.allyDeathMult);
          next = adjustDemon(next, DEMON_PER_ALLY_DEATH * perished);
        } else {
          // 圆满归来：忠诚小涨，心魔稍定
          next = adjustLoyalty(next, LOYALTY_GAIN_EXPEDITION);
          next = adjustDemon(next, -DEMON_RELIEF_PER_EXPEDITION);
        }
        return next;
      }),
    },
  };
}

/**
 * 全宗化解心魔（清心丹）。
 *
 * 与"心魔是个人问题"的原则不冲突：丹药是**玩家主动花钱**买的一次全宗静心，
 * 而不是某个弟子的行为牵连全宗。
 */
export function relieveDemonAll(state: GameState, amount: number): GameState {
  if (state.sect.disciples.length === 0) return state;
  return {
    ...state,
    sect: {
      ...state.sect,
      disciples: state.sect.disciples.map((d) => adjustDemon(d, -amount)),
    },
  };
}

/**
 * 任务途中叛逃（设定集第 8.6 章）。
 *
 * 只在**探索结算的那一刻**对参战弟子掷一次骰。这样做有两个好处：
 *   1. 叛逃永远发生在玩家看得见的场合（一趟队伍归来），而不是角落里静默消失；
 *   2. 掷骰的规模被队伍人数（≤50）框住 —— 千人宗门也不会每帧掉人。
 *
 * 触发条件是"忠诚低于性格阈值"：守道与恬淡的阈值是 0（永不叛逃），
 * 重义 15、好战 / 孤傲 20、贪利 40。
 */
export interface DesertionResult {
  state: GameState;
  deserters: { id: string; name: string; greedy: boolean }[];
}

export function rollDesertion(state: GameState, ids: string[], random: RandomSource): DesertionResult {
  const set = new Set(ids);
  const deserters: DesertionResult['deserters'] = [];
  for (const d of state.sect.disciples) {
    if (!set.has(d.id)) continue;
    const personality = PERSONALITY_MAP[d.personality];
    if (personality.desertBelow <= 0) continue;
    if (loyaltyTierOf(d.loyalty).neverDesert) continue;
    if (d.loyalty >= personality.desertBelow) continue;
    if (random() < DESERT_CHANCE) {
      deserters.push({ id: d.id, name: d.name, greedy: personality.id === 'greedy' });
    }
  }
  if (deserters.length === 0) return { state, deserters };

  const gone = new Set(deserters.map((x) => x.id));
  let next: GameState = {
    ...state,
    sect: { ...state.sect, disciples: state.sect.disciples.filter((d) => !gone.has(d.id)) },
  };

  // 贪利弟子叛逃会**带走一部分仓库材料**（设定集：贪利叛逃带走物资）
  const greedyCount = deserters.filter((x) => x.greedy).length;
  if (greedyCount > 0) {
    const taken = Math.min(0.5, DESERT_LOOT_RATIO * greedyCount);
    const materials = { ...next.materials };
    for (const key of Object.keys(materials) as MaterialId[]) {
      materials[key] = materials[key].mul(1 - taken);
    }
    next = { ...next, materials };
  }

  return { state: next, deserters };
}

/**
 * 这名弟子现在是否**拒绝执行任务**（心魔 61 以上）。
 *
 * 用在"选择弟子"的名单里：拒绝派遣的人会灰掉并写明原因，
 * 而不是被静默排除（静默排除会让玩家以为界面坏了）。
 */
export function isRefusingTask(disciple: Disciple): boolean {
  return demonTierOf(disciple.demon).refuseTask;
}

/** 拒绝高风险秘境（恬淡） */
export function refusesHighRisk(disciple: Disciple): boolean {
  return PERSONALITY_MAP[disciple.personality].refuseHighRisk;
}

/** 界面用：忠诚档名 / 心魔档名 */
export function describeLoyalty(disciple: Disciple): string {
  return loyaltyTierOf(disciple.loyalty).name;
}

export function describeDemon(disciple: Disciple): string {
  return demonTierOf(disciple.demon).name;
}

/**
 * 弟子**实际**的修行速度 —— 即"派遣中"那一层加成也算进去（本轮需求 10）。
 *
 * 需求原文：「弟子应当可以在派遣（包括探索）的过程中，获取经验值，加快修炼速度」。
 * `tickDisciples` 与界面都用这一个函数，免得"界面显示的速度"和
 * "实际涨修为的速度"各算各的（这正是最容易被玩家抓到的那种 bug）。
 */
export function getDiscipleEffectiveSpeed(state: GameState, disciple: Disciple): number {
  const base = getDiscipleSpeed(state, disciple);
  return disciple.status === 'exploring' ? base * (1 + EXPEDITION_CULTIVATION_BONUS) : base;
}

export interface RecruitResult {
  state: GameState;
  disciple: Disciple | null;
  reason: string | null;
}

/**
 * 招收一名弟子的花费（灵石）。
 *
 * 声望段位越高越便宜（设定集第 9 章）：名气就是"别人愿意来"，
 * 愿意来的人多，价码自然下去 —— 折扣上限 20%，由 `FAME_TIERS` 表兜住。
 */
export function getRecruitCost(state: GameState): Decimal {
  const base = recruitCost(state.sect.level, state.sect.disciples.length);
  return D(base).mul(D(1 - fameRecruitDiscount(state)));
}

export function canRecruit(state: GameState): { ok: boolean; reason: string | null } {
  if (!state.sect.founded) return { ok: false, reason: '尚未开宗立派' };
  if (state.sect.disciples.length >= getDiscipleCapacity(state)) {
    /*
     * 需求 1 / 2：上限有两条线（弟子居所 / 宗门品阶），提示要说清是哪一条卡住了，
     * 否则玩家会去升错东西。另外"一座弟子居所都没有"要说成"还没盖"，
     * 而不是"已满"—— 老存档（房子都是仆役居所）一读进来就是这种状态。
     */
    const housing = getDiscipleHousing(state);
    const bySect = discipleCapBySect(state.sect.level);
    if (housing === 0) {
      return { ok: false, reason: '尚无弟子居所，先去「建筑」页建一座（仆役居所不能住弟子）' };
    }
    return {
      ok: false,
      reason: housing <= bySect ? '弟子居所已满，需在「建筑」页再建居所' : '宗门品阶限制了弟子人数，需晋升品阶',
    };
  }
  if (state.resources.stone.lt(getRecruitCost(state))) {
    return { ok: false, reason: '灵石不足' };
  }
  return { ok: true, reason: null };
}

export function recruitDisciple(state: GameState, random: RandomSource = gameRandom): RecruitResult {
  const check = canRecruit(state);
  if (!check.ok) return { state, disciple: null, reason: check.reason };

  const cost = getRecruitCost(state);
  const disciple = rollDisciple(
    state.sect.level,
    state.nextDiscipleId,
    random,
    // 上古血脉（先天特质）：资质抽取上偏一档
    hasTraitEffect(state, 'aptitudeUp'),
  );

  const next: GameState = {
    ...state,
    resources: { ...state.resources, stone: state.resources.stone.sub(cost) },
    sect: {
      ...state.sect,
      disciples: [...state.sect.disciples, disciple],
      totalRecruited: state.sect.totalRecruited + 1,
    },
    nextDiscipleId: state.nextDiscipleId + 1,
  };

  return { state: next, disciple, reason: null };
}

/** 逐出弟子（需求 7：后期清理低资质弟子） */
export function dismissDisciple(state: GameState, id: string): GameState {
  const disciple = state.sect.disciples.find((d) => d.id === id);
  if (!disciple || disciple.status === 'exploring') return state;

  return {
    ...state,
    sect: { ...state.sect, disciples: state.sect.disciples.filter((d) => d.id !== id) },
  };
}

/** 一次性逐出所有低于指定资质的空闲弟子 */
export function dismissBelowAptitude(state: GameState, keepFrom: number): { state: GameState; count: number } {
  const kept: Disciple[] = [];
  let removed = 0;
  for (const d of state.sect.disciples) {
    const rank = aptitudeRank(d.aptitude);
    if (d.status === 'idle' && rank < keepFrom) {
      removed += 1;
    } else {
      kept.push(d);
    }
  }
  if (removed === 0) return { state, count: 0 };
  return { state: { ...state, sect: { ...state.sect, disciples: kept } }, count: removed };
}

/* ------------------------------------------------------------------ */
/* 资质与战力                                                          */
/* ------------------------------------------------------------------ */

export function aptitudeRank(id: string): number {
  const index = APTITUDE_ORDER.indexOf(id as never);
  return index < 0 ? 0 : index;
}

/**
 * 弟子的战力（受境界、丹药增益、器物与宗门建筑加成影响）。
 *
 * 宗门建筑这一项是需求 4 的「武技阁」：声明了 `disciplePowerBonus: 0.08`
 * 却一度没接线 —— 界面上写着 +8%/座、模拟器也按它有值来估值，
 * 但实际战力算不出来。这是文档核对时被翻出来的。
 */
export function getDisciplePower(state: GameState, disciple: Disciple): number {
  const base = REALMS[Math.min(disciple.realmIndex, REALMS.length - 1)].power;
  const multiplier =
    state.buffs.powerMultiplier *
    (1 + getArtifactBonuses(state).combat + getStructureBonus(state, 'disciplePowerBonus'));
  return base * multiplier;
}

/** 探索队伍的总战力 */
/**
 * 队伍战力。
 *
 * ⚠️ 这里必须把**装备的进攻栏**算进去 —— 否则"进攻栏"就只是一个好看的空位。
 * 装备的战力按"每人自己的"相加（与秘境伤亡不同：伤亡是逐人掷骰，
 * 而战力本来就是队伍级的汇总）。
 */
export function getPartyPower(state: GameState, ids: string[]): number {
  const byId = new Map(state.sect.disciples.map((d) => [d.id, d]));
  return ids.reduce((sum, id) => {
    const d = byId.get(id);
    // 装备的进攻栏战力算在本人身上（读取点：这里）
    return d ? sum + getDisciplePower(state, d) + getGearPower(d) : sum;
  }, 0);
}

/* ------------------------------------------------------------------ */
/* 时间推进                                                            */
/* ------------------------------------------------------------------ */

function pushJournal(journal: JournalEntry[], entry: JournalEntry): JournalEntry[] {
  const next = [entry, ...journal];
  return next.length > JOURNAL_LIMIT ? next.slice(0, JOURNAL_LIMIT) : next;
}

/**
 * 推进所有弟子的修炼与年龄。
 *
 * 返回新 state，同时把寿元耗尽 / 突破境界 / 卡在丹药上写进宗门记事。
 * 死去的弟子会从进行中的探索队伍里一并移除。
 *
 * 本轮需求 9 起，**弟子的大境界突破也要消耗仓库里的境界丹**：
 * 修为攒满但仓库没有对应丹药时，弟子会**卡在瓶颈**（进度停在临界点，
 * 不会浪费修为），并在宗门记事里说明"缺哪一味丹"。
 * 这是"突破对丹药的需求很强烈"落在弟子身上的那一半。
 */
export function tickDisciples(state: GameState, dt: number): GameState {
  if (state.sect.disciples.length === 0 || dt <= 0) return state;

  const years = (dt * GAME_DAYS_PER_SECOND) / GAME_DAYS_PER_YEAR;
  if (years <= 0) return state;

  const lifespanBonus = 1 + state.sect.lifespanBonus;
  const survivors: Disciple[] = [];
  const deadIds = new Set<string>();
  // 弟子突破要吃的丹药从这里扣；一次 tick 内多名弟子共用这一份账
  const pills = { ...state.pills };
  let journal = state.journal;
  let changed = false;

  /*
   * 静心阁的持续压制（设定集第 14.3 章"压制/清除手段"之一）。
   *
   * 按**真实分钟**算而不是按游戏年：心魔是给真人看的一条压力线，
   * 挂在纪年上会因为"一年只有 8 分钟"而变成一夜之间全员入魔。
   * 数值取建筑定义里的 `mindDrain`（每座 0.02/分钟，最多 12 座 = 0.24/分钟）——
   * 盖满之后大约一小时能压掉 14 点，刚好抵得上一次伤亡惨重的探索带来的涨幅。
   */
  const demonDrain = getStructureBonus(state, 'mindDrain') * (dt / 60);

  for (const disciple of state.sect.disciples) {
    const age = disciple.age + years;
    /*
     * ⚠️ 年龄一变，这次推进就必然产生了新状态。
     *
     * 这一行是补上来的 bug 修复：`changed` 原先只在"突破 / 修为有变 / 死亡"时置位，
     * 于是**修为没有变化的弟子根本不会变老** —— 卡在境界上限、或者进度刚好
     * 四舍五入到同一个值的弟子，年龄会永远停在那里。
     * 加了纪年（需求 1）之后这个洞更明显：时间在走，人却不老。
     */
    changed = true;

    /* --- 修为推进：可能一次跨越多个境界（离线很久时） --- */
    const realmCap = getDiscipleRealmCap(state, disciple);
    let realmIndex = disciple.realmIndex;
    let progress = disciple.progress;
    // 心得、宗门建筑、大比、以及"在外历练"全都在这里一起生效
    // （需求 4 / 本轮需求 10）
    let remaining = years * getDiscipleEffectiveSpeed(state, disciple);
    let jumps = 0;

    while (remaining > 0 && realmIndex < realmCap && jumps < MAX_REALM_JUMPS) {
      const def = REALMS[realmIndex];
      // 装了《碧髓凝真章》这类功法的弟子，突破所需修为会少一截
      const need = getDiscipleRealmNeed(disciple, realmIndex);
      if (def.cultivationYears <= 0 || need <= 0) break;

      const toNext = need - progress;
      if (remaining >= toNext) {
        /*
         * 需求 9：大境界突破**必须**有一颗对应境界丹。
         * 仓库没有就把进度停在临界点上等 —— 攒下的修为不丢，
         * 只是过不去（记一条日志说明缺什么，否则玩家只会看到"弟子不涨了"）。
         */
        const pillId = def.breakthroughPill;
        const have = pillId ? (pills[pillId] ?? 0) : 0;
        if (!pillId || have <= 0) {
          // 只在"刚刚顶到瓶颈"的那一帧记日志，不然每帧都会刷一条
          if (disciple.progress < need) {
            const pill = PILL_MAP[pillId];
            journal = pushJournal(journal, {
              time: state.playTime,
              kind: 'info',
              text: `${disciple.name} 修为已满${def.name}，只差一味${pill?.name ?? '突破丹'}便可破境`,
            });
          }
          progress = need;
          break;
        }

        if (have > 1) pills[pillId] = have - 1;
        else delete pills[pillId];

        remaining -= toNext;
        realmIndex += 1;
        progress = 0;
        jumps += 1;
      } else {
        progress += remaining;
        remaining = 0;
      }
    }

    if (realmIndex !== disciple.realmIndex) {
      changed = true;
      journal = pushJournal(journal, {
        time: state.playTime,
        kind: 'good',
        text: `${disciple.name} 突破至${REALMS[realmIndex].name}`,
      });
    } else if (progress !== disciple.progress) {
      changed = true;
    }
    /* --- 寿元判定 --- */
    const lifespan = REALMS[realmIndex].lifespan * lifespanBonus;
    if (age > lifespan) {
      changed = true;
      deadIds.add(disciple.id);
      journal = pushJournal(journal, {
        time: state.playTime,
        kind: 'bad',
        text: `${disciple.name} 寿元耗尽，于${REALMS[realmIndex].name}坐化`,
      });
      continue;
    }

    /* --- 忠诚度与心魔（设定集第 8.6 / 14.3 章） --- */
    const personality = PERSONALITY_MAP[disciple.personality];
    // 出门在外就不算闲置；闲着才掉忠诚
    let idleSeconds = disciple.status === 'exploring' ? 0 : disciple.idleSeconds + dt;
    let loyalty = disciple.loyalty;
    if (idleSeconds >= LOYALTY_IDLE_DECAY_SECONDS) {
      const steps = Math.floor(idleSeconds / LOYALTY_IDLE_DECAY_SECONDS);
      idleSeconds -= steps * LOYALTY_IDLE_DECAY_SECONDS;
      /*
       * 地板取"闲置地板"与"性格地板"里更高的那个：
       * 闲置最多把人磨到寻常（45），性格地板（天纵 30）比它低，
       * 所以正常情况下闲置这一条永远不会把人推到离心 —— 那要靠真出事。
       */
      const floor = Math.max(LOYALTY_NEGLECT_FLOOR, loyaltyFloorOf(disciple.aptitude, personality));
      loyalty = Math.max(
        floor,
        clampLoyalty(loyalty - steps * LOYALTY_IDLE_DECAY * personality.decayMult),
      );
    }
    // 心魔：静心阁持续压制 + 破境成功心病自消
    let demon = disciple.demon;
    if (demonDrain > 0 && demon > 0) demon = clampDemon(demon - demonDrain);
    if (realmIndex !== disciple.realmIndex) {
      /*
       * 破境成功 → 心魔 −3（设定集：悟道/破境能"降低心魔增速"）。
       *
       * ⚠️ 这一条原本写成了 `relieveDemonOnBreakthrough()` 却**没人调用** ——
       * 函数在、效果在描述里、实际永远不生效。现在直接在这里结算。
       */
      demon = clampDemon(demon - DEMON_RELIEF_PER_BREAKTHROUGH);
    }

    survivors.push({ ...disciple, age, realmIndex, progress, loyalty, demon, idleSeconds });
  }

  if (!changed) return state;

  /* --- 清理阵亡弟子所属的探索队伍 --- */
  let expeditions = state.expeditions;
  if (deadIds.size > 0) {
    expeditions = state.expeditions
      .map((e) => ({ ...e, discipleIds: e.discipleIds.filter((id) => !deadIds.has(id)) }))
      .filter((e) => e.discipleIds.length > 0);
  }

  return {
    ...state,
    pills,
    sect: { ...state.sect, disciples: survivors },
    expeditions,
    journal,
  };
}

/**
 * 给弟子加心得，并**自动夹到上限**。
 *
 * 心得有三条来源（秘境探索 / 普通探索 / 掌门游历），原先各自裸加，
 * 只有大比与建筑事件那条路夹了上限 —— 于是字段会涨到 256/240 这种值。
 * 效果本身不受影响（`getDiscipleSpeed` 取 min），但界面会出现「心得 256/240」，
 * 报告里的"最高心得"读数也会被虚高的字段带偏。
 * 统一走这一个函数，三处来源就不会再各自漂。
 */
export function addInsight(state: GameState, disciple: Disciple, gain: number): Disciple {
  return { ...disciple, insight: Math.min(getInsightMax(state), disciple.insight + gain) };
}

/** 把弟子标记为探索中 / 空闲 */
export function setDiscipleStatus(
  state: GameState,
  ids: string[],
  status: Disciple['status'],
  expeditionId?: string,
): GameState {
  const set = new Set(ids);
  return {
    ...state,
    sect: {
      ...state.sect,
      disciples: state.sect.disciples.map((d) =>
        set.has(d.id) ? { ...d, status, expeditionId: status === 'exploring' ? expeditionId : undefined } : d,
      ),
    },
  };
}

export { pushJournal };

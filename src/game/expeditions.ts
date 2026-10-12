/**
 * 秘境探索（需求 1 / 5）
 *
 * 一次探索的生命周期：
 *   发现 ──► 派遣（minParty~maxParty）──► 按探索速度累积进度
 *        ──► 结算产出 / 伤亡 / 心得 / 发现新秘境 ──► 该秘境进入冷却
 *
 * 需求 1 的三条硬性要求在这里落实：
 *   「弟子或者玩家探索发现」   → discovery 判定（个人游历里也有一份）
 *   「发现后固定在秘境栏」     → state.discoveredRealms 只增不减
 *   「每次探索后需要隔一段时间」→ 结算时写入 realmCooldowns
 *   「人越多最终获取的资源越多」→ 数量系数 + 掉落条目数都随人数增长
 *
 * 结算的核心量：
 *   战力比 = 队伍战力 / 秘境推荐战力
 *   人数系数 = 1 + (人数 - minParty) × PARTY_YIELD_PER_EXTRA
 *   产出   = 基础 × clamp(战力比, 0.5, 3) × 人数系数 × 增益 × 随机浮动
 *   伤亡率 = 基础伤亡率 / 战力比 × (1 - 减免)
 */
import { D } from './decimal';
import { gameRandom, randomId, weightedDraw, type RandomSource } from './random';
import {
  BLUEPRINTS,
  EXPLORATION_SEEDS,
  INSIGHT_PER_EXPEDITION,
  INSIGHT_PER_REALM_LEVEL,
  ITEM_MAP,
  HIGH_RISK_CASUALTY,
  LOYALTY_LOSS_HIGH_RISK,
  LOOT_ROLLS,
  LOOT_ROLLS_MAX,
  LOOT_ROLLS_PER_EXTRA,
  MAX_CASUALTY_RATE,
  MAX_YIELD_FACTOR,
  MIN_YIELD_FACTOR,
  PARTY_YIELD_PER_EXTRA,
  PILL_DROP_CHANCE,
  PILL_MAP,
  REALMS,
  SECRET_REALMS,
  SECRET_REALM_MAP,
  SEED_MAP,
  SEED_ROLLS,
  SURVEY_BASE_KINDS_MAX,
  SURVEY_BASE_KINDS_MIN,
  SURVEY_DURATION_RATIO,
  SURVEY_MAX_PARTY,
  SURVEY_RARE_CHANCE,
  SURVEY_YIELD_MULT,
  YIELD_VARIANCE_MAX,
  YIELD_VARIANCE_MIN,
  MAP_REGION_MAP,
  expeditionSlots,
  getSurveyLoot,
  isBasicMaterial,
  isRareMaterial,
  realmCountOfRegion,
  realmsOfRegion,
  regionTier,
  surveyReachRealm,
  type ItemId,
  type LootEntry,
  type MaterialId,
  type SecretRealmDef,
} from './content';
import {
  addItem,
  discoverRealm,
  getArtifactBonuses,
  getDiscoveryChance,
  getFarmTalentBonus,
  getRealmCooldown,
  getStructureBonus,
  getTraitEffect,
  getUndiscoveredCandidates,
  isDiscoveryGuaranteed,
  isRealmAvailable,
  isRealmOpened,
  isRealmDiscovered,
  recordDiscoveryFailure,
  consumeGear,
} from './engine';
import { getPartyManualYieldBonusOf, rollFragmentDrop, salvageManualsOnDeath } from './manuals';
import { consumePartyPills, getPartyPillSafety } from './gear';
import { changeFame, fameFromRealm, fameFromSurvey } from './fame';
import {
  addInsight,
  adjustLoyalty,
  getDiscipleCasualtyReduction,
  getPartyPower,
  getPartyTalentYieldBonusOf,
  isRefusingTask,
  pushJournal,
  refusesHighRisk,
  rollDesertion,
  setDiscipleStatus,
  settlePartyAfterExpedition,
} from './disciples';
import { getEnvironmentMaterialBonus, getWeatherEffects } from './season';
import { getKarmaExploreBonus } from './encounter';
import { getElementMaterialBonus, getSpaceExploreBonus } from './enlightenment';
import { addSeeds } from './planting';
import type { Disciple, Expedition, GameState } from './state';

/* ------------------------------------------------------------------ */
/* 校验与选人                                                          */
/* ------------------------------------------------------------------ */

/** 尚未发现的秘境数量（界面上给个「还有几处没找到」的目标感） */
export function getUndiscoveredCount(state: GameState): number {
  return SECRET_REALMS.filter((def) => !isRealmDiscovered(state, def)).length;
}

export function getMaxExpeditions(state: GameState): number {
  if (!state.sect.founded) return 0;
  return expeditionSlots(state.sect.level);
}

export function getIdleDisciples(state: GameState): Disciple[] {
  return state.sect.disciples.filter((d) => d.status === 'idle');
}

export interface StartCheck {
  ok: boolean;
  reason: string | null;
}

/**
 * 循环探索的次数上限（本轮需求 4）。
 *
 * 需求原文：「弟子探索可以设置循环多次探索，上限 30 次」。
 * 设上限是因为一支队伍挂上 30 趟之后，冷却 + 时长合起来可能要跑现实里好几个小时，
 * 再往上加只会让人忘了自己排过队。
 */
export const MAX_EXPEDITION_REPEAT = 30;

/** 把玩家填的次数夹到 1~30 */
export function clampRepeat(repeat: number): number {
  if (!Number.isFinite(repeat)) return 1;
  return Math.max(1, Math.min(MAX_EXPEDITION_REPEAT, Math.floor(repeat)));
}
export function canStartExpedition(state: GameState, realmId: string, ids: string[]): StartCheck {
  const def = SECRET_REALM_MAP[realmId];
  if (!def) return { ok: false, reason: '秘境不存在' };
  if (!state.sect.founded) return { ok: false, reason: '尚未开宗立派' };
  if (!isRealmDiscovered(state, def)) return { ok: false, reason: '尚未发现此秘境' };
  // 需求 1：资源富集区的秘境要先花资源开启
  if (!isRealmOpened(state, def)) return { ok: false, reason: '尚未开启，需先立阵眼' };
  if (!isRealmAvailable(state, def)) {
    const cooldown = getRealmCooldown(state, def.id);
    if (cooldown > 0) return { ok: false, reason: `冷却中，还需 ${Math.ceil(cooldown)} 秒` };
    return { ok: false, reason: '此地暂时去不了' };
  }
  if (state.expeditions.length >= getMaxExpeditions(state)) {
    return { ok: false, reason: '探索队伍已满，提升宗门品阶可增加队伍' };
  }
  if (ids.length < def.minParty) {
    return { ok: false, reason: `至少需派遣 ${def.minParty} 名弟子` };
  }
  if (ids.length > def.maxParty) {
    return { ok: false, reason: `最多可派遣 ${def.maxParty} 名弟子` };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, reason: '同一名弟子不能重复派遣' };
  }

  const byId = new Map(state.sect.disciples.map((d) => [d.id, d]));
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) return { ok: false, reason: '弟子不存在' };
    if (d.status !== 'idle') return { ok: false, reason: `${d.name} 正在探索中` };
    if (d.realmIndex < def.minRealm) {
      return { ok: false, reason: `需${REALMS[def.minRealm].name}以上弟子` };
    }
    /*
     * 心魔与性格会让人**拒绝执行任务**（设定集第 8.5 / 14.3 章）。
     *
     * 两条都做成硬性拒绝、并把原因写在按钮上：
     * 设定集原文说的是"有概率无故拒绝"，但概率拒绝在界面上无法表达 ——
     * 玩家点下"派遣"却什么也没发生，只会以为是 bug。
     * 硬拒绝 + 明确提示，玩家一眼就知道"这个人现在不能用，得先给他清心"。
     */
    if (isRefusingTask(d)) {
      return { ok: false, reason: `${d.name} 心魔缠身，拒绝出征（先服清心丹或建静心阁）` };
    }
    if (def.baseCasualty >= HIGH_RISK_CASUALTY && refusesHighRisk(d)) {
      return { ok: false, reason: `${d.name} 性情恬淡，拒绝前往如此凶险之地` };
    }
  }
  return { ok: true, reason: null };
}

/**
 * 自动挑一队满足条件且战力最高的空闲弟子（界面上「推荐队伍」用）。
 *
 * 默认按 maxParty 满编 —— 「人越多最终获取的资源越多」，
 * 空闲弟子闲着也是闲着。
 *
 * ⚠️ 这里必须排掉"拒绝出征"的人（心魔缠身 / 恬淡拒绝高危），
 * 否则"推荐队伍"会推荐出一个 `canStartExpedition` 判定为不合法的组合，
 * 玩家点了派遣却失败，还得自己去找是谁的问题。
 */
export function autoSelectParty(state: GameState, realmId: string, size?: number): string[] {
  const def = SECRET_REALM_MAP[realmId];
  if (!def) return [];

  const highRisk = def.baseCasualty >= HIGH_RISK_CASUALTY;
  const candidates = getIdleDisciples(state)
    .filter((d) => d.realmIndex >= def.minRealm)
    .filter((d) => !isRefusingTask(d))
    .filter((d) => !(highRisk && refusesHighRisk(d)))
    .sort((a, b) => REALMS[b.realmIndex].power - REALMS[a.realmIndex].power);

  const want = Math.max(def.minParty, Math.min(size ?? def.maxParty, def.maxParty));
  return candidates.slice(0, want).map((d) => d.id);
}

/* ------------------------------------------------------------------ */
/* 开始探索                                                            */
/* ------------------------------------------------------------------ */

export function startExpedition(
  state: GameState,
  realmId: string,
  ids: string[],
  random: RandomSource = gameRandom,
  /** 连做几趟（本轮需求 4，上限 MAX_EXPEDITION_REPEAT） */
  repeat = 1,
): GameState {
  const check = canStartExpedition(state, realmId, ids);
  if (!check.ok) return state;

  const def = SECRET_REALM_MAP[realmId];
  if (!def) return state;

  const expedition: Expedition = {
    // 用随机 id 而不是 playTime：同一时刻派出两支队伍时，
    // 基于时间的 id 会撞车，结算时就会误删另一支队伍
    id: randomId('e', random),
    realmId,
    discipleIds: [...ids],
    progress: 0,
    duration: def.duration,
    kind: 'realm',
    repeatLeft: clampRepeat(repeat),
  };

  const withStatus = setDiscipleStatus(state, ids, 'exploring', expedition.id);
  const names = ids
    .map((id) => state.sect.disciples.find((d) => d.id === id)?.name ?? '?')
    .join('、');

  /*
   * 指派高危秘境会让人不满（设定集第 8.6 章「指派极高风险任务 −10~20」）。
   *
   * 取了个温和值（−4）：本作的秘境伤亡率到极危是 40%，一趟下来常常真的要死人，
   * 按设定集那个量级来扣，玩家的每一支队伍打完两趟就全部离心了 ——
   * 那不是"取舍"，那是"不许打"。所以这里只作为**长期消耗**存在，
   * 与"圆满归来 +3"形成一个"打得稳就涨、硬拼就掉"的平衡。
   */
  const withLoyalty =
    def.baseCasualty >= HIGH_RISK_CASUALTY
      ? {
          ...withStatus,
          sect: {
            ...withStatus.sect,
            disciples: withStatus.sect.disciples.map((d) =>
              ids.includes(d.id) ? adjustLoyalty(d, -LOYALTY_LOSS_HIGH_RISK) : d,
            ),
          },
        }
      : withStatus;

  return {
    ...withLoyalty,
    expeditions: [...withLoyalty.expeditions, expedition],
    journal: pushJournal(withLoyalty.journal, {
      time: withLoyalty.playTime,
      kind: 'info',
      text: `${names} 启程探索${def.name}（${ids.length} 人）`,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 结算                                                                */
/* ------------------------------------------------------------------ */

export interface ExpeditionOutcome {
  realmName: string;
  gains: { id: ItemId; amount: number; name: string; icon: string }[];
  pills: { id: string; amount: number; name: string; icon: string }[];
  /** 本次掉到的功法碎片（设定集第 7 章） */
  fragments: { id: string; amount: number; name: string; grade: number }[];
  /** 带回的材料种子（需求 5） */
  seeds: { material: MaterialId; amount: number; name: string; icon: string }[];
  /** 寻获的图纸（需求 6） */
  blueprints: { id: string; name: string; icon: string }[];
  /** 本次新发现的秘境（需求 1） */
  discovered: { id: string; name: string; icon: string } | null;
  /** 队员们获得的心得（需求 4） */
  insight: number;
  casualties: string[];
  powerRatio: number;
  partySize: number;
}

/** 人数系数：超出最少人数的部分每人 +40% */
export function getPartySizeFactor(def: SecretRealmDef, partySize: number): number {
  const extra = Math.max(0, partySize - def.minParty);
  return 1 + extra * PARTY_YIELD_PER_EXTRA;
}

/** 掉落条目数：人数越多抽得越多 */
export function getLootRolls(def: SecretRealmDef, partySize: number): number {
  const extra = Math.max(0, partySize - def.minParty);
  return Math.min(LOOT_ROLLS + extra * LOOT_ROLLS_PER_EXTRA, LOOT_ROLLS_MAX);
}

/** 一次探索给每名参与者多少心得 */
export function getExpeditionInsight(state: GameState, def: SecretRealmDef): number {
  const base = INSIGHT_PER_EXPEDITION + def.minRealm * INSIGHT_PER_REALM_LEVEL;
  return Math.max(1, Math.round(base * (1 + getStructureBonus(state, 'insightBonus'))));
}

/**
 * 结算一次探索。
 * 先发奖励再判定伤亡 —— 弟子用命换来的东西不会因为死亡而丢失。
 */
export function resolveExpedition(
  state: GameState,
  expedition: Expedition,
  random: RandomSource = gameRandom,
): { state: GameState; outcome: ExpeditionOutcome | null } {
  const def = SECRET_REALM_MAP[expedition.realmId];
  if (!def) {
    return { state: { ...state, expeditions: state.expeditions.filter((e) => e.id !== expedition.id) }, outcome: null };
  }

  // 队伍里可能已经有人寿元耗尽
  const alive = expedition.discipleIds.filter((id) => state.sect.disciples.some((d) => d.id === id));
  // 队伍只从名册里取一次，后面所有按人算的东西都复用这一份（千人宗门下省一趟 O(全宗人数)）
  const rosterById = new Map(state.sect.disciples.map((d) => [d.id, d]));
  const party: Disciple[] = [];
  for (const id of alive) {
    const d = rosterById.get(id);
    if (d) party.push(d);
  }
  const partyPower = getPartyPower(state, alive);
  const powerRatio = def.requiredPower > 0 ? partyPower / def.requiredPower : MAX_YIELD_FACTOR;
  const partySize = alive.length;

  const yieldFactor = Math.min(Math.max(powerRatio, MIN_YIELD_FACTOR), MAX_YIELD_FACTOR);
  const sizeFactor = getPartySizeFactor(def, partySize);
  const artifacts = getArtifactBonuses(state);
  const weather = getWeatherEffects(state);
  /*
   * 弟子的**产出类**天赋与性格（设定集第 8.3 / 8.5 章）：
   * 按队伍取最高一项，不叠加 —— 一个人懂兽语就够了，带十个不会变成十倍。
   */
  const partyTalentBonus = getPartyTalentYieldBonusOf(party) + getPartyManualYieldBonusOf(party);
  const yieldMultiplier =
    // 善行值加成（需求 2）：善行越高，探索产出越好
    (1 + getKarmaExploreBonus(state) + getSpaceExploreBonus(state)) *
    state.buffs.yieldMultiplier *
    (1 + artifacts.expeditionYield + getStructureBonus(state, 'expeditionYieldBonus') + (weather.expeditionYield ?? 0)) *
    (1 + partyTalentBonus);

  /* ---- 1. 计算产出 ---- */
  /*
   * 慧眼辨材（设定集第 8.4 章：稀有材料掉落概率 +4%）。
   *
   * 做法是**按权重抬稀有材料**，而不是"必定多掉一条"—— 后者会让稀有材料
   * 从"运气"变成"工资"。这个坑在掌门亲探那条路上踩过一次：
   * `weightedDraw(rare, 1, ...)` 在不放回抽样下必定返回一条，稀有率直接变 100%。
   * 抬权重保留了随机性，只是把骰子往稀有那一侧挪一点。
   */
  const rareBonus = getFarmTalentBonus(state, 'rareDrop');
  const pool = def.loot
    .filter((entry) => !entry.guaranteed)
    .map((entry) =>
      rareBonus > 0 && isRareMaterial(entry.item)
        ? { ...entry, weight: entry.weight * (1 + rareBonus) }
        : entry,
    );
  const guaranteed = def.loot.filter((entry) => entry.guaranteed);
  const picked: LootEntry[] = [...guaranteed, ...weightedDraw(pool, getLootRolls(def, partySize), random)];

  let working = state;
  const gains: ExpeditionOutcome['gains'] = [];
  const pillGains: ExpeditionOutcome['pills'] = [];

  for (const entry of picked) {
    const variance = YIELD_VARIANCE_MIN + random() * (YIELD_VARIANCE_MAX - YIELD_VARIANCE_MIN);
    /*
     * 季节与天象对**基础材料**的加成在这里生效（需求 1）。
     * 稀有材料不吃这个加成：它们是秘境深处的产物，不该被地表气候左右 ——
     * 否则一年里总有一段时间刷不到星辰砂，节奏会变得莫名其妙。
     */
    // 季节/天象（需求 1）与五行感悟（需求 3）是两个独立乘区
    const seasonal = isBasicMaterial(entry.item)
      ? (1 + getEnvironmentMaterialBonus(state, entry.item)) * (1 + getElementMaterialBonus(state, entry.item))
      : 1;
    const amount = Math.max(
      1,
      Math.floor(entry.amount * yieldFactor * sizeFactor * yieldMultiplier * variance * Math.max(0, seasonal)),
    );
    working = addItem(working, entry.item, D(amount));
    gains.push({
      id: entry.item,
      amount,
      name: ITEM_MAP[entry.item].name,
      icon: ITEM_MAP[entry.item].icon,
    });
  }

  if (def.pillLoot && def.pillLoot.length > 0 && random() < PILL_DROP_CHANCE) {
    const pillsPicked = weightedDraw(def.pillLoot, 1, random);
    for (const entry of pillsPicked) {
      const pills = { ...working.pills, [entry.pill]: (working.pills[entry.pill] ?? 0) + entry.amount };
      working = { ...working, pills };
      pillGains.push({
        id: entry.pill,
        amount: entry.amount,
        name: PILL_MAP[entry.pill]?.name ?? entry.pill,
        icon: PILL_MAP[entry.pill]?.icon ?? '⚗',
      });
    }
  }

  /* ---- 1b. 种子（需求 5：稀有材料的种子只能靠探索） ---- */
  const seedGains: ExpeditionOutcome['seeds'] = [];
  if (random() < def.seedChance) {
    const seedPool = EXPLORATION_SEEDS.filter(
      (seed) => seed.rarity >= (def.seedMinRarity ?? 1) && seed.rarity <= def.seedMaxRarity,
    ).map((seed) => ({
      ...seed,
      weight: seed.dropWeight,
    }));
    for (const pickedSeed of weightedDraw(seedPool, SEED_ROLLS, random)) {
      working = addSeeds(working, pickedSeed.material, 1);
      seedGains.push({
        material: pickedSeed.material,
        amount: 1,
        name: SEED_MAP[pickedSeed.material]?.name ?? pickedSeed.name,
        icon: pickedSeed.icon,
      });
    }
  }

  /* ---- 1c. 图纸（需求 6：稀有建筑只能靠探索或商行） ---- */
  const blueprintGains: ExpeditionOutcome['blueprints'] = [];
  if (def.blueprintChance > 0 && random() < def.blueprintChance) {
    // 只掉境界够得着的图纸（需求 6：图纸要跟玩家等级挂钩）
    const missing = BLUEPRINTS.filter(
      (bp) => working.blueprints[bp.id] !== true && working.realmIndex >= bp.requiresRealm,
    );
    if (missing.length > 0) {
      const found = missing[Math.min(missing.length - 1, Math.floor(random() * missing.length))];
      working = { ...working, blueprints: { ...working.blueprints, [found.id]: true } };
      blueprintGains.push({ id: found.id, name: found.name, icon: found.icon });
    }
  }

  /* ---- 1d. 发现新秘境（需求 1） ---- */
  let discovered: ExpeditionOutcome['discovered'] = null;
  // 只在附近发现（需求 1）：探秘境同样倾向于发现同一片地方的新秘境
  const candidates = getUndiscoveredCandidates(working, def.regionId);
  if (candidates.length > 0) {
    // 硬保底：连续失败够多次就必然发现一次（它不在概率公式里，见 engine）
    if (isDiscoveryGuaranteed(working) || random() < getDiscoveryChance(working)) {
      const [found] = weightedDraw(
        candidates.map((c) => ({ ...c, weight: c.discoveryWeight })),
        1,
        random,
      );
      if (found) {
        working = discoverRealm(working, found.id);
        discovered = { id: found.id, name: found.name, icon: found.icon };
      }
    } else {
      // 没发现就累积失败次数，避免运气差的玩家永远停在第一处秘境
      working = recordDiscoveryFailure(working);
    }
  }

  /* ---- 1d2. 功法碎片（设定集第 7.3 章：小怪/精英/BOSS 掉碎片） ---- */
  const fragmentRoll = rollFragmentDrop(working, def.tier, random);
  working = fragmentRoll.state;
  const fragmentGain = fragmentRoll.drop;

  /* ---- 1e. 心得（需求 4：弟子探索后增加心得，加快进境） ---- */
  const insightGain = getExpeditionInsight(working, def);

  /* ---- 2. 判定伤亡 ---- */
  const safety = Math.min(
    1,
    Math.max(
      0,
      state.buffs.safetyReduction +
        artifacts.expeditionSafety +
        getStructureBonus(state, 'casualtyReduction') +
        // 丹药栏（设定集第 8.7 章）：出战时自动服下，全队伤亡减免，一趟用掉
        getPartyPillSafety(party),
    ),
  );
  const baseRate = powerRatio > 0 ? def.baseCasualty / powerRatio : MAX_CASUALTY_RATE;  /*
   * 注意：天象**不影响**伤亡率。
   * 试过让血月 / 罡风临时抬高伤亡，结果是把伤亡的正反馈推过临界点 ——
   * 多死几个 → 队伍凑不满 → 战力比下降 → 伤亡更高 → 弟子全灭。
   * 随机天象不该有能力掀翻宗门，所以那两条天象改用别的方式做代价。
   */
  // 铁血军魂（先天特质）：弟子伤亡率 ×0.98
  const casualtyRate =
    Math.min(Math.max(baseRate, 0), MAX_CASUALTY_RATE) *
    (1 - safety) *
    getTraitEffect(state, 'casualtyMult', 1);

  /*
   * 逐人掷骰（设定集第 8.3 / 8.5 / 8.6 章）。
   *
   * 队伍级的 `casualtyRate` 只算"这一趟有多险"，**具体到每个人还要看他自己的**
   * 战斗天赋、性格与忠诚档 —— 铁甲体魄的弟子就是比别人扛得住。
   * 这也是为什么天赋的减伤可以放心给"每人一份"：伤亡本来就是逐人判的，
   * 带 50 个人不会因此变成全员免伤。
   */
  const casualties: { id: string; name: string }[] = [];
  const survivors: string[] = [];
  for (const d of party) {
    const personal = getDiscipleCasualtyReduction(d);
    const personalRate = casualtyRate * (1 - personal);
    if (random() < personalRate) {
      casualties.push({ id: d.id, name: d.name });
    } else {
      survivors.push(d.id);
    }
  }

  /* ---- 3. 写回状态 ---- */
  // 注意：这里必须用 id 而不是名字来剔除陨落弟子 —— 道号是随机生成的，完全可能重复
  const deadIds = new Set(casualties.map((c) => c.id));
  const survivorSet = new Set(survivors);

  const disciples = working.sect.disciples
    .filter((d) => !deadIds.has(d.id))
    .map((d) => {
      const survived = survivorSet.has(d.id);
      // 生还者：回空闲 + 涨心得；其他人（未参与本次）原样保留
      return survived
      ? { ...d, status: 'idle' as const, expeditionId: undefined, insight: addInsight(working, d, insightGain).insight }
        : d;
    });

  let journal = working.journal;
  const summary = gains.map((g) => `${g.icon}${g.name}×${g.amount}`).join(' ');
  const extra = [
    seedGains.map((s) => `${s.icon}${s.name}`).join(' '),
    blueprintGains.map((b) => `${b.icon}${b.name}`).join(' '),
    fragmentGain ? `${fragmentGain.name}碎片×${fragmentGain.amount}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  journal = pushJournal(journal, {
    time: working.playTime,
    kind: 'good',
    text: `${def.name}探索归来（${partySize} 人）：${summary || '一无所获'}${
      extra ? `，另得 ${extra}` : ''
    }`,
  });
  if (discovered) {
    journal = pushJournal(journal, {
      time: working.playTime,
      kind: 'good',
      text: `弟子在${def.name}深处发现了新的秘境：${discovered.icon}${discovered.name}`,
    });
  }
  if (casualties.length > 0) {
    journal = pushJournal(journal, {
      time: working.playTime,
      kind: 'bad',
      text: `${def.name}一行折损：${casualties.map((c) => c.name).join('、')} 陨落`,
    });
  }

  /*
   * 需求 2：一次探索结算完，做两件"用过就没了"的收尾。
   *
   *   1. **保命丹**（按次的伤亡削减）在这一趟用掉了 —— 清掉次数标志，
   *      否则它会永远护着后面每一趟；
   *   2. **可携带器物**各消耗 1 次，用完即毁（`consumeGear`）。
   *
   * 两件事都放在"结算之后"而不是"派遣时"：派遣只是排上队，
   * 真出事、真用上装备的是结算那一刻。中途取消的探索不该磨损器物。
   */
  let gearState: GameState = {
    ...working,
    sect: { ...working.sect, disciples },
    expeditions: working.expeditions.filter((e) => e.id !== expedition.id),
    // 需求 1：每次探索后要隔一段时间才能再探
    realmCooldowns: { ...working.realmCooldowns, [def.id]: def.cooldown },
    journal,
  };

  /*
   * ---- 3b. 忠诚度与心魔的结算（设定集第 8.6 / 14.3 章） ----
   *
   * 放在"写回状态"之后、器物损耗之前：它只动弟子本身，
   * 与后面的保命丹 / 器物损耗互不影响。
   */
  gearState = settlePartyAfterExpedition(gearState, survivors, casualties.length, casualties.length > 0);

  /*
   * 声望（设定集第 9 章）：探得越深，名声越大。
   * 放在"探索归来"之后：弟子用命换来的名声该记在账上，
   * 哪怕这一趟折了人（折人本身不扣声望 —— 声望是对外的评价，不是内部的士气）。
   */
  gearState = changeFame(gearState, fameFromRealm(def.tier), `探索${def.name}`).state;

  /*
   * ---- 3b2. 陨落弟子的功法回收（设定集第 7 章：60% 回收、40% 损毁）----
   *
   * 必须在"从名册里剔除"**之后**做，但对象要取自剔除**之前**的快照 ——
   * 死了的人身上那本书才有可能回来。
   */
  if (casualties.length > 0) {
    const diedIds = new Set(casualties.map((c) => c.id));
    const died = working.sect.disciples.filter((d) => diedIds.has(d.id));
    const salvage = salvageManualsOnDeath(gearState, died, random);
    gearState = salvage.state;
    if (salvage.salvaged.length > 0 || salvage.lost.length > 0) {
      gearState = {
        ...gearState,
        journal: pushJournal(gearState.journal, {
          time: gearState.playTime,
          kind: 'info',
          text: `清点遗物：${[
            salvage.salvaged.length > 0 ? `回收 ${salvage.salvaged.join('、')}` : '',
            salvage.lost.length > 0 ? `损毁 ${salvage.lost.join('、')}` : '',
          ]
            .filter(Boolean)
            .join('，')}`,
        }),
      };
    }
  }

  /*
   * ---- 3c. 叛逃判定（设定集第 8.6 章）----
   * 只对**本趟参战且活着回来**的人掷骰，且发生在忠诚已经被上面那步改过之后 ——
   * 所以"同门陨落导致忠诚跌破阈值"有可能当场就变成下一趟的叛逃，
   * 这条因果链是刻意留着的。
   */
  /*
   * 出战归来：丹药栏里的东西**用掉了**（设定集第 8.7 章：丹药栏是一次性护命）。
   * 放在"写回状态"之后、叛逃判定之前：它只动参战者的丹药栏，
   * 与弟子去留无关。
   */
  gearState = consumePartyPills(gearState, survivors);

  const desertion = rollDesertion(gearState, survivors, random);
  if (desertion.deserters.length > 0) {
    gearState = desertion.state;
    journal = pushJournal(gearState.journal, {
      time: gearState.playTime,
      kind: 'bad',
      text: `${def.name}途中生变：${desertion.deserters
        .map((d) => `${d.name}${d.greedy ? '（卷走一批材料）' : ''}`)
        .join('、')} 叛出宗门`,
    });
    gearState = { ...gearState, journal };
  }

  if (working.buffs.safetyOnce) {
    gearState = {
      ...gearState,
      buffs: { ...gearState.buffs, safetyOnce: false, safetyReduction: 0 },
    };
  }

  const gear = consumeGear(gearState);
  gearState = gear.state;
  if (gear.broken.length > 0) {
    gearState = {
      ...gearState,
      journal: pushJournal(gearState.journal, {
        time: gearState.playTime,
        kind: 'bad',
        text: `携带的${gear.broken.join('、')}已损毁，需重新炼制`,
      }),
    };
  }

  let queued: GameState = gearState;

  /*
   * 本轮需求 4：循环探索。
   *
   * 这一趟结算完之后，如果 `repeatLeft > 1`，就**原地重新排上**同一处秘境：
   *   - `progress` 设成 `-def.cooldown` —— 负进度就是"在等冷却"，
   *     等它涨回 0 才开始这一趟，于是循环天然遵守冷却，不用另写一套计时；
   *   - 队伍保持 `exploring` 状态，不还给玩家（否则中途会被别人派走）；
   *   - 只剩一个弟子（低于 minParty）就停 —— 再派也进不去。
   */
  const repeatLeft = expedition.repeatLeft ?? 1;
  // 复用上面已经算好的 survivors（伤亡之后还活着的那批）
  if (repeatLeft > 1 && survivors.length >= def.minParty) {
    const continued: Expedition = {
      ...expedition,
      progress: -def.cooldown,
      repeatLeft: repeatLeft - 1,
    };
    queued = {
      ...queued,
      expeditions: [...queued.expeditions, continued],
      journal: pushJournal(queued.journal, {
        time: queued.playTime,
        kind: 'info',
        text: `${def.name}自动整队，还剩 ${repeatLeft - 1} 趟（等冷却中）`,
      }),
    };
    // 队伍留在原地继续探索
    queued = setDiscipleStatus(queued, survivors, 'exploring', expedition.id);
  }

  const next: GameState = queued;

  return {
    state: next,
    outcome: {
      realmName: def.name,
      gains,
      pills: pillGains,
      fragments: fragmentGain
        ? [{ id: fragmentGain.manualId, amount: fragmentGain.amount, name: fragmentGain.name, grade: fragmentGain.grade }]
        : [],
      seeds: seedGains,
      blueprints: blueprintGains,
      discovered,
      insight: insightGain,
      casualties: casualties.map((c) => c.name),
      powerRatio,
      partySize,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 普通探索（需求 1：小区域还没发现秘境时唯一能做的事）                  */
/* ------------------------------------------------------------------ */

/**
 * 一个小区域现在能不能做普通探索。
 *
 * 规则来自需求原文：「每个小区域在未发现秘境时只能普通探索」。
 * 所以条件是 **该小区域还有没被发现的秘境** —— 全都发现之后就只剩探秘境了。
 */
export function canSurveyRegion(state: GameState, regionId: string): StartCheck {
  const region = MAP_REGION_MAP[regionId];
  if (!region) return { ok: false, reason: '此处不存在' };
  /*
   * 需求 5：门槛按**大区域**算，而不是按小区域自己的档次。
   *
   * 原来用的是 `region.requiresRealm`，而它在同一个大区域内部是一路涨上去的
   * （东部群山里从需 0 到需 4），于是"除了最前面几个小区域，其它都点不动"。
   * 普通探索本来就是"去附近转转"，不该要求玩家先强到能闯那个区域最深处的秘境 ——
   * 那些秘境自己还有各自的解锁境界与队伍战力要求。
   */
  if (state.realmIndex < surveyReachRealm(regionId)) {
    return { ok: false, reason: `需${REALMS[surveyReachRealm(regionId)].name}以上才能走到这一带` };
  }
  const total = realmCountOfRegion(regionId);
  const found = realmsOfRegion(regionId).filter((r) => isRealmDiscovered(state, r)).length;
  if (total > 0 && found >= total) {
    return { ok: false, reason: '此地秘境已全部寻得，直接探秘境即可' };
  }
  /*
   * ⚠️ 「队伍名额」这一条**不能**放在这里。
   *
   * 掌门亲往不占队伍名额，而 `getMaxExpeditions` 在未开宗时是 0 ——
   * 放在这里会让"开宗前掌门也能出门转转"直接失效（这正是需求 5 要修的）。
   * 所以名额检查挪进 `canStartSurvey`（派队伍那条路）。
   */
  return { ok: true, reason: null };
}

/**
 * 普通探索的"队伍"版本需要弟子，所以额外要求已开宗。
 *
 * 这条单独拿出来，是为了让**掌门亲往**（`canStartSoloSurvey`）不受它限制 ——
 * 需求 5 要的正是"开宗前/没人手时，玩家本人也能出去看看"。
 */
export function canStartSurveyParty(state: GameState, regionId: string, ids: string[]): StartCheck {
  if (!state.sect.founded) return { ok: false, reason: '尚未开宗立派' };
  return canStartSurvey(state, regionId, ids);
}

/** 普通探索的时长（比正经探秘境快一些，因为它就在近处转） */
export function getSurveyDuration(_state: GameState, regionId: string): number {
  const region = MAP_REGION_MAP[regionId];
  if (!region) return 0;
  const tier = regionTier(regionId);
  const base = 120 * 1.6 ** (tier - 1);
  return Math.round(base * SURVEY_DURATION_RATIO);
}

/** 普通探索能派几个人：比探秘境宽松（就是去附近看看，不用整队） */
export function getSurveyPartyRange(): { min: number; max: number } {
  return { min: 1, max: SURVEY_MAX_PARTY };
}

export function canStartSurvey(state: GameState, regionId: string, ids: string[]): StartCheck {
  const region = canSurveyRegion(state, regionId);
  if (!region.ok) return region;

  // 派队伍才占名额（掌门亲往不占，见 canSurveyRegion 的注释）
  if (state.expeditions.length >= getMaxExpeditions(state)) {
    return { ok: false, reason: '探索队伍已满，提升宗门品阶可增加队伍' };
  }

  const { min, max } = getSurveyPartyRange();
  if (ids.length < min) return { ok: false, reason: `至少需派遣 ${min} 名弟子` };
  if (ids.length > max) return { ok: false, reason: `普通探索最多派 ${max} 名弟子` };
  if (new Set(ids).size !== ids.length) return { ok: false, reason: '同一名弟子不能重复派遣' };

  const def = MAP_REGION_MAP[regionId];
  const minRealm = Math.max(0, (def?.requiresRealm ?? 0) - 1);
  const byId = new Map(state.sect.disciples.map((d) => [d.id, d]));
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) return { ok: false, reason: '弟子不存在' };
    if (d.status !== 'idle') return { ok: false, reason: `${d.name} 正在探索中` };
    if (d.realmIndex < minRealm) return { ok: false, reason: `需${REALMS[minRealm].name}以上弟子` };
  }
  return { ok: true, reason: null };
}

/** 自动挑一队空闲弟子去做普通探索 */
export function autoSelectSurveyParty(state: GameState, _regionId: string, size = 2): string[] {
  return getIdleDisciples(state)
    .sort((a, b) => REALMS[b.realmIndex].power - REALMS[a.realmIndex].power)
    .slice(0, Math.max(1, Math.min(size, SURVEY_MAX_PARTY)))
    .map((d) => d.id);
}

export function startSurvey(
  state: GameState,
  regionId: string,
  ids: string[],
  random: RandomSource = gameRandom,
  /** 连做几趟（本轮需求 4） */
  repeat = 1,
): GameState {
  const check = canStartSurvey(state, regionId, ids);
  if (!check.ok) return state;
  const region = MAP_REGION_MAP[regionId];
  if (!region) return state;

  const expedition: Expedition = {
    id: randomId('s', random),
    realmId: regionId,
    discipleIds: [...ids],
    progress: 0,
    duration: getSurveyDuration(state, regionId),
    kind: 'survey',
    repeatLeft: clampRepeat(repeat),
  };

  const withStatus = setDiscipleStatus(state, ids, 'exploring', expedition.id);
  const names = ids
    .map((id) => state.sect.disciples.find((d) => d.id === id)?.name ?? '?')
    .join('、');

  return {
    ...withStatus,
    expeditions: [...withStatus.expeditions, expedition],
    journal: pushJournal(withStatus.journal, {
      time: withStatus.playTime,
      kind: 'info',
      text: `${names} 在${region.name}一带普通探索（${ids.length} 人）`,
    }),
  };
}

/**
 * 普通探索的结算。
 *
 * 需求原文：「普通探索有概率发现秘境和稀有材料，必定产出基础材料，但是数量随机。」
 * 所以三件事：
 *   1. **必定**给基础材料（1~2 种，数量随机）；
 *   2. 有概率给稀有材料；
 *   3. 有概率发现新秘境（用和探秘境同一套发现概率与硬保底）。
 *
 * ⚠️ 刻意**没有伤亡**：普通探索就是"在附近转转"，
 * 不该成为弟子的绞肉机。秘境那边的伤亡已经足够制造紧张感了，
 * 而且我这一轮已经亲眼见过两次"伤亡正反馈把宗门清空"，不想再加第三个来源。
 */
export function resolveSurvey(
  state: GameState,
  expedition: Expedition,
  random: RandomSource = gameRandom,
): { state: GameState; outcome: ExpeditionOutcome | null } {
  const region = MAP_REGION_MAP[expedition.realmId];
  const drop = () => state.expeditions.filter((e) => e.id !== expedition.id);
  if (!region) return { state: { ...state, expeditions: drop() }, outcome: null };

  const alive = expedition.discipleIds.filter((id) => state.sect.disciples.some((d) => d.id === id));
  const partySize = Math.max(1, alive.length);
  const tier = regionTier(region.id);

  const weather = getWeatherEffects(state);
  const yieldMultiplier =
    // 善行值加成（需求 2）：普通探索同样吃善行加成
    (1 + getKarmaExploreBonus(state) + getSpaceExploreBonus(state)) *
    state.buffs.yieldMultiplier *
    (1 + getStructureBonus(state, 'expeditionYieldBonus') + (weather.expeditionYield ?? 0)) *
    SURVEY_YIELD_MULT;
  // 人越多带回来的越多：普通探索也一样
  const sizeFactor = 1 + (partySize - 1) * PARTY_YIELD_PER_EXTRA;

  const { base, rare } = getSurveyLoot(tier);
  let working = state;
  const gains: ExpeditionOutcome['gains'] = [];

  const push = (item: ItemId, rawAmount: number): void => {
    const variance = YIELD_VARIANCE_MIN + random() * (YIELD_VARIANCE_MAX - YIELD_VARIANCE_MIN);
    const seasonal = isBasicMaterial(item)
      ? (1 + getEnvironmentMaterialBonus(working, item)) * (1 + getElementMaterialBonus(working, item))
      : 1;
    const amount = Math.max(
      1,
      Math.floor(rawAmount * yieldMultiplier * sizeFactor * variance * Math.max(0, seasonal)),
    );
    working = addItem(working, item, D(amount));
    const existing = gains.find((g) => g.id === item);
    if (existing) existing.amount += amount;
    else {
      gains.push({
        id: item,
        amount,
        name: ITEM_MAP[item].name,
        icon: ITEM_MAP[item].icon,
      });
    }
  };

  // 1. 必定产出的基础材料（1~2 种，数量随机）
  const kinds =
    SURVEY_BASE_KINDS_MIN +
    (SURVEY_BASE_KINDS_MAX > SURVEY_BASE_KINDS_MIN && random() < 0.5 ? 1 : 0);
  for (const entry of weightedDraw(base, Math.min(kinds, base.length), random)) {
    push(entry.item, entry.amount);
  }

  // 2. 有概率带回稀有材料
  if (rare.length > 0 && random() < SURVEY_RARE_CHANCE) {
    const [picked] = weightedDraw(rare, 1, random);
    if (picked) push(picked.item, picked.amount);
  }

  /* 3. 有概率发现新秘境（与探秘境共用同一套概率与硬保底） */
  let discovered: ExpeditionOutcome['discovered'] = null;
  // 普通探索只会在**这一带**找到秘境（需求 1：这是打开新区域的唯一入口）
  const candidates = getUndiscoveredCandidates(working, region.id);
  if (candidates.length > 0) {
    if (isDiscoveryGuaranteed(working) || random() < getDiscoveryChance(working)) {
      const [found] = weightedDraw(
        candidates.map((c) => ({ ...c, weight: c.discoveryWeight })),
        1,
        random,
      );
      if (found) {
        working = discoverRealm(working, found.id);
        discovered = { id: found.id, name: found.name, icon: found.icon };
      }
    } else {
      working = recordDiscoveryFailure(working);
    }
  }

  /* 3b. 功法残页（设定集第 7.3 章）：普通探索按区域的境界档次抽 */
  const surveyFragmentRoll = rollFragmentDrop(working, Math.min(9, Math.max(1, region.requiresRealm + 1)), random);
  working = surveyFragmentRoll.state;
  const surveyFragmentDrop = surveyFragmentRoll.drop;

  /* 4. 心得：普通探索也给，但只有秘境的一半 —— 见闻不如亲历 */
  const minRealm = Math.max(0, region.requiresRealm - 1);
  const insightGain = Math.max(
    1,
    Math.round(
      ((INSIGHT_PER_EXPEDITION + minRealm * INSIGHT_PER_REALM_LEVEL) * 0.5) *
        (1 + getStructureBonus(working, 'insightBonus')),
    ),
  );
  const disciples = working.sect.disciples.map((d) =>
    alive.includes(d.id) ? { ...d, status: 'idle' as const, expeditionId: undefined, insight: addInsight(working, d, insightGain).insight } : d,
  );
  working = { ...working, sect: { ...working.sect, disciples } };
  // 普通探索同样长名声，只是少得多（设定集第 9 章）
  working = changeFame(working, fameFromSurvey()).state;

  let journal = working.journal;
  const summary = gains.map((g) => `${g.icon}${g.name}×${g.amount}`).join(' ');
  journal = pushJournal(journal, {
    time: working.playTime,
    kind: 'good',
    text: `${region.name}普通探索归来（${partySize} 人）：${summary || '一无所获'}${
      surveyFragmentDrop ? `，另得 ${surveyFragmentDrop.name}碎片×${surveyFragmentDrop.amount}` : ''
    }`,
  });
  if (discovered) {
    journal = pushJournal(journal, {
      time: working.playTime,
      kind: 'good',
      text: `在${region.name}发现了新的秘境：${discovered.icon}${discovered.name}`,
    });
  }

  // 需求 2：普通探索也算"出门一趟"，保命丹与携带器物同样消耗
  let surveyState: GameState = {
    ...working,
    expeditions: working.expeditions.filter((e) => e.id !== expedition.id),
    journal,
  };
  if (working.buffs.safetyOnce) {
    surveyState = { ...surveyState, buffs: { ...surveyState.buffs, safetyOnce: false, safetyReduction: 0 } };
  }
  const surveyGear = consumeGear(surveyState);
  surveyState = surveyGear.state;
  if (surveyGear.broken.length > 0) {
    surveyState = {
      ...surveyState,
      journal: pushJournal(surveyState.journal, {
        time: surveyState.playTime,
        kind: 'bad',
        text: `携带的${surveyGear.broken.join('、')}已损毁，需重新炼制`,
      }),
    };
  }

  /*
   * 本轮需求 4：普通探索也能循环。
   * 它没有冷却，所以直接把进度归零、重新排上就行。
   */
  let queuedSurvey = surveyState;
  const surveyRepeat = expedition.repeatLeft ?? 1;
  if (surveyRepeat > 1) {
    // 普通探索没有伤亡，所以"还活着的人"就是队伍里还在的人
    const stillHere = alive;
    if (stillHere.length > 0) {
      queuedSurvey = {
        ...queuedSurvey,
        expeditions: [...queuedSurvey.expeditions, { ...expedition, progress: 0, repeatLeft: surveyRepeat - 1 }],
      };
      queuedSurvey = setDiscipleStatus(queuedSurvey, stillHere, 'exploring', expedition.id);
    }
  }

  const next: GameState = queuedSurvey;

  return {
    state: next,
    outcome: {
      realmName: `${region.name}（普通探索）`,
      gains,
      pills: [],
      // 普通探索也能碰上散落的功法残页（它本来就是"翻山越岭找东西"）
      fragments: surveyFragmentDrop
        ? [
            {
              id: surveyFragmentDrop.manualId,
              amount: surveyFragmentDrop.amount,
              name: surveyFragmentDrop.name,
              grade: surveyFragmentDrop.grade,
            },
          ]
        : [],
      seeds: [],
      blueprints: [],
      discovered,
      insight: insightGain,
      casualties: [],
      powerRatio: 1,
      partySize,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 时间推进                                                            */
/* ------------------------------------------------------------------ */

/** 探索速度倍率：丹药增益 × 器物 × 建筑（灵舟坊） */
export function getExpeditionSpeed(state: GameState): number {
  const artifacts = getArtifactBonuses(state);
  const buildings = getStructureBonus(state, 'expeditionSpeedBonus');
  const weather = getWeatherEffects(state).expeditionSpeed ?? 0;
  return Math.max(0.1, state.buffs.speedMultiplier * (1 + artifacts.expeditionSpeed + buildings + weather));
}

export function tickExpeditions(state: GameState, dt: number, random: RandomSource = gameRandom): GameState {
  if (state.expeditions.length === 0 || dt <= 0) return state;

  const gained = dt * getExpeditionSpeed(state);
  const remaining: Expedition[] = [];
  const finished: Expedition[] = [];

  for (const expedition of state.expeditions) {
    const progress = expedition.progress + gained;
    if (progress >= expedition.duration) finished.push({ ...expedition, progress });
    else remaining.push({ ...expedition, progress });
  }

  let working: GameState = { ...state, expeditions: remaining };
  for (const expedition of finished) {
    working =
      expedition.kind === 'survey'
        ? resolveSurvey(working, expedition, random).state
        : resolveExpedition(working, expedition, random).state;
  }
  return working;
}

/** 立即完成所有探索（灭魔丹） */
export function completeAllExpeditions(state: GameState, random: RandomSource = gameRandom): GameState {
  let working = state;
  for (const expedition of [...state.expeditions]) {
    working = resolveExpedition(working, { ...expedition, progress: expedition.duration }, random).state;
  }
  return working;
}

export function getExpeditionProgress(expedition: Expedition): number {
  if (expedition.duration <= 0) return 1;
  return Math.min(1, expedition.progress / expedition.duration);
}


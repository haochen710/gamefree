/**
 * 丹炉与弟子装备（设定集第 8.7 / 11 章）
 *
 * 与其它模块一样：数据在 `content/furnace.ts`，这里做纯函数与聚合，界面在
 * `components/GearPanel.tsx`。
 *
 * ## 丹炉
 * 同时只有**一口在用**（`state.furnaceId`）。九件是"换更好的"的线性进阶，
 * 而不是"叠九口炉子" —— 叠起来会让成功率与批量迅速失控。
 *
 * ## 弟子装备
 * 五栏：增益 / 进攻 / 防御 / 丹药 ×2。装备存在**仓库**里（`state.gears`），
 * 装到人身上就从仓库减 1、卸下加回去 —— 与功法完全同一套口径，
 * 玩家不用学两套规则，也不可能出现"同一件装备在两个人身上"。
 */
import { gameRandom, type RandomSource } from './random';
import {
  DEFAULT_FURNACE_ID,
  GEAR_SALVAGE_RATE,
  FURNACE_MAP,
  FURNACES,
  GEARS,
  GEAR_MAP,
  GEAR_SLOTS,
  GEAR_SLOT_NAMES,
  slotAccepts,
  type FurnaceDef,
  type GearDef,
  type GearKind,
  type GearSlot,
} from './content';
import { getAmount, payCost, toCostMap } from './engine';
import { pushJournal } from './disciples';
import type { Disciple, GameState } from './state';

/* ------------------------------------------------------------------ */
/* 丹炉                                                                */
/* ------------------------------------------------------------------ */

export function getFurnace(state: GameState): FurnaceDef {
  return FURNACE_MAP[state.furnaceId] ?? FURNACE_MAP[DEFAULT_FURNACE_ID];
}

/** 已获得的炉鼎（默认炉子始终算已获得） */
export function getOwnedFurnaces(state: GameState): string[] {
  const owned = new Set(state.furnaces);
  owned.add(DEFAULT_FURNACE_ID);
  return FURNACES.filter((f) => owned.has(f.id)).map((f) => f.id);
}

export function canForgeFurnace(state: GameState, furnaceId: string): { ok: boolean; reason: string | null } {
  const def = FURNACE_MAP[furnaceId];
  if (!def) return { ok: false, reason: '没有这件炉鼎' };
  if (state.furnaces.includes(furnaceId) || furnaceId === DEFAULT_FURNACE_ID) {
    return { ok: false, reason: '已经拥有这口炉鼎' };
  }
  if (state.alchemyTier < def.requiresAlchemyTier) {
    return { ok: false, reason: `需炼丹 ${def.requiresAlchemyTier} 品` };
  }
  if (state.refiningTier < def.requiresRefiningTier) {
    return { ok: false, reason: `需炼器 ${def.requiresRefiningTier} 品` };
  }
  for (const [id, amount] of Object.entries(def.cost) as [keyof typeof def.cost, number][]) {
    if (getAmount(state, id).lt(amount)) {
      return { ok: false, reason: `材料不足（${String(id)}）` };
    }
  }
  return { ok: true, reason: null };
}

/** 铸造（获得）一口新炉鼎；铸成之后自动换上 */
export function forgeFurnace(state: GameState, furnaceId: string): GameState {
  if (!canForgeFurnace(state, furnaceId).ok) return state;
  const def = FURNACE_MAP[furnaceId];
  // 代价表里是普通数字，payCost 收 Decimal 表 —— 在逻辑层折算一次
  const paid = payCost(state, toCostMap(def.cost));
  if (paid === state) return state;
  const working: GameState = {
    ...paid,
    furnaces: [...paid.furnaces, furnaceId],
    furnaceId,
    journal: pushJournal(paid.journal, {
      time: paid.playTime,
      kind: 'good',
      text: `铸成${def.icon}${def.name}（炼丹 +${Math.round(def.alchemyBonus * 100)}%、炼器 +${Math.round(
        def.refiningBonus * 100,
      )}%），已换上新炉`,
    }),
  };
  return working;
}

/** 换用某一口已获得的炉鼎 */
export function equipFurnace(state: GameState, furnaceId: string): GameState {
  if (!getOwnedFurnaces(state).includes(furnaceId)) return state;
  if (state.furnaceId === furnaceId) return state;
  return { ...state, furnaceId };
}

/** 丹炉提供的炼丹 / 炼器成功率 —— 读取点：crafting.getCraftSuccessRate */
export function furnaceAlchemyBonus(state: GameState): number {
  return getFurnace(state).alchemyBonus;
}

export function furnaceRefiningBonus(state: GameState): number {
  return getFurnace(state).refiningBonus;
}

/** 一次炼制多出一件的概率 —— 读取点：crafting.craftPill / craftArtifact */
export function furnaceBatchBonus(state: GameState): number {
  return getFurnace(state).batchBonus;
}

/**
 * 自动合成的速度加成。
 *
 * 实现在 engine.getFurnaceRefineSpeedBonus（那里的注释解释了为什么不能
 * 反过来 import 本模块 —— gear 依赖 engine，反向引用会成环）。
 * 这里只做转发，保证界面与逻辑读的是同一个数。
 */
export { getFurnaceRefineSpeedBonus as furnaceRefineSpeedBonus } from './engine';

/* ------------------------------------------------------------------ */
/* 弟子装备：库存与装卸                                                 */
/* ------------------------------------------------------------------ */

export function getGearCount(state: GameState, gearId: string): number {
  return state.gears[gearId] ?? 0;
}

/** 仓库里的装备（按品阶降序） */
export function getOwnedGears(state: GameState): { def: GearDef; count: number }[] {
  return GEARS.filter((g) => getGearCount(state, g.id) > 0)
    .map((def) => ({ def, count: getGearCount(state, def.id) }))
    .sort((a, b) => b.def.grade - a.def.grade || a.def.id.localeCompare(b.def.id));
}

/** 加/减装备库存 */
export function addGear(state: GameState, gearId: string, amount: number): GameState {
  if (amount === 0) return state;
  const next = Math.max(0, (state.gears[gearId] ?? 0) + amount);
  const gears = { ...state.gears };
  if (next > 0) gears[gearId] = next;
  else delete gears[gearId];
  return { ...state, gears };
}

/** 某名弟子身上所有装备（含空位） */
export function getDiscipleGear(disciple: Disciple): { slot: GearSlot; def: GearDef | null }[] {
  return GEAR_SLOTS.map((slot) => ({
    slot,
    def: GEAR_MAP[disciple.gear[slot] ?? ''] ?? null,
  }));
}

/** 该弟子身上装备数 */
export function countDiscipleGear(disciple: Disciple): number {
  return GEAR_SLOTS.filter((slot) => Boolean(disciple.gear[slot])).length;
}

export function canEquipGear(
  state: GameState,
  discipleId: string,
  gearId: string,
  slot: GearSlot,
): { ok: boolean; reason: string | null } {
  const disciple = state.sect.disciples.find((d) => d.id === discipleId);
  if (!disciple) return { ok: false, reason: '弟子不存在' };
  const def = GEAR_MAP[gearId];
  if (!def) return { ok: false, reason: '没有这件装备' };
  if (getGearCount(state, gearId) <= 0) return { ok: false, reason: '仓库里没有这件装备' };
  if (!slotAccepts(slot, def.kind)) {
    return { ok: false, reason: `${def.name}不能放进${GEAR_SLOT_NAMES[slot]}` };
  }
  if (disciple.realmIndex < def.minRealm) {
    return { ok: false, reason: `需${['炼气', '筑基', '金丹', '元婴', '化神'][def.minRealm] ?? '更高'}期以上` };
  }
  return { ok: true, reason: null };
}

/** 装备一件（该栏已有东西则换下来，旧的回到仓库） */
export function equipGear(state: GameState, discipleId: string, gearId: string, slot: GearSlot): GameState {
  if (!canEquipGear(state, discipleId, gearId, slot).ok) return state;
  const disciple = state.sect.disciples.find((d) => d.id === discipleId);
  if (!disciple) return state;
  const previous = disciple.gear[slot];

  let working = addGear(state, gearId, -1);
  working = {
    ...working,
    sect: {
      ...working.sect,
      disciples: working.sect.disciples.map((d) =>
        d.id === discipleId ? { ...d, gear: { ...d.gear, [slot]: gearId } } : d,
      ),
    },
  };
  if (previous) working = addGear(working, previous, 1);
  return working;
}

/** 卸下某一栏 */
export function unequipGear(state: GameState, discipleId: string, slot: GearSlot): GameState {
  const disciple = state.sect.disciples.find((d) => d.id === discipleId);
  const gearId = disciple?.gear[slot];
  if (!disciple || !gearId) return state;
  let working: GameState = {
    ...state,
    sect: {
      ...state.sect,
      disciples: state.sect.disciples.map((d) =>
        d.id === discipleId ? { ...d, gear: { ...d.gear, [slot]: '' } } : d,
      ),
    },
  };
  working = addGear(working, gearId, 1);
  return working;
}

/**
 * 一键申领（设定集：按境界品级自动申领）。
 *
 * 规则：从**最高品阶**的装备开始，发给"够境界、且该栏位空着"的**境界最高**的弟子。
 * 与功法的一键发书同一套思路 —— 玩家在千人宗门里真正需要的不是"逐件拖",
 * 而是"把好东西发给最该拿的人"。
 */
export function autoEquipGears(state: GameState): { state: GameState; handed: number } {
  let working = state;
  let handed = 0;
  const order = [...GEARS].sort((a, b) => b.grade - a.grade || a.id.localeCompare(b.id));

  for (const def of order) {
    const slots = def.kind === 'pill' ? (['pill1', 'pill2'] as GearSlot[]) : ([def.kind] as GearSlot[]);
    let guard = 0;
    while (getGearCount(working, def.id) > 0 && guard < 10000) {
      guard += 1;
      let best: { id: string; realmIndex: number } | null = null;
      for (const d of working.sect.disciples) {
        if (d.realmIndex < def.minRealm) continue;
        const free = slots.find((slot) => !d.gear[slot]);
        if (!free) continue;
        if (!best || d.realmIndex > best.realmIndex) best = { id: d.id, realmIndex: d.realmIndex };
      }
      if (!best) break;
      const target = working.sect.disciples.find((d) => d.id === best!.id);
      const free = slots.find((slot) => !target?.gear[slot]);
      if (!free) break;
      const next = equipGear(working, best.id, def.id, free);
      if (next === working) break;
      working = next;
      handed += 1;
    }
  }
  return { state: working, handed };
}

/* ------------------------------------------------------------------ */
/* 装备的加成聚合（每一条都注明读取点）                                 */
/* ------------------------------------------------------------------ */

/** 弟子战力加成 —— 读取点：disciples.getPartyPower */
export function getGearPower(disciple: Disciple): number {
  let total = 0;
  for (const slot of GEAR_SLOTS) {
    total += GEAR_MAP[disciple.gear[slot] ?? '']?.power ?? 0;
  }
  return total;
}

/** 弟子伤亡削减 —— 读取点：disciples.getDiscipleCasualtyReduction */
export function getGearCasualtyReduction(disciple: Disciple): number {
  let total = 0;
  for (const slot of GEAR_SLOTS) {
    total += GEAR_MAP[disciple.gear[slot] ?? '']?.casualtyReduction ?? 0;
  }
  return total;
}

/** 弟子修行加成 —— 读取点：disciples.getDiscipleSpeed */
export function getGearCultivationBonus(disciple: Disciple): number {
  let total = 0;
  for (const slot of GEAR_SLOTS) {
    total += GEAR_MAP[disciple.gear[slot] ?? '']?.cultivationBonus ?? 0;
  }
  return total;
}

/**
 * 队伍里丹药栏提供的一次性安全加成 —— 读取点：expeditions.resolveExpedition 的 safety。
 *
 * 「一次性」= 出这一趟就吃掉：结算完由 `consumePartyPills` 把丹药栏清空
 * （丹药栏里的东西本来就是"带着应急的"）。
 */
export function getPartyPillSafety(party: Disciple[]): number {
  let best = 0;
  for (const d of party) {
    for (const slot of ['pill1', 'pill2'] as GearSlot[]) {
      best = Math.max(best, GEAR_MAP[d.gear[slot] ?? '']?.safety ?? 0);
    }
  }
  return best;
}

/** 出战归来：把参战弟子丹药栏里的东西吃掉（一次性） */
export function consumePartyPills(state: GameState, partyIds: string[]): GameState {
  const set = new Set(partyIds);
  let changed = false;
  const disciples = state.sect.disciples.map((d) => {
    if (!set.has(d.id)) return d;
    if (!d.gear.pill1 && !d.gear.pill2) return d;
    changed = true;
    // 丹药是"用掉"而不是"还回仓库"—— 它本来就是为了这一趟准备的
    return { ...d, gear: { ...d.gear, pill1: '', pill2: '' } };
  });
  return changed ? { ...state, sect: { ...state.sect, disciples } } : state;
}

/* ------------------------------------------------------------------ */
/* 炼器：把装备造出来                                                   */
/* ------------------------------------------------------------------ */

export function canForgeGear(state: GameState, gearId: string): { ok: boolean; reason: string | null } {
  const def = GEAR_MAP[gearId];
  if (!def) return { ok: false, reason: '没有这件装备' };
  if (state.refiningTier < def.grade) {
    return { ok: false, reason: `需炼器 ${def.grade} 品` };
  }
  for (const [id, amount] of Object.entries(def.cost) as [keyof typeof def.cost, number][]) {
    if (getAmount(state, id).lt(amount)) return { ok: false, reason: `材料不足（${String(id)}）` };
  }
  return { ok: true, reason: null };
}

/**
 * 炼制一件装备。
 *
 * 与炼丹同一条规则：**失败照样消耗材料**（`crafting` 那边已经立过这个规矩），
 * 成功率复用 `getCraftSuccessRate(state, 'refining', grade)` —— 所以丹炉、
 * 藏经阁的器物加成、丹鼎天成的特质全都在同一条线上生效。
 */
export interface ForgeResult {
  state: GameState;
  ok: boolean;
  made: number;
  rate: number;
  message: string;
}

export function forgeGear(
  state: GameState,
  gearId: string,
  rate: number,
  random: RandomSource = gameRandom,
): ForgeResult {
  const check = canForgeGear(state, gearId);
  if (!check.ok) return { state, ok: false, made: 0, rate, message: check.reason ?? '无法炼制' };
  const def = GEAR_MAP[gearId];

  const paid = payCost(state, toCostMap(def.cost));
  if (paid === state) return { state, ok: false, made: 0, rate, message: '材料不足' };

  const success = random() < rate;
  if (!success) {
    return {
      state: {
        ...paid,
        journal: pushJournal(paid.journal, {
          time: paid.playTime,
          kind: 'bad',
          text: `炼制${def.name}失败，材料尽毁（成功率 ${Math.round(rate * 100)}%）`,
        }),
      },
      ok: false,
      made: 0,
      rate,
      message: `炼制失败（成功率 ${Math.round(rate * 100)}%）`,
    };
  }

  // 丹炉的批量加成：好炉子偶尔一次出两件
  const batch = random() < furnaceBatchBonus(paid) ? 2 : 1;
  const working = addGear(paid, gearId, batch);
  return {
    state: {
      ...working,
      journal: pushJournal(working.journal, {
        time: working.playTime,
        kind: 'good',
        text: `炼成${def.icon}${def.name}×${batch}`,
      }),
    },
    ok: true,
    made: batch,
    rate,
    message: `炼成 ${def.name}×${batch}`,
  };
}

/**
 * 弟子陨落时回收身上的装备（60% 回收 / 40% 损毁，与功法同一套规则）。
 *
 * 逐件掷骰而不是"整体 60%"：玩家看到的是"这件东西回没回来"。
 * 设定集没写这一条（它只写了功法的回收），所以这是**本作自己的决定**：
 * 既然功法能捡回来，随身装备一起捡回来更符合直觉，
 * 也让"炼装备"不至于变成一个填不满的坑。
 */
export function salvageGearsOnDeath(
  state: GameState,
  died: Disciple[],
  random: RandomSource = gameRandom,
): { state: GameState; salvaged: string[]; lost: string[] } {
  let working = state;
  const salvaged: string[] = [];
  const lost: string[] = [];
  for (const disciple of died) {
    for (const slot of GEAR_SLOTS) {
      const gearId = disciple.gear[slot];
      const def = GEAR_MAP[gearId];
      if (!def) continue;
      if (random() < GEAR_SALVAGE_RATE) {
        working = addGear(working, gearId, 1);
        salvaged.push(def.name);
      } else {
        lost.push(def.name);
      }
    }
  }
  return { state: working, salvaged, lost };
}

/** 界面用：装备在某名弟子身上的展示串 */
export function describeDiscipleGear(disciple: Disciple): string {
  const parts = getDiscipleGear(disciple)
    .filter((entry) => entry.def)
    .map((entry) => `${entry.def!.icon}${entry.def!.name}`);
  return parts.length > 0 ? parts.join(' ') : '未着装';
}

/** 界面用：某件装备能否被某名弟子用（列表里灰掉不合格的） */
export function eligibleForGear(state: GameState, gearId: string): Disciple[] {
  const def = GEAR_MAP[gearId];
  if (!def) return [];
  return state.sect.disciples
    .filter((d) => d.realmIndex >= def.minRealm)
    .sort((a, b) => b.realmIndex - a.realmIndex || a.name.localeCompare(b.name));
}

export type { GearKind, GearSlot };

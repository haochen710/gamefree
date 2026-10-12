/**
 * 功法：获取、合成、装备、加成与回收（设定集第 7 章）
 *
 * 这一层只做纯函数与加成聚合，界面在 `components/ManualPanel.tsx`。
 *
 * 与弟子那套天赋的关系，一句话说清：
 *   - **天赋是"你招到什么人"**（随机、永久、改不了）
 *   - **功法是"你给什么人配什么书"**（可获取、可拆卸、可换人）
 * 两者都是修行/伤亡的来源，但只有后者是玩家能主动规划的长期目标。
 */
import { D } from './decimal';
import { gameRandom, weightedDraw, type RandomSource } from './random';
import {
  ARENA_FIRST_FRAGMENTS,
  ARENA_PARTICIPANT_FRAGMENTS,
  ARENA_RUNNERUP_FRAGMENTS,
  CONTEMPLATE_FRAGMENTS,
  CONTEMPLATE_QI_COST,
  FRAGMENT_DROP_CHANCE,
  FRAGMENT_DROP_COUNT,
  FRAGMENT_GRADE_WEIGHTS,
  FRAGMENTS_PER_MANUAL,
  MANUAL_GRADE_NAMES,
  MANUAL_GRADE_MIN_REALM,
  MANUAL_MAP,
  MANUALS,
  MANUAL_SALVAGE_RATE,
  SYNTH_BASE_RATE,
  SYNTH_FAIL_LOSS,
  SYNTH_MAX_RATE,
  SYNTH_PER_LIBRARY,
  canDiscipleUse,
  fragmentIdOf,
  manualIdOfFragment,
  manualsOfGrade,
  type ManualDef,
  type ManualGrade,
  type ManualKind,
} from './content';
import { getBuildingCount } from './engine';
import { pushJournal } from './disciples';
import type { Disciple, GameState } from './state';

/* ------------------------------------------------------------------ */
/* 碎片与整本的读写                                                     */
/* ------------------------------------------------------------------ */

export function getFragmentCount(state: GameState, manualId: string): number {
  return state.manualFragments[fragmentIdOf(manualId)] ?? 0;
}

export function getManualCount(state: GameState, manualId: string): number {
  return state.manuals[manualId] ?? 0;
}

/** 库存里所有完整功法（按品阶降序、同阶按 id 稳定） */
export function getOwnedManuals(state: GameState): { def: ManualDef; count: number }[] {
  return MANUALS.filter((m) => (state.manuals[m.id] ?? 0) > 0).map((def) => ({
    def,
    count: state.manuals[def.id] ?? 0,
  }));
}

/** 库存里所有碎片（按品阶降序） */
export function getOwnedFragments(state: GameState): { def: ManualDef; count: number }[] {
  return MANUALS.map((def) => ({ def, count: getFragmentCount(state, def.id) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.def.grade - a.def.grade || a.def.id.localeCompare(b.def.id));
}

/** 加碎片（负数用于扣除；数量夹到 0 以上） */
export function addFragments(state: GameState, manualId: string, amount: number): GameState {
  if (amount === 0) return state;
  const key = fragmentIdOf(manualId);
  const next = Math.max(0, (state.manualFragments[key] ?? 0) + amount);
  const manualFragments = { ...state.manualFragments };
  if (next > 0) manualFragments[key] = next;
  else delete manualFragments[key];
  return { ...state, manualFragments };
}

/** 加完整功法 */
export function addManual(state: GameState, manualId: string, amount: number): GameState {
  if (amount === 0) return state;
  const next = Math.max(0, (state.manuals[manualId] ?? 0) + amount);
  const manuals = { ...state.manuals };
  if (next > 0) manuals[manualId] = next;
  else delete manuals[manualId];
  return { ...state, manuals };
}

/* ------------------------------------------------------------------ */
/* 获取：秘境掉落 / 藏经阁参悟 / 论道大比                                */
/* ------------------------------------------------------------------ */

/** 按秘境档次抽一个品阶（档次越高越可能出高档） */
export function rollFragmentGrade(tier: number, random: RandomSource): ManualGrade {
  const table = FRAGMENT_GRADE_WEIGHTS[Math.min(9, Math.max(1, tier))] ?? FRAGMENT_GRADE_WEIGHTS[1];
  const pool = (Object.entries(table) as [string, number][])
    .map(([grade, weight]) => ({ grade: Number(grade) as ManualGrade, weight }))
    .filter((entry) => entry.weight > 0);
  if (pool.length === 0) return 1;
  const [picked] = weightedDraw(pool, 1, random);
  return picked?.grade ?? 1;
}

export interface FragmentDrop {
  manualId: string;
  name: string;
  amount: number;
  grade: ManualGrade;
  gradeName: string;
}

/**
 * 秘境结算时掉碎片（设定集第 7.3 章"秘境掉落"）。
 *
 * 概率与数量都写死在 content 里（45% / 2 份），可调；
 * 品阶由**秘境档次**决定，所以"想要极品功法就得往深处走"是一条硬约束。
 */
export function rollFragmentDrop(
  state: GameState,
  tier: number,
  random: RandomSource,
): { state: GameState; drop: FragmentDrop | null } {
  if (random() >= FRAGMENT_DROP_CHANCE) return { state, drop: null };

  let working = state;
  const got = new Map<string, number>();
  for (let i = 0; i < FRAGMENT_DROP_COUNT; i += 1) {
    const grade = rollFragmentGrade(tier, random);
    const pool = manualsOfGrade(grade);
    if (pool.length === 0) continue;
    const def = pool[Math.floor(random() * pool.length)];
    working = addFragments(working, def.id, 1);
    got.set(def.id, (got.get(def.id) ?? 0) + 1);
  }
  const [firstId] = got.keys();
  if (!firstId) return { state: working, drop: null };
  const def = MANUAL_MAP[firstId];
  return {
    state: working,
    drop: {
      manualId: firstId,
      name: def.name,
      amount: got.get(firstId) ?? 1,
      grade: def.grade,
      gradeName: MANUAL_GRADE_NAMES[def.grade],
    },
  };
}

/** 论道大比的功法奖励（设定集：名次不同、品阶不同） */
export function grantArenaManuals(state: GameState, random: RandomSource): { state: GameState; notes: string[] } {
  const disciples = state.sect.disciples;
  if (disciples.length === 0) return { state, notes: [] };

  let working = state;
  const notes: string[] = [];
  // 按境界排出前四名：第一拿上品碎片、二三拿良品、其余算参与奖
  const ranked = [...disciples].sort((a, b) => b.realmIndex - a.realmIndex);

  const pick = (grade: ManualGrade, amount: number) => {
    const pool = manualsOfGrade(grade);
    if (pool.length === 0) return;
    const def = pool[Math.floor(random() * pool.length)];
    working = addFragments(working, def.id, amount);
    notes.push(`${def.name}碎片×${amount}`);
  };

  pick(3, ARENA_FIRST_FRAGMENTS);
  pick(2, ARENA_RUNNERUP_FRAGMENTS);
  pick(1, ARENA_PARTICIPANT_FRAGMENTS);
  void ranked;
  return { state: working, notes };
}

/* ------------------------------------------------------------------ */
/* 合成                                                                */
/* ------------------------------------------------------------------ */

/** 合成成功率（藏经阁越多越稳） */
export function getSynthRate(state: GameState): number {
  const libraries = getBuildingCount(state, 'library');
  return Math.min(SYNTH_MAX_RATE, SYNTH_BASE_RATE + libraries * SYNTH_PER_LIBRARY);
}

export interface SynthResult {
  state: GameState;
  ok: boolean;
  /** 是否触发了失败（扣掉一份碎片） */
  failed: boolean;
  message: string;
}

/**
 * 用 5 份碎片合成一本完整功法。
 *
 * 失败**只损失 1 份碎片**（不是全部 5 份）：设定集只说了"藏经阁等级提升成功率"，
 * 没说失败怎么罚；一次性吞掉 5 份碎片会让玩家攒到 5 份也不敢点，
 * 于是这个系统就变成了摆设。
 */
export function synthManual(
  state: GameState,
  manualId: string,
  random: RandomSource = gameRandom,
): SynthResult {
  const def = MANUAL_MAP[manualId];
  if (!def) return { state, ok: false, failed: false, message: '没有这种功法' };
  if (def.grade === 5 && getBuildingCount(state, 'library') < 1) {
    return { state, ok: false, failed: false, message: '天纵功法需先建藏经阁方可参悟' };
  }
  if (getFragmentCount(state, manualId) < FRAGMENTS_PER_MANUAL) {
    return {
      state,
      ok: false,
      failed: false,
      message: `碎片不足（需 ${FRAGMENTS_PER_MANUAL} 份）`,
    };
  }

  const rate = getSynthRate(state);
  const success = random() < rate;
  let working = addFragments(state, manualId, -FRAGMENTS_PER_MANUAL);
  if (!success) {
    // 失败：吞掉一份碎片（已经扣掉的 5 份里退回 4 份）
    working = addFragments(working, manualId, FRAGMENTS_PER_MANUAL - SYNTH_FAIL_LOSS);
    return {
      state: working,
      ok: false,
      failed: true,
      message: `参悟失败，损失 ${SYNTH_FAIL_LOSS} 份碎片（成功率 ${Math.round(rate * 100)}%）`,
    };
  }

  working = addManual(working, manualId, 1);
  working = {
    ...working,
    journal: pushJournal(working.journal, {
      time: working.playTime,
      kind: 'good',
      text: `藏经阁中参悟有成，合成 ${def.name}（${MANUAL_GRADE_NAMES[def.grade]}）`,
    }),
  };
  return { state: working, ok: true, failed: false, message: `合成 ${def.name}` };
}

/** 藏经阁参悟：用灵气换某一品阶的碎片（凡品~极品；天纵不可参悟） */
export function canContemplate(
  state: GameState,
  grade: ManualGrade,
): { ok: boolean; reason: string | null; cost: number } {
  const cost = CONTEMPLATE_QI_COST[grade];
  if (cost <= 0) return { ok: false, reason: '天纵功法无法参悟，只能从九档秘境中取得', cost: 0 };
  if (getBuildingCount(state, 'library') < 1) return { ok: false, reason: '需先建藏经阁', cost };
  if (state.resources.qi.lt(cost)) return { ok: false, reason: '灵气不足', cost };
  return { ok: true, reason: null, cost };
}

export interface ContemplateResult {
  state: GameState;
  /** 参悟到了哪本功法的碎片 */
  gained: { id: string; name: string; amount: number } | null;
  message: string;
}

export function contemplate(
  state: GameState,
  grade: ManualGrade,
  random: RandomSource = gameRandom,
): ContemplateResult {
  const check = canContemplate(state, grade);
  if (!check.ok) return { state, gained: null, message: check.reason ?? '无法参悟' };

  const pool = manualsOfGrade(grade);
  if (pool.length === 0) return { state, gained: null, message: '此品阶暂无功法' };
  const def = pool[Math.floor(random() * pool.length)];

  const next: GameState = {
    ...addFragments(
      { ...state, resources: { ...state.resources, qi: state.resources.qi.sub(D(check.cost)) } },
      def.id,
      CONTEMPLATE_FRAGMENTS,
    ),
  };
  return {
    state: next,
    gained: { id: def.id, name: def.name, amount: CONTEMPLATE_FRAGMENTS },
    message: `参悟得 ${def.name}碎片 ×${CONTEMPLATE_FRAGMENTS}`,
  };
}

/* ------------------------------------------------------------------ */
/* 装备 / 卸下                                                          */
/* ------------------------------------------------------------------ */

export function manualSlotOf(kind: ManualKind): 'cultivationManual' | 'combatManual' {
  return kind === 'cultivation' ? 'cultivationManual' : 'combatManual';
}

export interface EquipCheck {
  ok: boolean;
  reason: string | null;
}

export function canEquipManual(state: GameState, discipleId: string, manualId: string): EquipCheck {
  const disciple = state.sect.disciples.find((d) => d.id === discipleId);
  if (!disciple) return { ok: false, reason: '弟子不存在' };
  const def = MANUAL_MAP[manualId];
  if (!def) return { ok: false, reason: '没有这种功法' };
  if (getManualCount(state, manualId) <= 0) return { ok: false, reason: '仓库里没有这本功法' };
  if (!canDiscipleUse(def.grade, disciple.realmIndex)) {
    return {
      ok: false,
      reason: `需${MANUAL_GRADE_NAMES[def.grade]}功法最低境界：${['炼气', '筑基', '金丹', '元婴', '化神'][MANUAL_GRADE_MIN_REALM[def.grade]]}期`,
    };
  }
  return { ok: true, reason: null };
}

/** 装备一本功法（同名已在身上则视为重复） */
export function equipManual(state: GameState, discipleId: string, manualId: string): GameState {
  if (!canEquipManual(state, discipleId, manualId).ok) return state;
  const def = MANUAL_MAP[manualId];
  const slot = manualSlotOf(def.kind);

  let working = addManual(state, manualId, -1);
  const disciples = working.sect.disciples.map((d) => {
    if (d.id !== discipleId) return d;
    // 换下来的那本回到仓库（设定集：自由拆卸无损耗）
    return { ...d, [slot]: manualId };
  });
  working = { ...working, sect: { ...working.sect, disciples } };

  const previous = state.sect.disciples.find((d) => d.id === discipleId)?.[slot];
  if (previous) working = addManual(working, previous, 1);
  return working;
}

/** 卸下某名弟子某个槽位的功法 */
export function unequipManual(
  state: GameState,
  discipleId: string,
  slot: 'cultivationManual' | 'combatManual',
): GameState {
  const disciple = state.sect.disciples.find((d) => d.id === discipleId);
  if (!disciple || !disciple[slot]) return state;
  const manualId = disciple[slot];
  const disciples = state.sect.disciples.map((d) => (d.id === discipleId ? { ...d, [slot]: '' } : d));
  const working: GameState = { ...state, sect: { ...state.sect, disciples } };
  return addManual(working, manualId, 1);
}

/* ------------------------------------------------------------------ */
/* 加成聚合                                                            */
/* ------------------------------------------------------------------ */

/** 某名弟子修炼功法带来的修行加成（加算） */
export function getManualCultivationBonus(disciple: Disciple): number {
  const def = MANUAL_MAP[disciple.cultivationManual];
  return def ? def.cultivationBonus : 0;
}

/** 某名弟子两本功法带来的"突破所需修为削减" */
export function getManualNeedReduction(disciple: Disciple): number {
  let total = 0;
  for (const id of [disciple.cultivationManual, disciple.combatManual]) {
    const def = MANUAL_MAP[id];
    if (def) total += def.needReduction;
  }
  return Math.min(0.3, total);
}

/** 某名弟子两本功法带来的伤亡削减（与天赋、性格、忠诚同一个池子） */
export function getManualCasualtyReduction(disciple: Disciple): number {
  let total = 0;
  for (const id of [disciple.cultivationManual, disciple.combatManual]) {
    const def = MANUAL_MAP[id];
    if (def) total += def.casualtyReduction;
  }
  return total;
}

/** 某名弟子两本功法带来的心魔抵抗 */
export function getManualDemonGuard(disciple: Disciple): number {
  let total = 0;
  for (const id of [disciple.cultivationManual, disciple.combatManual]) {
    const def = MANUAL_MAP[id];
    if (def) total += def.demonGuard;
  }
  return total;
}

/**
 * 队伍里功法提供的产出加成（**取最高一项**，不叠加）。
 *
 * 与天赋那条同源：设定集明说「同功法不可叠加，只取最高品级效果」。
 */
export function getPartyManualYieldBonus(state: GameState, ids: string[]): number {
  const byId = new Map(state.sect.disciples.map((d) => [d.id, d]));
  const party: Disciple[] = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (d) party.push(d);
  }
  return getPartyManualYieldBonusOf(party);
}

/** 同上，但直接收弟子对象（秘境结算已经取过一次队伍，没必要再查一遍名册） */
export function getPartyManualYieldBonusOf(party: Disciple[]): number {
  let best = 0;
  for (const d of party) {
    for (const manualId of [d.cultivationManual, d.combatManual]) {
      const def = MANUAL_MAP[manualId];
      if (def) best = Math.max(best, def.yieldBonus);
    }
  }
  return best;
}

/** 全宗最高的功法心魔抵抗（界面展示用；逐人结算时用的是他自己那一份） */
export function getBestManualDemonGuard(state: GameState): number {
  let best = 0;
  for (const d of state.sect.disciples) {
    best = Math.max(best, getManualDemonGuard(d));
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 陨落回收                                                            */
/* ------------------------------------------------------------------ */

/**
 * 弟子陨落时回收身上的功法（设定集：60% 回收、40% 损毁）。
 *
 * 逐本掷骰而不是"整体 60%"：玩家看到的是"这本书回没回来"，
 * 一本一本判才和界面上的"已回收 / 已损毁"对得上。
 */
export function salvageManualsOnDeath(
  state: GameState,
  died: Disciple[],
  random: RandomSource = gameRandom,
): { state: GameState; salvaged: string[]; lost: string[] } {
  let working = state;
  const salvaged: string[] = [];
  const lost: string[] = [];
  for (const disciple of died) {
    for (const manualId of [disciple.cultivationManual, disciple.combatManual]) {
      const def = MANUAL_MAP[manualId];
      if (!def) continue;
      if (random() < MANUAL_SALVAGE_RATE) {
        working = addManual(working, manualId, 1);
        salvaged.push(def.name);
      } else {
        lost.push(def.name);
      }
    }
  }
  return { state: working, salvaged, lost };
}

/** 界面用：某名弟子当前两本功法（含空位） */
export function getEquippedManuals(
  disciple: Disciple,
): { slot: 'cultivation' | 'combat'; def: ManualDef | null }[] {
  return [
    { slot: 'cultivation', def: MANUAL_MAP[disciple.cultivationManual] ?? null },
    { slot: 'combat', def: MANUAL_MAP[disciple.combatManual] ?? null },
  ];
}

/** 界面用：可装备这本功法的弟子（按境界降序，方便挑人） */
export function getEligibleDisciples(state: GameState, manualId: string): Disciple[] {
  const def = MANUAL_MAP[manualId];
  if (!def) return [];
  return state.sect.disciples
    .filter((d) => canDiscipleUse(def.grade, d.realmIndex))
    .sort((a, b) => b.realmIndex - a.realmIndex || a.name.localeCompare(b.name));
}

/** 界面用：仓库里所有功法（含碎片数），按品阶降序 */
export function getAllManuals(state: GameState): { def: ManualDef; count: number; fragments: number }[] {
  return [...MANUALS]
    .sort((a, b) => b.grade - a.grade || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .map((def) => ({
      def,
      count: getManualCount(state, def.id),
      fragments: getFragmentCount(state, def.id),
    }));
}

/** 藏经阁的合成加成说明（界面 tooltip） */
export function describeSynth(state: GameState): string {
  return `合成成功率 ${Math.round(getSynthRate(state) * 100)}%（每座藏经阁 +${Math.round(
    SYNTH_PER_LIBRARY * 100,
  )}%）`;
}

/** 碎片 / 功法的展示名 */
export function labelOf(manualId: string): string {
  return MANUAL_MAP[manualId]?.name ?? manualId;
}

export { manualIdOfFragment, MANUAL_GRADE_NAMES };


/**
 * 宗门幸福度（需求 4 / 5）
 *
 * 需求原文：
 *   「增加宗门幸福度设定，幸福度越高，可以给弟子修炼的增益，反之减益」
 *   「增加宗门获取幸福度的建筑，这些建筑一定得是非常稀有，需求的资源多，
 *     且需要稀有材料」
 *
 * 口径（与用户确认）：**稀有建筑提供基础值 + 动态修正**。
 *
 * 怎么算：
 *   target = 基础值（稀有建筑给的） + 各条动态修正（忠诚 / 心魔 / 伤亡 /
 *            战争 / 灵草与丹药是否充足 / 人口密度）
 *   state.happiness 每帧朝 target **平滑靠拢**（不会一帧跳完）
 *
 * 为什么要"目标值 + 平滑"而不是直接存一个数字：
 *   幸福度是个**情绪**，玩家做了好事（补上灵草、清了心魔）应该看到它
 *   "慢慢好起来"，而不是瞬间满格。同时平滑也避免了某个瞬时状态
 *   （比如刚死了一个弟子）把数值砸到底、再也回不来。
 *
 * 效果：幸福度换算成**全宗弟子修行速度倍率**，
 *   50 是中立点（×1.00），100 是 ×1.30，0 是 ×0.80 —— 有增益也有减益，
 *   正如需求写的"越高增益、反之减益"。
 */
import {
  HAPPINESS_BUILDINGS,
  HAPPINESS_MAX,
  HAPPINESS_MIN,
  HAPPINESS_NEUTRAL,
  HAPPINESS_BONUS_AT_MAX,
  HAPPINESS_PENALTY_AT_MIN,
  HAPPINESS_DRIFT_PER_SECOND,
  HAPPINESS_MODIFIERS,
} from './content';
import { getBuildingCount, getDiscipleCapacity } from './engine';
import { getSectArrayHappiness } from './sectArray';
import { getFameTier } from './fame';
import { FAME_TIERS } from './content';
import type { GameState } from './state';

/** 稀有幸福度建筑提供的**基础值**（各建筑自身的 happiness 之和） */
export function getHappinessBase(state: GameState): number {
  let base = 0;
  for (const def of HAPPINESS_BUILDINGS) {
    base += getBuildingCount(state, def.id) * (def.happiness ?? 0);
  }
  return base;
}

/**
 * 动态修正（需求 4 的那一半）。
 *
 * 每一条都对应一个玩家**能动手改善**的东西 —— 这是这条设计的重点：
 * 幸福度不该是一个随机数，而是一面照出宗门状态的镜子。
 */
export interface HappinessFactor {
  id: string;
  label: string;
  value: number;
  detail: string;
}

export function getHappinessFactors(state: GameState): HappinessFactor[] {
  const out: HappinessFactor[] = [];
  const disciples = state.sect.disciples;

  if (disciples.length === 0) {
    /*
     * ⚠️ 空宗门也要把大阵算上：护山大阵是**建筑**给的效果，
     * 与有没有弟子无关（第一次把这段插错了分支，实测才发现）。
     */
    if (state.sectArrayOn) {
      out.push({
        id: 'sectArray',
        label: '宗门大阵',
        value: getSectArrayHappiness(state),
        detail: '大阵运转中',
      });
    }
    return out;
  }

  /* 1. 弟子忠诚（平均）—— 最直接的一条 */
  const loyaltyAvg = disciples.reduce((sum, d) => sum + d.loyalty, 0) / disciples.length;
  const loyaltyFactor = ((loyaltyAvg - 50) / 50) * HAPPINESS_MODIFIERS.loyalty;
  out.push({
    id: 'loyalty',
    label: '弟子忠诚',
    value: loyaltyFactor,
    detail: `平均 ${Math.round(loyaltyAvg)}（50 为中立）`,
  });

  /* 2. 心魔（平均）—— 心魔缠身的宗门不会有幸福感 */
  const demonAvg = disciples.reduce((sum, d) => sum + d.demon, 0) / disciples.length;
  const demonFactor = -(demonAvg / 100) * HAPPINESS_MODIFIERS.demon;
  out.push({
    id: 'demon',
    label: '心魔',
    value: demonFactor,
    detail: `平均 ${Math.round(demonAvg)}`,
  });

  /* 3. 近期伤亡 —— 用"最近一层凶险秘境还开着几条队伍"这种瞬时量不好取，
        改用寿命/陨落计数里最直接的一项：道伤弟子占比 */
  /*
   * ⚠️ 道伤是**掌门自己的状态**（第 16 轮那轮修过：道伤只来自突破失败与
   * 心魔雷罚），弟子身上没有这个字段 —— 所以这一项量的是"掌门带伤"，
   * 那也确实会让全宗人心不定。
   */
  const masterInjured = state.injurySeconds > 0 ? 1 : 0;
  const injuryFactor = -masterInjured * HAPPINESS_MODIFIERS.injury;
  out.push({
    id: 'injury',
    label: '掌门道伤',
    value: injuryFactor,
    detail: masterInjured > 0 ? '掌门身上带着道伤' : '掌门身体无恙',
  });

  /* 4. 战争状态 —— 打仗的宗门人心惶惶 */
  // 交战方记在根层的 atWarWith 里（不是 npcSects 的字段）
  const atWar = state.atWarWith.length;
  const warFactor = -atWar * HAPPINESS_MODIFIERS.warEach;
  out.push({
    id: 'war',
    label: '交战',
    value: warFactor,
    detail: atWar === 0 ? '四面无事' : `同时与 ${atWar} 家交战`,
  });

  /* 5. 灵草是否充足 —— 吃得饱才有幸福感（按人均灵草） */
  const perCapitaHerb = disciples.length > 0 ? Number(state.resources.herb) / disciples.length : 0;
  const wellFed = perCapitaHerb >= HAPPINESS_MODIFIERS.herbComfortPerHead;
  out.push({
    id: 'food',
    label: '灵草储备',
    value: wellFed ? HAPPINESS_MODIFIERS.wellFed : -HAPPINESS_MODIFIERS.hungry,
    detail: `人均 ${Math.round(perCapitaHerb)} 灵草（${wellFed ? '富足' : '偏紧'}）`,
  });

  /* 6. 居住密度 —— 挤在一起当然不开心（需求 4 的"反之减益"） */
  const cap = getDiscipleCapacity(state);
  const crowd = cap > 0 ? disciples.length / cap : 0;
  const crowdFactor = crowd > HAPPINESS_MODIFIERS.crowdThreshold
    ? -(crowd - HAPPINESS_MODIFIERS.crowdThreshold) * HAPPINESS_MODIFIERS.crowd
    : HAPPINESS_MODIFIERS.roomy;
  out.push({
    id: 'crowd',
    label: '居住密度',
    value: crowdFactor,
    detail: `${Math.round(crowd * 100)}% 满员（${Math.round(HAPPINESS_MODIFIERS.crowdThreshold * 100)}% 以上开始不满）`,
  });

  /* 7. 名望段位 —— 名门大派弟子与有荣焉 */
  // FameTierDef 没有序号字段 —— 段位序号就是它在表里的下标
  const fameTier = getFameTier(state);
  const tierIndex = FAME_TIERS.findIndex((t) => t.id === fameTier.id);
  const tierFactor = Math.max(0, tierIndex) * HAPPINESS_MODIFIERS.fameTierEach;
  out.push({
    id: 'fame',
    label: '宗门名望',
    value: tierFactor,
    detail: `${fameTier.name}（第 ${Math.max(0, tierIndex) + 1} 段）`,
  });

  /* 8. 宗门大阵（需求 9）—— 护山大阵转着，人心就定 */
  if (state.sectArrayOn) {
    out.push({
      id: 'sectArray',
      label: '宗门大阵',
      value: getSectArrayHappiness(state),
      detail: '大阵运转中',
    });
  }

  return out;
}

/** 目标幸福度（基础值 + 全部修正，夹在上下限内） */
export function getHappinessTarget(state: GameState): number {
  const raw =
    HAPPINESS_NEUTRAL +
    getHappinessBase(state) +
    getHappinessFactors(state).reduce((sum, f) => sum + f.value, 0);
  return Math.max(HAPPINESS_MIN, Math.min(HAPPINESS_MAX, raw));
}

/**
 * 幸福度 → 弟子修行速度倍率。
 *
 * 50 = ×1.00（中立）；100 = ×1.30；0 = ×0.80。
 * 两端不对称是故意的：**减益比增益温和** —— 需求要的是"幸福度低会难受"，
 * 不是"幸福度低就没法玩"。
 */
export function getHappinessCultivationMultiplier(state: GameState): number {
  const h = state.happiness;
  if (h >= HAPPINESS_NEUTRAL) {
    const t = (h - HAPPINESS_NEUTRAL) / (HAPPINESS_MAX - HAPPINESS_NEUTRAL);
    return 1 + t * (HAPPINESS_BONUS_AT_MAX - 1);
  }
  const t = (HAPPINESS_NEUTRAL - h) / (HAPPINESS_NEUTRAL - HAPPINESS_MIN);
  return 1 - t * (1 - HAPPINESS_PENALTY_AT_MIN);
}

/** 界面用：一句话概括当前幸福度 */
export function describeHappiness(state: GameState): string {
  const h = state.happiness;
  if (h >= 85) return '宗门上下其乐融融';
  if (h >= 70) return '弟子们过得不错';
  if (h >= 55) return '还算安稳';
  if (h >= 45) return '平平淡淡';
  if (h >= 30) return '弟子们有些不满';
  if (h >= 15) return '人心浮动，怨气不小';
  return '宗门里怨声载道';
}

/**
 * 每帧推进：幸福度朝目标平滑靠拢。
 *
 * ⚠️ 用 `dt` 而不是"每帧固定步长"：离线几小时回来时，幸福度应该
 * **已经**走到目标值附近，而不是从零慢慢爬 —— 但也不能一步跳到位
 * （那样玩家就看不到"慢慢好起来"的过程）。所以按秒做指数逼近。
 */
export function tickHappiness(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;
  const target = getHappinessTarget(state);
  const diff = target - state.happiness;
  if (Math.abs(diff) < 0.01) {
    return state.happiness === target ? state : { ...state, happiness: target };
  }
  // 每秒靠拢 HAPPINESS_DRIFT_PER_SECOND 的比例（指数逼近，永远不会越过目标）
  const step = 1 - Math.pow(1 - HAPPINESS_DRIFT_PER_SECOND, dt);
  return { ...state, happiness: state.happiness + diff * step };
}

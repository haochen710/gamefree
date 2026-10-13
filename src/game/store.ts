/**
 * 全局状态容器（zustand）。
 *
 * 每个动作都是「读当前 state → 用 game/ 里的纯函数算出新 state → set」，
 * 游戏逻辑与 React 因此完全解耦。
 *
 * 所有会改变状态的动作都经过 nextGame() 收口，它统一做一件事：
 * 刷新建筑解锁。这样无论资源是被动涨上来的、还是一颗丹药瞬间给的，
 * 都不会漏掉解锁时机。
 */
import { create } from 'zustand';
import { fmt, fmtDuration } from './decimal';
import {
  AUTO_REFINE_LEVEL_MAX,
  BUILDABLE_MAP,
  ITEM_MAP,
  ENDING_MAP,
  FURNACE_MAP,
  GEAR_MAP,
  MANUAL_GRADE_MIN_REALM,
  REFINE_RECIPE_MAP,
  SERVANT_JOB_MAP,
  SECRET_REALM_MAP,
  type ItemId,
  type EndingId,
  type GearSlot,
  type ManualGrade,
  type MaterialId,
  type ServantJobId,
} from './content';
import * as engine from './engine';
import * as disciples from './disciples';
import * as expeditions from './expeditions';
import * as crafting from './crafting';
import * as research from './research';
import * as planting from './planting';
import * as shop from './shop';
import * as manuals from './manuals';
import * as fame from './fame';
import * as diplomacy from './diplomacy';
import * as gear from './gear';
import * as travel from './travel';
import * as encounter from './encounter';
import * as enlightenment from './enlightenment';
import * as tick from './tick';
import { gameRandom } from './random';
import * as sectActivity from './sectActivity';
import { applyTick } from './tick';
import { createAscendedState, createInitialState, type GameState } from './state';
import {
  applyOffline,
  clearLocal,
  exportCode,
  importCode,
  loadFromLocal,
  saveToLocal,
  type OfflineReport,
} from './save';

export interface GameStore {
  game: GameState;
  offline: OfflineReport | null;
  notice: string | null;
  lastSavedAt: number;

  tick(dt: number): void;

  /* 修行 */
  meditate(): void;
  buy(id: string, count: number | 'max'): void;
  /* ---- 建造队列（需求 2） ---- */
  enqueueBuild(id: string): void;
  dequeueBuild(index: number): void;
  moveQueueItem(index: number, delta: number): void;
  clearBuildQueue(): void;
  /** 天工院的特殊升级：解锁一个建造名额 */
  upgradeQueue(): void;
  advanceLayer(): void;
  /**
   * 突破大境界（需求 9：必须持有对应境界丹，丹药由函数内部扣除）。
   *
   * 原来这个动作带一个 `usePill` 开关 —— 现在丹药是硬门槛，
   * 能突破就一定要吃丹，开关本身没有意义了。
   */
  breakthrough(): void;
  refineStone(times: number): void;
  setAutoRefine(level: number): void;
  ascend(): void;
  hardReset(): void;

  /* 个人游历（需求 1） */
  startTravel(regionId: string): void;
  cancelTravel(): void;

  /* 种植（需求 5） */
  plantSeed(material: string): void;
  plantAllSeeds(): void;
  harvest(id: string): void;
  harvestAll(): void;
  hastenPlanting(id: string, currency: planting.HastenCurrency): void;

  /* 钻研（需求 6） */
  startResearch(id: string): void;
  cancelResearch(): void;

  /* 商行（需求 3） */
  buyShopOffer(offerId: string): void;
  /** 一键打包：买下当前所有买得起的货（需求 2） */
  buyAllShopOffers(): void;

  /* 藏经阁 / 功法（设定集第 7 章） */
  /** 用灵气参悟某一品阶的碎片（凡品~极品） */
  contemplateManual(grade: ManualGrade): void;
  /** 用 5 份碎片合成一本完整功法 */
  synthManual(manualId: string): void;
  /** 把一本功法装备给某名弟子 */
  equipManual(discipleId: string, manualId: string): void;
  /** 卸下某名弟子某个槽位的功法 */
  unequipManual(discipleId: string, slot: 'cultivationManual' | 'combatManual'): void;
  /** 一键把仓库里的功法发给最合适的弟子（按境界降序，能装就装） */
  autoEquipManuals(): void;

  /* 声望 / 特质 / 外交 / 结局（设定集第 1 / 9 / 10 章） */
  /** 选定山门先天特质（一局只能选一次） */
  chooseTrait(traitId: string): void;
  /** 用声望兑换声望商店的一件货 */
  buyFameOffer(goodId: string): void;
  /** 向 NPC 宗门赠礼（optionIndex 对应 GIFT_OPTIONS 的三档） */
  giftSect(sectId: string, optionIndex: number): void;
  /** 与 NPC 宗门论道（涨一点关系） */
  parleySect(sectId: string): void;
  /** 结盟 */
  allySect(sectId: string): void;
  /** 撕毁盟约 */
  breakAlliance(sectId: string): void;
  /** 宣战 */
  declareWar(sectId: string): void;
  /** 立刻打一场宗门大战（调试/手动用；正常由 tick 按周期触发） */
  fightBattle(sectId: string): void;
  /** 结算一个已达成的结局（记进跨周目记录） */
  settleEnding(endingId: string): void;

  /* 丹炉与弟子装备（设定集第 8.7 / 11 章） */
  /** 铸造一口新炉鼎（铸成即换上） */
  forgeFurnace(furnaceId: string): void;
  /** 换用一口已获得的炉鼎 */
  equipFurnace(furnaceId: string): void;
  /** 炼制一件弟子装备 */
  forgeGear(gearId: string): void;
  /** 把一件装备装到某名弟子的某个栏位 */
  equipGear(discipleId: string, gearId: string, slot: string): void;
  /** 卸下某名弟子某个栏位 */
  unequipGear(discipleId: string, slot: string): void;
  /** 一键申领：把仓库里的装备按境界发给合适的弟子 */
  autoEquipGears(): void;
  /** 一键把某件装备从所有弟子身上卸下（需求 1） */
  unequipGearEverywhere(gearId: string): void;
  /** 一键卸下所有弟子身上的功法（需求 7） */
  unequipAllManuals(): void;
  /** 批量参悟：一次用灵气换多份碎片（需求 7） */
  contemplateManualBatch(grade: number, times: number): void;
  /** 批量招收弟子（需求 10） */
  recruitDiscipleBatch(count: number): void;

  /* 仆人 */
  recruitServant(job: string): void;
  assignServant(from: string, to: string): void;
  /** 批量把 N 名仆人从某工种调到另一工种（本轮需求 4） */
  assignServants(from: string, to: string, count: number): void;
  dismissServant(job: string): void;
  dismissAllServants(): void;

  /* 宗门（需求 4） */
  foundSect(): void;
  upgradeSect(): void;
  recruitDisciple(): void;
  dismissDisciple(id: string): void;
  dismissBelow(rank: number): void;
  /** 开启 / 停办宗门大比（需求 4：比武台由玩家决定是否开启） */
  toggleArena(): void;
  /** 立刻举办一次大比（只有已开启且冷却走完时可用） */
  holdArena(): void;

  /* 秘境 */
  startExpedition(realmId: string, ids: string[], repeat?: number): void;
  /** 掌门独自前往已发现的秘境（需求 5） */
  startSoloRealm(realmId: string): void;
  /** 掌门亲自做普通探索（需求 5）：开宗前也能用 */
  startSoloSurvey(regionId: string): void;
  /** 选择随机遭遇里的某个选项（需求 2） */
  chooseEncounter(optionIndex: number): void;
  /** 合成 / 精炼（需求 4） */
  refine(recipeId: string, times: number): void;
  /** 花资源开启资源富集区的秘境（需求 1） */
  openRealm(realmId: string): void;
  /** 设置某条配方的自动合成目标存量（本轮需求 2） */
  setAutoRefineTarget(recipeId: string, target: number): void;
  /* ---- 感悟（需求 3） ---- */
  enlighten(pathId: string): void;
  cancelEnlighten(): void;
  /** 制作空间戒指（需求 3） */
  craftSpaceRing(): void;
  /** 时空穿梭（需求 3） */
  timeJump(): void;
  /** 普通探索（需求 1）：小区域还没发现秘境时只能这么做 */
  startSurvey(regionId: string, ids: string[], repeat?: number): void;

  /* 丹器 */
  craftPill(id: string, count: number): void;
  craftArtifact(id: string, count: number): void;
  upgradeAlchemy(): void;
  upgradeRefining(): void;
  usePill(id: string): void;

  /* 存档 */
  dismissOffline(): void;
  setNotice(message: string | null): void;
  saveNow(): void;
  exportSave(): string;
  importSave(code: string): boolean;
}

/**
 * 补一次"开局三选一"的候选特质。
 *
 * 放在这里（而不是 `createInitialState`）有两个原因：
 *   1. `createInitialState` 在 state.ts 里，而抽特质要用到 `fame.ts`
 *      与 engine 的聚合 —— 那会绕成循环依赖；
 *   2. 旧存档（本轮之前开的局）也没有这三个候选，需要在这里补上。
 *
 * 已经选过特质的存档不会被再抽一次（`traits.length > 0` 直接跳过），
 * 所以"读档换特质"这条路是堵死的。
 */
function ensureTraitOffer(state: GameState): GameState {
  if (state.traits.length > 0) return state;
  if (state.traitOffer.length > 0) return state;
  const offer = fame.rollTraitOffer(state, gameRandom);
  return offer.length === 0 ? state : { ...state, traitOffer: offer };
}

/** 启动流程：读档 → 结算离线收益。只在模块加载时执行一次 */
function boot(): { game: GameState; offline: OfflineReport | null } {
  const now = Date.now();
  const loaded = loadFromLocal();
  if (!loaded) return { game: ensureTraitOffer(createInitialState(now)), offline: null };

  const { state, report } = applyOffline(loaded, now);
  return { game: ensureTraitOffer(state), offline: report };
}

const booted = boot();

/**
 * 生成状态变更。状态没变就返回空对象（避免无谓重渲染），
 * 变了则顺带做两件收口的事：刷新建筑解锁、把资源砍回储存上限。
 *
 * 收口在这里的意义是：无论资源是被动涨上来的、丹药瞬间给的、
 * 还是秘境掉落带回来的，都不可能突破上限、也不会漏掉解锁时机。
 */
function nextGame(previous: GameState, next: GameState): { game?: GameState } {
  if (next === previous) return {};
  const refreshed = engine.refreshUnlocks(next);
  return { game: engine.clampResources(refreshed) };
}

export const useGame = create<GameStore>()((set, get) => ({
  game: booted.game,
  offline: booted.offline,
  notice: null,
  lastSavedAt: Date.now(),

  tick: (dt) => {
    set((s) => nextGame(s.game, applyTick(s.game, dt)));
  },

  /* ------------------------------------------------------------ 修行 */

  meditate: () => {
    set((s) => nextGame(s.game, engine.meditate(s.game)));
  },

  buy: (id, count) => {
    set((s) => {
      const def = BUILDABLE_MAP[id];
      if (!def) return {};
      const owned = engine.getBuildingCount(s.game, id);
      const amount = count === 'max' ? engine.maxAffordable(def, owned, s.game) : count;
      if (amount <= 0) return {};
      return nextGame(s.game, engine.buyBuilding(s.game, def, amount));
    });
  },

  /* ---- 建造队列（需求 2） ---- */

  enqueueBuild: (id) => {
    set((s) => {
      if (s.game.buildQueue.length >= engine.getQueueSlots(s.game)) {
        return { notice: '建造队列已满，升级天工院可增加名额' };
      }
      const next = engine.enqueueBuild(s.game, id);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已加入建造队列' };
    });
  },

  dequeueBuild: (index) => {
    set((s) => {
      const next = engine.dequeueBuild(s.game, index);
      return next === s.game ? {} : nextGame(s.game, next);
    });
  },

  moveQueueItem: (index, delta) => {
    set((s) => {
      const next = engine.moveQueueItem(s.game, index, delta);
      return next === s.game ? {} : nextGame(s.game, next);
    });
  },

  clearBuildQueue: () => {
    set((s) => {
      const next = engine.clearQueue(s.game);
      return next === s.game ? {} : nextGame(s.game, next);
    });
  },

  upgradeQueue: () => {
    set((s) => {
      const check = engine.canUpgradeQueue(s.game);
      if (!check.ok) return { notice: check.reason ?? '无法升级' };
      return { ...nextGame(s.game, engine.upgradeQueue(s.game)), notice: '天工院扩建完成，建造名额 +1' };
    });
  },

  advanceLayer: () => {
    set((s) => (engine.canAdvanceLayer(s.game) ? nextGame(s.game, engine.advanceLayer(s.game)) : {}));
  },

  breakthrough: () => {
    set((s) => {
      const status = engine.getBreakthroughStatus(s.game);
      if (!status.possible) return { notice: status.reason ?? '还不能突破' };
      const result = engine.breakthrough(s.game);
      if (!result) return {};

      const realm = engine.getRealm(result.state);
      if (result.success) {
        return { ...nextGame(s.game, result.state), notice: `突破成功，已入${realm.name}！` };
      }
      if (result.injurySeconds > 0) {
        return {
          ...nextGame(s.game, result.state),
          notice: `突破失败（成功率 ${Math.round(result.rate * 100)}%），道伤缠身，${fmtDuration(
            result.injurySeconds,
          )}内无法再度突破`,
        };
      }
      return {
        ...nextGame(s.game, result.state),
        notice: `突破失败（成功率 ${Math.round(result.rate * 100)}%）。境界尚浅，并无大碍，可即刻再试`,
      };
    });
  },

  refineStone: (times) => {
    set((s) => {
      const updated = nextGame(s.game, engine.refineStone(s.game, times));
      return updated.game ? { ...updated, notice: '灵石合成完成' } : {};
    });
  },

  setAutoRefine: (level) => {
    set((s) => {
      const clamped = Math.min(Math.max(Math.floor(level), 0), AUTO_REFINE_LEVEL_MAX);
      if (clamped === s.game.autoRefineLevel) return {};
      const rate = clamped > 0 ? engine.getAutoRefineRate({ ...s.game, autoRefineLevel: clamped }) : 0;
      return {
        game: { ...s.game, autoRefineLevel: clamped, autoRefineProgress: clamped > 0 ? s.game.autoRefineProgress : 0 },
        notice:
          clamped === 0
            ? '已关闭灵石自动合成'
            : `灵石自动合成已开启（${rate} 批/秒）`,
      };
    });
  },

  /* ------------------------------------------------------ 个人游历（需求 1） */

  startTravel: (regionId) => {
    set((s) => {
      const check = travel.canStartTravel(s.game, regionId);
      if (!check.ok) return { notice: check.reason ?? '无法出行' };
      const next = travel.startTravel(s.game, regionId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '掌门已启程' };
    });
  },

  cancelTravel: () => {
    set((s) => {
      if (!s.game.personalTravel) return { notice: '掌门并未在外' };
      return { ...nextGame(s.game, travel.cancelTravel(s.game)), notice: '掌门已折返' };
    });
  },

  /* --------------------------------------------------------- 种植（需求 5） */

  plantSeed: (material) => {
    set((s) => {
      const check = planting.canPlant(s.game, material as MaterialId);
      if (!check.ok) return { notice: check.reason ?? '无法种植' };
      const next = planting.plantSeed(s.game, material as MaterialId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已种下种子' };
    });
  },

  plantAllSeeds: () => {
    set((s) => {
      const next = planting.plantAll(s.game);
      if (next === s.game) return { notice: '没有可种的种子，或地块已满' };
      return {
        ...nextGame(s.game, next),
        notice: `已种下 ${next.plantings.length - s.game.plantings.length} 块地`,
      };
    });
  },

  harvest: (id) => {
    set((s) => {
      const result = planting.harvestPlanting(s.game, id);
      if (result.gains.length === 0) return { notice: '这块地还没成熟' };
      const gain = result.gains[0];
      return { ...nextGame(s.game, result.state), notice: `收获 ${gain.name}×${gain.amount}` };
    });
  },

  harvestAll: () => {
    set((s) => {
      const result = planting.harvestAll(s.game);
      if (result.gains.length === 0) return { notice: '没有成熟的地块' };
      const summary = result.gains.map((g) => `${g.name}×${g.amount}`).join('、');
      return { ...nextGame(s.game, result.state), notice: `收获 ${summary}` };
    });
  },

  hastenPlanting: (id, currency) => {
    set((s) => {
      const result = planting.hastenPlanting(s.game, id, currency);
      if (result.state === s.game) return { notice: result.message };
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  /* --------------------------------------------------------- 钻研（需求 6） */

  startResearch: (id) => {
    set((s) => {
      const check = research.canStartResearch(s.game, id);
      if (!check.ok) return { notice: check.reason ?? '无法钻研' };
      const next = research.startResearch(s.game, id);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已开始钻研' };
    });
  },

  cancelResearch: () => {
    set((s) => {
      if (!s.game.research) return { notice: '当前没有在钻研的技术' };
      return { ...nextGame(s.game, research.cancelResearch(s.game)), notice: '已放弃钻研，材料不退' };
    });
  },

  /* --------------------------------------------------------- 商行（需求 3） */

  buyShopOffer: (offerId) => {
    set((s) => {
      const result = shop.buyShopOffer(s.game, offerId);
      if (result.state === s.game) return { notice: result.message };
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  /* --------------------------------------------------- 藏经阁 / 功法（设定集第 7 章） */

  contemplateManual: (grade) => {
    set((s) => {
      const result = manuals.contemplate(s.game, grade);
      if (result.state === s.game) return { notice: result.message };
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  synthManual: (manualId) => {
    set((s) => {
      const result = manuals.synthManual(s.game, manualId);
      if (result.state === s.game) return { notice: result.message };
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  equipManual: (discipleId, manualId) => {
    set((s) => {
      const check = manuals.canEquipManual(s.game, discipleId, manualId);
      if (!check.ok) return { notice: check.reason ?? '无法装备' };
      const next = manuals.equipManual(s.game, discipleId, manualId);
      if (next === s.game) return {};
      const disciple = s.game.sect.disciples.find((d) => d.id === discipleId);
      return {
        ...nextGame(s.game, next),
        notice: `${disciple?.name ?? '弟子'} 习得 ${manuals.labelOf(manualId)}`,
      };
    });
  },

  unequipManual: (discipleId, slot) => {
    set((s) => {
      const next = manuals.unequipManual(s.game, discipleId, slot);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已卸下功法，功法已回到藏经阁' };
    });
  },

  /*
   * 一键发书。
   *
   * 千人的宗门里逐本拖到某个人身上是不现实的，所以给一个"能装就装"的入口：
   * 按**境界降序**遍历弟子（境界高的先拿好书），每本功法只发一本，
   * 发完为止。玩家仍然可以手动调整个别重点弟子。
   */
  autoEquipManuals: () => {
    set((s) => {
      let working = s.game;
      const owned = manuals
        .getOwnedManuals(working)
        .sort((a, b) => b.def.grade - a.def.grade)
        .map((entry) => ({ ...entry }));
      if (owned.length === 0) return { notice: '仓库里没有可发的功法' };

      const candidates = [...working.sect.disciples].sort(
        (a, b) => b.realmIndex - a.realmIndex || a.name.localeCompare(b.name),
      );
      let handed = 0;
      for (const entry of owned) {
        const slot = entry.def.kind === 'cultivation' ? 'cultivationManual' : 'combatManual';
        for (let i = 0; i < entry.count; i += 1) {
          const target = candidates.find(
            (d) =>
              !d[slot] &&
              d.realmIndex >= MANUAL_GRADE_MIN_REALM[entry.def.grade] &&
              manuals.getManualCount(working, entry.def.id) > 0,
          );
          if (!target) break;
          const next = manuals.equipManual(working, target.id, entry.def.id);
          if (next === working) break;
          working = next;
          handed += 1;
        }
      }
      if (working === s.game) return { notice: '没有可发出去的功法（弟子境界不够或都已装备）' };
      return { ...nextGame(s.game, working), notice: `已发出 ${handed} 本功法` };
    });
  },

  /* ------------------------------------------------- 声望 / 特质 / 外交 / 结局 */

  chooseTrait: (traitId) => {
    set((s) => {
      const check = fame.canChooseTrait(s.game, traitId);
      if (!check.ok) return { notice: check.reason ?? '无法选择' };
      const next = fame.chooseTrait(s.game, traitId);
      if (next === s.game) return {};
      const def = fame.traitView(traitId);
      return { ...nextGame(s.game, next), notice: `山门气运已定：${def?.name ?? traitId}` };
    });
  },

  buyFameOffer: (goodId) => {
    set((s) => {
      const result = fame.buyFameOffer(s.game, goodId);
      if (result.state === s.game) return { notice: result.message };
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  giftSect: (sectId, optionIndex) => {
    set((s) => {
      const check = diplomacy.canGift(s.game, sectId, optionIndex);
      if (!check.ok) return { notice: check.reason ?? '无法赠礼' };
      const next = diplomacy.giftSect(s.game, sectId, optionIndex);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: `赠礼已成（关系 +${check.gain}）` };
    });
  },

  parleySect: (sectId) => {
    set((s) => {
      const check = diplomacy.canParley(s.game, sectId);
      if (!check.ok) return { notice: check.reason ?? '无法论道' };
      const next = diplomacy.parleySect(s.game, sectId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '论道一场，关系略有增进' };
    });
  },

  allySect: (sectId) => {
    set((s) => {
      const check = diplomacy.canAlly(s.game, sectId);
      if (!check.ok) return { notice: check.reason ?? '无法结盟' };
      const next = diplomacy.allySect(s.game, sectId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '盟约已成' };
    });
  },

  breakAlliance: (sectId) => {
    set((s) => {
      const next = diplomacy.breakAlliance(s.game, sectId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '盟约已撕毁' };
    });
  },

  declareWar: (sectId) => {
    set((s) => {
      const check = diplomacy.canDeclareWar(s.game, sectId);
      if (!check.ok) return { notice: check.reason ?? '无法宣战' };
      const next = diplomacy.declareWar(s.game, sectId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已宣战（此局不再满足隐世传承的条件）' };
    });
  },

  fightBattle: (sectId) => {
    set((s) => {
      const outcome = diplomacy.resolveBattle(s.game, sectId);
      if (!outcome || outcome.state === s.game) return { notice: '无法开战' };
      return { ...nextGame(s.game, outcome.state), notice: outcome.won ? `${outcome.text}！` : outcome.text };
    });
  },

  settleEnding: (endingId) => {
    set((s) => {
      const ended = endingId as EndingId;
      const check = fame.checkEndings(s.game).find((e) => e.id === ended);
      if (!check) return { notice: '没有这个结局' };
      if (!check.reached) return { notice: `尚未达成：${check.progress}` };
      /*
       * 一起记下**所有**已达成的结局（见 fame.completeReachedEndings 的注释）：
       * 「称霸仙域」与「隐世传承」可以同时成立，没有理由让玩家二选一。
       */
      const result = fame.completeReachedEndings(s.game);
      if (result.state === s.game) return { notice: '这个结局已经记过了' };
      const names = result.recorded.map((id) => ENDING_MAP[id].name).join('、');
      return { ...nextGame(s.game, result.state), notice: `记入周目：${names}` };
    });
  },

  /* ------------------------------------------------- 丹炉与弟子装备（设定集第 8.7 / 11 章） */

  forgeFurnace: (furnaceId) => {
    set((s) => {
      const check = gear.canForgeFurnace(s.game, furnaceId);
      if (!check.ok) return { notice: check.reason ?? '无法铸造' };
      const next = gear.forgeFurnace(s.game, furnaceId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: `铸成 ${FURNACE_MAP[furnaceId]?.name ?? furnaceId}，已换上新炉` };
    });
  },

  equipFurnace: (furnaceId) => {
    set((s) => {
      const next = gear.equipFurnace(s.game, furnaceId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: `改用 ${FURNACE_MAP[furnaceId]?.name ?? furnaceId}` };
    });
  },

  forgeGear: (gearId) => {
    set((s) => {
      const rate = crafting.getCraftSuccessRate(s.game, 'refining', GEAR_MAP[gearId]?.grade ?? 1);
      const result = gear.forgeGear(s.game, gearId, rate);
      if (result.state === s.game) return { notice: result.message };
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  equipGear: (discipleId, gearId, slot) => {
    set((s) => {
      const gearSlot = slot as GearSlot;
      const check = gear.canEquipGear(s.game, discipleId, gearId, gearSlot);
      if (!check.ok) return { notice: check.reason ?? '无法装备' };
      const next = gear.equipGear(s.game, discipleId, gearId, gearSlot);
      if (next === s.game) return {};
      const disciple = s.game.sect.disciples.find((d) => d.id === discipleId);
      return { ...nextGame(s.game, next), notice: `${disciple?.name ?? '弟子'} 装备 ${GEAR_MAP[gearId]?.name ?? gearId}` };
    });
  },

  unequipGear: (discipleId, slot) => {
    set((s) => {
      const next = gear.unequipGear(s.game, discipleId, slot as GearSlot);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已卸下装备，装备回到仓库' };
    });
  },

  autoEquipGears: () => {
    set((s) => {
      const result = gear.autoEquipGears(s.game);
      if (result.state === s.game) return { notice: '没有可发出去的装备（弟子境界不够或栏位已满）' };
      return { ...nextGame(s.game, result.state), notice: `已发出 ${result.handed} 件装备` };
    });
  },

  unequipGearEverywhere: (gearId) => {
    set((s) => {
      const result = gear.unequipGearEverywhere(s.game, gearId);
      if (result.removed === 0) return { notice: '没有弟子穿着这件装备' };
      return {
        ...nextGame(s.game, result.state),
        notice: `已从 ${result.removed} 名弟子身上卸下 ${GEAR_MAP[gearId]?.name ?? gearId}`,
      };
    });
  },

  unequipAllManuals: () => {
    set((s) => {
      const result = manuals.unequipAllManuals(s.game);
      if (result.removed === 0) return { notice: '没有弟子带着功法' };
      return { ...nextGame(s.game, result.state), notice: `已卸下 ${result.removed} 本功法，全部回到藏经阁` };
    });
  },

  contemplateManualBatch: (grade, times) => {
    set((s) => {
      let working = s.game;
      let got = 0;
      let last = '';
      for (let i = 0; i < Math.max(0, Math.floor(times)); i += 1) {
        const check = manuals.canContemplate(working, grade as ManualGrade);
        if (!check.ok) {
          last = check.reason ?? '';
          break;
        }
        const result = manuals.contemplate(working, grade as ManualGrade);
        if (!result.gained) break;
        working = result.state;
        got += 1;
        last = result.message;
      }
      if (got === 0) return { notice: last || '无法参悟' };
      return { ...nextGame(s.game, working), notice: `参悟 ${got} 次：${last}` };
    });
  },

  recruitDiscipleBatch: (count) => {
    set((s) => {
      const result = disciples.recruitDisciplesBatch(s.game, count);
      if (result.hired === 0) return { notice: result.stoppedBy };
      return {
        ...nextGame(s.game, result.state),
        notice: `招收 ${result.hired} 名弟子（${result.stoppedBy}）`,
      };
    });
  },

  buyAllShopOffers: () => {
    set((s) => {
      const result = shop.buyAllShopOffers(s.game);
      if (result.bought === 0) return { notice: '现在没有买得起的货' };
      return {
        ...nextGame(s.game, result.state),
        notice: `一键打包：买下 ${result.bought} 件，共 ${fmt(result.spent)} 灵石`,
      };
    });
  },

  ascend: () => {
    set((s) => {
      if (!engine.canAscend(s.game)) return {};
      const gain = engine.getDaoYunGain(s.game);
      /*
       * 飞升 = 「飞升成仙」结局（设定集第 10 章）。于是这里做两件事：
       *   1. 把这个结局记进周目（解锁传承特质、并算进周目奖励）；
       *   2. 把**所有**已记结局的周目奖励一并加进这一局的道韵结算 ——
       *      "上一周目的成就，这一周目是有回报的"，多周目才有意义。
       */
      const withEnding = fame.completeEnding(s.game, 'ascend');
      const bonus = fame.endingDaoYunBonus(withEnding);
      const total = gain.add(bonus);
      const next = createAscendedState(withEnding, total, Date.now());
      // 周目记录跨局保留（它是解锁传承特质的凭据）
      next.legacyEndings = [...withEnding.legacyEndings];
      saveToLocal(next);
      return {
        ...nextGame(s.game, next),
        notice: `飞升成功！获得 ${fmt(total)} 点道韵${bonus > 0 ? `（含周目奖励 ${bonus}）` : ''}`,
        lastSavedAt: Date.now(),
      };
    });
  },

  hardReset: () => {
    const fresh = ensureTraitOffer(createInitialState(Date.now()));
    // 「已完成结局」跨周目保留（它是解锁传承特质的凭据），其余一切重来
    fresh.legacyEndings = [...useGame.getState().game.legacyEndings];
    fresh.traitOffer = fame.rollTraitOffer(fresh, gameRandom);
    clearLocal();
    saveToLocal(fresh);
    set({ game: fresh, offline: null, notice: '已重开修行', lastSavedAt: Date.now() });
  },

  /* ------------------------------------------------------------ 仆人 */

  recruitServant: (job) => {
    set((s) => {
      const check = engine.canRecruitServant(s.game);
      if (!check.ok) return { notice: check.reason ?? '无法招收' };
      const next = engine.recruitServant(s.game, job as ServantJobId);
      if (next === s.game) return {};
      const def = SERVANT_JOB_MAP[job as ServantJobId];
      return {
        ...nextGame(s.game, next),
        notice: `一名仆人来到洞府，安排去${def?.name ?? '做事'}`,
      };
    });
  },

  assignServant: (from, to) => {
    set((s) => {
      const next = engine.assignServant(s.game, from as ServantJobId, to as ServantJobId);
      if (next === s.game) return {};
      const def = SERVANT_JOB_MAP[to as ServantJobId];
      return { ...nextGame(s.game, next), notice: `一名仆人改派去${def?.name ?? '做事'}` };
    });
  },

  /** 批量调岗（本轮需求 4）：一次把 N 名仆人从某工种搬到另一工种 */
  assignServants: (from, to, count) => {
    set((s) => {
      if (from === to) return { notice: '源岗位与目标岗位相同' };
      const available = s.game.servants[from] ?? 0;
      const next = engine.assignServants(s.game, from as ServantJobId, to as ServantJobId, count);
      if (next === s.game) return {};
      const moved = Math.min(available, Math.max(0, Math.floor(count)));
      const fromDef = SERVANT_JOB_MAP[from as ServantJobId];
      const toDef = SERVANT_JOB_MAP[to as ServantJobId];
      return {
        ...nextGame(s.game, next),
        notice: `${moved} 名仆人从${fromDef?.name ?? '原岗位'}调往${toDef?.name ?? '新岗位'}`,
      };
    });
  },

  dismissServant: (job) => {
    set((s) => {
      const next = engine.dismissServant(s.game, job as ServantJobId);
      if (next === s.game) return {};
      return { ...nextGame(s.game, next), notice: '已遣散一名仆人，腾出一个仆役床位' };
    });
  },

  dismissAllServants: () => {
    set((s) => {
      const count = engine.getServantCount(s.game);
      if (count === 0) return { notice: '当前没有仆人' };
      return {
        ...nextGame(s.game, engine.dismissAllServants(s.game)),
        notice: `已遣散全部 ${count} 名仆人`,
      };
    });
  },

  /* ------------------------------------------------------------ 宗门 */

  foundSect: () => {
    set((s) => {
      const updated = nextGame(s.game, engine.foundSect(s.game));
      return updated.game ? { ...updated, notice: '开宗立派！' } : {};
    });
  },

  upgradeSect: () => {
    set((s) => {
      const status = engine.getSectUpgradeStatus(s.game);
      if (!status.possible) return { notice: status.reason ?? '暂不可晋升' };
      const next = engine.upgradeSect(s.game);
      return {
        ...nextGame(s.game, next),
        notice: `宗门晋升为${engine.getSectLevelDef(next.sect.level).name}`,
      };
    });
  },

  recruitDisciple: () => {
    set((s) => {
      const result = disciples.recruitDisciple(s.game);
      if (!result.disciple) return { notice: result.reason ?? '招收失败' };
      return {
        ...nextGame(s.game, result.state),
        notice: `${result.disciple.name} 拜入宗门`,
      };
    });
  },

  dismissDisciple: (id) => {
    set((s) => {
      const target = s.game.sect.disciples.find((d) => d.id === id);
      if (!target) return {};
      if (target.status === 'exploring') return { notice: `${target.name} 正在探索，无法逐出` };
      return {
        ...nextGame(s.game, disciples.dismissDisciple(s.game, id)),
        notice: `${target.name} 已被逐出宗门`,
      };
    });
  },

  dismissBelow: (rank) => {
    set((s) => {
      const result = disciples.dismissBelowAptitude(s.game, rank);
      if (result.count === 0) return { notice: '没有符合条件的弟子' };
      return {
        ...nextGame(s.game, result.state),
        notice: `已逐出 ${result.count} 名低资质弟子`,
      };
    });
  },

  toggleArena: () => {
    set((s) => {
      if (!sectActivity.hasArena(s.game)) return { notice: '尚未建成比武台' };
      const enabled = !s.game.arenaEnabled;
      return {
        game: {
          ...s.game,
          arenaEnabled: enabled,
          // 开启时给一个满周期，免得一开就立刻开比
          arenaTimer: enabled ? sectActivity.ARENA_INTERVAL_SECONDS : s.game.arenaTimer,
        },
        notice: enabled ? '宗门大比已开启，十年一比' : '宗门大比已停办',
      };
    });
  },

  holdArena: () => {
    set((s) => {
      if (!sectActivity.isArenaRunning(s.game)) return { notice: '需先建成比武台并开启大比' };
      if (s.game.arenaTimer > 0) {
        return { notice: `距下次大比还有 ${fmtDuration(s.game.arenaTimer)}` };
      }
      const result = sectActivity.runArena(s.game);
      return {
        ...nextGame(s.game, result.state),
        notice: `大比落幕，${result.participants} 名弟子各得心得，全宗修行加速一年`,
      };
    });
  },

  /* ------------------------------------------------------------ 秘境 */

  /** 合成 / 精炼（需求 4） */
  refine: (recipeId, times) => {
    set((s) => {
      const recipe = REFINE_RECIPE_MAP[recipeId];
      if (!recipe) return {};
      const next = engine.refine(s.game, recipeId, times);
      if (next === s.game) return { notice: '材料不足，或还没到能合成的境界' };
      const out = ITEM_MAP[recipe.output.item as ItemId];
      return {
        ...nextGame(s.game, next),
        notice: `合成完成：${out?.icon ?? ''}${out?.name ?? recipe.output.item} ×${recipe.output.amount * times}`,
      };
    });
  },

  /** 花资源开启资源富集区的秘境（需求 1） */
  openRealm: (realmId) => {
    set((s) => {
      const def = SECRET_REALM_MAP[realmId];
      if (!def) return {};
      const check = engine.canOpenRealm(s.game, def);
      if (!check.ok) return { notice: check.reason ?? '无法开启' };
      return {
        ...nextGame(s.game, engine.openRealm(s.game, def)),
        notice: `${def.name} 已开启`,
      };
    });
  },

  /** 设置某条配方的自动合成目标存量（本轮需求 2） */
  setAutoRefineTarget: (recipeId, target) => {
    set((s) => {
      const next = Math.max(0, Math.floor(target));
      const targets = { ...s.game.autoRefineTargets };
      if (next > 0) targets[recipeId] = next;
      else delete targets[recipeId];
      return { game: { ...s.game, autoRefineTargets: targets } };
    });
  },

  /* ---- 感悟（需求 3） ---- */

  enlighten: (pathId) => {
    set((s) => {
      const check = enlightenment.canEnlighten(s.game, pathId);
      if (!check.ok) return { notice: check.reason ?? '无法感悟' };
      return { ...nextGame(s.game, enlightenment.startEnlighten(s.game, pathId)), notice: '开始感悟' };
    });
  },

  cancelEnlighten: () => {
    set((s) => {
      const next = enlightenment.cancelEnlighten(s.game);
      return next === s.game ? {} : { ...nextGame(s.game, next), notice: '感悟已中断（投入的资源不退）' };
    });
  },

  craftSpaceRing: () => {
    set((s) => {
      const check = enlightenment.canCraftSpaceRing(s.game);
      if (!check.ok) return { notice: check.reason ?? '无法制作' };
      return { ...nextGame(s.game, enlightenment.craftSpaceRing(s.game)), notice: '空间戒指已成' };
    });
  },

  /**
   * 时空穿梭（需求 3）。
   *
   * 结算就是把一大段时间交给 `applyTick` —— 所以产出、钻研、灵植、
   * 弟子的修炼与寿元、秘境冷却全都会按"这些时间真的过了一遍"来算。
   */
  timeJump: () => {
    set((s) => {
      const check = enlightenment.canTimeJump(s.game);
      if (!check.ok) return { notice: check.reason ?? '还不能穿梭' };
      const years = enlightenment.getTimeJumpYears(s.game);
      const next = enlightenment.doTimeJump(s.game, (g, dt) => tick.applyTick(g, dt, gameRandom));
      return { ...nextGame(s.game, next), notice: `时空穿梭 ${years} 年` };
    });
  },

  chooseEncounter: (optionIndex) => {
    set((s) => {
      const result = encounter.chooseEncounterOption(s.game, optionIndex);
      if (!result.outcome) return { notice: '这个选择现在做不了' };
      const o = result.outcome;
      const loot = o.gains
        .map((g) => `${g.icon}${g.name}${g.amount > 0 ? '+' : ''}${g.amount}`)
        .join(' ');
      return {
        ...nextGame(s.game, result.state),
        notice: `${o.text}${loot ? `（${loot}）` : ''}`,
      };
    });
  },

  startSoloRealm: (realmId) => {
    set((s) => {
      const check = travel.canStartSoloRealm(s.game, realmId);
      if (!check.ok) return { notice: check.reason ?? '无法前往' };
      return {
        ...nextGame(s.game, travel.startSoloRealm(s.game, realmId)),
        notice: '掌门已独自前往秘境',
      };
    });
  },

  /** 掌门亲自做普通探索（需求 5） */
  startSoloSurvey: (regionId) => {
    set((s) => {
      const check = travel.canStartSoloSurvey(s.game, regionId);
      if (!check.ok) return { notice: check.reason ?? '无法前往' };
      return {
        ...nextGame(s.game, travel.startSoloSurvey(s.game, regionId)),
        notice: '掌门已亲自出发',
      };
    });
  },

  startExpedition: (realmId, ids, repeat = 1) => {
    set((s) => {
      const check = expeditions.canStartExpedition(s.game, realmId, ids);
      if (!check.ok) return { notice: check.reason ?? '无法派遣' };
      return {
        ...nextGame(s.game, expeditions.startExpedition(s.game, realmId, ids, gameRandom, repeat)),
        notice: '已派遣弟子前往探索',
      };
    });
  },

  /* 普通探索（需求 1）：还没发现秘境的小区域只能这么探 */
  startSurvey: (regionId, ids, repeat = 1) => {
    set((s) => {
      const check = expeditions.canStartSurvey(s.game, regionId, ids);
      if (!check.ok) return { notice: check.reason ?? '无法派遣' };
      return {
        ...nextGame(s.game, expeditions.startSurvey(s.game, regionId, ids, gameRandom, repeat)),
        notice: '已派遣弟子在附近做普通探索',
      };
    });
  },

  /* ------------------------------------------------------------ 丹器 */

  craftPill: (id, count) => {
    set((s) => {
      const check = crafting.canCraftPill(s.game, id);
      if (!check.ok) return { notice: check.reason ?? '无法炼制' };
      // 需求 2：炼制有概率失败，失败照样消耗材料
      const result = crafting.craftPill(s.game, id, count, gameRandom);
      if (result.made === 0 && result.failed === 0) return { notice: '材料不足' };
      const rate = Math.round(result.rate * 100);
      return {
        ...nextGame(s.game, result.state),
        notice:
          result.failed === 0
            ? `丹药炼成 ×${result.made}`
            : `炼成 ×${result.made}，炸炉 ×${result.failed}（成功率 ${rate}%）`,
      };
    });
  },

  craftArtifact: (id, count) => {
    set((s) => {
      const check = crafting.canCraftArtifact(s.game, id);
      if (!check.ok) return { notice: check.reason ?? '无法炼制' };
      const result = crafting.craftArtifact(s.game, id, count, gameRandom);
      if (result.made === 0 && result.failed === 0) return { notice: '材料不足' };
      const rate = Math.round(result.rate * 100);
      return {
        ...nextGame(s.game, result.state),
        notice:
          result.failed === 0
            ? `器物出炉 ×${result.made}`
            : `出炉 ×${result.made}，炼废 ×${result.failed}（成功率 ${rate}%）`,
      };
    });
  },

  upgradeAlchemy: () => {
    set((s) => {
      const status = crafting.getAlchemyUpgradeStatus(s.game);
      if (!status.possible) return { notice: status.reason ?? '无法提升' };
      const next = crafting.upgradeAlchemy(s.game);
      return { ...nextGame(s.game, next), notice: `炼丹术精进至 ${next.alchemyTier} 品` };
    });
  },

  upgradeRefining: () => {
    set((s) => {
      const status = crafting.getRefiningUpgradeStatus(s.game);
      if (!status.possible) return { notice: status.reason ?? '无法提升' };
      const next = crafting.upgradeRefining(s.game);
      return { ...nextGame(s.game, next), notice: `炼器术精进至 ${next.refiningTier} 品` };
    });
  },

  usePill: (id) => {
    set((s) => {
      const result = crafting.usePill(s.game, id);
      return { ...nextGame(s.game, result.state), notice: result.message };
    });
  },

  /* ------------------------------------------------------------ 存档 */

  dismissOffline: () => set({ offline: null }),

  setNotice: (message) => set({ notice: message }),

  saveNow: () => {
    const ok = saveToLocal(get().game);
    set({ lastSavedAt: Date.now(), notice: ok ? null : '存档失败（浏览器存储不可用）' });
  },

  exportSave: () => exportCode(get().game),

  importSave: (code) => {
    const loaded = importCode(code);
    if (!loaded) {
      set({ notice: '存档码无法识别，请检查是否复制完整' });
      return false;
    }
    const now = Date.now();
    const { state, report } = applyOffline(loaded, now);
    saveToLocal(state);
    set({ game: state, offline: report, notice: '存档导入成功', lastSavedAt: now });
    return true;
  },
}));

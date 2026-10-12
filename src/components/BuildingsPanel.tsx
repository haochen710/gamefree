/**
 * 建造清单：所有可建造物集中在一个模块里，按用途分组。
 *
 * 本轮需求 7 起，它归在**独立的「建筑」页**（原先挂在「洞府」页里）——
 * 于是"洞府"只剩存档，而"建造"有了自己的入口。
 *
 * 可见性规则（这里曾经有过一个 bug）：
 *   只要**曾经**达成过解锁条件，或者已经建过，就永远显示。
 *   早期版本用「当前资源是否达标」来判断，导致玩家一花掉灵气，
 *   已经建了好几座的灵木林就从面板上消失了。
 *
 * 需求 6 之后，建筑卡上还会显示「需钻研某某技术」「需某某图纸」，
 * 技术与图纸门槛**不隐藏**建筑 —— 玩家得先看见目标，才知道该钻研什么。
 */
import { fmt } from '../game/decimal';
import {
  BLUEPRINT_MAP,
  BUILDABLES,
  BUILDABLE_MAP,
  BUILD_GROUPS,
  REALMS,
  RESOURCE_MAP,
  TECH_MAP,
  type BuildableDef,
  type BuildGroupId,
  type ResourceId,
  type StructureDef,
} from '../game/content';
import {
  canAfford,
  getBuildGate,
  getBuildingCount,
  getCost,
  getGeneratorOutput,
  getMaxCount,
  getUnlockProgress,
  isUnlocked,
  maxAffordable,
} from '../game/engine';
import { getQueueSlots } from '../game/engine';
// 需求 6：唯一工坊的升级就是炼丹 / 炼器品阶，复用同一套判定
import { getAlchemyUpgradeStatus, getRefiningUpgradeStatus } from '../game/crafting';
import { useGame } from '../game/store';
import type { GameState } from '../game/state';
import CostList from './CostList';
import Panel from './Panel';
import { FoldSection } from './fold';

/** 建筑效果的一行短说明（只用于不产出资源的建筑） */
function describeEffect(def: StructureDef): string {
  const parts: string[] = [];
  // 需求 2：仆役居所与弟子居所分开列，免得玩家以为两边通用
  if (def.servantCapacity) parts.push(`仆役居所 +${def.servantCapacity}`);
  if (def.discipleCapacity) parts.push(`弟子居所 +${def.discipleCapacity}`);
  if (def.plots) parts.push(`灵植地块 +${def.plots}`);
  if (def.alchemySlots) parts.push(`炼丹位 +${def.alchemySlots}`);
  if (def.refiningSlots) parts.push(`炼器位 +${def.refiningSlots}`);
  if (def.shopSlots) parts.push(`商行货位 +${def.shopSlots}`);
  if (def.cultivationBonus) parts.push(`弟子修炼 +${Math.round(def.cultivationBonus * 100)}%`);
  if (def.disciplePowerBonus) parts.push(`弟子战力 +${Math.round(def.disciplePowerBonus * 100)}%`);
  if (def.expeditionSpeedBonus) parts.push(`探索速度 +${Math.round(def.expeditionSpeedBonus * 100)}%`);
  if (def.expeditionDistanceBonus) parts.push(`探索距离 +${Math.round(def.expeditionDistanceBonus * 100)}%`);
  if (def.expeditionYieldBonus) parts.push(`秘境产出 +${Math.round(def.expeditionYieldBonus * 100)}%`);
  if (def.casualtyReduction) parts.push(`伤亡率 -${Math.round(def.casualtyReduction * 100)}%`);
  // 建筑一律不给"发现秘境"加成 —— 那只有寻宝宝盘能给（见 BALANCE 第六节）
  if (def.insightBonus) parts.push(`弟子心得 +${Math.round(def.insightBonus * 100)}%`);
  if (def.breakthroughBonus) parts.push(`突破成功率 +${Math.round(def.breakthroughBonus * 100)}%`);
  if (def.productionBonus) parts.push(`全局产量 +${Math.round(def.productionBonus * 100)}%`);
  if (def.arena) parts.push('解锁宗门大比');
  if (def.storage) {
    const storage = (Object.entries(def.storage) as [ResourceId, number][])
      .map(([id, amount]) => `${RESOURCE_MAP[id].icon}+${fmt(amount)}`)
      .join(' ');
    parts.push(`储存上限 ${storage}`);
  }
  return parts.join(' · ') || '—';
}

/**
 * 门槛标签。
 *
 * `getBuildGate` 只返回第一个未满足的条件（决定按钮能不能点），
 * 但玩家想知道"到底要满足几件事"，所以这里把所有硬性门槛都列出来。
 */
function GateTags({ def, state }: { def: BuildableDef; state: GameState }) {
  const tags: { text: string; done: boolean }[] = [];

  if (def.requiresSect) {
    tags.push({ text: '已开宗立派', done: state.sect.founded });
  }
  if (def.requiresTech) {
    tags.push({
      text: `技术：${TECH_MAP[def.requiresTech]?.name ?? def.requiresTech}`,
      done: state.techs[def.requiresTech] === true,
    });
  }
  if (def.requiresBlueprint) {
    tags.push({
      text: `图纸：${BLUEPRINT_MAP[def.requiresBlueprint]?.name ?? def.requiresBlueprint}`,
      done: state.blueprints[def.requiresBlueprint] === true,
    });
  }
  if (def.requiresBuilding) {
    const need = BUILDABLE_MAP[def.requiresBuilding];
    tags.push({
      text: `前置：${need?.name ?? def.requiresBuilding}`,
      done: getBuildingCount(state, def.requiresBuilding) > 0,
    });
  }
  if (def.requiresRealm !== undefined && def.requiresRealm > 0) {
    tags.push({
      text: `需 ${REALMS[def.requiresRealm].name}`,
      done: state.realmIndex >= def.requiresRealm,
    });
  }
  if (def.requiresSectLevel) {
    tags.push({ text: `${def.requiresSectLevel}品宗门`, done: state.sect.level >= def.requiresSectLevel });
  }

  if (tags.length === 0) return null;

  return (
    <div className="gate-tags">
      {tags.map((tag) => (
        <span key={tag.text} className={tag.done ? 'gate-tag gate-tag--done' : 'gate-tag'}>
          {tag.done ? '✓ ' : ''}
          {tag.text}
        </span>
      ))}
    </div>
  );
}

function BuildRow({ def, state }: { def: BuildableDef; state: GameState }) {
  const buy = useGame((s) => s.buy);
  const enqueueBuild = useGame((s) => s.enqueueBuild);
  const queue = useGame((s) => s.game.buildQueue);
  const queueSlots = useGame((s) => getQueueSlots(s.game));

  const owned = getBuildingCount(state, def.id);
  const maxCount = getMaxCount(def);
  const atMax = owned >= maxCount;
  const cost1 = getCost(def, owned, 1);
  const cost10 = getCost(def, owned, 10);
  // 技术 / 图纸 / 境界 / 宗门四道门槛任一未过，按钮都必须禁用
  const gate = getBuildGate(def, state);
  const blocked = gate !== null || atMax;
  const canBuy1 = !blocked && canAfford(state, cost1);
  const canBuy10 = !blocked && canAfford(state, cost10);
  const maxN = blocked ? 0 : maxAffordable(def, owned, state);

  const output = def.kind === 'generator' ? getGeneratorOutput(state, def) : null;
  const target = def.kind === 'generator' ? RESOURCE_MAP[def.produces] : null;

  /*
   * 需求 4：「唯一类建筑已完成建造后不应当还有建造和排队按钮」。
   *
   * 所以唯一建筑（max === 1）建好之后整块按钮区都不渲染，
   * 而不是把按钮灰掉 —— 灰按钮会让人以为是"资源不够，再攒攒就能建第二座"。
   */
  const isUnique = maxCount === 1;
  const builtUnique = isUnique && owned >= 1;
  // 需求 6：丹房 / 炼器房唯一，它们的"升级"就是炼丹 / 炼器品阶
  const tierUpgrade = def.id === 'alchemyRoom' ? 'alchemy' : def.id === 'refinery' ? 'refining' : null;

  return (
    <article className={canBuy1 || builtUnique ? 'generator' : 'generator generator--locked'}>
      <div className="generator__main">
        <span className="generator__icon">{def.icon}</span>
        <div className="generator__text">
          <div className="generator__title">
            <span className="generator__name">{def.name}</span>
            <span className="generator__count">
              ×{owned}
              {Number.isFinite(maxCount) && <em className="generator__max">/ {maxCount}</em>}
            </span>
            {gate && <span className="generator__gate">{gate}</span>}
            {atMax && !isUnique && <span className="generator__gate generator__gate--done">已建满</span>}
            {builtUnique && <span className="generator__gate generator__gate--done">已建成 · 唯一</span>}
          </div>
          <div className="generator__output">
            {def.kind === 'generator' && target
              ? `产出 ${target.icon} ${fmt(output ?? 0)}/秒`
              : def.kind === 'structure'
                ? describeEffect(def)
                : '—'}
          </div>
          <div className="generator__desc">{def.desc}</div>
          <GateTags def={def} state={state} />

          {/* 需求 6：唯一工坊的"升级"就在这里，不需要再跑一趟丹器页 */}
          {tierUpgrade && builtUnique && <TierUpgradeRow kind={tierUpgrade} state={state} />}
        </div>
      </div>

      {!builtUnique && (
        <div className="generator__buy">
          <div className="generator__price">
            <CostList cost={cost1} state={state} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn" disabled={!canBuy1} onClick={() => buy(def.id, 1)}>
              建造 1
            </button>
            {!isUnique && (
              <button type="button" className="btn" disabled={!canBuy10} onClick={() => buy(def.id, 10)}>
                建造 10
              </button>
            )}
            {!isUnique && (
              <button type="button" className="btn" disabled={maxN <= 0} onClick={() => buy(def.id, 'max')}>
                最大 {maxN > 0 ? `(${fmt(maxN, 0)})` : ''}
              </button>
            )}
            {/* 需求 2：也可以排进建造队列，资源一到就自动盖 */}
            <button
              type="button"
              className="btn"
              disabled={gate !== null || queue.length >= queueSlots}
              onClick={() => enqueueBuild(def.id)}
              title="加入建造队列后，资源够了会自动开工"
            >
              排队
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * 唯一工坊的升级行（需求 6）
 *
 * 需求原文：「丹房和炼器房可以升级……这俩升级需要钻研对应等级的技术」。
 *
 * 品阶既在丹器页能升，也在这里能升 —— 同一件事、同一个引擎函数，
 * 只是让玩家在"看着这座建筑"的时候也能直接推进，不必来回切页。
 */
function TierUpgradeRow({ kind, state }: { kind: 'alchemy' | 'refining'; state: GameState }) {
  const upgradeAlchemy = useGame((s) => s.upgradeAlchemy);
  const upgradeRefining = useGame((s) => s.upgradeRefining);

  const status = kind === 'alchemy' ? getAlchemyUpgradeStatus(state) : getRefiningUpgradeStatus(state);
  const currentTier = kind === 'alchemy' ? state.alchemyTier : state.refiningTier;
  const label = kind === 'alchemy' ? '炼丹术' : '炼器术';

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>
          {label} <strong>{currentTier} 品</strong>
          {status.nextTier !== null && ` → ${status.nextTier} 品`}
        </span>
        {status.nextTier === null ? (
          <span className="panel__hint">已至九品</span>
        ) : (
          <button
            type="button"
            className="btn btn--tiny"
            disabled={!status.possible}
            onClick={() => (kind === 'alchemy' ? upgradeAlchemy() : upgradeRefining())}
          >
            晋升 {status.nextTier} 品
            {!status.possible && status.reason && <span className="btn__sub">{status.reason}</span>}
          </button>
        )}
      </div>
      {status.nextTier !== null && (
        <div className="tier-upgrade__cost">
          需 <CostList cost={status.cost} state={state} />
        </div>
      )}
    </div>
  );
}

/** 未解锁建筑的提示：告诉玩家还差什么，而不是一片空白 */
function LockedHint({ state }: { state: GameState }) {
  const locked = BUILDABLES.filter((def) => !isUnlocked(def, state));
  if (locked.length === 0) return null;

  // 挑最接近解锁的那一个显示进度
  const nearest = locked
    .map((def) => ({ def, progress: getUnlockProgress(def, state) }))
    .find((item) => item.progress !== null);

  return (
    <p className="panel__note panel__note--locked">
      还有 <strong>{locked.length}</strong> 处建筑尚未解锁
      {nearest?.progress && (
        <>
          ，最近的一处需要{' '}
          <strong>
            {RESOURCE_MAP[nearest.progress.id as keyof typeof RESOURCE_MAP]?.name ?? nearest.progress.id}{' '}
            {fmt(nearest.progress.need, 0)}
          </strong>
          （已有 {fmt(nearest.progress.have, 0)}）
        </>
      )}
      。
    </p>
  );
}

export function BuildingsPanel({ collapsible = false }: { collapsible?: boolean } = {}) {
  const game = useGame((s) => s.game);

  const visibleByGroup = BUILD_GROUPS.map((group) => ({
    group,
    defs: BUILDABLES.filter((def) => def.group === (group.id as BuildGroupId) && isUnlocked(def, game)),
  })).filter((entry) => entry.defs.length > 0);

  return (
    <Panel
      title="营造"
      hint="设施 · 仆役居所 · 弟子居所 · 工坊"
      collapsible={collapsible}
      storageKey="buildings"
    >
      {visibleByGroup.length === 0 && <p className="panel__note">暂无可建造的项目。</p>}

      {visibleByGroup.map(({ group, defs }) => (
        // 需求 2：各类建筑分组也可以折叠（设施 / 仆役居所 / 弟子居所 / 工坊十几组）
        <FoldSection
          key={group.id}
          title={`${group.title}`}
          hint={group.hint}
          count={defs.length}
          storageKey={`build.${group.id}`}
          className="build-group"
        >
          <div className="generator-list">
            {defs.map((def) => (
              <BuildRow key={def.id} def={def} state={game} />
            ))}
          </div>
        </FoldSection>
      ))}

      <LockedHint state={game} />
    </Panel>
  );
}

export default BuildingsPanel;

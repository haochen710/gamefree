/**
 * 弟子装备的炼制列表（需求 15）
 *
 * 抽成独立组件是因为它要在**两个地方**出现：
 *   - 「炼器」页（玩家在这里炼东西，装备本来就该在这儿能炼）；
 *   - 「丹器阁」面板（宗门页右栏，看谁穿着什么）。
 *
 * ⚠️ 原先只有后者有这份列表，于是玩家在炼器页怎么也找不到刚解锁的
 * 弟子装备 —— 需求 15 报的就是这个。
 */
import { useState } from 'react';
import {
  GEARS,
  itemIcon,
  itemName,
  GEAR_GRADE_NAMES,
  GEAR_SLOT_NAMES,
  REALMS,
  type GearDef,
} from '../game/content';
import {
  canEquipGear,
  canForgeGear,
  countDiscipleGear,
  eligibleForGear,
  findGearWearers,
  getGearCount,
} from '../game/gear';
import { getCraftSuccessRate } from '../game/crafting';
import { toCostMap } from '../game/engine';
import { useGame } from '../game/store';
import CostList from './CostList';

/** 境界名统一从 content 的 REALMS 取（不再自抄一张只有 5 项的小表） */
const realmName = (index: number): string => REALMS[Math.min(index, REALMS.length - 1)]?.name ?? '';

function GearRow({ def }: { def: GearDef }) {
  const game = useGame((s) => s.game);
  const forgeNow = useGame((s) => s.forgeGear);
  const equipNow = useGame((s) => s.equipGear);
  const unequipEverywhere = useGame((s) => s.unequipGearEverywhere);
  const [picking, setPicking] = useState(false);

  const owned = getGearCount(game, def.id);
  const rate = getCraftSuccessRate(game, 'refining', def.grade);
  const forgeCheck = canForgeGear(game, def.id);
  const wearers = findGearWearers(game, def.id);
  const targets = picking ? eligibleForGear(game, def.id).slice(0, 60) : [];
  const noGearTargets = targets.filter((d) => !wearers.some((w) => w.disciple.id === d.id));
  const alreadyTargets = targets.filter((d) => wearers.some((w) => w.disciple.id === d.id));

  return (
    <article className={def.grade >= 4 ? 'recipe recipe--rare' : 'recipe'}>
      <div className="recipe__head">
        <span className="recipe__icon">{def.icon}</span>
        <span className="recipe__name">{def.name}</span>
        <span className={`tier-badge tier-badge--${def.grade >= 4 ? 7 : def.grade === 3 ? 5 : 1}`}>
          {GEAR_GRADE_NAMES[def.grade]}
        </span>
        <span className="cat-badge">{GEAR_SLOT_NAMES[def.kind === 'pill' ? 'pill1' : def.kind]}</span>
        {owned > 0 && <span className="recipe__owned">库存 {owned}</span>}
        {wearers.length > 0 && <span className="recipe__owned">在装 {wearers.length}</span>}
      </div>

      <div className="recipe__desc">{def.desc}</div>
      <div className="recipe__desc">需 {realmName(def.minRealm)}以上</div>
      {/* 需求 11：成本里的材料名要用中文（原来直接印 id，玩家看到的是 blackIron×30） */}
      <div className="recipe__desc">
        成本：
        {Object.entries(def.cost)
.map(([id, amount]) => `${itemIcon(id)}${itemName(id)}×${amount}`)
          .join(' ')}
      </div>

      {/* 需求 1：已装备的弟子单独列出来 */}
      {wearers.length > 0 && (
        <div className="recipe__desc">
          <strong>已装备</strong>：
          {wearers
            .slice(0, 8)
            .map((w) => `${w.disciple.name}（${GEAR_SLOT_NAMES[w.slot]}）`)
            .join('、')}
          {wearers.length > 8 ? ` 等 ${wearers.length} 人` : ''}
        </div>
      )}

      <div className={rate < 1 ? 'recipe__rate recipe__rate--risk' : 'recipe__rate'}>
        成功率 {Math.round(rate * 100)}%（失败照样消耗材料）
      </div>

      <div className="recipe__foot">
        <div className="recipe__cost">
          {/*
            ⚠️ content 里的成本表写的是**普通数字**，而 CostList 收的是 Decimal 表
            （它要调 amount.gt 判够不够）。漏了 toCostMap 就会直接抛
            "amount.gt is not a function" —— 这也是本轮那 4 条冒烟红的真因。
          */}
          <CostList cost={toCostMap(def.cost)} state={game} />
        </div>
        <div className="btn-row">
          <button type="button" className="btn" disabled={!forgeCheck.ok} title={forgeCheck.reason ?? ''} onClick={() => forgeNow(def.id)}>
            炼制
          </button>
          {/* 收起永远要放行：库存发完后 owned 归零，否则列表收不起来（需求 1） */}
          <button
            type="button"
            className="btn btn--tiny"
            disabled={owned <= 0 && !picking}
            onClick={() => setPicking((v) => !v)}
          >
            {picking ? '收起名单' : `发给弟子（${owned}）`}
          </button>
          <button
            type="button"
            className="btn btn--tiny"
            disabled={wearers.length === 0}
            title="把这件装备从所有弟子身上卸下（回到仓库，不损耗）"
            onClick={() => unequipEverywhere(def.id)}
          >
            一键卸载（{wearers.length}）
          </button>
        </div>
      </div>

      {picking && (
        <div className="picker">
          {targets.length === 0 && <p className="panel__note">没有够境界的弟子。</p>}
          {noGearTargets.length > 0 && <p className="panel__note">未装备的弟子（{noGearTargets.length} 人）：</p>}
          {noGearTargets.map((d) => {
            const kind = def.kind === 'pill' ? (d.gear.pill1 ? 'pill2' : 'pill1') : def.kind;
            const check = canEquipGear(game, d.id, def.id, kind);
            return (
              <button
                key={d.id}
                type="button"
                className="picker__item"
                disabled={!check.ok}
                title={check.reason ?? ''}
                onClick={() => equipNow(d.id, def.id, kind)}
              >
                <span className="picker__name">{d.name}</span>
                <span className="picker__realm">{realmName(d.realmIndex)}</span>
                <span className="picker__power">已着装 {countDiscipleGear(d)}/5</span>
              </button>
            );
          })}
          {alreadyTargets.length > 0 && <p className="panel__note">已装备的弟子（{alreadyTargets.length} 人）：</p>}
          {alreadyTargets.map((d) => {
            const kind = def.kind === 'pill' ? (d.gear.pill1 ? 'pill2' : 'pill1') : def.kind;
            const check = canEquipGear(game, d.id, def.id, kind);
            return (
              <button
                key={d.id}
                type="button"
                className="picker__item picker__item--on"
                disabled={!check.ok}
                title={check.reason ?? ''}
                onClick={() => equipNow(d.id, def.id, kind)}
              >
                <span className="picker__name">{d.name}</span>
                <span className="picker__realm">{realmName(d.realmIndex)}</span>
                <span className="picker__power">已着装 {countDiscipleGear(d)}/5</span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

/** 炼器页里那一段「弟子装备」 */
export function GearForgeSection() {
  const game = useGame((s) => s.game);
  const totalOwned = GEARS.reduce((sum, def) => sum + getGearCount(game, def.id), 0);

  return (
    <>
      <h3 className="panel__subtitle">弟子装备（五栏）</h3>
      <p className="panel__note">
        每名弟子五个栏位：<strong>增益 / 进攻 / 防御 / 丹药 ×2</strong>。
        增益栏加修行、进攻栏加战力、防御栏降伤亡，丹药栏是出战时自动服下的一次性护命。
        装备可以在弟子之间随意拆卸，不损耗；库存 <strong>{totalOwned}</strong> 件。
      </p>
      {GEARS.map((def) => (
        <GearRow key={def.id} def={def} />
      ))}
    </>
  );
}

export default GearForgeSection;

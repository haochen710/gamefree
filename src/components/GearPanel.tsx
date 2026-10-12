/**
 * 丹器阁：丹炉九件 + 弟子五装备栏（设定集第 8.7 / 11 章）
 *
 * 两块内容放在一起，是因为它们共用一条产线：**炼器**。
 * 上半是"用什么炼"（换更好的炉鼎），下半是"炼什么、给谁穿"。
 *
 * ⚠️ 界面上的一个刻意取舍：装备**不在弟子行里挂五个下拉框**，
 * 而是做成"选装备 → 选人"（与功法一致）。千人宗门里逐行挂下拉框
 * 既卡又难找，而玩家的真实问题永远是"我这件好东西该给谁"。
 */
import { useState } from 'react';
import {
  FURNACES,
  GEARS,
  GEAR_GRADE_NAMES,
  GEAR_SLOT_NAMES,
  type GearDef,
} from '../game/content';
import {
  canEquipGear,
  canForgeFurnace,
  canForgeGear,
  countDiscipleGear,
  describeDiscipleGear,
  eligibleForGear,
  getFurnace,
  getGearCount,
  getOwnedFurnaces,
} from '../game/gear';
import { describeCraftRate, getCraftSuccessRate } from '../game/crafting';
import { useGame } from '../game/store';
import Panel from './Panel';
import { FoldSection } from './fold';

const REALM_NAMES = ['炼气', '筑基', '金丹', '元婴', '化神'];

/* ------------------------------------------------------------------ */
/* 丹炉九件                                                            */
/* ------------------------------------------------------------------ */

function FurnaceSection() {
  const game = useGame((s) => s.game);
  const forge = useGame((s) => s.forgeFurnace);
  const equip = useGame((s) => s.equipFurnace);
  const current = getFurnace(game);
  const owned = getOwnedFurnaces(game);

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>
          当前炉鼎：{current.icon} {current.name}（炼丹 +{Math.round(current.alchemyBonus * 100)}% · 炼器 +
          {Math.round(current.refiningBonus * 100)}% · 出丹双份 +{Math.round(current.batchBonus * 100)}% · 自动合成 +
          {Math.round(current.refineSpeedBonus * 100)}%）
        </span>
      </div>
      <p className="panel__note">
        九件炉鼎各有各的好处：<strong>成功率</strong>决定成不成，<strong>批量</strong>决定一炉出几件，
        <strong>自动合成</strong>决定合成材料有多快。同时只能用**一口**，所以"换更好的"是线性进阶。
      </p>
      <div className="btn-row btn-row--wrap">
        {FURNACES.map((def) => {
          const has = owned.includes(def.id);
          const check = canForgeFurnace(game, def.id);
          const isCurrent = game.furnaceId === def.id;
          return (
            <button
              key={def.id}
              type="button"
              className={isCurrent ? 'btn btn--primary' : 'btn btn--tiny'}
              disabled={isCurrent || (!has && !check.ok)}
              title={
                isCurrent
                  ? '正在使用'
                  : has
                    ? `换用 ${def.name}`
                    : check.ok
                      ? `${def.desc}（点击铸造）`
                      : (check.reason ?? '')
              }
              onClick={() => (has ? equip(def.id) : forge(def.id))}
            >
              {def.icon}
              {def.grade}品 {def.name}
              {has ? '' : check.ok ? '（可铸）' : ''}
            </button>
          );
        })}
      </div>
      <p className="panel__note">
        当前炼丹成功率会随品阶与被炼之物变化：{describeCraftRate(game, 'alchemy', Math.min(9, game.alchemyTier))}。
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 装备炼制                                                            */
/* ------------------------------------------------------------------ */

function GearRow({ def }: { def: GearDef }) {
  const game = useGame((s) => s.game);
  const forgeNow = useGame((s) => s.forgeGear);
  const equipNow = useGame((s) => s.equipGear);
  const autoEquip = useGame((s) => s.autoEquipGears);
  const [picking, setPicking] = useState(false);

  const owned = getGearCount(game, def.id);
  const rate = getCraftSuccessRate(game, 'refining', def.grade);
  const forgeCheck = canForgeGear(game, def.id);
  const wearers = game.sect.disciples.filter((d) =>
    ['gain', 'attack', 'defense', 'pill1', 'pill2'].some((slot) => d.gear[slot as 'gain'] === def.id),
  );
  const targets = picking ? eligibleForGear(game, def.id).slice(0, 40) : [];

  return (
    <article className={def.grade >= 4 ? 'recipe recipe--rare' : 'recipe'}>
      <div className="recipe__head">
        <span className="recipe__icon">{def.icon}</span>
        <span className="recipe__name">{def.name}</span>
        <span className={`tier-badge tier-badge--${def.grade >= 4 ? 7 : def.grade === 3 ? 5 : 1}`}>
          {GEAR_GRADE_NAMES[def.grade]}
        </span>
        <span className="cat-badge">{GEAR_SLOT_NAMES[def.kind === 'pill' ? 'pill1' : def.kind]}</span>
        {owned > 0 && <span className="recipe__owned">藏 {owned}</span>}
      </div>
      <div className="recipe__desc">{def.desc}</div>
      <div className="recipe__desc">
        需 {REALM_NAMES[def.minRealm]}期以上 · 成本：
        {Object.entries(def.cost)
          .map(([id, amount]) => `${id}×${amount}`)
          .join(' ')}
      </div>
      {wearers.length > 0 && (
        <div className="recipe__desc">
          在装：{wearers.slice(0, 6).map((d) => d.name).join('、')}
          {wearers.length > 6 ? ` 等 ${wearers.length} 人` : ''}
        </div>
      )}
      <div className="recipe__foot">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--tiny"
            disabled={!forgeCheck.ok}
            title={forgeCheck.reason ?? `成功率 ${Math.round(rate * 100)}%（失败照样消耗材料）`}
            onClick={() => forgeNow(def.id)}
          >
            炼制（{Math.round(rate * 100)}%）
          </button>
          <button type="button" className="btn btn--tiny" disabled={owned <= 0} onClick={() => setPicking((v) => !v)}>
            {picking ? '收起名单' : `给弟子（${owned}）`}
          </button>
          <button type="button" className="btn btn--tiny" disabled={owned <= 0} onClick={autoEquip} title="按境界从高到低发给最合适的人">
            一键申领
          </button>
        </div>
      </div>
      {picking && (
        <div className="picker">
          {targets.length === 0 && <p className="panel__note">没有够境界的弟子。</p>}
          {targets.map((d) => {
            const kind = def.kind === 'pill' ? (d.gear.pill1 ? 'pill2' : 'pill1') : def.kind;
            const check = canEquipGear(game, d.id, def.id, kind);
            return (
              <button
                key={d.id}
                type="button"
                className="picker__item"
                disabled={!check.ok}
                title={check.reason ?? ''}
                onClick={() => {
                  equipNow(d.id, def.id, kind);
                  setPicking(false);
                }}
              >
                <span className="picker__name">{d.name}</span>
                <span className="picker__realm">{REALM_NAMES[d.realmIndex] ?? ''}期</span>
                <span className="picker__power">已着装 {countDiscipleGear(d)}/5</span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 面板                                                                */
/* ------------------------------------------------------------------ */

export function GearPanel({ collapsible }: { collapsible?: boolean }) {
  const game = useGame((s) => s.game);
  const unequipNow = useGame((s) => s.unequipGear);

  const equipped = game.sect.disciples
    .filter((d) => countDiscipleGear(d) > 0)
    .sort((a, b) => b.realmIndex - a.realmIndex)
    .slice(0, 12);
  const totalOwned = GEARS.reduce((sum, def) => sum + getGearCount(game, def.id), 0);

  return (
    <Panel
      title="丹器阁"
      hint={`炉鼎 ${getOwnedFurnaces(game).length}/9 · 装备库存 ${totalOwned} 件`}
      collapsible={collapsible}
      storageKey="gear"
    >
      <FurnaceSection />

      <h3 className="panel__subtitle">弟子装备（五栏）</h3>
      <p className="panel__note">
        每名弟子五个栏位：<strong>增益 / 进攻 / 防御 / 丹药 ×2</strong>。
        增益栏加修行、进攻栏加战力、防御栏降伤亡，丹药栏是出战时自动服下的一次性护命
        （<strong>用掉就没了</strong>，回来要重新发）。装备可以在弟子之间随意拆卸，不损耗。
      </p>

      {equipped.length > 0 && (
        <div className="inv-list">
          <p className="panel__note">当前装配（按境界前 12 名）：</p>
          {equipped.map((d) => (
            <div key={d.id} className="inv-row">
              <span className="inv-row__name">{d.name}</span>
              <span className="inv-row__count">{REALM_NAMES[d.realmIndex] ?? ''}期</span>
              <span className="inv-row__effect">{describeDiscipleGear(d)}</span>
              <button
                type="button"
                className="btn btn--tiny"
                onClick={() => {
                  const slot = (['gain', 'attack', 'defense', 'pill1', 'pill2'] as const).find((s) => d.gear[s]);
                  if (slot) unequipNow(d.id, slot);
                }}
              >
                卸下
              </button>
            </div>
          ))}
        </div>
      )}

      {[3, 2, 1].map((band) => {
        const list = GEARS.filter((g) => (band === 3 ? g.grade >= 4 : band === 2 ? g.grade === 3 : g.grade <= 2));
        if (list.length === 0) return null;
        return (
          <FoldSection
            key={band}
            title={band === 3 ? '高阶装备（极品 / 天纵）' : band === 2 ? '上品装备' : '凡品 / 良品装备'}
            count={list.length}
            storageKey={`gear.band.${band}`}
            defaultOpen={band === 1}
          >
            {list.map((def) => (
              <GearRow key={def.id} def={def} />
            ))}
          </FoldSection>
        );
      })}

      <p className="panel__note">
        小提示：丹药栏里的东西是**消耗品**，一趟秘境回来就空了 —— 常备几件是划算的。
      </p>
    </Panel>
  );
}

export default GearPanel;

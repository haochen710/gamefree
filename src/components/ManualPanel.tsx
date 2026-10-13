/**
 * 藏经阁（设定集第 7 章：功法系统）
 *
 * 三件事在这里收口：
 *   1. **参悟** —— 用宗门灵气换凡品~极品的碎片（天纵只能靠九档秘境）；
 *   2. **合成** —— 5 份同功法碎片合成一本完整功法，藏经阁越多成功率越高；
 *   3. **发放** —— 把仓库里的功法装给弟子（也支持"一键发书"）。
 *
 * 界面上的一个刻意取舍：**「发书」做成"选功法 → 选人"**，而不是
 * "在弟子行里挂两个下拉框"。理由是千人宗门里逐行挂下拉框既卡又难找，
 * 而玩家的真实问题永远是"我这本好书该给谁" —— 那就从书出发。
 */
import { useState } from 'react';
import { fmt } from '../game/decimal';
import {
  CONTEMPLATE_QI_COST,
  FRAGMENTS_PER_MANUAL,
  MANUAL_GRADE_NAMES,
  MANUAL_GRADE_MIN_REALM,
  REALMS,
  type ManualDef,
  type ManualGrade,
} from '../game/content';
import {
  canContemplate,
  canEquipManual,
  describeSynth,
  getEligibleDisciples,
  getEquippedManuals,
  getAllManuals,
  getSynthRate,
} from '../game/manuals';
import { getBuildingCount } from '../game/engine';
import { useGame } from '../game/store';
import Panel from './Panel';
import { FoldSection } from './fold';

/*
 * 境界名一律从 content 的 REALMS 里取。
 * 原本这里自抄了一张只有 5 项的小表（与 GearPanel 同一份错），
 * 合体期以上的弟子会渲染成空白 —— 需求 1 的「境界显示不全」。
 */
const realmName = (index: number): string => REALMS[Math.min(index, REALMS.length - 1)]?.name ?? '';

/** 单个功法条目：碎片数、合成按钮、发放入口 */
function ManualRow({ def }: { def: ManualDef }) {
  const game = useGame((s) => s.game);
  const synthManual = useGame((s) => s.synthManual);
  const equipManual = useGame((s) => s.equipManual);
  const [picking, setPicking] = useState(false);

  const fragments = game.manualFragments[`frag:${def.id}`] ?? 0;
  const owned = game.manuals[def.id] ?? 0;
  const enough = fragments >= FRAGMENTS_PER_MANUAL;
  const rate = getSynthRate(game);

  const equippedBy = game.sect.disciples.filter(
    (d) => d.cultivationManual === def.id || d.combatManual === def.id,
  );
  const eligible = picking ? getEligibleDisciples(game, def.id) : [];
  const slot = def.kind === 'cultivation' ? ('cultivationManual' as const) : ('combatManual' as const);
  // 已经装了这个槽位的弟子不能再装（要换就得先卸下）
  const freeTargets = eligible.filter((d) => !d[slot]).slice(0, 40);

  return (
    <article className={def.grade >= 4 ? 'recipe recipe--rare' : 'recipe'}>
      <div className="recipe__head">
        <span className="recipe__icon">{def.icon}</span>
        <span className="recipe__name">{def.name}</span>
        <span className={`tier-badge tier-badge--${def.grade >= 4 ? 7 : def.grade === 3 ? 5 : 1}`}>
          {MANUAL_GRADE_NAMES[def.grade]}
        </span>
        <span className="cat-badge">{def.kind === 'cultivation' ? '增益' : '进攻'}</span>
        {owned > 0 && <span className="recipe__owned">藏 {owned}</span>}
        {fragments > 0 && <span className="recipe__owned">碎片 {fragments}/{FRAGMENTS_PER_MANUAL}</span>}
      </div>

      <div className="recipe__desc">{def.desc}</div>
      <div className="recipe__desc">
        来源：{def.source} · 需 {realmName(MANUAL_GRADE_MIN_REALM[def.grade])}以上方可修习
      </div>

      {equippedBy.length > 0 && (
        <div className="recipe__desc">
          已装备：{equippedBy.slice(0, 6).map((d) => d.name).join('、')}
          {equippedBy.length > 6 ? ` 等 ${equippedBy.length} 人` : ''}
        </div>
      )}

      <div className="recipe__foot">
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--tiny"
            disabled={!enough}
            title={enough ? describeSynth(game) : `还需 ${FRAGMENTS_PER_MANUAL - fragments} 份碎片`}
            onClick={() => synthManual(def.id)}
          >
            合成（{Math.round(rate * 100)}%）
          </button>
          <button
            type="button"
            className="btn btn--tiny"
            disabled={owned <= 0}
            onClick={() => setPicking((v) => !v)}
          >
            {picking ? '收起名单' : `发给弟子（${owned}）`}
          </button>
        </div>
      </div>

      {picking && (
        <div className="picker">
          {freeTargets.length === 0 && (
            <p className="panel__note">没有可装备的弟子（境界不够，或该槽位都已占用）。</p>
          )}
          {freeTargets.map((d) => {
            const check = canEquipManual(game, d.id, def.id);
            return (
              <button
                key={d.id}
                type="button"
                className="picker__item"
                disabled={!check.ok}
                title={check.reason ?? ''}
                onClick={() => {
                  equipManual(d.id, def.id);
                  setPicking(false);
                }}
              >
                <span className="picker__name">{d.name}</span>
                <span className="picker__realm">{realmName(d.realmIndex)}</span>
                <span className="picker__power">
                  忠诚 {Math.round(d.loyalty)} · 心魔 {Math.round(d.demon)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function ManualPanel({ collapsible }: { collapsible?: boolean }) {
  const game = useGame((s) => s.game);
  const contemplateManual = useGame((s) => s.contemplateManual);
  const contemplateBatch = useGame((s) => s.contemplateManualBatch);
  const unequipManual = useGame((s) => s.unequipManual);
  const unequipAllManuals = useGame((s) => s.unequipAllManuals);
  const autoEquipManuals = useGame((s) => s.autoEquipManuals);

  const libraries = getBuildingCount(game, 'library');
  const all = getAllManuals(game);
  const totalFragments = all.reduce((sum, entry) => sum + entry.fragments, 0);
  const totalOwned = all.reduce((sum, entry) => sum + entry.count, 0);
  // 身上带着功法的人数（一键卸载按钮上要显示"卸几本"）
  const equippedCount = game.sect.disciples.reduce(
    (sum, d) => sum + (d.cultivationManual ? 1 : 0) + (d.combatManual ? 1 : 0),
    0,
  );

  // 已装备的功法（按弟子境界降序取前 12 条展示，避免千人宗门把面板撑爆）
  const equipped = game.sect.disciples
    .filter((d) => d.cultivationManual || d.combatManual)
    .sort((a, b) => b.realmIndex - a.realmIndex)
    .slice(0, 12);

  const grades: ManualGrade[] = [1, 2, 3, 4, 5];

  return (
    <Panel
      title="藏经阁"
      hint={`${libraries} 座 · 功法 ${totalOwned} 本 · 碎片 ${totalFragments} 份`}
      collapsible={collapsible}
      storageKey="manuals"
    >
      <p className="panel__note">
        功法分 <strong>凡品 / 良品 / 上品 / 极品 / 天纵</strong> 五档，每名弟子各带
        <strong> 1 本修炼功法 + 1 本战斗功法</strong>。碎片来自秘境探索、论道大比与这里的参悟；
        <strong> {FRAGMENTS_PER_MANUAL} 份同功法碎片</strong>可合成一本，成功率随藏经阁座数上升。
        {libraries === 0 && ' 先建一座藏经阁才能参悟。'}
      </p>

      {/*
        参悟：用灵气换碎片。
        它把"多余灵气"变成"功法进度"，于是一个中后期常见的处境
        （灵气用不完、但没东西可买）有了一条有意义的出口。
      */}
      <div className="tier-upgrade">
        <div className="tier-upgrade__head">
          <span>藏经阁参悟</span>
          <span className="tier-upgrade__slots">{describeSynth(game)}</span>
        </div>
        <div className="btn-row btn-row--wrap">
          {grades.map((grade) => {
            const check = canContemplate(game, grade);
            const cost = CONTEMPLATE_QI_COST[grade];
            if (cost <= 0) {
              return (
                <button
                  key={grade}
                  type="button"
                  className="btn btn--tiny"
                  disabled
                  title={check.reason ?? ''}
                >
                  {MANUAL_GRADE_NAMES[grade]}不可参悟
                </button>
              );
            }
            return (
              <span key={grade} className="btn-row">
                <button
                  type="button"
                  className="btn btn--tiny"
                  disabled={!check.ok}
                  title={check.reason ?? `消耗 ☯${fmt(cost)} 换 1 份碎片`}
                  onClick={() => contemplateManual(grade)}
                >
                  参悟{MANUAL_GRADE_NAMES[grade]} ☯{fmt(cost)}
                </button>
                {/* 需求 7：批量参悟（一次点十下太累） */}
                <button
                  type="button"
                  className="btn btn--tiny"
                  disabled={!check.ok}
                  title={check.reason ?? `连参悟 10 次，共 ☯${fmt(cost * 10)}（灵气不够就做几次算几次）`}
                  onClick={() => contemplateBatch(grade, 10)}
                >
                  ×10
                </button>
              </span>
            );
          })}
        </div>
        <p className="panel__note">
          参悟只能得到<strong>碎片</strong>（天纵除外 —— 它只在九档秘境里）。想凑齐一本，
          通常得一边探索一边参悟。
        </p>
      </div>

      {totalOwned > 0 && (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={autoEquipManuals}
            title="按境界从高到低，把仓库里的功法发出去"
          >
            一键发书（把仓库里的功法发给最合适的弟子）
          </button>
          {/* 需求 7：一键卸载（全部回到藏经阁，不损耗） */}
          <button
            type="button"
            className="btn"
            disabled={equippedCount === 0}
            title="把所有弟子身上的功法都卸下来，回到藏经阁"
            onClick={unequipAllManuals}
          >
            一键卸载（{equippedCount} 本）
          </button>
        </div>
      )}

      {equipped.length > 0 && (
        <div className="disciple-list">
          <p className="panel__note">当前装配（按境界前 12 名）：</p>
          {equipped.map((d) => (
            <div key={d.id} className="inv-row">
              <span className="inv-row__name">{d.name}</span>
              <span className="inv-row__count">{realmName(d.realmIndex)}</span>
              <span className="inv-row__effect">
                {getEquippedManuals(d)
                  .map((entry) => (entry.def ? entry.def.name : '—'))
                  .join(' / ')}
              </span>
              <button
                type="button"
                className="btn btn--tiny"
                onClick={() => unequipManual(d.id, d.cultivationManual ? 'cultivationManual' : 'combatManual')}
                title="卸下第一本已装备的功法"
              >
                卸下
              </button>
            </div>
          ))}
        </div>
      )}

      {grades.map((grade) => (
        <FoldSection
          key={grade}
          title={`${MANUAL_GRADE_NAMES[grade]}功法`}
          hint={`需 ${realmName(MANUAL_GRADE_MIN_REALM[grade])}`}
          count={all.filter((entry) => entry.def.grade === grade).length}
          storageKey={`manual.grade.${grade}`}
          defaultOpen={grade <= 2}
        >
          {all
            .filter((entry) => entry.def.grade === grade)
            .map((entry) => (
              <ManualRow key={entry.def.id} def={entry.def} />
            ))}
        </FoldSection>
      ))}
    </Panel>
  );
}

export default ManualPanel;

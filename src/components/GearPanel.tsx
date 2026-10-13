/**
 * 丹器阁（设定集第 8.7 / 11 章）
 *
 * 这里只保留两件事：
 *   - **炉鼎九件**（换更好的炉子）；
 *   - 当前装配总览 + **共享的装备列表**（GearForgeSection）。
 *
 * ⚠️ 装备列表抽成了独立组件：它要在「炼器」页与这里同时出现。
 * 原先只有这里有一份，于是玩家在炼器页根本找不到弟子装备（需求 15）。
 */
import { FURNACES, GEARS, REALMS } from '../game/content';
import {
  canForgeFurnace,
  countDiscipleGear,
  describeDiscipleGear,
  getFurnace,
  getGearCount,
  getOwnedFurnaces,
} from '../game/gear';
import { describeCraftRate } from '../game/crafting';
import { useGame } from '../game/store';
import Panel from './Panel';
import GearForgeSection from './GearForgeSection';

/** 境界名统一从 content 的 REALMS 取（不再自抄一张只有 5 项的小表） */
const realmName = (index: number): string => REALMS[Math.min(index, REALMS.length - 1)]?.name ?? '';

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
        <strong>自动合成</strong>决定合成材料有多快。同时只能用<strong>一口</strong>，所以「换更好的」是线性进阶。
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

      {equipped.length > 0 && (
        <div className="inv-list">
          <p className="panel__note">当前装配（按境界前 12 名）：</p>
          {equipped.map((d) => (
            <div key={d.id} className="inv-row">
              <span className="inv-row__name">{d.name}</span>
              <span className="inv-row__count">{realmName(d.realmIndex)}</span>
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

      <GearForgeSection />

      <p className="panel__note">
        小提示：丹药栏里的东西是<strong>消耗品</strong>，一趟秘境回来就空了 —— 常备几件是划算的。
      </p>
    </Panel>
  );
}

export default GearPanel;

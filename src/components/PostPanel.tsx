/**
 * 派遣与技艺 —— **按功能页拆开**（需求 2）
 *
 * 需求原文：
 *   「弟子派遣分化到各个功能界面里面去，不放在宗门内」
 *
 * 所以原先那个统一的「派遣与技艺」面板被拆成按技艺面独立的小节：
 *   - 炼丹页 → 安置丹房（炼丹技艺）
 *   - 炼器页 → 安置炼器房（炼器技艺）
 *   - 符箓页 → 安置符房（制符技艺）
 *   - 灵植页 → 安置灵田（种田技艺）
 *
 * ⚠️ 但四类技艺的**进度**仍然要能在一个地方横向比较（"我该先培养哪个"），
 * 所以 `PostOverview` 保留了那份总览 —— 它挂在**修行页**（弟子修炼的主场），
 * 而不是宗门页。
 */
import { useState } from 'react';
import {
  FARM_TALENT_MAP,
  POST_BUILDINGS,
  SKILL_BONUS_PER_LEVEL,
  SKILL_MAX_LEVEL,
  SKILL_NAMES,
  TALENT_KIND_NAMES,
  type SkillKind,
} from '../game/content';
import { getPostBonus, getPostCapacity, getPostCount, getPostFree, talentKindOf, describePost } from '../game/posting';
import { skillLevelOf } from '../game/content';
import { useGame } from '../game/store';
import Panel from './Panel';

/** 选人名单：够资格进这座设施、且当前没在别处的弟子 */
function PostPicker({ buildingId }: { buildingId: string }) {
  const game = useGame((s) => s.game);
  const postNow = useGame((s) => s.postDisciple);
  const kind = POST_BUILDINGS[buildingId]?.kind;

  const candidates = game.sect.disciples
    .filter((d) => !d.post && d.status === 'idle')
    .map((d) => ({
      d,
      match: kind ? talentKindOf(d) === kind : false,
      points: kind ? (d.skills[kind] ?? 0) : 0,
    }))
    // 对口优先 → 技艺点高的优先 → 境界高的优先
    .sort((a, b) => Number(b.match) - Number(a.match) || b.points - a.points || b.d.realmIndex - a.d.realmIndex)
    .slice(0, 60);

  if (candidates.length === 0) return <p className="panel__note">没有空闲弟子可安排（其余都在探索或已在岗）。</p>;

  return (
    <div className="picker">
      {candidates.map(({ d, match, points }) => (
        <button
          key={d.id}
          type="button"
          className={match ? 'picker__item picker__item--on' : 'picker__item'}
          title={match ? '天赋对口：技艺点更快、加成翻倍' : '天赋不对口：只能拿到基础加成'}
          onClick={() => postNow(d.id, buildingId)}
        >
          <span className="picker__name">{d.name}</span>
          <span className="picker__realm">{FARM_TALENT_MAP[d.farmTalent]?.name ?? '—'}</span>
          <span className="picker__power">
            {kind ? `${SKILL_NAMES[kind]} ${skillLevelOf(points)} 级` : ''} {match ? '· 对口' : ''}
          </span>
        </button>
      ))}
    </div>
  );
}

/** 一名在岗弟子的行 */
function PostedRow({ id }: { id: string }) {
  const game = useGame((s) => s.game);
  const unpostOne = useGame((s) => s.unpostDisciple);
  const d = game.sect.disciples.find((x) => x.id === id);
  if (!d) return null;
  return (
    <div className="inv-row">
      <span className="inv-row__name">{d.name}</span>
      <span className="inv-row__count">
        {FARM_TALENT_MAP[d.farmTalent]?.name ?? '—'}
        {d.post && talentKindOf(d) === POST_BUILDINGS[d.post]?.kind ? ' · 对口' : ''}
      </span>
      <span className="inv-row__effect">{describePost(d)}</span>
      <button type="button" className="btn btn--tiny" onClick={() => unpostOne(d.id)}>
        撤回
      </button>
    </div>
  );
}

/**
 * 一个技艺面的派遣小节（炼丹 / 炼器 / 制符 / 种田各一份）。
 *
 * 放在各自的功能页里，这样"我要在这座丹房里放谁"和"我要炼什么丹"
 * 在同一屏 —— 需求 2 想要的就是这个。
 */
export function PostSection({ kind }: { kind: SkillKind }) {
  const game = useGame((s) => s.game);
  const unpostAll = useGame((s) => s.unpostAll);
  const [openId, setOpenId] = useState<string | null>(null);

  const buildings = Object.keys(POST_BUILDINGS)
    .filter((id) => POST_BUILDINGS[id].kind === kind)
    .map((id) => ({
      id,
      name: POST_BUILDINGS[id].name,
      icon: POST_BUILDINGS[id].icon,
      posted: getPostCount(game, id),
      capacity: getPostCapacity(game, id),
    }));

  const bonus = getPostBonus(game, kind);
  const totalPosted = buildings.reduce((sum, b) => sum + b.posted, 0);
  const totalCapacity = buildings.reduce((sum, b) => sum + b.capacity, 0);
  const onDuty = game.sect.disciples.filter((d) => d.post && POST_BUILDINGS[d.post]?.kind === kind);

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>
          {TALENT_KIND_NAMES[kind]}岗位：在岗 <strong>{totalPosted}</strong> / {totalCapacity} 人 · 加成{' '}
          <strong>+{Math.round(bonus * 100)}%</strong>
        </span>
      </div>
      <p className="panel__note">
        把有<strong>{TALENT_KIND_NAMES[kind]}天赋</strong>的弟子安排进这里：技艺点攒得更快、
        给设施的加成也翻倍（每级 +{Math.round(SKILL_BONUS_PER_LEVEL * 100)}%，上限 {SKILL_MAX_LEVEL} 级）。
        ⚠️ 在岗的弟子<strong>不能同时去探索</strong>。
      </p>

      {totalCapacity === 0 ? (
        <p className="panel__note">
          还没有{POST_BUILDINGS[buildings[0]?.id ?? '']?.name ?? '对应设施'} —— 先去「建筑」页盖一座。
        </p>
      ) : (
        buildings.map((b) => (
          <div key={b.id} className="notice-board__row">
            <span className="notice-board__name">
              {b.icon}
              {b.name}
            </span>
            <span className="notice-board__detail">
              {b.posted} / {b.capacity} 人
            </span>
            <span className="btn-row" style={{ marginLeft: 'auto' }}>
              <button
                type="button"
                className="btn btn--tiny"
                disabled={getPostFree(game, b.id) <= 0 && openId !== b.id}
                onClick={() => setOpenId(openId === b.id ? null : b.id)}
              >
                {openId === b.id ? '收起名单' : `安排人（空 ${getPostFree(game, b.id)}）`}
              </button>
              <button type="button" className="btn btn--tiny" disabled={b.posted === 0} onClick={() => unpostAll(b.id)}>
                全部撤回
              </button>
            </span>
          </div>
        ))
      )}

      {openId && <PostPicker buildingId={openId} />}

      {onDuty.length > 0 && (
        <div className="inv-list">
          {onDuty.slice(0, 10).map((d) => (
            <PostedRow key={d.id} id={d.id} />
          ))}
          {onDuty.length > 10 && <p className="panel__note">…… 另有 {onDuty.length - 10} 人在岗</p>}
        </div>
      )}
    </div>
  );
}

/**
 * 四类技艺的总览（挂在**修行页**）。
 *
 * 需求 2 把派遣拆到了各个功能页，但"我该先培养哪一类技艺"这个判断
 * 需要横向比较 —— 所以总览单独留在弟子修炼的主场，而不是宗门页。
 */
export function PostOverview({ collapsible }: { collapsible?: boolean }) {
  const game = useGame((s) => s.game);
  const autoPost = useGame((s) => s.autoPostAll);

  const rows = (Object.keys(SKILL_NAMES) as SkillKind[]).map((kind) => {
    const buildings = Object.keys(POST_BUILDINGS).filter((id) => POST_BUILDINGS[id].kind === kind);
    const capacity = buildings.reduce((sum, id) => sum + getPostCapacity(game, id), 0);
    const posted = buildings.reduce((sum, id) => sum + getPostCount(game, id), 0);
    return { kind, capacity, posted, bonus: getPostBonus(game, kind) };
  });
  const totalCapacity = rows.reduce((sum, r) => sum + r.capacity, 0);
  const totalPosted = rows.reduce((sum, r) => sum + r.posted, 0);

  return (
    <Panel
      title="派遣与技艺"
      hint={`在岗 ${totalPosted} / ${totalCapacity} 人`}
      collapsible={collapsible}
      storageKey="postOverview"
    >
      <p className="panel__note">
        四座设施的岗位分别在<strong>炼丹 / 炼器 / 符箓 / 灵植</strong>四页里安排
        （需求 2：派遣分化到各功能界面）。这里只做横向比较，方便你决定先把人投到哪条线上。
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn--primary" disabled={totalCapacity === 0} onClick={autoPost}>
          一键填岗（对口优先，四页一起填）
        </button>
      </div>
      {totalCapacity === 0 && (
        <p className="panel__note">
          还没有任何岗位。先去「建筑」页盖一座<strong>丹房 / 炼器房 / 符房 / 灵田</strong>。
        </p>
      )}
      {rows.map((row) => (
        <div key={row.kind} className="notice-board__row">
          <span className="notice-board__name">{TALENT_KIND_NAMES[row.kind]}</span>
          <span className="notice-board__detail">
            在岗 {row.posted} / {row.capacity} 人
          </span>
          <span className="notice-board__missing">+{Math.round(row.bonus * 100)}%</span>
        </div>
      ))}
    </Panel>
  );
}

export default PostSection;

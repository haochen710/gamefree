/**
 * 派遣与技艺（需求 3 + 12）
 *
 * 四座设施（丹房 / 炼器房 / 符房 / 灵田）各有一批岗位，玩家把弟子安排进去：
 *   - 在岗期间**持续获得心得**（需求 3：遣到建筑也能涨经验）；
 *   - 在岗期间**积累该项技艺点**，升级后给设施的加成更多（需求 12）；
 *   - **对口天赋**（炼丹天赋进丹房…）让技艺点攒得更快、加成翻倍；
 *   - 被派遣的弟子**不能同时去探索** —— 人手是要分配的稀缺资源。
 *
 * 界面上的取舍：一屏看四个技艺面（各有多少人 / 多少岗位 / 当前加成），
 * 点开某一面才展开选人名单。千人宗门里"逐个人挑"是不现实的，
 * 所以另给一个「一键填岗」（按对口与技艺排序）。
 */
import { useState } from 'react';
import {
  FARM_TALENT_MAP,
  POST_BUILDINGS,
  SKILL_LEVEL_POINTS,
  SKILL_MAX_LEVEL,
  SKILL_NAMES,
  TALENT_KIND_NAMES,
  type SkillKind,
} from '../game/content';
import { getPostOverview, talentKindOf, describePost } from '../game/posting';
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

/** 一个技艺面（炼丹 / 炼器 / 制符 / 种田） */
function KindBlock({
  kind,
  posted,
  capacity,
  bonus,
  buildings,
}: {
  kind: SkillKind;
  posted: number;
  capacity: number;
  bonus: number;
  buildings: { id: string; name: string; icon: string; posted: number; capacity: number }[];
}) {
  const game = useGame((s) => s.game);
  const unpostAll = useGame((s) => s.unpostAll);
  const unpostOne = useGame((s) => s.unpostDisciple);
  const [openId, setOpenId] = useState<string | null>(null);

  const posted_ = game.sect.disciples.filter((d) => d.post && POST_BUILDINGS[d.post]?.kind === kind);

  return (
    <div className="tier-upgrade">
      <div className="tier-upgrade__head">
        <span>
          {TALENT_KIND_NAMES[kind]}：在岗 <strong>{posted}</strong> / {capacity} 人 · 设施加成{' '}
          <strong>+{Math.round(bonus * 100)}%</strong>
        </span>
      </div>

      {buildings.map((b) => (
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
              disabled={b.capacity <= 0}
              onClick={() => setOpenId(openId === b.id ? null : b.id)}
            >
              {openId === b.id ? '收起名单' : '安排人'}
            </button>
            <button type="button" className="btn btn--tiny" disabled={b.posted === 0} onClick={() => unpostAll(b.id)}>
              全部撤回
            </button>
          </span>
        </div>
      ))}

      {openId && <PostPicker buildingId={openId} />}

      {posted_.length > 0 && (
        <div className="inv-list">
          {posted_.slice(0, 12).map((d) => (
            <div key={d.id} className="inv-row">
              <span className="inv-row__name">{d.name}</span>
              <span className="inv-row__count">
                {FARM_TALENT_MAP[d.farmTalent]?.name ?? '—'}
                {talentKindOf(d) === kind ? ' · 对口' : ''}
              </span>
              <span className="inv-row__effect">{describePost(d)}</span>
              <button type="button" className="btn btn--tiny" onClick={() => unpostOne(d.id)}>
                撤回
              </button>
            </div>
          ))}
          {posted_.length > 12 && <p className="panel__note">…… 另有 {posted_.length - 12} 人在岗</p>}
        </div>
      )}
    </div>
  );
}

export function PostPanel({ collapsible }: { collapsible?: boolean }) {
  const game = useGame((s) => s.game);
  const autoPost = useGame((s) => s.autoPostAll);
  const overview = getPostOverview(game);
  const totalPosted = overview.reduce((sum, entry) => sum + entry.posted, 0);
  const totalCapacity = overview.reduce((sum, entry) => sum + entry.capacity, 0);

  return (
    <Panel
      title="派遣与技艺"
      hint={`在岗 ${totalPosted} / ${totalCapacity} 人`}
      collapsible={collapsible}
      storageKey="post"
    >
      <p className="panel__note">
        把弟子派进<strong>丹房 / 炼器房 / 符房 / 灵田</strong>，他们会在那里
        <strong>持续积累心得</strong>与<strong>技艺点</strong>；技艺每升一级，
        给这座设施的加成更多（上限 {SKILL_MAX_LEVEL} 级）。
        <strong>天赋对口</strong>的人技艺点攒得快、加成还翻倍 ——
        所以"谁进哪座房子"是一件值得想一下的事。
      </p>
      <p className="panel__note">
        ⚠️ 在岗的弟子<strong>不能同时去探索</strong>：人手是要分配的。
        技艺等级的门槛依次是 {SKILL_LEVEL_POINTS.slice(1, 6).join(' / ')} …（越往后越陡）。
      </p>

      <div className="btn-row">
        <button type="button" className="btn btn--primary" disabled={totalCapacity === 0} onClick={autoPost}>
          一键填岗（对口优先）
        </button>
      </div>

      {totalCapacity === 0 && (
        <p className="panel__note">
          还没有任何设施岗位。先去「建筑」页盖一座<strong>丹房 / 炼器房 / 符房 / 灵田</strong>。
        </p>
      )}

      {overview.map((entry) => (
        <KindBlock key={entry.kind} {...entry} />
      ))}
    </Panel>
  );
}

export default PostPanel;

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
  POST_UNLOCK,
  SKILL_BONUS_PER_LEVEL,
  SKILL_MAX_LEVEL,
  SKILL_NAMES,
  TALENT_KIND_NAMES,
  type SkillKind,
} from '../game/content';
import { getPostBonus,
  getPostEffect, getPostCapacity,
  postSlotsPerBuilding, getPostCount, getPostFree, talentKindOf, describePost } from '../game/posting';
import { skillLevelOf } from '../game/content';
import { useGame } from '../game/store';
import type { Disciple } from '../game/state';
import Panel from './Panel';

/** 选人名单：够资格进这座设施、且当前没在别处的弟子 */
/**
 * 选人名单（第 21 轮：按**适配性**排序并给出推荐）。
 *
 * 玩家原话：「岗位选人界面可以根据适配性做推荐，炼器制符同理」。
 *
 * 适配分由四件事加权而成 —— 而且**与加成的来源一一对应**，
 * 所以玩家看到的排序就是他实际会拿到的收益排序：
 *   1. 天赋对口（加成 ×1.5、技艺点攒得快）→ 最大权重；
 *   2. 技艺等级（加成全部由它解锁：1 级成功率 / 3 级省料 / 5 级增产 / 7 级越阶）；
 *   3. 已有的技艺点（离下一级还有多远）；
 *   4. 境界（顺手带一点，高境界弟子更耐得住）。
 * 前几名打「推荐」标记，并把"他到底能贡献什么"写在旁边。
 */
function scoreCandidate(d: Disciple, kind: SkillKind): { score: number; points: number; level: number; match: boolean; unlocks: string[] } {
  const points = kind ? (d.skills[kind] ?? 0) : 0;
  const level = skillLevelOf(points);
  const match = talentKindOf(d) === kind;
  const unlocks: string[] = [];
  if (level >= POST_UNLOCK.success) unlocks.push('成功率');
  if (level >= POST_UNLOCK.cost) unlocks.push('省料');
  if (level >= POST_UNLOCK.output) unlocks.push('增产');
  if (level >= POST_UNLOCK.quality) unlocks.push('越阶');
  const score =
    (match ? 100 : 0) +
    level * 12 +
    Math.min(30, Math.log10(1 + points) * 6) +
    d.realmIndex * 2;
  return { score, points, level, match, unlocks };
}

function PostPicker({ buildingId }: { buildingId: string }) {
  const game = useGame((s) => s.game);
  const postNow = useGame((s) => s.postDisciple);
  const kind = POST_BUILDINGS[buildingId]?.kind;

  const ranked = game.sect.disciples
    .filter((d) => !d.post && d.status === 'idle')
    .map((d) => ({ d, ...scoreCandidate(d, kind) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);

  if (ranked.length === 0) return <p className="panel__note">没有空闲弟子可安排（其余都在探索或已在岗）。</p>;

  return (
    <div className="picker">
      {ranked.map(({ d, level, match, unlocks, score }, index) => (
        <button
          key={d.id}
          type="button"
          className={match ? 'picker__item picker__item--on' : 'picker__item'}
          title={
            (match ? '天赋对口：加成 ×1.5、技艺点攒得更快' : '天赋不对口：加成打七折') +
            (unlocks.length > 0 ? ` · 已解锁：${unlocks.join('、')}` : ' · 还没解锁任何加成（技艺 0 级）')
          }
          onClick={() => postNow(d.id, buildingId)}
        >
          <span className="picker__name">
            {index < 3 && <span className="picker__badge">推荐</span>}
            {d.name}
          </span>
          <span className="picker__realm">{FARM_TALENT_MAP[d.farmTalent]?.name ?? '—'}</span>
          <span className="picker__power">
            适配 {Math.round(score)}
            {kind ? ` · ${SKILL_NAMES[kind]} ${level} 级` : ''}
            {match ? ' · 对口' : ''}
            {unlocks.length > 0 ? ` · ${unlocks.join('/')}` : ' · 无加成'}
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
  /*
   * 第 27 轮（需求 1）：玩家原话「各个建筑的岗位栏，在派遣弟子后却没有显示加成
   * 是多少；加成提出成为一个单独的栏目显示：如成功率+xx%，资源消耗减少 xx% 等」。
   *
   * 现在在岗弟子的加成有**四类**（第 21 轮做的模型），但界面只显示了成功率那一项 ——
   * 省料 / 增产 / 失败回收三项完全看不见，玩家根本不知道自己派人有啥用。
   * 所以这里把四类一起列出来（按品阶按 1 档算：这是"平时炼低阶东西"的口径）。
   */
  const effect = getPostEffect(game, kind, 1);
  const effectRows = [
    { key: 'success', label: '成功率', value: effect.success, hint: '1 级解锁' },
    { key: 'cost', label: '资源消耗减少', value: effect.cost, hint: '3 级解锁' },
    { key: 'output', label: '产出（出双份）', value: effect.output, hint: '5 级解锁' },
    { key: 'salvage', label: '失败回收', value: effect.salvage, hint: '2 级解锁' },
  ];
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

      {/*
        第 27 轮（需求 1）：**加成单独一栏**。
        四类加成按"技艺多少级解锁"的顺序排，没解锁的也列出来并标上门槛 ——
        否则玩家只会看到一排 0%，不知道是"没人"还是"等级不够"。
      */}
      <div className="notice-board">
        <div className="notice-board__head">
          <span>📊 {TALENT_KIND_NAMES[kind]}加成（在岗 {effect.posted} 人，其中 {effect.contributors} 人在出力）</span>
          <span className="notice-board__sum">
            {totalPosted === 0 ? '尚无加成' : `成功率 +${Math.round(effect.success * 100)}%`}
          </span>
        </div>
        {effectRows.map((row) => (
          <div key={row.key} className="notice-board__row">
            <span className="notice-board__name">{row.label}</span>
            <span className="notice-board__detail">
              {row.value > 0 ? (
                <strong>+{Math.round(row.value * 100)}%</strong>
              ) : (
                <span className="panel__hint">0%（{row.hint}）</span>
              )}
            </span>
          </div>
        ))}
        <p className="panel__note">
          加成按<strong>技艺等级</strong>长出来，而且**目标品阶越高、有效等级越低**
          （炼五品丹时，3 级弟子等于没来）。想提高，就派对口天赋、等级更高的弟子。
        </p>
      </div>

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
              {/* 第 29 轮：岗位数随品阶增长，所以把"每座几人"写出来 —— 否则
                  玩家会以为"这一座怎么突然能站 90 个人" */}
              <span className="panel__hint">（每座 {postSlotsPerBuilding(game, b.id)} 个，随品阶增长）</span>
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

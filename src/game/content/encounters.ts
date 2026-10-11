/**
 * 开宗前的随机遭遇（需求 2）
 *
 * 需求原文：
 *   「增加随机事件，开宗前有遇到商队、不同npc等，对不同npc的选择可以获得
 *     不同奖励或者惩罚，人物增加善恶值设定。人物恶行值越高，突破时越容易
 *     遭受天雷之罚，导致突破失败（小境界突破也会），但是恶行值突破一定程度
 *     之后可以抢劫npc，获取大量材料，乃至部分稀有材料，但是几率不大。
 *     善行值越高，普通探索或者秘境探索产出有相应加成。」
 *
 * 所以这个文件只放**内容**：遇到谁、能选什么、选了会怎样。
 * 判定与结算在 `../encounter.ts`。
 *
 * 设计上三条：
 *   1. **每个遭遇都至少有一个"不亏"的选项** —— 随机事件不该逼玩家做亏本买卖，
 *      否则它就从"选择"退化成"罚站"。
 *   2. **选项要有真实取舍**：行善给的是稳定的小收益 + 善行值，
 *      作恶给的是立刻到手的大量材料 + 恶行值，而恶行值会在突破时还回来。
 *   3. **抢劫是恶行线的专属奖励**，门槛见 `KARMA_ROB_THRESHOLD`：
 *      恶行值到位了才解锁，且成功率一律不高（需求："几率不大"）。
 */
import type { ItemId } from './resources';

export interface EncounterEffect {
  /** 善恶值变化：正 = 善行，负 = 恶行 */
  karma: number;
  /**
   * 直接获得（正）/ 失去（负）的物品。
   * 负数只有在**付得起**的时候那个选项才可选（见 `requiresItems` 的推导）。
   */
  items?: Partial<Record<ItemId, number>>;
  /** 丹药（丹药有自己的 id 空间，不在 ItemId 里） */
  pills?: Record<string, number>;
  /** 道伤秒数：做坏事容易挨打 */
  injury?: number;
  /** 抢劫类选项的成功率（不填 = 必定成功） */
  successChance?: number;
  /** 抢劫成功时的额外奖励（可以含稀有材料） */
  successItems?: Partial<Record<ItemId, number>>;
  /** 抢劫失败时的后果 */
  failInjury?: number;
}

export interface EncounterOption {
  label: string;
  desc: string;
  /** 恶行值要低到这个数以下才能选（karma <= 该值）。抢劫类选项用这个 */
  requiresKarmaAtMost?: number;
  /** 善行值要高到这个数以上才能选 */
  requiresKarmaAtLeast?: number;
  /**
   * 需要持有这些物品才谈得上"失去"它们。
   * 不填时由 `items` 里的负数项自动推出来（少写一遍，少一处漂移）。
   */
  requiresItems?: Partial<Record<ItemId, number>>;
  effect: EncounterEffect;
  /** 结果文案（成功 / 不涉及判定的普通结果） */
  result: string;
  /** 失败文案（有 successChance 时才有意义） */
  failResult?: string;
}

/** 遭遇的范围（需求 1 起分两种） */
export type EncounterScope = 'player' | 'sect';

/**
 * 宗门进攻类事件的参数（需求 1）。
 *
 * 这类事件**不会过期作废**：玩家不选，它就按最坏的结果照常结算
 * （需求原文：「针对宗门的进攻类随机事件正常进行和结算」）。
 * 其余宗门事件与玩家事件一样，到点就消失、没有影响。
 */
export interface EncounterAttack {
  /** 强度（0~1）：越大越难挡。结算时还会按掌门境界放大 */
  power: number;
  /** 战报里的一句话 */
  desc: string;
}

export interface EncounterDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** 玩家事件还是宗门事件（需求 1）。宗门事件只在开宗后出现 */
  scope: EncounterScope;
  /** 有它就是"进攻类"：到点不选也会照常结算 */
  attack?: EncounterAttack;
  options: EncounterOption[];
  /** 抽取权重 */
  weight: number;
}

export const ENCOUNTERS: EncounterDef[] = [
  {
    id: 'caravan',
    name: '行脚商队',
    icon: '🐫',
    desc: '一支商队停在路边歇脚，货箱半开，几匹驮兽正低头啃草。领队的修士朝你拱了拱手。',
    scope: 'player',
    weight: 12,
    options: [
      {
        label: '以灵石换货',
        desc: '按市价交易，童叟无欺。',
        requiresItems: { stone: 800 },
        effect: {
          karma: 2,
          items: { stone: -800, blackIron: 40, spiritSilk: 25, moonDew: 4 },
        },
        result: '商队按数给你装了货，还多塞了两把灵蚕丝。',
      },
      {
        label: '让路同行',
        desc: '陪他们走一段夜路，分文不取。',
        effect: { karma: 6, items: { stone: 200 } },
        result: '领队谢过你，临别时塞来一小袋灵石当盘缠。',
      },
      {
        label: '下手抢夺',
        desc: '商队护卫不多 —— 但你得够狠才下得了手。',
        requiresKarmaAtMost: -30,
        effect: {
          karma: -12,
          successChance: 0.55,
          successItems: { blackIron: 300, spiritSilk: 200, moonDew: 30, starSand: 6, stone: 4000 },
          failInjury: 180,
        },
        result: '你趁夜摸了进去，货箱一空，人也没留下。',
        failResult: '护卫里有高手。你挨了一记，空手逃了出来。',
      },
    ],
  },
  {
    id: 'woundedCultivator',
    name: '落难的散修',
    icon: '🧎',
    desc: '一个散修靠坐在石头上，道袍破了大半，气息紊乱 —— 像是被什么追了很久。',
    scope: 'player',
    weight: 10,
    options: [
      {
        label: '出手相救',
        desc: '渡一缕灵气替他压住伤势。',
        requiresItems: { qi: 5000 },
        effect: { karma: 12, items: { qi: -5000 }, pills: { qiGatheringPill: 2 } },
        result: '他缓过气来，把身上仅剩的两枚凝气丹塞给你，说日后必有回报。',
      },
      {
        label: '视而不见',
        desc: '萍水相逢，各安天命。',
        effect: { karma: -5 },
        result: '你从他身边走过。身后传来一声轻叹。',
      },
      {
        label: '摸走储物袋',
        desc: '他连抬手的力气都没有了。',
        requiresKarmaAtMost: -30,
        effect: { karma: -14, items: { stone: 1500, blackIron: 60, moonDew: 8 } },
        result: '你解下他的储物袋。他没有反抗，只是闭上了眼。',
      },
    ],
  },
  {
    id: 'herbChild',
    name: '采药童子',
    icon: '🌿',
    desc: '一个十来岁的童子背着小药篓，正蹲在崖边小心翼翼地拔一株灵芝。',
    scope: 'player',
    weight: 8,
    options: [
      {
        label: '教他辨灵草',
        desc: '顺手指点几句，比给他东西更有用。',
        effect: { karma: 8, items: { herb: 2000 } },
        result: '童子听得认真，把药篓里最好的一把灵草全给了你。',
      },
      {
        label: '抢走药篓',
        desc: '一篓药材，对他来说不过是白忙一天。',
        requiresKarmaAtMost: -30,
        effect: { karma: -16, items: { herb: 9000, moonDew: 6 } },
        result: '你把药篓提走了。童子愣在原地，没敢追。',
      },
    ],
  },
  {
    id: 'blackRobe',
    name: '黑袍老者',
    icon: '🧙',
    desc: '一个黑袍老者盘坐在断碑上，周身没有一点气息外泄 —— 你看不出他的深浅。',
    scope: 'player',
    weight: 6,
    options: [
      {
        label: '恭敬请教',
        desc: '奉上灵石，求一句指点。',
        requiresItems: { stone: 1200 },
        effect: { karma: 3, items: { stone: -1200, starSand: 4 } },
        result: '他收下灵石，随手抛来一小撮星砂："拿去吧。"',
      },
      {
        label: '远远避开',
        desc: '看不出深浅的人，最好别招惹。',
        effect: { karma: 0 },
        result: '你绕了很远的路过去。回头时，断碑上已经空了。',
      },
      {
        label: '暗中偷袭',
        desc: '他背对着你 —— 但你赌得起吗？',
        requiresKarmaAtMost: -50,
        effect: {
          karma: -20,
          successChance: 0.45,
          successItems: { starSand: 20, lunarCrystal: 2, stone: 6000 },
          failInjury: 400,
        },
        result: '一击得手。老者倒下时眼里还带着难以置信。',
        failResult: '你刚近身，他连眼皮都没抬。你被打飞出去，道伤不轻。',
      },
    ],
  },
  {
    id: 'patrol',
    name: '仙门巡使',
    icon: '⚔',
    desc: '两名仙门巡使御剑拦住去路，出示令牌："近日此地有散修作乱，报上名号来历。"',
    scope: 'player',
    weight: 6,
    options: [
      {
        label: '行礼让道',
        desc: '如实相告，客客气气。',
        effect: { karma: 8 },
        result: '巡使验过你的气息，点了点头，让开了路。',
      },
      {
        label: '绕道而行',
        desc: '多走两天，省得麻烦。',
        effect: { karma: 0 },
        result: '你绕开了那道关卡，多花了两天，但没惹上事。',
      },
      {
        label: '出手抗衡',
        desc: '仙门的东西，向来是最好的。',
        requiresKarmaAtMost: -50,
        effect: {
          karma: -22,
          successChance: 0.4,
          successItems: { immortalJade: 1, chaosQi: 1, stone: 8000, starSand: 12 },
          failInjury: 700,
        },
        result: '两名巡使都没能回去。你从他们身上搜出了仙门的东西。',
        failResult: '巡使的剑比传闻中快得多。你重伤遁走，什么也没拿到。',
      },
    ],
  },
  {
    id: 'beggar',
    name: '乞儿',
    icon: '🥣',
    desc: '一个瘦得脱了形的孩子缩在墙根，面前摆着一只豁口的碗。',
    scope: 'player',
    weight: 9,
    options: [
      {
        label: '施舍灵石',
        desc: '你也不宽裕，但总比他强。',
        requiresItems: { stone: 300 },
        effect: { karma: 10, items: { stone: -300 } },
        result: '孩子捧着灵石，给你磕了个头就跑了。',
      },
      {
        label: '驱赶',
        desc: '别挡着路。',
        effect: { karma: -7 },
        result: '你抬脚踢翻了那只碗。孩子缩得更紧了些。',
      },
    ],
  },
  {
    id: 'wanderingDoctor',
    name: '游方郎中',
    icon: '💊',
    desc: '一个背着药箱的郎中在树下支了个摊，幌子上写着"丹道正统，童叟无欺"。',
    scope: 'player',
    weight: 8,
    options: [
      {
        label: '买丹',
        desc: '价格不算便宜，但看着是真货。',
        requiresItems: { stone: 2000 },
        effect: { karma: 2, items: { stone: -2000 }, pills: { foundationPill: 1 } },
        result: '郎中从箱底摸出一枚筑基丹，用玉瓶仔细装了给你。',
      },
      {
        label: '讨要',
        desc: '蹭一枚凝气丹，脸皮厚点就是了。',
        effect: { karma: -9, pills: { qiGatheringPill: 1 } },
        result: '郎中脸色难看，但还是丢给你一枚凝气丹打发你走。',
      },
      {
        label: '洗劫药箱',
        desc: '一个郎中而已。',
        requiresKarmaAtMost: -40,
        effect: { karma: -15, items: { moonDew: 10, starSand: 3, coldJade: 12 }, pills: { foundationPill: 2 } },
        result: '药箱里的东西比你想象中多得多。郎中瘫在树下没敢吭声。',
      },
    ],
  },
  {
    id: 'spiritBeast',
    name: '受伤的灵兽',
    icon: '🦊',
    desc: '一只雪白的灵狐后腿被兽夹咬住，见你靠近，警惕地低吼，却没有逃。',
    scope: 'player',
    weight: 8,
    options: [
      {
        label: '为它疗伤',
        desc: '渡灵气、拆兽夹。',
        requiresItems: { qi: 8000 },
        effect: { karma: 12, items: { qi: -8000, spiritSilk: 150 } },
        result: '灵狐舔了舔你的手，转身钻进林子，片刻后叼着一大团灵蚕丝回来。',
      },
      {
        label: '取其内丹',
        desc: '一只灵狐的内丹，能换不少好东西。',
        requiresKarmaAtMost: -30,
        effect: { karma: -18, items: { demonCore: 400, fireMarrow: 20 } },
        result: '灵狐至死都没再发出声音。',
      },
      {
        // 这个"不做任何事"的选项是必须的：没有它，灵气不够、又不够恶的玩家
        // 会卡在这个遭遇上永远点不掉，后续所有遭遇也被一起挡住。
        label: '绕开',
        desc: '它有它的命，你有你的路。',
        effect: { karma: 0 },
        result: '你绕了过去。身后传来一声低低的呜咽，很快被风吹散了。',
      },
    ],
  },
  {
    id: 'oldFarmer',
    name: '问路老农',
    icon: '👨‍🌾',
    desc: '一个扛着锄头的老农在岔路口张望，见你过来，小心翼翼地问哪条路通向镇上。',
    scope: 'player',
    weight: 9,
    options: [
      {
        label: '指点迷津',
        desc: '顺手的事。',
        effect: { karma: 5, items: { stone: 150 } },
        result: '老农千恩万谢，硬塞给你一小串铜钱换的灵石。',
      },
      {
        label: '恐吓问路',
        desc: '让他把身上的东西都交出来。',
        effect: { karma: -8, items: { stone: 400 } },
        result: '老农哆嗦着把怀里的灵石全掏了出来。',
      },
    ],
  },
];

export const ENCOUNTER_MAP: Record<string, EncounterDef> = ENCOUNTERS.reduce(
  (acc, e) => {
    acc[e.id] = e;
    return acc;
  },
  {} as Record<string, EncounterDef>,
);

/* ------------------------------------------------------------------ */
/* 宗门事件（需求 1：开宗后才会遇到，其中进攻类必须结算）                */
/* ------------------------------------------------------------------ */

/**
 * 需求原文：
 *   「随机事件开宗后也会遇到，只是会增加针对宗门的事件，比如遇到匪徒进攻宗门等，
 *     宗门新增宗门大阵等防御设施，能减少乃至避免弟子伤亡。
 *     针对玩家的随机事件持续30秒，若不做出选择则会自动消失，
 *     针对宗门的进攻类随机事件正常进行和结算，其余也消失，没有影响」
 *
 * 所以宗门事件分两类：
 *   - **进攻类**（`attack` 非空）：到点不选也照常结算，损失由「宗门防御」减免；
 *   - **其余**：到点就消失，没有影响（和玩家事件一样）。
 *
 * `attack.power` 是 0~1 的强度，结算时还要乘上「掌门境界系数」——
 * 否则开宗初期的一场匪患和渡劫期的一场匪患一样疼，那就没意义了。
 */
export const SECT_ENCOUNTERS: EncounterDef[] = [
  {
    id: 'banditSiege',
    name: '匪徒围攻山门',
    icon: '🏴',
    scope: 'sect',
    desc: '一伙散修聚在上下山的必经之路上，扬言要"借"些灵石。人不少，但看得出没什么高手。',
    attack: { power: 0.3, desc: '匪徒冲进外门，抢走了库房里的东西，也有弟子在混战中受伤。' },
    weight: 12,
    options: [
      {
        label: '掌门亲自迎敌',
        desc: '露一手，让他们知道这里是谁的地方。',
        effect: { karma: 4, injury: 90 },
        result: '你只出了一招，匪首就跪下了。其余人作鸟兽散。',
      },
      {
        label: '关闭山门死守',
        desc: '靠阵法拖到他们自己散去。',
        requiresItems: { stone: 600 },
        effect: { karma: 0, items: { stone: -600 } },
        result: '山门紧闭三日，匪徒抢不到东西，骂骂咧咧地走了。',
      },
      {
        label: '花钱消灾',
        desc: '破财免灾，弟子要紧。',
        requiresItems: { stone: 3000 },
        effect: { karma: -4, items: { stone: -3000 } },
        result: '你丢出一袋灵石，匪首掂了掂，笑着带人走了。',
      },
    ],
  },
  {
    id: 'beastTide',
    name: '兽潮来袭',
    icon: '🐗',
    scope: 'sect',
    desc: '后山的妖兽不知为何成群结队地往下冲，灵田和药圃首当其冲。',
    attack: { power: 0.45, desc: '兽群踏平了两片灵田，巡山的弟子被撞伤了好几个。' },
    weight: 10,
    options: [
      {
        label: '布阵驱兽',
        desc: '把大阵开到最大，用阵光把它们逼回去。',
        requiresItems: { qi: 20000 },
        effect: { karma: 3, items: { qi: -20000 } },
        result: '阵光如墙，兽群撞了几次就转向了。',
      },
      {
        label: '带弟子围猎',
        desc: '既是祸事，也是一批妖丹。',
        effect: { karma: 1, items: { demonCore: 600 }, injury: 60 },
        result: '一场围猎下来，兽潮退了，库房里多了几百枚妖丹。',
      },
      {
        label: '弃田保人',
        desc: '灵田没了可以再开，弟子没了就是没了。',
        effect: { karma: 5, items: { herb: -4000 } },
        result: '你把人都撤回了内门。灵田被糟蹋得不成样子，但没人受伤。',
      },
    ],
  },
  {
    id: 'demonCultivator',
    name: '魔修叩山',
    icon: '👹',
    scope: 'sect',
    desc: '一个浑身血气的中年修士停在山门外，既不进门也不走，只是笑："听说这里新立了宗门？"',
    attack: { power: 0.6, desc: '那人在山门内走了一圈，打伤数名弟子，还卷走了一批材料。' },
    weight: 7,
    options: [
      {
        label: '开阵迎战',
        desc: '请君入瓮。',
        effect: { karma: 2, injury: 240 },
        result: '大阵一开，那人脸色变了。恶战一场，他被逼退，山门无恙。',
      },
      {
        label: '以礼相待',
        desc: '摸不清底细之前，不急着翻脸。',
        requiresItems: { starSand: 20, lunarCrystal: 2 },
        effect: { karma: -2, items: { starSand: -20, lunarCrystal: -2 } },
        result: '你送了他一批材料。他挑了挑眉转身走了 —— 但你记住了这张脸。',
      },
      {
        label: '遣散弟子避祸',
        desc: '把人都撤走，随他在山里折腾。',
        requiresItems: { qi: 50000 },
        effect: { karma: 0, items: { qi: -50000 } },
        result: '宗门空了三天。他什么也没捞到，走时踢翻了一座石灯。',
      },
    ],
  },
  {
    id: 'tribute',
    name: '附庸来朝',
    icon: '🎁',
    scope: 'sect',
    desc: '山下几个小家族派人抬着箱子来贺，说是"仰慕仙门已久"。',
    weight: 11,
    options: [
      {
        label: '收下贡品',
        desc: '他们求的是庇护，收下就等于应了。',
        effect: { karma: -3, items: { stone: 8000, blackIron: 200, spiritSilk: 150 } },
        result: '箱子抬进了库房。几家人喜出望外，此后岁岁来朝。',
      },
      {
        label: '回赠灵石，两不相欠',
        desc: '不结这个因果。',
        requiresItems: { stone: 2000 },
        effect: { karma: 8, items: { stone: -2000, herb: 3000 } },
        result: '你把灵石按价回赠，只收下几筐灵草。几家人反倒更敬重你。',
      },
    ],
  },
  {
    id: 'spiritVeinSurge',
    name: '灵脉暴涨',
    icon: '💥',
    scope: 'sect',
    desc: '地底灵脉忽然翻涌，山中灵气浓度一炷香内涨了三成 —— 但这样涨下去，灵脉会伤。',
    weight: 9,
    options: [
      {
        label: '全力吸纳',
        desc: '送到嘴边的灵气，不吃白不吃。',
        effect: { karma: -4, items: { qi: 400000 } },
        result: '全宗弟子一起打坐，一夜之间灵气暴涨。至于灵脉……以后再说。',
      },
      {
        label: '疏导灵脉',
        desc: '少拿一些，让它细水长流。',
        effect: { karma: 6, items: { qi: 120000 } },
        result: '你带人疏通了地脉。灵气只取三成，但这座山还能再用几百年。',
      },
    ],
  },
  {
    id: 'discipleDispute',
    name: '弟子争端',
    icon: '⚖',
    scope: 'sect',
    desc: '两名内门弟子在演武场上动了真火，一人被打成重伤。两边各有各的说法。',
    weight: 9,
    options: [
      {
        label: '依门规严惩',
        desc: '重罚动手的那个，以儆效尤。',
        effect: { karma: -2, items: { stone: 500 } },
        result: '你当着全宗的面废了那人的一条经脉。此后半年，演武场再没人敢下重手。',
      },
      {
        label: '各打五十大板',
        desc: '谁也别觉得自己占理。',
        effect: { karma: 4 },
        result: '两人都被罚去后山砍了三个月的柴。伤者养好之后，两人反倒成了朋友。',
      },
    ],
  },
];

ENCOUNTERS.push(...SECT_ENCOUNTERS);
for (const e of SECT_ENCOUNTERS) ENCOUNTER_MAP[e.id] = e;

/** 只抽玩家事件（未开宗时只能遇到这些） */
export function playerEncounters(): EncounterDef[] {
  return ENCOUNTERS.filter((e) => e.scope === 'player');
}

/** 只抽宗门事件 */
export function sectEncounters(): EncounterDef[] {
  return ENCOUNTERS.filter((e) => e.scope === 'sect');
}

/** 是不是进攻类（需求 1：这类到点不选也必须结算） */
export function isAttackEncounter(def: EncounterDef): boolean {
  return def.attack !== undefined;
}

/** 某选项当前是否可选（只做"够不够格 / 付不付得起"的判断，不涉及随机） */
export function optionRequiredItems(option: EncounterOption): Partial<Record<ItemId, number>> {
  if (option.requiresItems) return option.requiresItems;
  const need: Partial<Record<ItemId, number>> = {};
  for (const [item, amount] of Object.entries(option.effect.items ?? {})) {
    if ((amount as number) < 0) need[item as ItemId] = -(amount as number);
  }
  return need;
}

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

export interface EncounterDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
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

/** 某选项当前是否可选（只做"够不够格 / 付不付得起"的判断，不涉及随机） */
export function optionRequiredItems(option: EncounterOption): Partial<Record<ItemId, number>> {
  if (option.requiresItems) return option.requiresItems;
  const need: Partial<Record<ItemId, number>> = {};
  for (const [item, amount] of Object.entries(option.effect.items ?? {})) {
    if ((amount as number) < 0) need[item as ItemId] = -(amount as number);
  }
  return need;
}

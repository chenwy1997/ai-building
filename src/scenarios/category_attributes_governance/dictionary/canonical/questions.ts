/**
 * Open questions raised during dictionary work.
 *
 * The point of this file is that no question is allowed to block on a role that may not
 * exist. Every entry carries who can actually answer it, what evidence is already
 * attached, and a default decision that takes effect if nobody adjudicates. A question
 * that is measurable from data already on hand must be measured before it is put to a
 * person: sending `配件类型` to a "category expert" was exactly that mistake, and the
 * measurement reversed the initial judgement.
 */

export type Kind = '概念口径' | '可实测' | '业务归属' | '行业事实';
export type Answerer = '标准资料' | '现有数据实测' | '业务负责人' | '供应商';

export interface OpenQuestion {
  id: string;
  subject: string;
  question: string;
  kind: Kind;
  answerableBy: Answerer;
  /** Evidence already gathered. Required for 可实测 so it cannot be escalated unmeasured. */
  evidence: string[];
  /** What happens if nobody adjudicates. Must never be "wait". */
  defaultDecision: string;
  /** Whether the default can be undone later without redoing work. */
  reversible: boolean;
  reversibleBecause: string;
  impact: { leafCategories: number };
  resolution?: { verdict: string; by: string; at: string };
}

export interface QuestionSet {
  schema: 'sanheng-open-questions-v1';
  questions: OpenQuestion[];
}

export function validateQuestions(set: QuestionSet): void {
  if (set.schema !== 'sanheng-open-questions-v1') throw new Error('未知待裁定清单格式');
  const ids = new Set<string>();
  for (const question of set.questions) {
    if (ids.has(question.id)) throw new Error(`待裁定编号重复: ${question.id}`);
    ids.add(question.id);
    if (!question.question.trim() || !question.subject.trim()) throw new Error(`待裁定缺少主题或问题: ${question.id}`);
    // A default is what keeps the process from stalling on an absent role.
    if (!question.defaultDecision.trim()) throw new Error(`待裁定必须有默认结论，不允许以等待作为状态: ${question.id}`);
    if (!question.reversible) {
      throw new Error(`默认结论不可逆不允许自动生效，须改为保守可逆的默认: ${question.id}`);
    }
    if (!question.reversibleBecause.trim()) throw new Error(`必须说明默认结论为何可逆: ${question.id}`);
    // Anything answerable from data on hand must be measured before a person is asked.
    if (question.kind === '可实测' && !question.evidence.length) {
      throw new Error(`可实测的问题必须先附实测证据再上报: ${question.id}`);
    }
    if (question.answerableBy === '现有数据实测' && question.kind !== '可实测') {
      throw new Error(`标为现有数据实测的问题类型应为可实测: ${question.id}`);
    }
    const resolution = question.resolution;
    if (resolution && (!resolution.verdict.trim() || !resolution.by.trim() || !resolution.at.trim())) {
      throw new Error(`已裁定的问题必须记录结论、裁定人和日期: ${question.id}`);
    }
  }
}

export const pending = (set: QuestionSet) => set.questions.filter((question) => !question.resolution);

/**
 * Settled rulings, in the form the mounting stage needs. Without these a branch re-reports
 * concepts the dictionary already decided against — the grease pilot filed 防扩散性能 and
 * 降噪性能等级 as gaps, both of which q-功能 had already ruled out as claims without a single
 * test method. A ruling is only a decision if the next stage can see it.
 */
export const rulings = (set: QuestionSet) =>
  set.questions
    .filter((question) => question.resolution)
    .map((question) => ({ 编号: question.id, 涉及: question.subject, 裁定: question.resolution!.verdict }));

const questions: OpenQuestion[] = [
  {
    id: 'q-规格',
    subject: '历史属性名「规格」（546个末级类目，469个变体）',
    question: '「规格」下至少有药品剂量规格、包装规格、公称尺寸、型号代号四种含义，各自应拆到哪些标准属性？',
    kind: '可实测',
    answerableBy: '现有数据实测',
    evidence: [
      '按一级类目实测1090条候选：医药相关352(32%)、五金工具169(16%)、实验室及化学用品137(13%)、生活福利118(11%)、办公用品78(7%)、电气类34(3%)，共23个一级类目',
      '医药类的写法直接给出拆法：药品规格如0.5g*24片、10g:0.1g、每袋装6克、每丸重9克；以及每盒支数、瓶装粒数、每盒袋数',
      '「10g:0.1g」是软膏总量比主药含量，复方制剂还需列全多个活性成分：单剂量含量无法压成一个数值，全部1090条的格式提示均为「开放文本；按实际资料填写」',
      '五金类：公称规格或适用尺寸24、扳手开口尺寸6、规格型号如开口尺寸6、垫圈规格M12/M16共4、批头规格1.5mm共4',
      '办公用品类含幅面或开本代号的14条：A4、A5、B5、16开、8开',
      '「配件/耗材/备件/附件的规格尺寸或参数」这类纯占位写法实测102条占9%，分散在行业商品、气动液压、办公设备、焊接、仪器仪表等类目',
      '中药材特有写法不足10条：统货/选货/等级、贵细中药材的支数与头数、中药饮片的片厚与大小',
    ],
    defaultDecision:
      '暂不进入标准字典。按一级类目分派实测各含义占比后再拆：医药类拟新增剂量规格与装量两条属性，包装含义映射到已有包装形式与单包装内数量，五金类映射到公称尺寸类属性。实测完成前该名称保留在候选层不发布。',
    reversible: true,
    reversibleBecause: '候选层 candidates_v1 保留了全部546个类目的原始写法与出处，任何时候都能按新结论重新映射，不需要重新取证。',
    impact: { leafCategories: 546 },
    resolution: {
      verdict:
        '实测推翻了原假设。「规格」不是四个含义各拆一条，而是各一级类目下的一个占位名，含义等于「本类目最主要的那个规格参数」，'
        + '因此以映射到已有属性为主：装量归单包装内数量、净含量归内容物净质量或净体积、五金的M12归螺纹代号、型号部分归制造商型号。'
        + '实测只暴露出三个已有属性无法承接的真概念，已新增：药品规格（文本，按药典原文，因10g:0.1g与复方制剂无法压成数值）、'
        + '对边或开口尺寸、纸张幅面代号。占9%的「配件规格尺寸或参数」纯占位写法裁定为不给属性，须在挂载阶段改填该配件的具体属性。'
        + '浓度部分因量纲可变移交 q-区间值类型；中药材的等级与头数体系证据不足10条，留待医药行业包单独立项。'
        + '决定文件 batch-0001.json 已按此改为拆分，并连带解除了 batch-0002.json 中「规格尺寸」的阻塞条件。',
      by: '现有数据实测',
      at: '2026-09-17',
    },
  },
  {
    id: 'q-适用场景',
    subject: '历史属性名「适用场景」（452个末级类目，644个变体）',
    question: '「适用场景」描述的是客户现场条件而非商品固有属性，同一商品在不同场景下取值会变。平台是否需要它作为可筛选属性保留？',
    kind: '业务归属',
    answerableBy: '业务负责人',
    evidence: [
      '取值样本跨度极大：办公、卫生间、厨房餐饮、商用健身房、冰面/雪地、出租房配置、办公楼玻璃',
      '644个变体中多数写法为「推荐使用场景」「主要应用场景」，属推荐用途而非规格',
      '流程说明-v3 已区分产品固有属性与客户现场条件，后者不作为需要补齐的商品属性',
    ],
    defaultDecision:
      '不进入标准字典，保留在候选层。它是营销与检索标签，不是选型规格；若业务确认需要按场景筛选，应作为独立的运营标签体系管理，而不是混进属性模板。',
    reversible: true,
    reversibleBecause: '仅是不发布，候选层原始记录与452个类目的对应关系完整保留；若业务决定需要，可直接从候选层建标签体系。',
    impact: { leafCategories: 452 },
    resolution: { verdict: '不进入标准字典，按默认结论执行。', by: '业务负责人', at: '2026-09-17' },
  },
  {
    id: 'q-区间值类型',
    subject: '字典缺少区间值类型与量纲可变的承载方式（影响「测量范围」304个末级，以及测量分辨率、浓度等同类属性）',
    question:
      '量程、测量范围这类属性既是区间值，量纲又随所测的量而变（压力MPa、温度℃、浓度mg/L、尺寸mm）。契约规定每条属性只有一个物理量，应如何承载？',
    kind: '概念口径',
    answerableBy: '标准资料',
    evidence: [
      '「测量范围」408个变体：可测量的压力区间如0~1.6MPa、测量温度范围℃、可测量的浓度或量程范围、可测量的尺寸范围',
      '「工作温度」量纲固定为℃，本批已拆成上下限两条数值属性，说明区间本身可拆，难点只在量纲可变',
      'dictionary/方法与验收.md 已记载该缺口：温度范围、多维结构等后续需扩展正式值类型，本版不强行挤入一个数值',
      'ETIM 对区间与量纲有独立的值类型与单位管理，可作为结构参考',
      'q-规格 实测移交：实验室类「包装规格或浓度规格」中的浓度部分14条同属此缺口——mol/L、质量分数%、ppm 是不同物理量，不是同一量的不同单位',
    ],
    defaultDecision:
      '暂不进入标准字典。量纲固定的情形先行落地（工作温度上下限已完成），量纲可变的情形保持在候选层。下一版扩展区间值类型时按「被测量的量」建立属性族，每个量一对上下限属性，而不是用一条文本属性承载全部。',
    reversible: true,
    reversibleBecause: '现在是不发布而非发布错误定义；候选层保留全部原始区间写法，扩展值类型后可按新结构重新映射，不需重新取证。',
    impact: { leafCategories: 304 },
    resolution: {
      verdict:
        '两个子问题的答案不同，标准资料与实测各解一半。'
        + '（一）区间：ETIM 把区间定为独立值类型 R（闭区间 [a..b]，两个数值共用一个单位），eCl@ss 用同一条数值属性的 min/max level，'
        + '两个标准都不把区间拆成两条属性；ETIM 导则并明确要求「优先使用数值、布尔、区间类型，不要新建字母数字型」，即反对退回文本。'
        + '已在契约新增 range 类型，并把原来拆成上下限两条的工作温度与控温范围各合并为一条区间属性——拆开时类目只挂一侧在契约上完全合法，是个结构漏洞。'
        + '（二）量纲随类目而变：两个标准在此分歧。ETIM 把单位绑定在「类目×特征」的配对上（导则第769行），因此同一条「测量范围」特征在不同类目可用不同单位；'
        + 'eCl@ss 则规定一条数值属性绑定一个物理量，备选单位必须同量纲。我们采用 eCl@ss 的规则：挂载由模型完成，'
        + '若单位留到挂载时决定，模型要多做一次选择，且跨类目取值不读单位就无法比较。'
        + '因此按被测量的量分列属性，已新增测量范围（温度）、（长度）、（压力）三条区间属性。'
        + '实测608条候选跨约13个量、显式带单位仅30条、65%（394条）连被测量是什么都没写——这部分不是概念分歧而是原始记录缺信息，'
        + '末级类目本身知道自己的仪器测什么，交由挂载阶段选对应属性，字典不为「不知道测什么」保留一条属性。'
        + '浓度、硬度、pH 等量的量程须先在对应行业包里把单位与量纲定清楚再建，浓度本身还跨物理量（mol/L 与质量分数% 不是同一个量）。',
      by: '标准资料',
      at: '2026-09-17',
    },
  },
  {
    id: 'q-功能',
    subject: '历史属性名「功能」（249个末级类目，421个变体）',
    question:
      '「功能」取值是并列多值特性（速干/透气/防晒），其中相当一部分本应是各自独立的布尔属性（火力调节/预约定时/水量可调）。保留为运营标签，还是要求逐项拆成布尔属性？',
    kind: '业务归属',
    answerableBy: '业务负责人',
    evidence: [
      '实测：497条候选中取值与末级类目名完全重合仅1条，不重合156条，无枚举314条',
      '取值样本：高尔夫服饰→速干/透气/防晒/防水/弹力；玻璃水→去油膜/清洁/防冻/除虫胶；煎药壶→火力调节/预约定时/水量可调/文武火可调',
      '与「细分类型」的区别：后者是单一归属，本属性是特性清单，两者不可合并',
      '与「尺寸」同为打包反模式，但拆解目标随类目而变，字典层无法枚举',
    ],
    defaultDecision:
      '不进入标准字典，保留在候选层。打包成一个文本会失去可筛选性；各类目若确需某项功能，应在该类目挂载时作为独立布尔属性提出，由字典按需新增标准定义。若业务需要粗粒度特性标签用于检索，应作为运营标签体系管理，不混进属性模板。',
    reversible: true,
    reversibleBecause: '候选层保留全部249个类目的原始取值，既可用于抽取独立布尔属性，也可用于建标签体系，不需重新取证。',
    impact: { leafCategories: 249 },
    resolution: {
      verdict:
        '不采用一刀切，按实测的两个子类型分开处理。'
        + '（一）有单一国标测试方法可量化的进字典做正式属性，本次收证据量最大的三项：透气52次→GB/T 5453 透气率（mm/s）、'
        + '防水27次→GB/T 4744 耐静水压（mmH₂O）、防晒6次与防紫外线4次→GB/T 18830 的 UPF 等级。'
        + '（二）测试方法随材料分多套体系的留待对应行业包：防滑28、耐磨22、保暖16、防静电8、阻燃7、抗菌与杀菌消毒32——'
        + '耐磨在纺织用马丁代尔次数、鞋底用DIN磨耗体积、涂层用泰伯法，阻燃在服装、塑料、建材各有一套等级体系，'
        + '与浓度、硬度是同一处问题，须先定清测试方法与量纲再建；杀菌消毒属受监管的卫生宣称，另按合规属性处理。'
        + '（三）纯勾选项与作用宣称不进字典：清洁、去污、除味、定时、预约、摆叶、轻便等约150次，各类目确需某项时在挂载阶段作为独立布尔属性提出。'
        + '须特别记录：本次映射发生在概念层而非取值层——历史取值「防水」只说明该属性适用、不给出取值，供应商须补测耐静水压数值。'
        + '这与「粘度」不收高/中/低粘、「硬度」不收硬/中是同一条原则：没有测试方法与标尺的标签不构成可比取值。',
      by: '业务负责人',
      at: '2026-09-17',
    },
  },
];

export const openQuestions: QuestionSet = { schema: 'sanheng-open-questions-v1', questions };

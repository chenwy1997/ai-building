import type { Dimension } from '../mounting.ts';

/**
 * Branch mounting: turn a frozen dictionary into one branch's attribute template.
 *
 * The dictionary answers "what does this property mean"; this stage answers "which
 * properties does this category carry". Keeping them apart is what makes the second
 * question cheap enough to hand to a weaker model: the task is selection from a facet
 * shortlist of a few dozen candidates, never open-ended authoring. Anything the branch
 * needs but the shortlist cannot express is reported as a gap rather than invented, so a
 * failed mounting is evidence about the dictionary instead of a silent bad template.
 */
export interface BranchSpec {
  /** Path below the root node, e.g. ['泵、阀及管路','金属管材管件','法兰']. */
  branchPath: string[];
  /** Retrieval labels; their union is the candidate shortlist shown to the model. */
  facets: string[];
  /** Dimensions a leaf must cover or `inspectLeaf` reports 缺维度. */
  requiredDimensions: Dimension[];
  /** Why this branch was chosen as a pilot, and what defect it is meant to expose. */
  premise: string;
}

/**
 * Pilot branch. Flanges are 16 leaves of one part that differ only in how they join the
 * pipe, so the base-plus-delta model should hold almost completely. The historical
 * delivery instead gave them a mean sibling Jaccard of 0.66 and put 压力等级 on exactly
 * one of the 16 — a flange without a pressure rating is not a flange, so the defect is
 * measurable rather than a matter of taste.
 */
export const flangeBranch: BranchSpec = {
  branchPath: ['泵、阀及管路', '金属管材管件', '法兰'],
  facets: ['通用', '实物', '管路', '流体', '紧固件', '配件', '兜底类目'],
  requiredDimensions: ['身份', '接口', '材质'],
  premise:
    '16个末级类目是同一种零件的不同连接形式，共享属性应当接近全集。历史交付里只有品牌、材质、执行标准是16个兄弟都有的，压力等级只挂在1个兄弟上，公称通径缺7个——用分支模板重挂，兄弟间差异必须写明理由才能存在。',
};

/**
 * Second-round pilots, chosen so each one exercises a judgement made during the dictionary
 * batches. If a deferral was wrong, mounting surfaces it as a gap on a branch that plainly
 * needs the property, which is a stronger signal than re-reading the deferral's reasoning.
 */
export const coldWeatherBranch: BranchSpec = {
  branchPath: ['个人防护', '身体防护', '防寒服'],
  facets: ['通用', '实物', '穿戴', '织物', '防护', '配件', '兜底类目'],
  requiredDimensions: ['身份', '材质'],
  premise:
    '检验 q-功能 的裁定。当时只收了透气率、耐静水压、UPF 三项有单一国标测试方法的，把保暖判为「测试方法分多套体系，留待行业包」。防寒服若确实需要保暖参数而字典给不出，这条 defer 就站不住。同时这是离五金最远的形态：没有通径、没有压力等级，考验通用/实物标签拆分之后穿戴类还召不召得回该有的属性。',
};

export const pressureMeasurementBranch: BranchSpec = {
  branchPath: ['仪器仪表', '过程仪表', '压力测量'],
  facets: ['通用', '实物', '仪器', '仪表', '管路', '流体', '电气', '工控', '配件', '兜底类目'],
  requiredDimensions: ['身份', '性能', '接口'],
  premise:
    '行使 q-区间值类型 的裁定。当时按 eCl@ss 的一量一属性建了「测量范围（压力）」区间属性，并把量程与测量精度的配对判为过强而撤掉。压力仪表是量程属性最该被用上的地方：模型若不选它而去申报缺口，说明区间属性的选用说明没写清。',
};

export const plasticGreaseBranch: BranchSpec = {
  branchPath: ['实验室及化学用品', '润滑脂', '塑料润滑脂'],
  facets: ['通用', '实物', '化学', '润滑', '流体', '密封', '配件', '兜底类目'],
  requiredDimensions: ['身份', '性能'],
  premise:
    '检验第 3 批对 性能等级 的 defer。当时以「润滑脂等级体系多套、量纲不统一」为由未收。塑料润滑脂同时会用到粘度、闪点、使用温度范围三条已建属性，可一并验证化学品语境下这些属性够不够用。',
};

export const branches: Record<string, BranchSpec> = {
  法兰: flangeBranch,
  防寒服: coldWeatherBranch,
  压力测量: pressureMeasurementBranch,
  塑料润滑脂: plasticGreaseBranch,
};

const protocol = `你在为一个类目分支挂载标准属性。

规则：
1. 只能从「候选属性」里选。候选集是按分支的召回标签从冻结字典里取出的，不在其中的属性一律不得选用。
2. 不得发明属性ID，不得改写候选属性的定义、类型、单位或描述对象。定义是冻结的。
3. 分支需要、但候选集里没有任何属性能表达的选型需求，写进 gaps。gaps 是对字典的缺口申报，不是挂载结果。
   缺口的 need 与 object 不得写进类目名。描述对象是零件部位（如「法兰密封面」），不是商品（如「平焊法兰的密封面」）——
   同一个部位换个商品名写一遍，就会被当成两个缺口，历史模板里「材质」裂成四千个变体正是这么来的。
4. 每条选择都要写 rationale：为什么这个末级类目需要它。理由要落在这个分支的选型或采购决策上，不能是「常见属性」这类空话。
5. requirement 三档：required 缺失即为缺陷；conditional 只在特定情形必填，必须同时给 condition；optional 有则填。
6. 历史证据是历史模板的忠实聚合。历史上有不代表该有，历史上没有不代表不该有，出现频次不证明必填。判断依据是这个分支的选型逻辑。
7. 候选属性里标了「同需求多口径」的，正常只挂一个。代号（如DN、PN）和实测值（如mm）是两种口径，同时挂载须在 rationale 里说明为什么两者都要。
8. 只输出 JSON，不要代码块标记，不要解释性文字。`;

export const baseSystem = `${protocol}

本轮任务：为分支定出「基础属性集」——分支下每个末级类目都应当携带的属性。

判据是：这个属性对分支里绝大多数末级类目都是同一个选型需求。个别末级类目不适用的，仍然放进基础集，下一轮由该末级类目写明理由删除；只对少数末级类目成立的，不要放进基础集，留到下一轮各自新增。

输出格式：
{"base":[{"propertyId":"sh.xxx.yyy","requirement":"required|conditional|optional","condition":"仅conditional时给出","rationale":"为什么这个分支需要它"}],
 "gaps":[{"need":"缺口的属性名","object":"描述对象","why":"为什么候选集里没有一个能表达","historicalNames":["对应的历史属性名"],"leaves":["需要它的末级类目"]}]}`;

export const leafSystem = `${protocol}

本轮任务：为一个末级类目写出它相对基础属性集的差异。

只写差异。基础集里已有且策略不变的属性不要重复列出。差异要能被这个末级类目和它兄弟的区别解释——若解释不出区别，就不该有差异，这正是历史交付漂移的来源。

- add：这个末级类目独有的属性。仍然只能从候选集里选，且不能是基础集里已有的。
- remove：基础集里的属性对这个末级类目确实不成立。reason 要说明为什么这个末级类目不同于兄弟，不能写「不适用」。
- override：属性保留但必填策略要改。reason 同上。

输出格式：
{"add":[{"propertyId":"sh.xxx.yyy","requirement":"required|conditional|optional","condition":"仅conditional时给出","rationale":"为什么只有这个末级类目需要"}],
 "remove":[{"propertyId":"sh.xxx.yyy","reason":"为什么这个末级类目不同于兄弟"}],
 "override":[{"propertyId":"sh.xxx.yyy","requirement":"required|conditional|optional","condition":"仅conditional时给出","reason":"为什么策略要改"}],
 "gaps":[{"need":"缺口的属性名","object":"描述对象","why":"为什么候选集里没有一个能表达","historicalNames":["对应的历史属性名"],"leaves":["本末级类目"]}]}`;

/**
 * Gap consolidation. Leaves report gaps independently, so one missing property arrives as
 * several reports under different names — the same drift the dictionary batches exist to
 * undo. Merging is semantic and therefore stays with the model; the program only keeps the
 * raw reports alongside the merged result so a merge can always be traced back and undone.
 */
export const gapSystem = `你在归并同一个分支下各末级类目独立申报的「字典缺口」。

各末级类目是分别申报的，同一个缺口会以不同名字、不同措辞出现多次。每条申报都带唯一序号，你用序号引用它们。

判据：
1. 描述对象相同、测量口径相同，就是同一个缺口。把类目名写进描述对象不构成新概念——「平焊法兰的密封面」和「法兰盖的密封面」都是「法兰密封面」，是一个缺口。
2. 描述对象不同则必须分开。「法兰盘厚度」和「管壁厚度」测的不是同一处，不能并。
3. 代号体系与实测值是两个缺口。真空法兰的 KF/CF 规格代号与法兰盘厚度的毫米值不能并。
4. 归并后要给出建议的值类型：text（代号、牌号、分类）、number（可运算的量）、integer（计数）、boolean（是否）、range（区间）。
   number/integer/range 都必须给物理量与单位，这是字典的既有约束。计数照字典现有约定写 quantity="count"、units=["个"]，
   长度写 quantity="length"、units=["mm"]。text 与 boolean 不得带物理量或单位。
5. 不确定能不能并的，宁可分开并在 note 里写明疑虑。并错了会污染字典，分开只是多一条待裁定。
6. 有的申报其实不是缺口，放进 notGaps 并写明被哪条现有属性覆盖。这不是缺字典，是引导的选用说明该放宽，两者处理完全不同。
   三种情形都算：一是申报理由里已经说了「候选集中虽有某属性，但……」；二是对照「各末级实际挂载结果」，
   申报的末级类目其实已经挂上了能表达它的属性——既然挂上了就不缺，只是选用说明让它挂得不确定；
   三是**该属性在「全字典属性一览」里存在，只是没进本分支的候选集**——末级类目当时看不到它，所以只能报缺口，
   这是召回标签没覆盖到，属于引导缺陷。请务必逐条比对全字典一览再判定，这一类最容易被误当成真缺口。
7. 「已裁定事项」是字典阶段已经作出并生效的裁定。命中裁定的申报放进 ruledOut，写明命中哪条裁定编号、以及按该裁定
   这个末级类目应当怎么办。重复申报一个已被否掉的概念不是新发现，只会让裁定失效。
   尤其注意 q-功能 那条裁定：它已经指定挂载阶段就是类目级布尔属性的申报入口，所以凡是「是否具备某功能/某作用」
   这种定性宣称（防水、防风、阻燃、防扩散、降噪、防滑、耐磨、保暖、抗菌这类），一律进 ruledOut 并写明
   按 q-功能 应作为该末级类目的独立布尔属性提出。注意字典里已有对应的实验室量化属性（如耐静水压、透气率、UPF）
   并不妨碍这条：量化指标与「是否具备」是两个口径，裁定要的就是后者走类目布尔这条路。
   反过来，可测量的物理量缺失（充绒量多少克、蓬松度多少 cm³/g、滴点多少 ℃）是真缺口，进 gaps，别混进来。
8. 三个桶对应三种完全不同的后续动作，不要混：gaps 要往字典里加属性；notGaps 要放宽现有属性的引导；
   ruledOut 什么都不加，按已有裁定处理。
9. 每一条原始申报的序号都必须出现在 gaps、notGaps 或 ruledOut 之中，恰好一次。不得丢弃任何一条。

输出格式：
{"gaps":[{"need":"归并后的缺口名","object":"描述对象（部位，不带类目名）","type":"text|number|integer|boolean|range","quantity":"number/integer/range时给物理量，否则null","units":["建议单位符号，非数值给空数组"],"why":"为什么字典需要补这一条","from":[原始申报序号],"note":"归并疑虑或裁定提示，无则空字符串"}],
 "notGaps":[{"from":[原始申报序号],"coveredBy":"已能覆盖它的现有属性ID","why":"为什么该属性已经覆盖，以及它的选用说明为何没让末级类目选中它"}],
 "ruledOut":[{"from":[原始申报序号],"ruling":"命中的裁定编号","why":"该裁定怎么说，以及这个末级类目按裁定应当怎么办"}]}

只输出 JSON，不要代码块标记。`;

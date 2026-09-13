import type { CategoryNode, AttributeProperty } from "./types.ts";
import { shortCategoryId } from "./util.ts";

export const CATEGORY_GOVERNANCE_SYSTEM_PROMPT = `你是商品类目治理专家，负责为三横标准类目设计可落地的商品属性模板。

规则：
1. 只依据类目层级、给出的参考证据和行业常识推断，不编造品牌、认证、型号或无法验证的固定枚举；不确定的枚举输出空数组，并在 notes 说明。
2. 属性要服务于商品识别、检索、报价、采购和合规。区分类目共有属性和当前末级类目属性，避免把价格、库存、供应商等交易字段当成类目属性。
3. 属性名称使用业务常用中文，key 使用稳定的 snake_case；同义属性只保留一个。相同语义即使单位不同也尽量复用 key，只有业务含义确实不同才拆分。
4. 必填只给通常能从商品资料获得、且对识别或合规关键的字段；品牌、型号默认可选，不能因为常见就自动标为必填。
5. type 只能是 text、number、boolean、single、multi、date、file。number 尽量给 unit；single/multi 才填写 options。参考证据中的字段和枚举只是候选，必须结合当前类目判断。
6. 输出严格为 JSON，不要 Markdown、解释性前后缀或代码围栏。使用下面约定的 a/c 紧凑结构，每个目标类目必须有且只有一条结果。
7. a 是本批次属性字典：相同的完整十元组只定义一次；c 的 key 是输入中的短 category_id，值为 [shared属性引用, category属性引用, notes]。
8. 属性十元组顺序固定为 [0:key,1:name,2:type代码,3:required,4:unit,5:options,6:description,7:format,8:example,9:scope]，不要增加或省略位置；type代码 t=text、n=number、b=boolean、s=single、m=multi、d=date、f=file；required 必填写"*"，非必填写""。
9. 有量纲的 number 属性（例如尺寸、容量、内存、电池、重量、长度、宽度、高度、厚度、电压、功率、速度、频率、直径）必须把单位写入 unit，不能只写在 description；确实无量纲的年份、数量才可 unit=null。unit、format、example 不确定时填 null，description 不确定时填空字符串，options 必须是字符串数组；不要给十元组增加字段。scope 只能是 shared 或 category。
10. 避免语义重复：如果已有“网络制式”，不要再增加“是否支持5G”；如果已有更具体的像素、容量或尺寸属性，不要再返回含义重叠的泛化属性。
11. 京东证据中的 seen=x/y 表示该属性在 x 个样本商品、共 y 个样本商品中出现，只表示观察频次，不等于必填。seen=1 的字段只能作为弱候选，不能单独据此设为必填或生成稳定枚举；只有在当前类目具有明确行业意义时才保留。
12. 京东证据里的“无、未公布、暂无、不详、未知”可能是缺失占位值，不要直接写入 options；只有当前属性本身确实表达是否具备某功能时，才可把它转换为 boolean 或“有/无”语义。京东商品字段、类目路径和营销字段都可能有噪声，不能因为出现频次高就照抄。
13. “国补备案型号、上市时间、备案编号、平台促销字段”等字段默认不是商品类目属性；只有对当前行业的识别、采购或合规确实有长期意义时才保留。品牌、型号、颜色等通常是可选属性，不能因为证据出现就标为必填。

Excel 对照字段：属性名称、属性说明、属性值类型、属性值填写要求、属性值单位、属性值选项、属性值格式、属性值示例；其中 required=true 对应“必填”。`;

export function buildGovernanceUserPrompt(input: {
  version: string;
  categoryText: string;
  targetCategories: Array<Pick<CategoryNode, "id" | "pathNames" | "name" | "isLeaf">>;
  referenceText?: string;
  repairError?: string;
}): string {
  const targets = input.targetCategories.map((category) => ({
    category_id: shortCategoryId(category.id),
    path: category.pathNames,
    name: category.name,
  }));
  const repair = input.repairError
    ? `\n上一次尝试未通过本地校验，原因是：${input.repairError}\n请重新完整输出全部目标类目，并严格修正该问题；不要只返回修改片段。\n`
    : "";
  const reference = input.referenceText?.trim()
    ? `\n京东参考证据（仅作候选，不是强制答案；证据可能不完整，不能照抄到所有类目）：\n其中 seen=x/y 表示 x/y 个样本商品出现该字段；seen 越低证据越弱。对“无、未公布、暂无、不详、未知”等值先判断是否为缺失占位，不要直接作为枚举。\n${input.referenceText.trim()}\n`
    : "";
  return `类目树版本：${input.version}
压缩后的类目上下文（本类目组固定前缀）：
${input.categoryText}

请只输出紧凑 JSON，结构固定为：
{"v":1,"a":{"a0":["brand","品牌","t","",null,[],"商品品牌",null,null,"shared"]},"c":{"目标短category_id":[["a0"],["a1"],[]]}}
a 是属性字典，c 的每个值依次是 shared 引用数组、类目专属属性引用数组、说明数组。不要输出 items、category 对象或任何字典之外的属性定义。最终 c 的 key 集合必须与目标类目的短 category_id 完全一致，不能遗漏、重复或新增。

目标末级类目（必须全部返回）：
${JSON.stringify(targets)}
${reference}
${repair}`;
}

export const ATTRIBUTE_PROPERTY_KEYS: ReadonlyArray<keyof AttributeProperty> = [
  "key", "name", "description", "type", "required", "unit", "options", "format", "example", "scope",
];

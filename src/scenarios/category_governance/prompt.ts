import type { CategoryNode, AttributeProperty } from "./types.ts";
import { shortCategoryId } from "./util.ts";

export const CATEGORY_GOVERNANCE_SYSTEM_PROMPT = `你是商品类目治理专家，负责为三横标准类目设计可落地的商品属性模板。

规则：
1. 只依据输入的类目层级和行业常识推断，不编造品牌、认证、型号或无法验证的固定枚举；不确定的枚举输出空数组，并在 notes 说明。
2. 属性要服务于商品识别、检索、报价、采购和合规。区分类目共有属性和当前末级类目属性，避免把价格、库存、供应商等交易字段当成类目属性。
3. 属性名称使用业务常用中文，key 使用稳定的 snake_case；同义属性只保留一个。必填只给通常能从商品资料获得且对识别有帮助的字段。
4. type 只能是 text、number、boolean、single、multi、date、file。number 必须尽量给出 unit；single/multi 才能填写 options。
5. 输出严格为 JSON，不要 Markdown、解释性前后缀或代码围栏。每个目标类目都必须有一条结果。

Excel 对照字段：属性名称、属性说明、属性值类型、属性值填写要求、属性值单位、属性值选项、属性值格式、属性值示例；其中 required=true 对应“必填”。`;

export function buildGovernanceUserPrompt(input: {
  version: string;
  categoryText: string;
  targetCategories: Array<Pick<CategoryNode, "id" | "pathNames" | "name" | "isLeaf">>;
}): string {
  const targets = input.targetCategories.map((category) => ({
    category_id: shortCategoryId(category.id),
    path: category.pathNames,
    name: category.name,
  }));
  return `类目树版本：${input.version}
目标末级类目（必须全部返回）：
${JSON.stringify(targets, null, 2)}

压缩后的类目上下文：
${input.categoryText}

请输出如下 JSON 结构：
{"items":[{"category":{"id":"目标 category_id","path":["一级","二级"],"name":"末级名称"},"shared":[${propertyExample()}],"properties":[${propertyExample()}],"notes":[]}]}
shared 放该批次中可复用的共有属性，properties 放该类目专属或更准确的属性。每个属性都应包含 key,name,type,required；可选字段为 description,unit,options,format,example,scope。`;
}

function propertyExample(): string {
  return `{"key":"brand","name":"品牌","type":"text","required":false,"unit":null,"options":[],"description":"","format":null,"example":null,"scope":"shared"}`;
}

export const ATTRIBUTE_PROPERTY_KEYS: ReadonlyArray<keyof AttributeProperty> = [
  "key", "name", "description", "type", "required", "unit", "options", "format", "example", "scope",
];

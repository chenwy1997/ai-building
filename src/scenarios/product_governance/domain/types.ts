export type FieldType = '文本' | '数值' | '是否' | '选项' | '日期';
export type ValueStatus = 'filled' | 'needs_evidence' | 'conflict' | 'invalid' | 'enum_candidate' | 'not_applicable';
export interface Evidence {
  id: string; productId: string; kind: 'title' | 'sale_spec' | 'brand' | 'fixture';
  text: string; sourceRef: string;
}
export interface Observed<T> { value: T; evidenceId: string; quote: string }
export interface Quantity extends Observed<number> { unit: string; scope: string }
export interface BrandObservation extends Observed<string> { describes: 'self' | 'compatible' | 'supplier' }
export interface CaseInput {
  id: string; label: string; kind: 'synthetic' | 'historical'; productId: string; categoryId: string;
  categoryBasis: string; evidence: Evidence[];
  brands: BrandObservation[]; unbranded?: Observed<boolean>;
  direct: Quantity[]; totals: Quantity[]; packs: Quantity[];
  homogeneous?: Observed<boolean>; giftsExcluded?: Observed<boolean>;
}
export interface ValueResult {
  caseId: string; productId: string; attributeId: string; status: ValueStatus;
  value: string | number | null; unit: string | null; dictionaryRef?: string;
  reasonCode: string; reason: string; evidenceIds: string[]; trace: string[];
}
export interface Attribute {
  id: string; revision: number; name: string; kind: '公共属性' | '类目特性属性';
  definition: string; fieldType: FieldType; unit: string | null; describes: string;
  excludedMeanings: string[]; sourceRefs: string[]; ruleId: string;
}
export interface Binding {
  categoryId: string; attributeId: string; required: boolean; applicability: string;
  valueLevel: 'SKU' | 'SPU'; scope: string; uses: string[]; rationale: string;
}
export interface Rule {
  id: string; operator: 'brand_dictionary' | 'pieces_per_pack';
  inputContract: string[]; preconditions: string[]; formula: string | null;
  onFailure: string; placeholders?: string[]; directUnit?: string; directScope?:string; totalUnit?: string; packsUnit?: string;
}
export interface Standard {
  schema: 'product-governance-standard-v1'; releaseId: string; status: 'pilot_draft';
  categories: Array<{id:string;name:string;path:string}>;
  attributes: Attribute[]; bindings: Binding[]; rules: Rule[];
  brandDictionary: {kind:'local_reference'; productionIdsVerified:false; entries:Array<{id:string;name:string;aliases:string[]}>};
  rubric: Array<{id:string;name:string;question:string}>;
  sources: Array<{id:string;kind:string;location:string;note:string}>;
}
export interface Expectation {caseId:string; attributeId:string; status:ValueStatus; value:string|number|null}
export interface Review {
  summary: string;
  checks: Array<{attributeId:string;criteria:Array<{criterionId:string;verdict:'pass'|'fail'|'uncertain';reason:string}>}>;
  findings: Array<{id:string;attributeId:string;severity:'high'|'medium'|'low';issue:string;recommendation:string}>;
  caseOpinions: Array<{caseId:string;attributeId:string;status:ValueStatus;value:string|number|null;reason:string}>;
}

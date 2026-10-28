import { describe, expect, test } from 'bun:test';
import { carrierVerified, compareBaseline, ownership, validateDraft, validateFamilies, validateQuantityMapping, migrateLegacyDecision, dynamicFieldDecision, checkRestorations, isHistoricalCarrierExclusion } from '../core';
const policy = { explicitExcludedNames: ['品牌', '销售单位', '型号'], dynamicReviewNames: ['保质期', '商品重量'] };
const validCarrier = { categoryInstanceId: 'instance-a', propertyInstanceId: 'weight-property', effectiveVersion: 'v2', sameMeaning: true, visibleInput: true, verifiedAt: '2026-10-28', source: 'read-only snapshot' };
const proposal = { categoryId: 'a', category: '蚊香', key: 'shelf', name: '保质期', scope: 'SKU', type: 'text', required: false, definition: '按标签规定储存条件的可用期限，不是保修期', purpose: '核采购与储存', rules: ['原文附单位'], sourceSpuCount: 1, evidenceKeys: ['e1'], targetDirectEvidence: true };
const pool = { categories: [{ id: 'a', products: [{ sku: '1', spu: 's1' }], evidence: [{ id: 'e1', sku: '1', spu: 's1' }], pool: [{ name: '保质期' }] }] };
const draft = () => ({ categories: [{ categoryId: 'a', category: '蚊香' }], proposals: [structuredClone(proposal)], candidateDecisions: [{ categoryId: 'a', sourceName: '保质期', candidateName: '保质期', decision: 'keep', evidenceKeys: ['e1'], reason: '储存用途' }] });
describe('真实v4回归', () => {
  test('warranty列和默认key存在不证明蚊香表单有保质期', () => { expect(carrierVerified({ databaseColumn: 'warranty', defaultKey: 'warranty' })).toBe(false); expect(ownership('保质期', policy)).toBe('candidate_allowed_scope_pending'); });
  test('重量在一个SKU有入口不可全局排除；同义和目录版本是必要证据', () => { expect(carrierVerified(validCarrier)).toBe(true); expect(carrierVerified({ ...validCarrier, sameMeaning: false })).toBe(false); expect(carrierVerified({ ...validCarrier, effectiveVersion: undefined })).toBe(false); });
  test('别的类目动态入口不能当作目标类目已配置', () => { expect(carrierVerified({ ...validCarrier, categoryId: 'a' }, 'b')).toBe(false); expect(carrierVerified({ ...validCarrier, categoryId: 'a' }, 'a')).toBe(true); });
  test('显式业务排除仍有效，字段类型不决定职责', () => { expect(ownership('销售单位', policy)).toBe('explicit_business_exclusion'); expect(ownership('商品重量', policy)).toBe('candidate_allowed_scope_pending'); });
  test('86条历史映射含重复别名时，销售单位明确政策优先', () => { const p={...policy,rules:[{key:'saleUnit',names:['销售单位'],currentPolicy:'scope_verification_required'}]};expect(dynamicFieldDecision({sourceName:'销售单位',candidateName:''},p)).toBe(false); });
  test('不再让纯warranty排除通过', () => { const d = draft(); d.proposals = []; d.candidateDecisions[0]!.decision = 'exclude'; d.candidateDecisions[0]!.reason = '原生 warranty 已承载'; expect(validateDraft(d, pool, ['a'], policy).errors.some(e => e.kind === 'unscoped_exclusion')).toBe(true); });
  test('默认映射措辞和商品前缀不能绕过职责检查', () => { const d = draft(); d.proposals = []; Object.assign(d.candidateDecisions[0]!, { decision:'exclude', reason:'数据库列已存在，使用默认映射' }); expect(validateDraft(d,pool,['a'],policy).errors.some(e=>e.kind==='unscoped_exclusion')).toBe(true); Object.assign(d.candidateDecisions[0]!,{sourceName:'商品保质期',candidateName:'保质期',reason:'原生字段已承载'}); expect(validateDraft(d,pool,['a'],policy).errors.some(e=>e.kind==='unscoped_exclusion')).toBe(true); });
  test('保质期属性合法，数值/文本不因数据库列存在误拦', () => expect(validateDraft(draft(), pool, ['a'], policy).errors).toEqual([]));
  test('用户认可未延伸到新增；实质改名或定义变化能定位', () => { const result = compareBaseline([proposal], [{ ...proposal, definition: '保修期' }]); expect(result[0]!.status).toBe('modified'); expect(compareBaseline([proposal], [])[0]!.status).toBe('removed'); });
  test('本类没有样本可以用有来源候选，但不伪造观察款', () => { const d = draft(); Object.assign(d.proposals[0]!, { sourceSpuCount: 0, evidenceKeys: [], targetDirectEvidence: false, sourceReferences: ['model_prior:储存期限'] }); expect(validateDraft(d, pool, ['a'], policy).errors).toEqual([]); d.proposals[0]!.sourceSpuCount = 1; expect(validateDraft(d, pool, ['a'], policy).errors.some(e => e.kind === 'evidence_count')).toBe(true); });
  test('低尘/无尘同族不能因缺某个样本而漏成员判断', () => { const matrix = { families: [{ name: '擦拭纸', members: ['a', 'b'], concepts: [{ name: '裁切工艺', assessments: [{ categoryId: 'a', applicability: 'conditional', reason: '仅裁片与封边工艺适用', proposalNames: [] }] }] }] }; expect(validateFamilies(matrix, [], ['a', 'b']).some(e => e.kind === 'family_coverage')).toBe(true); });
  test('有族名称但没有对应概念不能冒充同族依据', () => { expect(validateFamilies({families:[{name:'害虫防治',members:['a'],concepts:[]}]},[{...proposal,sourceKind:'family',sourceReferences:['family:害虫防治']}],['a']).some(e=>e.kind==='family_provenance')).toBe(true); });
  test('每包数量不等于销售单位；复用需对象分母单位与有效载体', () => { expect(validateQuantityMapping({ object: '纸张', denominator: '包', unit: '抽', relationship: 'same', nativeKey: 'saleUnit' })).toBe(false); expect(validateQuantityMapping({ object: '纸张', denominator: '包', unit: '抽', relationship: 'different' })).toBe(true); });
  test('数量复用不能使用其他目录或缺少目标类目', () => { const m={object:'纸张',denominator:'包',unit:'抽',relationship:'same',nativeKey:'unitMinQua',carrier:{...validCarrier,categoryId:'b'}};expect(validateQuantityMapping(m,'a')).toBe(false);expect(validateQuantityMapping(m)).toBe(false);expect(validateQuantityMapping(m,'b')).toBe(true); });
  test('纸品旧中文排除状态迁待核，保留旧原文及明确人工排除', () => { const d={categoryId:'a',sourceName:'商品重量',decision:'排除：原生职责',reason:'weight已有字段',humanReview:''};const moved=migrateLegacyDecision(d,policy);expect(moved.decision).toBe('defer');expect(moved.historicalReason).toBe(d.reason);expect(migrateLegacyDecision({...d,humanReview:'不要'},policy).decision).toBe(d.decision);expect(migrateLegacyDecision({...d,sourceName:'品牌'},policy).decision).toBe(d.decision); });
  test('归并目标与证据缺失均定位，不静默过滤', () => { const d = draft(); d.candidateDecisions[0]!.candidateName = '失效定义'; d.proposals[0]!.evidenceKeys = ['missing']; expect(validateDraft(d, pool, ['a'], policy).errors.map(e => e.kind)).toContain('decision_target'); expect(validateDraft(d, pool, ['a'], policy).errors.map(e => e.kind)).toContain('evidence'); });
  test('最新人审范围只恢复保质期选填，不连带恢复重量或保修期', () => {
    const p={...policy,restorationPolicy:{allowedOptionalNames:['保质期']}};
    const check=(name:string,required=false)=>checkRestorations({proposals:[],candidateDecisions:[{categoryId:'a',sourceName:name,decision:'exclude',reason:'原生职责已承载'}]},[{...proposal,name,required}],[{categoryId:'a',sourceName:name,candidateName:name,decision:'keep'}],p);
    expect(check('保质期').errors).toEqual([]);
    expect(check('保质期',true).errors[0]?.kind).toBe('restoration_not_approved');
    expect(check('商品重量').errors[0]?.kind).toBe('restoration_not_approved');
    expect(check('保修期').errors[0]?.kind).toBe('restoration_not_approved');
  });
  test('列出职责待选不等于恢复，既有认可属性不受待选限制', () => {
    const p={...policy,restorationPolicy:{allowedOptionalNames:['保质期']}};
    const old={categoryId:'a',sourceName:'商品重量',decision:'exclude',reason:'weight原生职责'};
    const pending=checkRestorations({proposals:[],candidateDecisions:[old]},[],[{...old,decision:'defer'}],p);
    expect(pending.decisions[0]?.restorationState).toBe('pending_user');expect(pending.restored).toBe(0);
    const accepted={...proposal,name:'商品重量'};
    expect(checkRestorations({proposals:[accepted],candidateDecisions:[old]},[accepted],[{...old,decision:'keep',candidateName:'商品重量'}],p).errors).toEqual([]);
  });
  test('真实产地和长宽高基础字段理由也必须待选，不能绕过恢复限制', () => {
    const p={...policy,restorationPolicy:{allowedOptionalNames:['保质期']}};
    for (const [name,reason,basis] of [['产地','产地由产地基础字段负责。',''],['商品长宽高','此处系统长宽高由基础字段承载。',''],['重量','字段已承载','duplicate_carrier']]) {
      const old={categoryId:'a',sourceName:name,decision:'exclude',reason,exclusionBasis:basis};
      const baseline={proposals:[],candidateDecisions:[old]};
      expect(checkRestorations(baseline,[],[{...old,decision:'defer'}],p).decisions[0]?.restorationState).toBe('pending_user');
      expect(checkRestorations(baseline,[{...proposal,name}],[{...old,decision:'keep',candidateName:name}],p).errors[0]?.kind).toBe('restoration_not_approved');
    }
  });
  test('更换来源标签不能绕过同类同名概念的恢复范围，净含量不等同物流重量', () => {
    const p={...policy,restorationPolicy:{allowedOptionalNames:['保质期']}};
    const old={categoryId:'a',sourceName:'商品重量',decision:'exclude',reason:'原生weight'};
    const baseline={proposals:[],candidateDecisions:[old]};
    expect(checkRestorations(baseline,[{...proposal,name:'重量'}],[{...old,decision:'defer'},{categoryId:'a',sourceName:'v4网页候选：重量',candidateName:'重量',decision:'keep'}],p).errors[0]?.kind).toBe('restoration_not_approved');
    expect(checkRestorations(baseline,[{...proposal,name:'净含量'}],[{...old,decision:'defer'}],p).errors).toEqual([]);
  });
  test('历史底层key和基础信息措辞统一识别，但销售组合业务判断不冒充载体', () => {
    const p={...policy,rules:[{key:'tagIds'},{key:'packingList'},{key:'isCustomProduct'}],historicalCarrierReasonKeys:['sceneTagsKey','industryTagsKey']};
    for(const reason of ['国产/进口对应来源产地基础信息','sceneTagsKey/industryTagsKey/StdProduct.tagIds','按isCustomProduct处理','使用packingList','单品/套装属于现有销售规格及包装组合']) expect(isHistoricalCarrierExclusion({decision:'exclude',reason},p)).toBe(true);
    expect(isHistoricalCarrierExclusion({decision:'exclude',reason:'加热器纯销售组合，与香液性能无关'},p)).toBe(false);
  });
});

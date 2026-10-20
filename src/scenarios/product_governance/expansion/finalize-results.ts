import {join} from 'node:path';
import {read,save,digest} from '../runtime/storage.ts';
import {RUN,ROOT} from './settings.ts';
const d:any=await read(join(RUN,'analysis/assembled.json')),s:any=await read(join(RUN,'design/standard.json')),manifest:any=await read(join(RUN,'inputs/manifest.json'));
const freeze:any=await read(join(RUN,'batch-manifest.json')),jd:any=await read(join(RUN,'inputs/jd-summary.json'));
if(d.validationIssues.length)throw new Error('尚有未裁定规则/证据问题：'+d.validationIssues.length);
if(d.rows.length!==250||['deepseek','kimi','glm','qwen'].some(m=>d.modelCoverage[m]!==250))throw new Error('250件逐件及四模型覆盖未齐');
if(!manifest.allEsStatusChecksPass||manifest.uniqueProducts!==250)throw new Error('ES在售抽样未通过');
if(s.categories.length!==21||d.byCategory.length!==5||d.byCategory.some((c:any)=>c.sample!==50))throw new Error('类目范围或样本数不符');
if(freeze.standardHash!==digest(s)||d.standardHash!==digest(s))throw new Error('批次标准已漂移');
if(d.jdCoverage.deepseek!==jd.ok||d.jdCoverage.kimi!==jd.ok)throw new Error('京东补证双模型审核未齐');
if(d.rows.filter((r:any)=>r.jdSameProduct).length!==jd.selected)throw new Error('京东补证最终同品裁定未覆盖查询名单');
if(d.counts.eligible+d.counts.wrong+d.counts.uncertain!==250)throw new Error('归属计数不闭合');
const filled=d.fieldRecords.filter((f:any)=>f.inRate&&f.status==='filled').length,missing=d.missingCounts.reduce((n:number,x:any)=>n+x.count,0);
if(filled!==d.counts.filled||missing+filled!==d.counts.slots)throw new Error('字段分母/缺项计数不闭合');
for(const row of d.rows){
 if(row.category.status==='matched'&&row.category.targetId!==row.categoryId)throw new Error('matched目标与原类目不同');
 if(row.category.status==='wrong'&&row.category.targetConfirmed&&!row.category.targetPath)throw new Error('错挂目标未验证V2路径');
 if(['deepseek','kimi','glm','qwen'].some(m=>row.models[m]?.key!==row.key))throw new Error('模型key串商品');
}
for(const f of d.fieldRecords)f.ruleReview=d.ruleChecks.filter((r:any)=>r.key===f.key&&r.attributeId===f.attributeId).map((r:any)=>`${r.code}｜${r.decision}｜${r.reason||r.message}`).join('；');
const rootReview:any=await read(join(RUN,'analysis/root-review.json'));
if(rootReview.status!=='approved'||rootReview.reviewedKeys.length!==250||new Set(rootReview.reviewedKeys).size!==250)throw new Error('root最终复核未签署');
if(rootReview.inputHashesDigest!==digest(d.inputHashes))throw new Error('最终复核后输入变化，需重新签署');
const runtimeFiles=['expansion/assemble.ts','expansion/rules.ts','expansion/requiredness.ts','expansion/finalize-results.ts','batch/validation.ts','adapters/opencode-go.ts'];
const runtimeFileHashes=Object.fromEntries(await Promise.all(runtimeFiles.map(async f=>[f,digest(await Bun.file(join(ROOT,'src/scenarios/product_governance',f)).text())])));
const final={...d,runtimeFileHashes,runtimeHash:digest(runtimeFileHashes),status:'codex-adjudicated-await-operations-audit',finalizedAt:new Date().toISOString(),rootReview,
 limitations:['每类随机50件，样本等额而类目总体不等；合计是样本指标，不外推全21类或标准商品树。','运营尚未随机抽检。多模型一致性不是实际准确率。','每个SKU使用标题/规格、主图及限定京东补证；详情接口未提供详情正文/详情图，未声称已提取不存在的详情图。','新数量模型把数值、计数单位、内包装单位分为三个槽位，本轮属性集合也有扩展，不能直接把填充率与前轮3类作升降比较。','仅输出离线治理建议；没有迁移商品类目或回写生产属性。']};
await save(join(RUN,'analysis/final.json'),final);
await save(join(RUN,'analysis/root-signoff.json'),{actor:'Codex /root',at:final.finalizedAt,standardHash:digest(s),resultHash:digest(final),reviewedKeys:d.rows.map((r:any)=>r.key),counts:final.counts,operationsAudited:false,productionWritePerformed:false});
console.log(JSON.stringify({counts:final.counts,byCategory:final.byCategory,evidence:final.evidenceStats,models:final.modelStats},null,2));

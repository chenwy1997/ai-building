/** Explicit task state handed between tools; not product evidence. */
export const EXECUTION_NOTES=`同品核对是本流程已经完成的独立步骤。verifiedIdentity列明被允许使用的京东SKU、结论及原因；允许的证据不必在三横原资料重复出现才能补充，否则补证没有意义。仍检查字段语义及原文冲突；新的实质冲突可以提出，不能仅因“未再次给出同品证明”删除已核验来源。
常见标题销售规格可按其明确结构读取：80片×7包表示每包80片、该销售组合7包；3包×2提表示每提3包、共2提，若无混规格/赠品/标题规格冲突迹象可计算6包。这是已提供的销售规格，不要求额外出现“共”“每”或制造商盖章；不能把明显不同规格组合均摊。未提赠品不等于证明绝对无赠品，但没有任何赠品线索时不凭空制造歧义；发现相关线索则停止计算。
报价字段名color/size/seoModel不保证内容就是颜色/尺寸/制造商型号，必须按值本义核验。无长宽高次序的三维尺寸不擅自指定方向。包装尺寸不是盒体尺寸。材料层与主体材质分开，皮革表面不能自动推断底板或PU材质。
missing是本次schema表示“unknown/缺证”的状态，value留空；不是必须输出字面unknown。filled的reasonCode=none。不要为满足审核形式而指出已经正确的字段。
已知但枚举不覆盖的真实值可filled+out并保留原文，不强塞其他或清空。兼容抽取式纸巾和餐巾纸并非互相矛盾，可保留“抽取式纸巾/餐巾纸”作为枚举外试填候选；真正互斥来源才conflict。多风格词先保留原文复合值作候选；这不等于已批准线上多选或扩枚举。`;
export function identityContext(e:any){
 return {status:e.status,verifiedIdentity:(e.candidates??[]).filter((c:any)=>c.identity?.status==='same'&&e.evidence.length).map((c:any)=>({skuId:c.skuId,...c.identity,codexDecision:c.identity.codexDecision??null})),
  allowedSupplementEvidenceIds:e.evidence.map((x:any)=>x.id)};
}

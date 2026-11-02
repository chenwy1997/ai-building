import {expect,test} from 'bun:test';
import {applyReviewDeltas,digest} from '../scripts/assemble-sku-fill';
import type {SkuFillRow} from '../sku-fill-contract';

const row:SkuFillRow={skuId:'sku-a',categoryId:'cat-a',attributeKey:'weight',status:'proposed',value:100,evidence:[],notes:'作者候选'};
const change=()=>({skuId:row.skuId,attributeKey:row.attributeKey,beforeHash:digest(JSON.stringify(row)),replacement:{...row,status:'needs_evidence',value:null},reason:'纸芯/净重口径仍待核'});
test('审校差异只改被冻结的同一行，保留作者原件和前后状态',()=>{
 const revised=applyReviewDeltas([row],[change()]);
 expect(row.value).toBe(100);expect(revised[0]!.value).toBeNull();
 expect(revised[0]!.independentChange).toMatchObject({originalValue:100,originalStatus:'proposed'});
});
test('作者变动、身份替换及重复审校变更均拒绝，避免静默错位应用',()=>{
 expect(()=>applyReviewDeltas([{...row,value:200}],[change()])).toThrow('no longer matches');
 expect(()=>applyReviewDeltas([row],[{...change(),replacement:{...row,categoryId:'cat-b'}}])).toThrow('identity');
 expect(()=>applyReviewDeltas([row],[change(),change()])).toThrow('repeated');
});

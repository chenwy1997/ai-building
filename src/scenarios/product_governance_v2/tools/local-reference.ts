import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {read,hash} from '../runtime/store.ts';
import type {Source} from '../domain/meta.ts';
export async function localReference(entry:any):Promise<{rows:any[];sources:Source[]}>{
 const manifest=await read(entry.manifest);
 const actual=createHash('sha256').update(await readFile(manifest.snapshot)).digest('hex');
 if(actual!==entry.fileSha256||manifest.sha256!==actual)throw Error('reference workbook hash mismatch');
 const all=(await readFile(join(dirname(entry.manifest),'attribute-rows.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
 const rows=all.filter(r=>r.templateId===entry.scopeReference.referenceTemplateId&&r.sheet===entry.scopeReference.sheet&&entry.scopeReference.rows.includes(r.row));
 if(rows.length!==entry.scopeReference.rows.length||new Set(rows.map(r=>r.row)).size!==rows.length)throw Error('reference row coverage mismatch');
 const sources:Source[]=rows.map(r=>{
  if(r.fileHash!==actual)throw Error('reference row hash mismatch');
  const text=`模板编号：${r.templateId}\n类目路径：${r.categoryPath.join('>')}\n属性：${r.attribute}\n是否必填：${r.requiredRaw}\n填写类型：${r.fieldTypeRaw}\n可枚举值：${r.enumRaw??'（原表为空）'}`;
  return {id:r.sourceId,kind:'reference_dataset',platform:'震坤行（本地Excel）',locator:`${manifest.snapshot}#${r.sheet}!K${r.row}:N${r.row}`,
   text,hash:hash(text),retrievedAt:manifest.importedAt,mode:`local_workbook; fileSha256=${actual}; template=${r.templateId}; sheet=${r.sheet}; row=${r.row}`};
 });
 return {rows,sources};
}

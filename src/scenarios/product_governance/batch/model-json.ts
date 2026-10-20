// 结构修复只删除字符串以外、与当前栈不匹配的多余结束括号。
// 不补内容，不改键、数值或引文；截断或覆盖不全必须单独处理。
export function removeExtraClosers(text:string){let out='',string=false,escape=false;const stack:string[]=[],removed:{offset:number;character:string}[]=[];
 for(let i=0;i<text.length;i++){const c=text[i]!;if(string){out+=c;if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
  if(c==='"'){string=true;out+=c;continue;}
  if(c==='{'||c==='[')stack.push(c);
  if(c==='}'||c===']'){const expected=c==='}'?'{':'[';if(stack.at(-1)!==expected){removed.push({offset:i,character:c});continue;}stack.pop();}
  out+=c;
 }
 if(string||stack.length)throw new Error('不修复截断或缺少闭括号的内容');return {text:out,removed};
}
export function lastAssistantText(raw:string){
 const events=raw.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 const messages=events.flatMap(e=>e.role==='assistant'?[e]:e.message?.role==='assistant'?[e.message]:[]);
 if(messages.some(m=>m.tool_calls?.length))throw new Error('不接受出现工具调用的审核输出');
 return messages.map(m=>typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join(''):'').filter(Boolean).at(-1)?.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
}

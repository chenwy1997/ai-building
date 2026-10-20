import {test,expect} from 'bun:test';
import {buildCommandCodeRequest,parseCommandCodeResponse,assembleCommandCodeStream} from '../adapters/commandcode.ts';
test('CommandCode requires verified exact model identity and complete text',()=>{
  for(const model of ['Qwen/Qwen3.8-Flash','z-ai/glm-5.3-flash']) {
    const response={model,choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{total_tokens:12}};
    expect(parseCommandCodeResponse(model,response).text).toBe('{"ok":true}');
    expect(()=>parseCommandCodeResponse(model,{...response,model:'other'})).toThrow();
    expect(()=>parseCommandCodeResponse(model,{...response,model:undefined})).toThrow();
    expect(()=>parseCommandCodeResponse(model,{...response,choices:[{finish_reason:'length',message:{content:'{}'}}]})).toThrow();
    expect(()=>parseCommandCodeResponse(model,{...response,choices:[{finish_reason:'stop',message:{content:'{}',tool_calls:[{}]}}]})).toThrow();
  }
  expect(()=>buildCommandCodeRequest('unverified','{}',100)).toThrow();
});
test('stream rejects identity changes and premature completion',()=>{
 const model='Qwen/Qwen3.8-Flash';
 const chunks=[{model,choices:[{index:0,delta:{content:'{"ok":'}}]},{model,choices:[{index:0,delta:{content:'true}'},finish_reason:'stop'}],usage:{total_tokens:8}}];
 expect(parseCommandCodeResponse(model,assembleCommandCodeStream(model,chunks)).text).toBe('{"ok":true}');
 expect(()=>parseCommandCodeResponse(model,assembleCommandCodeStream(model,chunks.slice(0,1)))).toThrow();
 expect(()=>parseCommandCodeResponse(model,assembleCommandCodeStream(model,[...chunks,{model:'other'}]))).toThrow();
 const aliases=structuredClone(chunks);aliases[0]!.model='qwen3.8-flash';
 expect(parseCommandCodeResponse(model,assembleCommandCodeStream(model,aliases)).text).toBe('{"ok":true}');
 expect(()=>parseCommandCodeResponse(model,{model:'qwen3.8-flash',choices:chunks[1]!.choices})).toThrow();
});

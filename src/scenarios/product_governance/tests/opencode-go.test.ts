import {test,expect} from 'bun:test';
import {buildOpenCodeGoRequest,parseOpenCodeGoResponse} from '../adapters/opencode-go.ts';
test('GLM and Qwen use their verified Go API families without credentials in bodies',()=>{
 const g=buildOpenCodeGoRequest('glm-5.3-flash','{"test":true}',100);
 const q=buildOpenCodeGoRequest('qwen3.8-flash','{"test":true}',100);
 expect(g.route.endpoint).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions');
 expect(q.route.endpoint).toBe('https://opencode.ai/inference/go/anthropic/v1/messages');
 expect(q.body).toHaveProperty('system');expect(g.body.messages[0]?.role).toBe('system');
 expect(g.body).not.toHaveProperty('apiKey');
 expect(g.body).not.toHaveProperty('thinking');
 const low=buildOpenCodeGoRequest('glm-5.3-flash','{}',14000,'low');
 expect(low.body).toHaveProperty('reasoning_effort','low');
 expect(low.body).not.toHaveProperty('thinking');
 expect(()=>buildOpenCodeGoRequest('deepseek-v4.1-flash','',100)).toThrow();
});
test('reject truncated, tool-using, or wrong-model responses',()=>{
 expect(()=>parseOpenCodeGoResponse('glm-5.3-flash',{model:'glm-5.3-flash',choices:[{finish_reason:'length',message:{content:'{}'}}]})).toThrow();
 expect(()=>parseOpenCodeGoResponse('qwen3.8-flash',{model:'qwen3.8-flash',stop_reason:'max_tokens',content:[{type:'text',text:'{}'}]})).toThrow();
 expect(()=>parseOpenCodeGoResponse('qwen3.8-flash',{model:'qwen3.8-flash',stop_reason:'end_turn',content:[{type:'tool_use',name:'shell'}]})).toThrow();
 expect(()=>parseOpenCodeGoResponse('glm-5.3-flash',{model:'other',choices:[{finish_reason:'stop',message:{content:'{}'}}]})).toThrow();
});
test('parse text and usage separately from optional thinking blocks',()=>{
 expect(parseOpenCodeGoResponse('qwen3.8-flash',{model:'qwen3.8-flash',stop_reason:'end_turn',content:[{type:'thinking',thinking:'private'},{type:'text',text:'{"ok":true}'}],usage:{input_tokens:5,output_tokens:8}})).toEqual({text:'{"ok":true}',responseModel:'qwen3.8-flash',usage:{input_tokens:5,output_tokens:8}});
 expect(parseOpenCodeGoResponse('glm-5.3-flash',{model:'glm-5.3-flash',choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}).text).toBe('{"ok":true}');
});

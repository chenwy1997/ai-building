import {OpenAiCompatibleClient} from './openai-client.ts';
import {SecretBox} from '../platform/security/secret-box.ts';
import {loadAppConfig} from '../config/env.ts';
import {DatabaseHub} from '../platform/database/hub.ts';
import {PostgresAiCatalog} from '../data/ai-catalog.ts';
/** Shared AI-layer transport. No governance rules and no default thinking. */
export async function deepseekRuntime(direct=false){
 if(direct){const hosts=['api.deepseek.com'];for(const name of ['NO_PROXY','no_proxy'])process.env[name]=[process.env[name],...hosts].filter(Boolean).join(',');}
 let key=process.env.DEEPSEEK_API_KEY;let baseUrl='https://api.deepseek.com';
 if(!key){const config=loadAppConfig(),hub=new DatabaseHub(config.postgresUrl);try{const p=await new PostgresAiCatalog(hub.publicDatabase()).getProvider('deepseek');if(!p?.enabled||!p.apiKeyCiphertext||!config.masterKey)throw new Error('缺少DeepSeek Key；配置DEEPSEEK_API_KEY或使用公共库现有密钥');key=await new SecretBox(config.masterKey).decrypt(p.apiKeyCiphertext);baseUrl=p.baseUrl;}finally{await hub.closeAll();}}
 const client=new OpenAiCompatibleClient({baseUrl,apiKey:key,timeoutMs:90000});
 return{model:'deepseek-flash',chat:client.chat.bind(client)};
}

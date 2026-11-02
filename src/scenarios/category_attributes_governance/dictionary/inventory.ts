import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { Dictionary } from './contracts.ts';
import { digest, stable, validateDictionary } from './contracts.ts';

export interface Observation {
  namespace: 'sanheng' | 'jd'; category: { id: string; name: string; path: string[] };
  property: Record<string, unknown>; origin?: unknown;
}
export function openInventory(path: string) {
  const db = new Database(path);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sources_v1(id TEXT PRIMARY KEY,label TEXT NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,content TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS candidates_v1(id TEXT PRIMARY KEY,namespace TEXT NOT NULL,category_id TEXT NOT NULL,category_name TEXT NOT NULL,path TEXT NOT NULL,name TEXT NOT NULL,property TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS candidate_name_v1 ON candidates_v1(name);
    CREATE INDEX IF NOT EXISTS candidate_category_v1 ON candidates_v1(namespace,category_id);
    CREATE TABLE IF NOT EXISTS observations_v1(source_id TEXT NOT NULL REFERENCES sources_v1(id),ordinal INTEGER NOT NULL,candidate_id TEXT NOT NULL REFERENCES candidates_v1(id),origin TEXT NOT NULL,PRIMARY KEY(source_id,ordinal));
    CREATE INDEX IF NOT EXISTS observation_candidate_v1 ON observations_v1(candidate_id);
    CREATE TABLE IF NOT EXISTS properties_v1(id TEXT NOT NULL,revision INTEGER NOT NULL,name TEXT NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(id,revision));
    CREATE TABLE IF NOT EXISTS units_v1(id TEXT PRIMARY KEY,definition TEXT NOT NULL);
  `);
  return db;
}

/** Exact raw definition + category context identity only. This is NOT semantic deduplication. */
export function candidateId(o: Observation) {
  return digest({namespace:o.namespace,category:o.category,property:o.property});
}
export function importSource(db: Database, source: {label:string;kind:string;path:string;content:string}, rows: Observation[]) {
  // Content-addressable source snapshots; source editions are evidence records, never independent votes.
  const id = createHash('sha256').update(source.content).digest('hex');
  const insertCandidate = db.prepare('INSERT OR IGNORE INTO candidates_v1 VALUES (?,?,?,?,?,?,?)');
  const insertObservation = db.prepare('INSERT OR IGNORE INTO observations_v1 VALUES (?,?,?,?)');
  db.transaction(()=>{
    db.run('INSERT OR IGNORE INTO sources_v1 VALUES (?,?,?,?,?)',[id,source.label,source.kind,source.path,source.content]);
    rows.forEach((o,i)=>{
      if(!o.category.id || typeof o.property.name!=='string' || !o.property.name.trim()) throw new Error(`来源 ${source.label} 第 ${i} 条没有类目ID或属性名称`);
      const cid = candidateId(o);
      insertCandidate.run(cid,o.namespace,o.category.id,o.category.name,JSON.stringify(o.category.path),o.property.name,stable(o.property));
      insertObservation.run(id,i,cid,stable(o.origin??null));
    });
  })();
  return id;
}
export function storeDictionary(db:Database,d:Dictionary) {
  validateDictionary(d);
  db.transaction(()=>{
    for(const u of d.units) {
      const existing = db.query('SELECT definition FROM units_v1 WHERE id=?').get(u.id) as {definition:string}|null;
      if(existing && existing.definition!==stable(u)) throw new Error(`单位ID不可被重定义: ${u.id}`);
      db.run('INSERT OR IGNORE INTO units_v1 VALUES (?,?)',[u.id,stable(u)]);
    }
    for(const p of d.properties) {
      const existing = db.query('SELECT definition FROM properties_v1 WHERE id=? AND revision=?').get(p.id,p.revision) as {definition:string}|null;
      if(existing && existing.definition!==stable(p)) throw new Error(`已存在的属性版本不可变更: ${p.id}@${p.revision}`);
      db.run('INSERT OR IGNORE INTO properties_v1 VALUES (?,?,?,?)',[p.id,p.revision,p.name,stable(p)]);
    }
  })();
}
export function statistics(db:Database) {
  const count = (table:string) => (db.query(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n;
  return {
    observations:count('observations_v1'),contextualCandidates:count('candidates_v1'),
    distinctNames:(db.query('SELECT count(DISTINCT name) n FROM candidates_v1').get() as {n:number}).n,
    canonicalDefinitions:count('properties_v1'),units:count('units_v1'),
    categoryCounts:db.query('SELECT namespace,count(DISTINCT category_id) categories FROM candidates_v1 GROUP BY namespace').all(),
    sources:db.query('SELECT s.id,s.label,s.kind,count(o.ordinal) observations FROM sources_v1 s LEFT JOIN observations_v1 o ON s.id=o.source_id GROUP BY s.id ORDER BY s.label').all(),
  };
}
export function search(db: Database, query:string, limit=10) {
  if(!Number.isInteger(limit)||limit<1||limit>100) throw new Error('limit必须为1到100');
  return {
    notice:'候选来自历史模板或采样；同名不代表同义，样本值不代表封闭枚举。标准定义的检索命中也不等于类目适用。',
    definitions:db.query('SELECT definition FROM properties_v1 WHERE instr(name,?)>0 OR instr(id,?)>0 ORDER BY id LIMIT ?').all(query,query,limit).map(r=>JSON.parse((r as {definition:string}).definition)),
    candidates:db.query(`SELECT c.id,c.namespace,c.category_id,c.category_name,c.path,c.name,c.property,
      (SELECT count(*) FROM observations_v1 o WHERE o.candidate_id=c.id) sourceRecords
      FROM candidates_v1 c WHERE instr(c.name,?)>0 OR instr(c.path,?)>0
      ORDER BY CASE WHEN c.name=? THEN 0 WHEN instr(c.name,?)>0 THEN 1 ELSE 2 END,c.name,c.namespace,c.category_id,c.id LIMIT ?`).all(query,query,query,query,limit).map(r=>{
        const row = r as {path:string;property:string};
        return {...row,path:JSON.parse(row.path),property:JSON.parse(row.property)};
      }),
  };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { hash, readJson } from './core';

export interface ReferenceQuery {
  source?: string; text?: string; categoryText?: string; attributeText?: string;
  recordId?: string; offset?: number; limit?: number;
}
const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();

// Local XLSX/CSV lookup only. Platform options remain raw candidates, never approved enums.
export async function queryReferences(library: string, query: ReferenceQuery = {}) {
  const offset = query.offset ?? 0, limit = query.limit ?? 20;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid reference pagination (limit 1–100)');
  const catalogFile = path.join(library, 'catalog.json');
  const catalogBytes = await fs.readFile(catalogFile), catalog = JSON.parse(catalogBytes.toString());
  const manifest = await readJson(path.join(library, 'indexes/manifest.json'));
  if (manifest.catalogSha256 !== hash(catalogBytes)) throw Error('Reference catalog changed; rebuild indexes before querying');
  const templates = catalog.sources.filter((s: any) => s.access === 'local_template_index');
  if (query.source && !templates.some((s: any) => s.id === query.source)) throw Error('Not a local template source; available: ' + templates.map((s: any) => s.id).join(', ') + '. Other channels use the catalog entry.');
  const sources: any[] = [], rows: any[] = [];
  let total = 0;
  for (const source of templates.filter((s: any) => !query.source || s.id === query.source)) {
    const meta = manifest.sources.find((s: any) => s.sourceId === source.id);
    if (!meta || meta.originalFile !== source.originalFile || meta.indexFile !== source.indexFile) throw Error('Missing/mismatched source index: ' + source.id);
    const family = source.sourceFamilyId ?? source.id;
    if ((meta.sourceFamilyId ?? source.id) !== family) throw Error('Mismatched source family: ' + source.id);
    const supportingConfig = source.supportingFiles ?? [], supportingMeta = meta.supportingFiles ?? [];
    if (supportingConfig.length !== supportingMeta.length || supportingConfig.some((file: any, i: number) => file.originalFile !== supportingMeta[i].originalFile || file.role !== supportingMeta[i].role)) throw Error('Missing/mismatched supporting source: ' + source.id);
    const [original, index] = await Promise.all([fs.readFile(path.join(library, meta.originalFile)), fs.readFile(path.join(library, meta.indexFile))]);
    if (hash(original) !== meta.originalSha256 || hash(index) !== meta.indexSha256) throw Error('Reference integrity mismatch: ' + source.id);
    const supportingFiles = [];
    for (const file of supportingMeta) {
      const absoluteFile = path.join(library, file.originalFile);
      if (hash(await fs.readFile(absoluteFile)) !== file.originalSha256) throw Error('Reference integrity mismatch: ' + source.id + ' supporting file');
      supportingFiles.push({ originalFile: absoluteFile, originalSha256: file.originalSha256, role: file.role, rowCount: file.rowCount, emptyAttributeCategoryCount: file.emptyAttributeCategoryCount });
    }
    let reconciliation;
    if (source.reconciliationFile || meta.reconciliation) {
      if (!meta.reconciliation || source.reconciliationFile !== meta.reconciliation.reportFile) throw Error('Missing/mismatched reconciliation: ' + source.id);
      const reportFile = path.join(library, meta.reconciliation.reportFile);
      if (hash(await fs.readFile(reportFile)) !== meta.reconciliation.reportSha256) throw Error('Reference integrity mismatch: ' + source.id + ' reconciliation');
      reconciliation = { ...meta.reconciliation, reportFile };
    }
    sources.push({ sourceId: source.id, sourceFamilyId: family, name: source.name, format: meta.format,
      referenceRole: source.referenceRole, candidatePriority: source.candidatePriority, authority: source.authority,
      optionPolicy: source.optionPolicy, originalFile: path.join(library, meta.originalFile), originalSha256: meta.originalSha256,
      indexSha256: meta.indexSha256, indexedRows: meta.rowCount, headers: meta.headers,
      ...(supportingFiles.length ? { supportingFiles, reconciliation } : {}) });
    let indexedRows = 0;
    for (const line of gunzipSync(index).toString('utf8').split('\n')) {
      if (!line) continue;
      const record = JSON.parse(line);
      indexedRows++;
      if (record.sourceId !== source.id || record.sourceKind !== 'external_attribute_template') throw Error('Invalid reference provenance: ' + source.id);
      if ((record.sourceFamilyId ?? source.id) !== family || record.referenceRole !== source.referenceRole) throw Error('Invalid reference family/role: ' + source.id);
      if (query.recordId && record.id !== query.recordId) continue;
      if (query.categoryText && !normalize(record.categoryPath.join(' > ')).includes(normalize(query.categoryText))) continue;
      if (query.attributeText && !normalize(record.attribute).includes(normalize(query.attributeText))) continue;
      if (query.text && !normalize(JSON.stringify(record)).includes(normalize(query.text))) continue;
      if (total >= offset && rows.length < limit) rows.push(record);
      total++;
    }
    if (indexedRows !== meta.rowCount) throw Error('Reference row count mismatch: ' + source.id);
  }
  return {
    usage: 'candidate_reference_only', adoption: 'not_reviewed_or_applied', sourceContentIsInstruction: false,
    platformOptionsAreApprovedEnums: false,
    sourceFamilyIds: [...new Set(sources.map(source => source.sourceFamilyId))],
    matching: 'lexical; verify product object and category mapping before reuse',
    total, offset, nextOffset: offset + limit < total ? offset + limit : null, sources, rows,
  };
}

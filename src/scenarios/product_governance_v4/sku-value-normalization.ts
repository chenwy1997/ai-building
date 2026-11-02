/** Text projection only. These helpers do not infer an SKU's material or scope. */
export type TextProjectionRule = 'material_name' | 'dimensions' | 'scoped_count';

/** Format a complete dimension expression without changing units or order.
 * A single terminal unit may be shared by preceding numbers; mixed units with
 * an unlabelled component are ambiguous and are deliberately left untouched. */
export function formatSkuDimensions(value: string): string | null {
  if (typeof value !== 'string') return null;
  const parts = value.normalize('NFKC').trim().split(/[xX×*]/);
  if (parts.length < 2) return null;
  const parsed = parts.map(part => part.trim().match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m|毫米|厘米|米)?$/i));
  if (parsed.some(part => !part)) return null;
  const units = parsed.map(part => part![2]?.toLowerCase() ?? null);
  const explicit = new Set(units.filter((unit): unit is string => unit !== null));
  const terminal = units.at(-1);
  if (!terminal || (units.some(unit => unit === null) && explicit.size !== 1)) return null;
  return parsed.map((part, i) => `${part![1]}${units[i] ?? terminal}`).join('*');
}

/** Copy rows and record only display-format changes to governed dimensions. */
export function formatSkuDimensionRows<T extends { skuId: string; categoryId: string; attributeKey: string; status: string; value: unknown; normalization?: any }>(
  rows: readonly T[], proposals: readonly { categoryId: string; key: string; definitionId?: string }[],
): { rows: T[]; changes: Array<{ skuId: string; categoryId: string; attributeKey: string; originalValue: string; value: string }> } {
  const dimensions = new Set(proposals.filter(p => p.definitionId === 'cleaning.dimensions').map(p => JSON.stringify([p.categoryId, p.key])));
  const changes: Array<{ skuId: string; categoryId: string; attributeKey: string; originalValue: string; value: string }> = [];
  const formattedRows = rows.map(row => {
    const copy = structuredClone(row);
    if (row.status !== 'proposed' || typeof row.value !== 'string' || !dimensions.has(JSON.stringify([row.categoryId, row.attributeKey])) ||
        !row.normalization || typeof row.normalization !== 'object' || Array.isArray(row.normalization) || row.normalization.formatting !== undefined) return copy;
    const formatted = formatSkuDimensions(row.value);
    if (formatted === null || formatted === row.value) return copy;
    changes.push({ skuId: row.skuId, categoryId: row.categoryId, attributeKey: row.attributeKey, originalValue: row.value, value: formatted });
    copy.value = formatted;
    copy.normalization = { ...copy.normalization, formatting: { rule: 'dimensions', inputValue: row.value } };
    return copy;
  });
  return { rows: formattedRows, changes };
}

export function projectSkuText(rule: TextProjectionRule, quote: string, scope?: string): string | null {
  const text = quote.normalize('NFKC').trim();
  if (rule === 'material_name') {
    if (/^(?:纯棉|全棉)$/.test(text)) return '棉';
    const match = text.match(/^100(?:\.0+)?%\s*([\p{L}][\p{L}\s-]*)$/u);
    if (!match) return null;
    const name = match[1]!.trim();
    return /^(?:纯棉|全棉)$/.test(name) ? '棉' : name;
  }
  if (rule === 'dimensions') {
    const match = text.match(/^(.*)\s*\/\s*(节|张|片)$/);
    if (!match) return null;
    const dimension = match[1]!.trim();
    // Keep dimension order and physical units; never remove g/m² or invent mm.
    const number = '(?:\\d+(?:\\.\\d+)?)';
    const unit = '(?:mm|cm|m|毫米|厘米|米)';
    const pattern = new RegExp(`^${number}\\s*(?:${unit})?\\s*[xX×*]\\s*${number}\\s*${unit}(?:\\s*[xX×*]\\s*${number}\\s*${unit})?$`);
    return pattern.test(dimension) ? dimension : null;
  }
  if (rule === 'scoped_count') {
    if (!scope || !['包', '盒', '卷'].includes(scope)) return null;
    const match = text.match(/^(\d+(?:\.\d+)?\s*(?:抽|张|片|节|只|个|卷))\s*\/\s*(包|盒|卷)$/);
    return match && match[2] === scope ? match[1]!.replace(/\s+/g, '') : null;
  }
  return null;
}

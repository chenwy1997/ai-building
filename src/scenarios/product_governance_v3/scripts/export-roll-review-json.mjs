import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export function collectOpinions(index, headers, rows, reviewer, reviewedAt) {
  if (JSON.stringify(headers) !== JSON.stringify(index.workbookHeaders))
    throw Error("review worksheet headers changed");
  const seen = new Set(),
    group = new Map(),
    observations = [];
  for (const row of rows) {
    const id = row[14],
      decision = row[6],
      note = row[7];
    if (!id) {
      if (decision === "采用候选")
        throw Error("unknown values have no adoptable fact candidate");
      if (decision || note)
        observations.push({
          sku: row[0],
          attribute: row[2],
          decision: decision || null,
          note: note || null,
        });
      continue;
    }
    const original = index.candidates.find((c) => c.candidateId === id);
    if (!original || seen.has(id))
      throw Error("unknown or duplicate candidate row");
    seen.add(id);
    for (let i = 0; i < original.immutableCells.length; i++)
      if (
        !(i >= 6 && i <= 12) &&
        JSON.stringify(row[i] ?? null) !==
          JSON.stringify(original.immutableCells[i] ?? null)
      )
        throw Error(
          "candidate content changed; regenerate review material instead of editing evidence",
        );
    if (!decision) {
      if (note) observations.push({ candidateId: id, note });
      continue;
    }
    const action = {
      采用候选: "accept",
      驳回候选: "reject",
      暂缓核实: "defer",
    }[decision];
    if (!action) throw Error("unknown human decision");
    if (
      typeof reviewer !== "string" ||
      !reviewer.trim() ||
      typeof reviewedAt !== "string" ||
      !reviewedAt.trim()
    )
      throw Error(
        "reviewer and explicit UTC review time required on SKU与问题 B4/D4",
      );
    if (typeof note !== "string" || !note.trim())
      throw Error("each human decision needs its review reason");
    if (action === "accept" && !row.slice(8, 12).every((v) => v === "是"))
      throw Error("acceptance requires all four semantic checks");
    const file = group.get(original.bundleHash) ?? {
      sku: original.skuLabel,
      bundlePath: original.bundlePath,
      review: {
        bundleHash: original.bundleHash,
        reviewer,
        reviewedAt,
        decisions: [],
      },
    };
    file.review.decisions.push({
      candidateId: id,
      candidateHash: original.candidateHash,
      decision: action,
      conceptConfirmed: row[8] === "是",
      scopeConfirmed: row[9] === "是",
      unitConfirmed: row[10] === "是",
      conflictsChecked: row[11] === "是",
      note,
    });
    group.set(original.bundleHash, file);
  }
  if (seen.size !== index.candidates.length)
    throw Error(
      "missing candidate rows; filtered rows are valid but deleted rows are not",
    );
  return { files: [...group.values()], observations };
}
export async function exportReview(workbookPath, indexPath, outDir) {
  const { SpreadsheetFile, FileBlob } = await import("@oai/artifact-tool");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8")),
    wb = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
  const sh = wb.worksheets.getItem("事实审阅"),
    used = sh.getUsedRange().values,
    sku = wb.worksheets.getItem("SKU与问题");
  const headers = used[5].slice(0, index.workbookHeaders.length),
    rows = used.slice(6).filter((r) => r[0]);
  const result = collectOpinions(
    index,
    headers,
    rows,
    sku.getRange("B4").values[0][0],
    sku.getRange("D4").values[0][0],
  );
  await fs.mkdir(outDir, { recursive: true });
  for (const file of result.files)
    await fs.writeFile(
      join(outDir, file.sku + ".review.json"),
      JSON.stringify(file.review, null, 2),
    );
  const receipt = {
    kind: "local_workbook_opinion_export",
    indexPath,
    workbookPath,
    reviewFiles: result.files.map((f) => ({
      sku: f.sku,
      bundlePath: f.bundlePath,
      reviewPath: join(outDir, f.sku + ".review.json"),
      decisions: f.review.decisions.length,
    })),
    observations: result.observations,
    productionWrites: 0,
    automaticAdoptions: 0,
  };
  await fs.writeFile(
    join(outDir, "export-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  return {
    reviewFiles: result.files.length,
    observations: result.observations.length,
    productionWrites: 0,
    automaticAdoptions: 0,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 5)
    throw Error(
      "usage: node export-roll-review-json.mjs workbook.xlsx review-index.json /new/opinion-output-dir",
    );
  console.log(
    JSON.stringify(
      await exportReview(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
        resolve(process.argv[4]),
      ),
    ),
  );
}

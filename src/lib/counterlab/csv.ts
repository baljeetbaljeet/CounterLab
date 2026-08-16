import type {
  CellValue,
  ColumnProfile,
  DataRow,
  ParsedDataset,
  ResearchAnalysisKind,
  ResearchConfig,
} from "./types";

function countOutsideQuotes(input: string, character: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === '"') {
      if (quoted && input[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && input[index] === character) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(input: string): string {
  const firstRecord = input.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";", "|"];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: countOutsideQuotes(firstRecord, delimiter),
    }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ",";
}

function tokenizeDelimited(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const nextCharacter = input[index + 1];

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  if (quoted) {
    throw new Error("The delimited file contains an unterminated quoted value.");
  }

  return rows;
}

function coerceValue(value: string): CellValue {
  const normalized = value.trim();
  if (!normalized || /^(?:na|n\/a|null|nan)$/i.test(normalized)) {
    return null;
  }

  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  const lower = normalized.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return normalized;
}

function parseDelimited(input: string): ParsedDataset {
  const normalized = input.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalized);
  const tokenized = tokenizeDelimited(normalized, delimiter);
  if (tokenized.length < 2) {
    throw new Error("Add a header row and at least one data row.");
  }

  const columns = tokenized[0].map((column, index) => {
    const name = column.trim();
    return name || "column_" + (index + 1);
  });
  if (new Set(columns).size !== columns.length) {
    throw new Error("Every column needs a unique name.");
  }

  const rows = tokenized.slice(1).map((values) => {
    const row: DataRow = {};
    columns.forEach((column, index) => {
      row[column] = coerceValue(values[index] ?? "");
    });
    return row;
  });

  return {
    columns,
    rows,
    format: delimiter === "\t" ? "tsv" : delimiter === "," ? "csv" : "delimited",
  };
}

function jsonValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "number" && !Number.isFinite(value) ? null : value;
  }
  return JSON.stringify(value);
}

function recordsToDataset(
  decoded: unknown,
  format: "json" | "jsonl",
): ParsedDataset {
  if (!Array.isArray(decoded) || decoded.length === 0) {
    throw new Error("JSON datasets must contain one or more record objects.");
  }
  if (!decoded.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    throw new Error("Every JSON array item must be an object.");
  }

  const columns: string[] = [];
  const seen = new Set<string>();
  for (const item of decoded as Array<Record<string, unknown>>) {
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const rows = (decoded as Array<Record<string, unknown>>).map((item) => {
    const row: DataRow = {};
    columns.forEach((column) => {
      row[column] = jsonValue(item[column]);
    });
    return row;
  });
  return { columns, rows, format };
}

function parseJson(input: string): ParsedDataset {
  return recordsToDataset(JSON.parse(input) as unknown, "json");
}

function parseJsonLines(input: string): ParsedDataset {
  const records = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new Error(`JSON Lines record ${index + 1} is not valid JSON.`);
      }
    });
  return recordsToDataset(records, "jsonl");
}

export function parseDataset(input: string, filename = "dataset.csv"): ParsedDataset {
  const trimmed = input.trim();
  if (/\.(?:jsonl|ndjson)$/i.test(filename)) {
    return parseJsonLines(input);
  }
  if (/\.json$/i.test(filename) || trimmed.startsWith("[")) {
    try {
      return parseJson(input);
    } catch (error) {
      if (/\.json$/i.test(filename)) throw error;
    }
  }
  return parseDelimited(input);
}

export function parseCsv(input: string): ParsedDataset {
  return parseDelimited(input);
}

export function valueKey(value: CellValue): string {
  return value === null ? "__missing__" : String(value);
}

export function uniqueValues(rows: DataRow[], column: string): CellValue[] {
  const seen = new Map<string, CellValue>();
  for (const row of rows) {
    const value = row[column] ?? null;
    if (value !== null) seen.set(valueKey(value), value);
  }
  return [...seen.values()].sort((left, right) =>
    String(left).localeCompare(String(right), undefined, { numeric: true }),
  );
}

function isDateLike(name: string, values: CellValue[]): boolean {
  if (values.length < 3) return false;
  const strings = values.filter((value): value is string => typeof value === "string");
  if (strings.length / values.length < 0.8) return false;
  const parsed = strings.filter((value) => Number.isFinite(Date.parse(value))).length;
  const headerHint = /(?:date|time|timestamp|visit|recorded|year|month)/i.test(name);
  return parsed / strings.length >= (headerHint ? 0.7 : 0.9);
}

export function profileColumns(dataset: ParsedDataset): ColumnProfile[] {
  return dataset.columns.map((name) => {
    const values = dataset.rows
      .map((row) => row[name] ?? null)
      .filter((value): value is Exclude<CellValue, null> => value !== null);
    const unique = new Map<string, CellValue>();
    values.forEach((value) => unique.set(valueKey(value), value));
    const numericValues = values.filter((value): value is number => typeof value === "number");

    let kind: ColumnProfile["kind"] = "categorical";
    if (values.length === 0) kind = "empty";
    else if (unique.size === 2) kind = "binary";
    else if (numericValues.length === values.length) kind = "numeric";
    else if (isDateLike(name, values)) kind = "datetime";

    const profile: ColumnProfile = {
      name,
      kind,
      uniqueCount: unique.size,
      missingCount: dataset.rows.length - values.length,
      sampleValues: [...unique.values()].slice(0, 4),
    };
    if (numericValues.length) {
      profile.numericMinimum = Math.min(...numericValues);
      profile.numericMaximum = Math.max(...numericValues);
      profile.numericMean = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
    }
    return profile;
  });
}

function namedColumn(columns: string[], candidates: string[]): string | undefined {
  const normalized = new Map(columns.map((column) => [column.toLowerCase(), column]));
  return candidates.map((candidate) => normalized.get(candidate)).find(Boolean);
}

function profileMap(dataset: ParsedDataset): Map<string, ColumnProfile> {
  return new Map(profileColumns(dataset).map((profile) => [profile.name, profile]));
}

function defaultPositive(values: CellValue[]): CellValue {
  return values.find((value) =>
    ["1", "true", "yes", "success", "positive", "recovered", "case"].includes(String(value).toLowerCase()),
  ) ?? values[values.length - 1] ?? null;
}

export function inferConfigForKind(
  dataset: ParsedDataset,
  kind: ResearchAnalysisKind,
  claim = "The selected predictor is associated with the outcome.",
): ResearchConfig {
  const profiles = profileMap(dataset);
  const numeric = dataset.columns.filter((column) => profiles.get(column)?.kind === "numeric");
  const binary = dataset.columns.filter((column) => profiles.get(column)?.kind === "binary");
  const categorical = dataset.columns.filter((column) => {
    const profile = profiles.get(column);
    return profile && (profile.kind === "categorical" || profile.kind === "binary") && profile.uniqueCount <= 30;
  });
  const datetime = dataset.columns.filter((column) => profiles.get(column)?.kind === "datetime");
  const outcomeHint = namedColumn(dataset.columns, ["outcome", "response", "result", "target", "label", "success", "recovered", "score", "value", "measurement"]);
  const predictorHint = namedColumn(dataset.columns, ["treatment", "exposure", "intervention", "group", "condition", "predictor", "feature", "dose", "x"]);
  const weight = namedColumn(dataset.columns, ["count", "weight", "frequency", "n"]);
  const stratifier = namedColumn(dataset.columns, ["severity", "stratum", "site", "age_group", "sex", "cohort"]);
  const time = namedColumn(dataset.columns, ["date", "time", "timestamp", "visit_date", "recorded_at", "year", "month", "week", "day", "visit", "timepoint"]) ?? datetime[0];

  let outcome = outcomeHint ?? dataset.columns[dataset.columns.length - 1];
  let predictor = predictorHint ?? dataset.columns.find((column) => column !== outcome) ?? dataset.columns[0];

  if (kind === "binary-comparison") {
    outcome = (outcomeHint && binary.includes(outcomeHint) ? outcomeHint : binary[binary.length - 1]) ?? outcome;
    predictor = (predictorHint && categorical.includes(predictorHint) ? predictorHint : categorical.find((column) => column !== outcome)) ?? predictor;
  } else if (kind === "continuous-comparison") {
    outcome = (outcomeHint && numeric.includes(outcomeHint) ? outcomeHint : numeric.find((column) => column !== weight)) ?? outcome;
    predictor = (predictorHint && categorical.includes(predictorHint) ? predictorHint : categorical.find((column) => column !== outcome)) ?? predictor;
  } else if (kind === "association") {
    outcome = (outcomeHint && numeric.includes(outcomeHint) ? outcomeHint : numeric[numeric.length - 1]) ?? outcome;
    predictor = (predictorHint && numeric.includes(predictorHint) ? predictorHint : numeric.find((column) => column !== outcome)) ?? predictor;
  } else {
    outcome = (outcomeHint && numeric.includes(outcomeHint) ? outcomeHint : numeric.find((column) => column !== weight && column !== time)) ?? outcome;
    predictor = time ?? predictor;
  }

  const groups = uniqueValues(dataset.rows, predictor);
  const outcomes = uniqueValues(dataset.rows, outcome);
  return {
    kind,
    claim,
    outcome,
    predictor,
    time: kind === "time-series" ? time ?? predictor : undefined,
    stratifier:
      kind === "binary-comparison" || kind === "continuous-comparison"
        ? stratifier && stratifier !== outcome && stratifier !== predictor ? stratifier : undefined
        : undefined,
    weight: kind === "binary-comparison" || kind === "continuous-comparison" ? weight : undefined,
    positiveOutcome: kind === "binary-comparison" ? defaultPositive(outcomes) : undefined,
    referenceGroup: kind === "binary-comparison" || kind === "continuous-comparison" ? groups[0] ?? null : undefined,
    comparisonGroup: kind === "binary-comparison" || kind === "continuous-comparison" ? groups[1] ?? groups[0] ?? null : undefined,
    claimDirection: 1,
  };
}

export function detectResearchConfig(dataset: ParsedDataset): ResearchConfig {
  const profiles = profileColumns(dataset);
  const byName = new Map(profiles.map((profile) => [profile.name, profile]));
  const namedTime = namedColumn(dataset.columns, ["date", "time", "timestamp", "visit_date", "recorded_at", "year", "month", "week", "day", "visit", "timepoint"]);
  const time = profiles.find((profile) => profile.kind === "datetime") ??
    (namedTime && byName.get(namedTime)?.kind === "numeric" ? byName.get(namedTime) : undefined);
  const numeric = profiles.filter((profile) => profile.kind === "numeric" && !/^(?:count|weight|frequency|n)$/i.test(profile.name));
  const binaryProfiles = profiles.filter((profile) => profile.kind === "binary");
  const binary = binaryProfiles.find((profile) => /(?:outcome|response|result|target|label|success|recovered|case)/i.test(profile.name));
  const outcomeHint = namedColumn(dataset.columns, ["outcome", "response", "result", "target", "label", "success", "recovered", "score", "value", "measurement"]);
  const outcomeProfile = outcomeHint ? byName.get(outcomeHint) : undefined;
  const groupHint = namedColumn(dataset.columns, ["treatment", "exposure", "intervention", "group", "condition"]);
  const groupProfile = groupHint ? byName.get(groupHint) : undefined;
  const groupProfiles = profiles.filter((profile) =>
    (profile.kind === "categorical" || profile.kind === "binary") && profile.uniqueCount <= 30,
  );

  if (time && numeric.some((profile) => profile.name !== time.name)) {
    return inferConfigForKind(dataset, "time-series", "The measured outcome changes over time.");
  }
  if ((binary || outcomeProfile?.kind === "binary") && groupProfile && groupProfile.kind !== "numeric") {
    return inferConfigForKind(dataset, "binary-comparison", "The comparison group has a higher positive-outcome rate.");
  }
  if (numeric.length && groupProfile && groupProfile.kind !== "numeric") {
    return inferConfigForKind(dataset, "continuous-comparison", "The comparison group has a higher average outcome.");
  }
  if (numeric.length >= 2) {
    return inferConfigForKind(dataset, "association", "Higher predictor values are associated with higher outcome values.");
  }
  if (numeric.length === 1 && groupProfiles.some((profile) => profile.name !== numeric[0].name)) {
    return inferConfigForKind(dataset, "continuous-comparison", "The comparison group has a higher average outcome.");
  }
  if (binaryProfiles.length && groupProfiles.some((profile) => profile.name !== binaryProfiles[binaryProfiles.length - 1].name)) {
    return inferConfigForKind(dataset, "binary-comparison", "The comparison group has a higher positive-outcome rate.");
  }
  throw new Error("CounterLab could not identify a supported analysis. Include a numeric or binary outcome plus a group, numeric predictor, or date column.");
}

// Backward-compatible helper used by the original binary path.
export function inferDefaultColumns(dataset: ParsedDataset): {
  outcome: string;
  exposure: string;
  stratifier?: string;
  weight?: string;
} {
  const config = inferConfigForKind(dataset, "binary-comparison");
  return {
    outcome: config.outcome,
    exposure: config.predictor,
    stratifier: config.stratifier,
    weight: config.weight,
  };
}

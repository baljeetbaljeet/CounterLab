export type CellValue = string | number | boolean | null;

export type DataRow = Record<string, CellValue>;

export interface ParsedDataset {
  columns: string[];
  rows: DataRow[];
  format?: "csv" | "tsv" | "json" | "jsonl" | "delimited";
}

export interface ColumnProfile {
  name: string;
  kind: "numeric" | "categorical" | "binary" | "datetime" | "empty";
  uniqueCount: number;
  missingCount: number;
  sampleValues: CellValue[];
  numericMinimum?: number;
  numericMaximum?: number;
  numericMean?: number;
}

// Retained for the original weighted binary-outcome engine.
export interface AnalysisConfig {
  claim: string;
  outcome: string;
  exposure: string;
  stratifier?: string;
  weight?: string;
  positiveOutcome: CellValue;
  referenceGroup: CellValue;
  comparisonGroup: CellValue;
  claimDirection: 1 | -1;
}

export type SpecificationFamily =
  "Unadjusted" | "Adjusted" | "Subgroup" | "Robustness" | "Association" | "Trend";

export type EvidenceStatus = "supports" | "challenges" | "uncertain";

export interface SpecificationResult {
  id: string;
  label: string;
  shortLabel: string;
  family: SpecificationFamily;
  estimate: number;
  ciLow: number;
  ciHigh: number;
  pValue: number;
  sampleSize: number;
  status: EvidenceStatus;
  covariates: string[];
  evidence: string;
}

export interface GroupRate {
  group: string;
  successes: number;
  total: number;
  rate: number;
}

export interface DistributionRow {
  stratum: string;
  referenceShare: number;
  comparisonShare: number;
  gap: number;
}

export interface AnalysisTraceItem {
  title: string;
  detail: string;
  state: "complete" | "warning" | "discovery";
}

export interface AnalysisResult {
  verdict: "Robust" | "Fragile" | "Inconclusive";
  verdictTone: "positive" | "negative" | "neutral";
  headline: string;
  summary: string;
  observations: number;
  sourceRows: number;
  specifications: SpecificationResult[];
  groupRates: GroupRate[];
  aggregateEffect: number;
  adjustedEffect: number | null;
  reversalMagnitude: number | null;
  reversalFound: boolean;
  signStability: number;
  conclusiveRate: number;
  maxImbalance: number | null;
  distribution: DistributionRow[];
  findings: string[];
  trace: AnalysisTraceItem[];
  generatedAt: string;
  config: AnalysisConfig;
}

export interface ClaimSchema {
  kind?: ResearchAnalysisKind;
  outcome: string;
  exposure: string;
  predictor?: string;
  time?: string;
  stratifier?: string;
  weight?: string;
  positiveOutcome?: CellValue;
  referenceGroup?: CellValue;
  comparisonGroup?: CellValue;
  claimDirection: 1 | -1;
  rationale?: string;
}

export type ResearchAnalysisKind =
  "binary-comparison" | "continuous-comparison" | "association" | "time-series";

export type EffectScale = "proportion" | "raw" | "correlation" | "per-day" | "per-time-unit";

export interface ResearchConfig {
  kind: ResearchAnalysisKind;
  claim: string;
  outcome: string;
  predictor: string;
  time?: string;
  stratifier?: string;
  weight?: string;
  positiveOutcome?: CellValue;
  referenceGroup?: CellValue;
  comparisonGroup?: CellValue;
  claimDirection: 1 | -1;
}

export interface ResearchMetric {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "teal" | "alert";
}

export interface ResearchAnalysisResult {
  kind: ResearchAnalysisKind;
  kindLabel: string;
  methodLabel: string;
  verdict: "Robust" | "Fragile" | "Inconclusive";
  verdictTone: "positive" | "negative" | "neutral";
  headline: string;
  summary: string;
  observations: number;
  sourceRows: number;
  completeRows: number;
  missingRows: number;
  effectScale: EffectScale;
  effectLabel: string;
  primaryLabel: string;
  secondaryLabel: string;
  primaryEstimate: number;
  secondaryEstimate: number | null;
  specifications: SpecificationResult[];
  signStability: number;
  conclusiveRate: number;
  reversalFound: boolean;
  findings: string[];
  trace: AnalysisTraceItem[];
  qualityWarnings: string[];
  assumptions: string[];
  limitations: string[];
  metrics: ResearchMetric[];
  generatedAt: string;
  config: ResearchConfig;
}

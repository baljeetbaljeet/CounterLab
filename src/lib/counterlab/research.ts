import { analyzeClaim } from "./analysis";
import { uniqueValues, valueKey } from "./csv";
import {
  averageRanks,
  bootstrapDifference,
  correlationInference,
  linearRegression,
  median,
  normalCdf,
  pearsonCorrelation,
  summarize,
  theilSenSlope,
  trimmedMean,
  weightedSummary,
  welchDifference,
  winsorize,
  type IntervalEstimate,
  type NumericSummary,
} from "./statistics";
import type {
  AnalysisConfig,
  CellValue,
  DataRow,
  EffectScale,
  EvidenceStatus,
  ResearchAnalysisKind,
  ResearchAnalysisResult,
  ResearchConfig,
  ResearchMetric,
  SpecificationFamily,
  SpecificationResult,
} from "./types";

function sameValue(left: CellValue, right: CellValue): boolean {
  return valueKey(left) === valueKey(right);
}

function numericValue(value: CellValue): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function rowWeight(row: DataRow, column?: string): number {
  if (!column) return 1;
  const value = numericValue(row[column] ?? null);
  return value !== null && value > 0 ? value : 0;
}

function statusForInterval(ciLow: number, ciHigh: number, direction: 1 | -1): EvidenceStatus {
  if (direction === 1 && ciLow > 0) return "supports";
  if (direction === -1 && ciHigh < 0) return "supports";
  if (direction === 1 && ciHigh < 0) return "challenges";
  if (direction === -1 && ciLow > 0) return "challenges";
  return "uncertain";
}

function specification(
  id: string,
  label: string,
  shortLabel: string,
  family: SpecificationFamily,
  estimate: IntervalEstimate,
  config: ResearchConfig,
  evidence: string,
  covariates: string[] = [],
): SpecificationResult {
  return {
    id,
    label,
    shortLabel,
    family,
    estimate: estimate.estimate,
    ciLow: estimate.ciLow,
    ciHigh: estimate.ciHigh,
    pValue: estimate.pValue,
    sampleSize: estimate.sampleSize,
    status: statusForInterval(estimate.ciLow, estimate.ciHigh, config.claimDirection),
    evidence,
    covariates,
  };
}

function kindLabel(kind: ResearchAnalysisKind): string {
  const labels: Record<ResearchAnalysisKind, string> = {
    "binary-comparison": "Binary outcome comparison",
    "continuous-comparison": "Continuous or count comparison",
    association: "Numeric association",
    "time-series": "Longitudinal trend",
  };
  return labels[kind];
}

function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if ((absolute > 0 && absolute < 0.001) || absolute >= 10000) {
    return value.toExponential(2);
  }
  const sign = value > 0 ? "+" : "";
  return sign + value.toFixed(digits).replace(/\.?0+$/, "");
}

export function formatResearchEffect(value: number, scale: EffectScale): string {
  if (scale === "proportion") {
    const sign = value > 0 ? "+" : "";
    return sign + (value * 100).toFixed(1) + " pp";
  }
  if (scale === "correlation") return "r=" + formatNumber(value, 2);
  if (scale === "per-day") return formatNumber(value, 3) + "/day";
  if (scale === "per-time-unit") return formatNumber(value, 3) + "/unit";
  return formatNumber(value, 3);
}

export function formatResearchPValue(value: number): string {
  return value < 0.001 ? "<0.001" : value.toFixed(3);
}

function commonResult(
  config: ResearchConfig,
  specifications: SpecificationResult[],
): {
  verdict: ResearchAnalysisResult["verdict"];
  verdictTone: ResearchAnalysisResult["verdictTone"];
  signStability: number;
  conclusiveRate: number;
  reversalFound: boolean;
} {
  const supportingSigns = specifications.filter(
    (item) => Math.sign(item.estimate) === config.claimDirection,
  ).length;
  const conclusive = specifications.filter((item) => item.status !== "uncertain");
  const supports = conclusive.filter((item) => item.status === "supports").length;
  const challenges = conclusive.filter((item) => item.status === "challenges").length;
  const signStability = specifications.length ? supportingSigns / specifications.length : 0;
  const conclusiveRate = specifications.length ? conclusive.length / specifications.length : 0;
  const reversalFound = supports > 0 && challenges > 0;

  if (reversalFound) {
    return {
      verdict: "Fragile",
      verdictTone: "negative",
      signStability,
      conclusiveRate,
      reversalFound,
    };
  }
  if (challenges > 0) {
    return {
      verdict: "Fragile",
      verdictTone: "negative",
      signStability,
      conclusiveRate,
      reversalFound,
    };
  }
  if (conclusive.length >= 2 && supports === conclusive.length) {
    return {
      verdict: "Robust",
      verdictTone: "positive",
      signStability,
      conclusiveRate,
      reversalFound,
    };
  }
  return {
    verdict: "Inconclusive",
    verdictTone: "neutral",
    signStability,
    conclusiveRate,
    reversalFound,
  };
}

function completeCount(rows: DataRow[], columns: string[]): number {
  return rows.filter((row) =>
    columns.every((column) => row[column] !== null && row[column] !== undefined),
  ).length;
}

function binaryAnalysis(rows: DataRow[], config: ResearchConfig): ResearchAnalysisResult {
  if (
    config.positiveOutcome === undefined ||
    config.referenceGroup === undefined ||
    config.comparisonGroup === undefined
  ) {
    throw new Error("Binary comparison requires a positive outcome and two selected groups.");
  }
  const binaryConfig: AnalysisConfig = {
    claim: config.claim,
    outcome: config.outcome,
    exposure: config.predictor,
    stratifier: config.stratifier,
    weight: config.weight,
    positiveOutcome: config.positiveOutcome,
    referenceGroup: config.referenceGroup,
    comparisonGroup: config.comparisonGroup,
    claimDirection: config.claimDirection,
  };
  const result = analyzeClaim(rows, binaryConfig);
  const required = [
    config.outcome,
    config.predictor,
    ...(config.stratifier ? [config.stratifier] : []),
  ];
  const completeRows = completeCount(rows, required);
  const qualityWarnings: string[] = [];
  if (completeRows < rows.length)
    qualityWarnings.push(
      `${rows.length - completeRows} rows have missing required fields and are excluded where applicable.`,
    );
  if (result.groupRates.some((group) => group.total < 20))
    qualityWarnings.push(
      "At least one comparison group has fewer than 20 weighted observations; normal intervals may be unstable.",
    );
  if (!config.stratifier)
    qualityWarnings.push(
      "No stratifier is selected, so confounding sensitivity cannot be evaluated.",
    );

  const metrics: ResearchMetric[] = [
    {
      label: "Observations",
      value: Math.round(result.observations).toLocaleString("en-US"),
      detail: `${completeRows} complete source rows`,
    },
    {
      label: "Specifications",
      value: String(result.specifications.length),
      detail: `${Math.round(result.conclusiveRate * 100)}% conclusive`,
      tone: "teal",
    },
    {
      label: "Direction shift",
      value:
        result.reversalMagnitude === null
          ? "—"
          : formatResearchEffect(result.reversalMagnitude, "proportion"),
      detail: "unadjusted-to-adjusted magnitude",
      tone: result.reversalFound ? "alert" : "default",
    },
    {
      label: "Max. imbalance",
      value: result.maxImbalance === null ? "—" : (result.maxImbalance * 100).toFixed(1) + "%",
      detail: "between-group stratum gap",
      tone: result.maxImbalance !== null && result.maxImbalance >= 0.15 ? "alert" : "default",
    },
  ];

  return {
    kind: config.kind,
    kindLabel: kindLabel(config.kind),
    methodLabel: "Risk difference · stratified standardization",
    verdict: result.verdict,
    verdictTone: result.verdictTone,
    headline: result.headline,
    summary: result.summary,
    observations: result.observations,
    sourceRows: rows.length,
    completeRows,
    missingRows: rows.length - completeRows,
    effectScale: "proportion",
    effectLabel: "Risk difference",
    primaryLabel: "Unadjusted",
    secondaryLabel: "Adjusted",
    primaryEstimate: result.aggregateEffect,
    secondaryEstimate: result.adjustedEffect,
    specifications: result.specifications,
    signStability: result.signStability,
    conclusiveRate: result.conclusiveRate,
    reversalFound: result.reversalFound,
    findings: result.findings,
    trace: result.trace,
    qualityWarnings,
    assumptions: [
      "The outcome is binary and frequency weights, when selected, represent independent observations.",
      "Normal-approximation intervals are adequate for the observed group counts.",
      "Selected strata are measured before or independently of the outcome.",
    ],
    limitations: [
      "Risk differences and stratified standardization do not establish causality.",
      "Sparse cells can make normal-approximation intervals unreliable.",
    ],
    metrics,
    generatedAt: result.generatedAt,
    config,
  };
}

interface GroupSample {
  values: number[];
  weights: number[];
  summary: NumericSummary;
}

function groupSample(
  rows: DataRow[],
  config: ResearchConfig,
  group: CellValue,
  stratum?: CellValue,
): GroupSample {
  const values: number[] = [];
  const weights: number[] = [];
  for (const row of rows) {
    if (!sameValue(row[config.predictor] ?? null, group)) continue;
    if (
      config.stratifier &&
      stratum !== undefined &&
      !sameValue(row[config.stratifier] ?? null, stratum)
    )
      continue;
    const value = numericValue(row[config.outcome] ?? null);
    const weight = rowWeight(row, config.weight);
    if (value === null || weight <= 0) continue;
    values.push(value);
    weights.push(weight);
  }
  return {
    values,
    weights,
    summary: config.weight ? weightedSummary(values, weights) : summarize(values),
  };
}

function intervalFromPooled(items: IntervalEstimate[]): IntervalEstimate {
  const weights = items.map((item) => 1 / Math.max(item.standardError ** 2, 1e-12));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const estimate =
    items.reduce((sum, item, index) => sum + item.estimate * weights[index], 0) / weightTotal;
  const standardError = Math.sqrt(1 / weightTotal);
  const z = estimate / standardError;
  return {
    estimate,
    ciLow: estimate - 1.96 * standardError,
    ciHigh: estimate + 1.96 * standardError,
    pValue: 2 * (1 - normalCdf(Math.abs(z))),
    standardError,
    sampleSize: items.reduce((sum, item) => sum + item.sampleSize, 0),
  };
}

function continuousAnalysis(rows: DataRow[], config: ResearchConfig): ResearchAnalysisResult {
  if (config.referenceGroup === undefined || config.comparisonGroup === undefined) {
    throw new Error("Continuous comparison requires two selected groups.");
  }
  if (sameValue(config.referenceGroup, config.comparisonGroup)) {
    throw new Error("Reference and comparison must be different groups.");
  }
  const reference = groupSample(rows, config, config.referenceGroup);
  const comparison = groupSample(rows, config, config.comparisonGroup);
  const primary = welchDifference(reference.summary, comparison.summary);
  const specs: SpecificationResult[] = [
    specification(
      "welch",
      "Welch unequal-variance mean comparison",
      "Welch mean",
      "Unadjusted",
      primary,
      config,
      `${String(config.comparisonGroup)} minus ${String(config.referenceGroup)} using a Welch t interval.`,
    ),
  ];

  if (!config.weight) {
    try {
      const trimmed = bootstrapDifference(reference.values, comparison.values, (values) =>
        trimmedMean(values, 0.1),
      );
      const medians = bootstrapDifference(reference.values, comparison.values, median);
      specs.push(
        specification(
          "trimmed",
          "10% trimmed-mean sensitivity",
          "Trimmed mean",
          "Robustness",
          trimmed,
          config,
          "Deterministic percentile bootstrap after trimming 10% from each tail.",
        ),
        specification(
          "median",
          "Median-difference sensitivity",
          "Median",
          "Robustness",
          medians,
          config,
          "Deterministic percentile bootstrap of the between-group median difference.",
        ),
      );
    } catch {
      // Small datasets still retain the valid Welch primary estimate.
    }
  }

  let adjusted: IntervalEstimate | null = null;
  if (config.stratifier) {
    const subgroupIntervals: IntervalEstimate[] = [];
    for (const stratum of uniqueValues(rows, config.stratifier).slice(0, 12)) {
      try {
        const subgroupReference = groupSample(rows, config, config.referenceGroup, stratum);
        const subgroupComparison = groupSample(rows, config, config.comparisonGroup, stratum);
        const interval = welchDifference(subgroupReference.summary, subgroupComparison.summary);
        subgroupIntervals.push(interval);
        specs.push(
          specification(
            "subgroup-" + valueKey(stratum),
            `${config.stratifier}: ${String(stratum)}`,
            String(stratum),
            "Subgroup",
            interval,
            config,
            "Welch comparison estimated within this stratum.",
            [config.stratifier],
          ),
        );
      } catch {
        // Incomplete strata are omitted and disclosed in the audit.
      }
    }
    if (subgroupIntervals.length >= 2) {
      adjusted = intervalFromPooled(subgroupIntervals);
      specs.push(
        specification(
          "stratified-pooled",
          "Inverse-variance stratified estimate",
          "Stratified pooled",
          "Adjusted",
          adjusted,
          config,
          "Fixed-effect pooling of complete stratum-specific mean differences.",
          [config.stratifier],
        ),
      );
    }
  }

  const common = commonResult(config, specs);
  const completeRows = rows.filter(
    (row) =>
      numericValue(row[config.outcome] ?? null) !== null &&
      (!config.weight || rowWeight(row, config.weight) > 0) &&
      (sameValue(row[config.predictor] ?? null, config.referenceGroup!) ||
        sameValue(row[config.predictor] ?? null, config.comparisonGroup!)),
  ).length;
  const pooledVariance =
    ((reference.summary.n - 1) * reference.summary.variance +
      (comparison.summary.n - 1) * comparison.summary.variance) /
    Math.max(1, reference.summary.n + comparison.summary.n - 2);
  const pooledSd = Math.sqrt(Math.max(pooledVariance, 1e-12));
  const totalN = reference.summary.n + comparison.summary.n;
  const hedgesCorrection = 1 - 3 / Math.max(4 * totalN - 9, 1);
  const hedgesG = (primary.estimate / pooledSd) * hedgesCorrection;
  const qualityWarnings: string[] = [];
  if (rows.length - completeRows > 0)
    qualityWarnings.push(
      `${rows.length - completeRows} rows are excluded from the primary comparison because the outcome or selected group is missing.`,
    );
  if (reference.summary.n < 20 || comparison.summary.n < 20)
    qualityWarnings.push(
      "At least one group has fewer than 20 observations; inspect distributions and interval width carefully.",
    );
  if (config.weight)
    qualityWarnings.push(
      "Robust trimmed-mean and median bootstrap checks are disabled for frequency-weighted files.",
    );
  if (!config.stratifier)
    qualityWarnings.push(
      "No stratifier is selected; the result is not adjusted for measured confounding.",
    );
  if (Math.abs(primary.estimate / pooledSd) > 2)
    qualityWarnings.push(
      "The standardized difference is unusually large; verify units, coding, and influential observations.",
    );

  const metrics: ResearchMetric[] = [
    {
      label: "Complete observations",
      value: Math.round(primary.sampleSize).toLocaleString("en-US"),
      detail: `${completeRows} complete source rows`,
    },
    {
      label: "Mean difference",
      value: formatResearchEffect(primary.estimate, "raw"),
      detail: `${String(config.comparisonGroup)} minus ${String(config.referenceGroup)}`,
      tone: "teal",
    },
    {
      label: "Hedges' g",
      value: formatNumber(hedgesG, 2),
      detail: "small-sample corrected standardized effect",
    },
    {
      label: "Sensitivity span",
      value: formatResearchEffect(
        Math.max(...specs.map((item) => item.estimate)) -
          Math.min(...specs.map((item) => item.estimate)),
        "raw",
      ),
      detail: "range across executed specifications",
      tone: common.reversalFound ? "alert" : "default",
    },
  ];

  const headline =
    common.verdict === "Fragile"
      ? common.reversalFound
        ? "The estimated direction changes across defensible analyses."
        : "The estimated effect contradicts the stated claim."
      : common.verdict === "Robust"
        ? "The group difference remains directionally stable."
        : "Uncertainty prevents a stable directional conclusion.";
  const summary = `Welch's comparison estimates ${String(config.comparisonGroup)} minus ${String(config.referenceGroup)} at ${formatResearchEffect(primary.estimate, "raw")} (95% CI ${formatResearchEffect(primary.ciLow, "raw")} to ${formatResearchEffect(primary.ciHigh, "raw")}). ${adjusted ? `The stratified estimate is ${formatResearchEffect(adjusted.estimate, "raw")}.` : "No complete stratified estimate is available."}`;

  return {
    kind: config.kind,
    kindLabel: kindLabel(config.kind),
    methodLabel: "Welch comparison · robust location sensitivities",
    ...common,
    headline,
    summary,
    observations: primary.sampleSize,
    sourceRows: rows.length,
    completeRows,
    missingRows: rows.length - completeRows,
    effectScale: "raw",
    effectLabel: "Outcome difference",
    primaryLabel: "Welch mean",
    secondaryLabel: adjusted ? "Stratified" : "Robust median",
    primaryEstimate: primary.estimate,
    secondaryEstimate:
      adjusted?.estimate ?? specs.find((item) => item.id === "median")?.estimate ?? null,
    specifications: specs,
    findings: [
      `${String(config.referenceGroup)} mean: ${formatNumber(reference.summary.mean)}; ${String(config.comparisonGroup)} mean: ${formatNumber(comparison.summary.mean)}.`,
      `The standardized effect is Hedges' g=${formatNumber(hedgesG, 2)}.`,
      common.reversalFound
        ? "At least one conclusive sensitivity estimate points in the opposite direction."
        : "No conclusive direction reversal was detected.",
    ],
    trace: [
      {
        title: "Analysis family validated",
        detail: "A numeric outcome and two comparison groups were mapped successfully.",
        state: "complete",
      },
      {
        title: "Welch primary model executed",
        detail: "Unequal group variances and sample sizes are allowed.",
        state: "complete",
      },
      {
        title: "Robustness specifications audited",
        detail: `${specs.length} comparable effect estimates were executed.`,
        state: common.reversalFound ? "discovery" : "complete",
      },
      ...(qualityWarnings.length
        ? [
            {
              title: "Data-quality cautions recorded",
              detail: qualityWarnings[0],
              state: "warning" as const,
            },
          ]
        : []),
    ],
    qualityWarnings,
    assumptions: [
      "Observations are independent within and between groups.",
      "The outcome is meaningfully numeric and measured on a comparable scale.",
      "Welch inference is used for the primary mean comparison; bootstrap sensitivities are deterministic and exploratory.",
    ],
    limitations: [
      "Group comparisons are associational unless treatment assignment and design justify causal interpretation.",
      "The browser implementation does not fit multivariable regression or clustered random effects.",
    ],
    metrics,
    generatedAt: new Date().toISOString(),
    config,
  };
}

function pairedValues(
  rows: DataRow[],
  xColumn: string,
  yColumn: string,
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const row of rows) {
    const xValue = numericValue(row[xColumn] ?? null);
    const yValue = numericValue(row[yColumn] ?? null);
    if (xValue === null || yValue === null) continue;
    x.push(xValue);
    y.push(yValue);
  }
  return { x, y };
}

function associationAnalysis(rows: DataRow[], config: ResearchConfig): ResearchAnalysisResult {
  const paired = pairedValues(rows, config.predictor, config.outcome);
  if (paired.x.length < 4)
    throw new Error("Numeric association needs at least four complete paired observations.");
  const pearson = correlationInference(pearsonCorrelation(paired.x, paired.y), paired.x.length);
  const spearman = correlationInference(
    pearsonCorrelation(averageRanks(paired.x), averageRanks(paired.y)),
    paired.x.length,
  );
  const winsorized = correlationInference(
    pearsonCorrelation(winsorize(paired.x), winsorize(paired.y)),
    paired.x.length,
  );
  const specs = [
    specification(
      "pearson",
      "Pearson linear association",
      "Pearson",
      "Association",
      pearson,
      config,
      "Product-moment correlation with Fisher-z confidence interval.",
    ),
    specification(
      "spearman",
      "Spearman rank association",
      "Spearman",
      "Robustness",
      spearman,
      config,
      "Average-rank correlation, less sensitive to monotonic nonlinearity and outliers.",
    ),
    specification(
      "winsorized",
      "5% winsorized Pearson association",
      "Winsorized",
      "Robustness",
      winsorized,
      config,
      "Both variables are capped at their 5th and 95th percentiles before correlation.",
    ),
  ];
  if (paired.x.every((value) => value >= 0) && paired.y.every((value) => value >= 0)) {
    const transformed = correlationInference(
      pearsonCorrelation(paired.x.map(Math.log1p), paired.y.map(Math.log1p)),
      paired.x.length,
    );
    specs.push(
      specification(
        "log1p",
        "Log1p-transformed association",
        "Log transformed",
        "Robustness",
        transformed,
        config,
        "Pearson correlation after log(1+x) transformation of non-negative variables.",
      ),
    );
  }
  const regression = linearRegression(paired.x, paired.y);
  const common = commonResult(config, specs);
  const missingRows = rows.length - paired.x.length;
  const qualityWarnings: string[] = [];
  if (missingRows)
    qualityWarnings.push(`${missingRows} rows are excluded by complete-case analysis.`);
  if (paired.x.length < 30)
    qualityWarnings.push(
      "Fewer than 30 complete pairs are available; correlation intervals may be wide.",
    );
  if (Math.abs(pearson.estimate - spearman.estimate) >= 0.2)
    qualityWarnings.push(
      "Pearson and Spearman differ materially, suggesting outliers or a nonlinear monotonic relationship.",
    );
  if (Math.abs(pearson.estimate - winsorized.estimate) >= 0.15)
    qualityWarnings.push(
      "Winsorization materially changes the estimate, indicating influential tail values.",
    );

  const headline =
    common.verdict === "Fragile"
      ? common.reversalFound
        ? "The association changes direction under robustness checks."
        : "The association contradicts the stated claim."
      : common.verdict === "Robust"
        ? "The association is directionally stable across estimators."
        : "The association remains statistically uncertain.";
  const summary = `Pearson correlation is ${formatResearchEffect(pearson.estimate, "correlation")} (95% CI ${formatNumber(pearson.ciLow, 2)} to ${formatNumber(pearson.ciHigh, 2)}). Spearman rank correlation is ${formatResearchEffect(spearman.estimate, "correlation")}.`;
  return {
    kind: config.kind,
    kindLabel: kindLabel(config.kind),
    methodLabel: "Pearson · Spearman · winsorized sensitivity",
    ...common,
    headline,
    summary,
    observations: paired.x.length,
    sourceRows: rows.length,
    completeRows: paired.x.length,
    missingRows,
    effectScale: "correlation",
    effectLabel: "Correlation coefficient",
    primaryLabel: "Pearson",
    secondaryLabel: "Spearman",
    primaryEstimate: pearson.estimate,
    secondaryEstimate: spearman.estimate,
    specifications: specs,
    findings: [
      `The OLS slope is ${formatNumber(regression.estimate)} outcome units per predictor unit (R²=${regression.rSquared.toFixed(2)}).`,
      `Pearson–Spearman difference: ${Math.abs(pearson.estimate - spearman.estimate).toFixed(2)}.`,
      common.reversalFound
        ? "At least one conclusive estimator points in the opposite direction."
        : "No conclusive sign reversal was detected.",
    ],
    trace: [
      {
        title: "Complete pairs validated",
        detail: `${paired.x.length} rows contain both numeric variables.`,
        state: "complete",
      },
      {
        title: "Linear association estimated",
        detail: `Pearson ${formatResearchEffect(pearson.estimate, "correlation")}; p=${formatResearchPValue(pearson.pValue)}.`,
        state: "complete",
      },
      {
        title: "Rank and tail sensitivity audited",
        detail: `${specs.length - 1} robustness specifications were compared with Pearson.`,
        state: common.reversalFound ? "discovery" : "complete",
      },
      ...(qualityWarnings.length
        ? [
            {
              title: "Data-quality cautions recorded",
              detail: qualityWarnings[0],
              state: "warning" as const,
            },
          ]
        : []),
    ],
    qualityWarnings,
    assumptions: [
      "Rows are independent and the selected variables are measured on meaningful numeric scales.",
      "Pearson inference assumes an approximately linear, homoscedastic relationship for confirmatory interpretation.",
      "Complete-case analysis is reasonable for the observed missingness mechanism.",
    ],
    limitations: [
      "Correlation does not establish direction, mechanism, or causality.",
      "The current route does not adjust for additional confounders or clustered sampling.",
    ],
    metrics: [
      {
        label: "Complete pairs",
        value: paired.x.length.toLocaleString("en-US"),
        detail: `${missingRows} rows excluded`,
      },
      {
        label: "Pearson r",
        value: formatNumber(pearson.estimate, 2),
        detail: `p=${formatResearchPValue(pearson.pValue)}`,
        tone: "teal",
      },
      {
        label: "Spearman ρ",
        value: formatNumber(spearman.estimate, 2),
        detail: "rank-based sensitivity",
      },
      {
        label: "R²",
        value: regression.rSquared.toFixed(2),
        detail: "simple linear model variance explained",
      },
    ],
    generatedAt: new Date().toISOString(),
    config,
  };
}

function timeValue(value: CellValue): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 86_400_000 : null;
  }
  return null;
}

function trendAnalysis(rows: DataRow[], config: ResearchConfig): ResearchAnalysisResult {
  const timeColumn = config.time ?? config.predictor;
  const calendarTime = rows.some(
    (row) =>
      typeof row[timeColumn] === "string" && Number.isFinite(Date.parse(String(row[timeColumn]))),
  );
  const trendScale: EffectScale = calendarTime ? "per-day" : "per-time-unit";
  const points = rows
    .map((row) => ({
      time: timeValue(row[timeColumn] ?? null),
      outcome: numericValue(row[config.outcome] ?? null),
    }))
    .filter(
      (point): point is { time: number; outcome: number } =>
        point.time !== null && point.outcome !== null,
    )
    .sort((left, right) => left.time - right.time);
  if (points.length < 8)
    throw new Error("Longitudinal trend analysis needs at least eight complete time points.");
  const origin = points[0].time;
  const x = points.map((point) => point.time - origin);
  const y = points.map((point) => point.outcome);
  const range = x[x.length - 1] - x[0];
  if (range <= 0) throw new Error("The time column needs at least two distinct values.");
  const iid = linearRegression(x, y);
  const hacLag = Math.max(1, Math.floor(4 * (points.length / 100) ** (2 / 9)));
  const hac = linearRegression(x, y, hacLag);
  const senSlope = theilSenSlope(x, y);
  const sen: IntervalEstimate = {
    estimate: senSlope,
    ciLow: senSlope - 1.96 * hac.standardError,
    ciHigh: senSlope + 1.96 * hac.standardError,
    pValue: 2 * (1 - normalCdf(Math.abs(senSlope / hac.standardError))),
    standardError: hac.standardError,
    sampleSize: points.length,
  };
  const specs: SpecificationResult[] = [
    specification(
      "ols-hac",
      "OLS trend with Newey–West uncertainty",
      "HAC trend",
      "Trend",
      hac,
      config,
      `Slope per day with Bartlett-kernel HAC standard error, lag ${hacLag}.`,
    ),
    specification(
      "ols-iid",
      "OLS trend with independent-error uncertainty",
      "IID trend",
      "Trend",
      iid,
      config,
      "Same slope with conventional independent-error standard error.",
    ),
    specification(
      "theil-sen",
      "Theil–Sen robust trend",
      "Theil–Sen",
      "Robustness",
      sen,
      config,
      "Median pairwise slope; interval uses the HAC standard-error scale as a sensitivity approximation.",
    ),
  ];
  const midpoint = Math.floor(points.length / 2);
  for (const [id, label, start, end] of [
    ["early", "Early-period trend", 0, midpoint],
    ["late", "Late-period trend", midpoint, points.length],
  ] as const) {
    if (end - start >= 4) {
      const segment = linearRegression(x.slice(start, end), y.slice(start, end));
      specs.push(
        specification(
          id,
          label,
          id === "early" ? "Early period" : "Late period",
          "Subgroup",
          segment,
          config,
          "OLS slope estimated in one temporal half.",
        ),
      );
    }
  }
  const common = commonResult(config, specs);
  const missingRows = rows.length - points.length;
  let residualAutocorrelation = 0;
  if (hac.residuals.length >= 4) {
    try {
      residualAutocorrelation = pearsonCorrelation(
        hac.residuals.slice(0, -1),
        hac.residuals.slice(1),
      );
    } catch {
      // A perfectly fitted trend has constant zero residuals and no estimable lag correlation.
      residualAutocorrelation = 0;
    }
  }
  const duplicateTimes = points.length - new Set(points.map((point) => point.time)).size;
  const qualityWarnings: string[] = [];
  if (missingRows)
    qualityWarnings.push(
      `${missingRows} rows are excluded because time or outcome is missing or invalid.`,
    );
  if (duplicateTimes)
    qualityWarnings.push(
      `${duplicateTimes} observations share a time value; verify whether repeated measures require clustering.`,
    );
  if (Math.abs(residualAutocorrelation) >= 0.3)
    qualityWarnings.push(
      "Residual lag-1 autocorrelation is material; HAC uncertainty is preferred over the IID interval.",
    );
  if (points.length < 20)
    qualityWarnings.push(
      "Fewer than 20 time points are available; trend and autocorrelation estimates may be unstable.",
    );

  const headline =
    common.verdict === "Fragile"
      ? common.reversalFound
        ? "The trend direction is not stable across time or estimators."
        : "The observed trend contradicts the stated claim."
      : common.verdict === "Robust"
        ? "The longitudinal trend is directionally stable."
        : "The data do not establish a stable temporal trend.";
  const summary = `The Newey–West trend is ${formatResearchEffect(hac.estimate, trendScale)} (95% CI ${formatResearchEffect(hac.ciLow, trendScale)} to ${formatResearchEffect(hac.ciHigh, trendScale)}). The Theil–Sen sensitivity estimate is ${formatResearchEffect(senSlope, trendScale)}.`;
  return {
    kind: config.kind,
    kindLabel: kindLabel(config.kind),
    methodLabel: "OLS · Newey–West HAC · Theil–Sen",
    ...common,
    headline,
    summary,
    observations: points.length,
    sourceRows: rows.length,
    completeRows: points.length,
    missingRows,
    effectScale: trendScale,
    effectLabel: "Outcome slope",
    primaryLabel: "HAC trend",
    secondaryLabel: "Theil–Sen",
    primaryEstimate: hac.estimate,
    secondaryEstimate: senSlope,
    specifications: specs,
    findings: [
      `Observed time span: ${formatNumber(range, 1)} days across ${points.length} complete observations.`,
      `Residual lag-1 autocorrelation: ${formatNumber(residualAutocorrelation, 2)}.`,
      common.reversalFound
        ? "Early, late, or robust trend estimates include a conclusive direction conflict."
        : "No conclusive direction reversal was detected across temporal specifications.",
    ],
    trace: [
      {
        title: "Temporal ordering validated",
        detail: `${points.length} observations were parsed and sorted across ${formatNumber(range, 1)} days.`,
        state: "complete",
      },
      {
        title: "Autocorrelation-robust trend estimated",
        detail: `Newey–West lag ${hacLag}; slope ${formatResearchEffect(hac.estimate, trendScale)}.`,
        state: "complete",
      },
      {
        title: "Robust and segmented trends audited",
        detail: `${specs.length - 1} sensitivity specifications were executed.`,
        state: common.reversalFound ? "discovery" : "complete",
      },
      ...(qualityWarnings.length
        ? [
            {
              title: "Longitudinal cautions recorded",
              detail: qualityWarnings[0],
              state: "warning" as const,
            },
          ]
        : []),
    ],
    qualityWarnings,
    assumptions: [
      "The selected date/time values are correctly ordered and the numeric outcome is comparable over time.",
      "A linear slope is an interpretable first-order summary of the study period.",
      "Newey–West HAC uncertainty addresses short-range heteroskedasticity and autocorrelation, not all longitudinal dependence.",
    ],
    limitations: [
      "The route does not model seasonality, interventions, individual-level repeated measures, or nonlinear trajectories.",
      "Temporal association alone does not establish that time or an intervention caused the observed change.",
    ],
    metrics: [
      {
        label: "Time points",
        value: points.length.toLocaleString("en-US"),
        detail: `${formatNumber(range, 1)}-day observed span`,
      },
      {
        label: "HAC slope",
        value: formatResearchEffect(hac.estimate, trendScale),
        detail: `p=${formatResearchPValue(hac.pValue)}`,
        tone: "teal",
      },
      {
        label: "Theil–Sen",
        value: formatResearchEffect(senSlope, trendScale),
        detail: "robust median pairwise slope",
      },
      {
        label: "Lag-1 residual r",
        value: formatNumber(residualAutocorrelation, 2),
        detail: "serial-dependence audit",
        tone: Math.abs(residualAutocorrelation) >= 0.3 ? "alert" : "default",
      },
    ],
    generatedAt: new Date().toISOString(),
    config,
  };
}

export function runResearchAnalysis(
  rows: DataRow[],
  config: ResearchConfig,
): ResearchAnalysisResult {
  if (!rows.length) throw new Error("The dataset has no analyzable rows.");
  if (config.kind === "binary-comparison") return binaryAnalysis(rows, config);
  if (config.kind === "continuous-comparison") return continuousAnalysis(rows, config);
  if (config.kind === "association") return associationAnalysis(rows, config);
  return trendAnalysis(rows, config);
}

export function defaultClaimForKind(kind: ResearchAnalysisKind): string {
  const claims: Record<ResearchAnalysisKind, string> = {
    "binary-comparison": "The comparison group has a higher positive-outcome rate.",
    "continuous-comparison": "The comparison group has a higher average outcome.",
    association: "Higher predictor values are associated with higher outcome values.",
    "time-series": "The measured outcome increases over time.",
  };
  return claims[kind];
}

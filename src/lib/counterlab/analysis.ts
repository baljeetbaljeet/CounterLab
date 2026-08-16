import { uniqueValues, valueKey } from "./csv";
import type {
  AnalysisConfig,
  AnalysisResult,
  CellValue,
  DataRow,
  DistributionRow,
  EvidenceStatus,
  GroupRate,
  SpecificationResult,
} from "./types";

interface WeightedRate {
  successes: number;
  total: number;
  rate: number;
}

interface RiskDifference {
  estimate: number;
  ciLow: number;
  ciHigh: number;
  pValue: number;
  variance: number;
  sampleSize: number;
  reference: WeightedRate;
  comparison: WeightedRate;
}

function sameValue(left: CellValue, right: CellValue): boolean {
  return valueKey(left) === valueKey(right);
}

function rowWeight(row: DataRow, weightColumn?: string): number {
  if (!weightColumn) {
    return 1;
  }
  const value = row[weightColumn];
  const numeric =
    typeof value === "number" ? value : Number(String(value ?? ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function weightedRate(
  rows: DataRow[],
  config: AnalysisConfig,
  group: CellValue,
  stratum?: CellValue,
): WeightedRate {
  let successes = 0;
  let total = 0;

  for (const row of rows) {
    if (!sameValue(row[config.exposure] ?? null, group)) {
      continue;
    }
    if (
      config.stratifier &&
      stratum !== undefined &&
      !sameValue(row[config.stratifier] ?? null, stratum)
    ) {
      continue;
    }

    const weight = rowWeight(row, config.weight);
    if (weight <= 0 || row[config.outcome] === null) {
      continue;
    }

    total += weight;
    if (sameValue(row[config.outcome] ?? null, config.positiveOutcome)) {
      successes += weight;
    }
  }

  return {
    successes,
    total,
    rate: total > 0 ? successes / total : 0,
  };
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absolute);
  const approximation =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-absolute * absolute));
  return sign * approximation;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function riskDifference(
  rows: DataRow[],
  config: AnalysisConfig,
  stratum?: CellValue,
): RiskDifference {
  const reference = weightedRate(
    rows,
    config,
    config.referenceGroup,
    stratum,
  );
  const comparison = weightedRate(
    rows,
    config,
    config.comparisonGroup,
    stratum,
  );

  if (reference.total === 0 || comparison.total === 0) {
    throw new Error(
      "Both comparison groups need observations in every analyzed stratum.",
    );
  }

  const estimate = comparison.rate - reference.rate;
  const variance =
    (reference.rate * (1 - reference.rate)) / reference.total +
    (comparison.rate * (1 - comparison.rate)) / comparison.total;
  const standardError = Math.sqrt(Math.max(variance, 1e-12));
  const zScore = estimate / standardError;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));

  return {
    estimate,
    ciLow: estimate - 1.96 * standardError,
    ciHigh: estimate + 1.96 * standardError,
    pValue: Math.max(0, Math.min(1, pValue)),
    variance,
    sampleSize: reference.total + comparison.total,
    reference,
    comparison,
  };
}

function evidenceStatus(
  ciLow: number,
  ciHigh: number,
  claimDirection: 1 | -1,
): EvidenceStatus {
  if (claimDirection === 1 && ciLow > 0) {
    return "supports";
  }
  if (claimDirection === -1 && ciHigh < 0) {
    return "supports";
  }
  if (claimDirection === 1 && ciHigh < 0) {
    return "challenges";
  }
  if (claimDirection === -1 && ciLow > 0) {
    return "challenges";
  }
  return "uncertain";
}

function makeSpecification(
  id: string,
  label: string,
  shortLabel: string,
  family: SpecificationResult["family"],
  result: RiskDifference,
  config: AnalysisConfig,
  covariates: string[],
  evidence: string,
): SpecificationResult {
  return {
    id,
    label,
    shortLabel,
    family,
    estimate: result.estimate,
    ciLow: result.ciLow,
    ciHigh: result.ciHigh,
    pValue: result.pValue,
    sampleSize: result.sampleSize,
    status: evidenceStatus(
      result.ciLow,
      result.ciHigh,
      config.claimDirection,
    ),
    covariates,
    evidence,
  };
}

function pooledRiskDifference(
  strata: Array<{ value: CellValue; result: RiskDifference; weight: number }>,
  mode: "empirical" | "equal" | "precision",
): RiskDifference {
  let normalizedWeights: number[];
  if (mode === "equal") {
    normalizedWeights = strata.map(() => 1 / strata.length);
  } else if (mode === "precision") {
    const raw = strata.map(({ result }) => 1 / Math.max(result.variance, 1e-9));
    const total = raw.reduce((sum, value) => sum + value, 0);
    normalizedWeights = raw.map((value) => value / total);
  } else {
    const total = strata.reduce((sum, item) => sum + item.weight, 0);
    normalizedWeights = strata.map((item) => item.weight / total);
  }

  const estimate = strata.reduce(
    (sum, item, index) => sum + item.result.estimate * normalizedWeights[index],
    0,
  );
  const variance = strata.reduce(
    (sum, item, index) =>
      sum +
      normalizedWeights[index] *
        normalizedWeights[index] *
        item.result.variance,
    0,
  );
  const standardError = Math.sqrt(Math.max(variance, 1e-12));
  const pValue =
    2 * (1 - normalCdf(Math.abs(estimate / Math.max(standardError, 1e-9))));
  const sampleSize = strata.reduce(
    (sum, item) => sum + item.result.sampleSize,
    0,
  );

  return {
    estimate,
    ciLow: estimate - 1.96 * standardError,
    ciHigh: estimate + 1.96 * standardError,
    pValue: Math.max(0, Math.min(1, pValue)),
    variance,
    sampleSize,
    reference: { successes: 0, total: 0, rate: 0 },
    comparison: { successes: 0, total: 0, rate: 0 },
  };
}

function formatPercent(value: number, digits = 1): string {
  return (value * 100).toFixed(digits) + "%";
}

function formatPoints(value: number): string {
  const sign = value > 0 ? "+" : "";
  return sign + (value * 100).toFixed(1) + " pp";
}

function calculateDistribution(
  rows: DataRow[],
  config: AnalysisConfig,
  strata: CellValue[],
): DistributionRow[] {
  if (!config.stratifier) {
    return [];
  }

  const referenceTotals = strata.map((value) =>
    weightedRate(rows, config, config.referenceGroup, value),
  );
  const comparisonTotals = strata.map((value) =>
    weightedRate(rows, config, config.comparisonGroup, value),
  );
  const referenceAll = referenceTotals.reduce(
    (sum, rate) => sum + rate.total,
    0,
  );
  const comparisonAll = comparisonTotals.reduce(
    (sum, rate) => sum + rate.total,
    0,
  );

  return strata.map((stratum, index) => {
    const referenceShare =
      referenceAll > 0 ? referenceTotals[index].total / referenceAll : 0;
    const comparisonShare =
      comparisonAll > 0 ? comparisonTotals[index].total / comparisonAll : 0;
    return {
      stratum: String(stratum),
      referenceShare,
      comparisonShare,
      gap: Math.abs(referenceShare - comparisonShare),
    };
  });
}

function totalObservations(rows: DataRow[], weight?: string): number {
  return rows.reduce((sum, row) => sum + rowWeight(row, weight), 0);
}

export function analyzeClaim(
  rows: DataRow[],
  config: AnalysisConfig,
): AnalysisResult {
  if (!rows.length) {
    throw new Error("The dataset has no analyzable rows.");
  }

  const exposureValues = uniqueValues(rows, config.exposure);
  if (exposureValues.length < 2) {
    throw new Error("The exposure column needs at least two groups.");
  }
  if (
    !exposureValues.some((value) => sameValue(value, config.referenceGroup)) ||
    !exposureValues.some((value) => sameValue(value, config.comparisonGroup))
  ) {
    throw new Error("Choose comparison groups that exist in the dataset.");
  }

  const overall = riskDifference(rows, config);
  const groupRates: GroupRate[] = [
    {
      group: String(config.referenceGroup),
      successes: overall.reference.successes,
      total: overall.reference.total,
      rate: overall.reference.rate,
    },
    {
      group: String(config.comparisonGroup),
      successes: overall.comparison.successes,
      total: overall.comparison.total,
      rate: overall.comparison.rate,
    },
  ];

  const specifications: SpecificationResult[] = [
    makeSpecification(
      "unadjusted",
      "Unadjusted comparison",
      "Unadjusted",
      "Unadjusted",
      overall,
      config,
      [],
      String(config.comparisonGroup) +
        " minus " +
        String(config.referenceGroup) +
        " across the complete sample.",
    ),
  ];

  let adjustedEffect: number | null = null;
  let distribution: DistributionRow[] = [];
  let maxImbalance: number | null = null;
  let strataResults: Array<{
    value: CellValue;
    result: RiskDifference;
    weight: number;
  }> = [];

  if (config.stratifier) {
    const strata = uniqueValues(rows, config.stratifier);
    strataResults = strata
      .map((value) => {
        try {
          const result = riskDifference(rows, config, value);
          return { value, result, weight: result.sampleSize };
        } catch {
          return null;
        }
      })
      .filter(
        (
          item,
        ): item is {
          value: CellValue;
          result: RiskDifference;
          weight: number;
        } => Boolean(item),
      );

    for (const item of strataResults) {
      specifications.push(
        makeSpecification(
          "subgroup-" + valueKey(item.value),
          String(config.stratifier) + ": " + String(item.value),
          String(item.value),
          "Subgroup",
          item.result,
          config,
          [config.stratifier],
          "Effect estimated only within the " +
            String(item.value) +
            " stratum.",
        ),
      );
    }

    if (strataResults.length >= 2) {
      const empirical = pooledRiskDifference(strataResults, "empirical");
      const equal = pooledRiskDifference(strataResults, "equal");
      const precision = pooledRiskDifference(strataResults, "precision");
      adjustedEffect = empirical.estimate;

      specifications.push(
        makeSpecification(
          "adjusted-empirical",
          "Population-standardized adjustment",
          "Population adjusted",
          "Adjusted",
          empirical,
          config,
          [config.stratifier],
          "Stratum-specific effects standardized to the observed population.",
        ),
        makeSpecification(
          "adjusted-equal",
          "Equal-strata sensitivity analysis",
          "Equal strata",
          "Adjusted",
          equal,
          config,
          [config.stratifier],
          "Each stratum receives equal influence regardless of sample size.",
        ),
        makeSpecification(
          "adjusted-precision",
          "Precision-weighted fixed effect",
          "Precision weighted",
          "Adjusted",
          precision,
          config,
          [config.stratifier],
          "Stratum estimates are weighted by inverse sampling variance.",
        ),
      );
    }

    distribution = calculateDistribution(
      rows,
      config,
      strataResults.map((item) => item.value),
    );
    maxImbalance = distribution.length
      ? Math.max(...distribution.map((row) => row.gap))
      : null;
  }

  const overallSign = Math.sign(overall.estimate);
  const adjustedSign = adjustedEffect === null ? 0 : Math.sign(adjustedEffect);
  const subgroupSigns = strataResults.map((item) =>
    Math.sign(item.result.estimate),
  );
  const oppositeSubgroups = subgroupSigns.filter(
    (sign) => sign !== 0 && sign === -overallSign,
  ).length;
  const reversalFound =
    adjustedEffect !== null &&
    overallSign !== 0 &&
    adjustedSign === -overallSign &&
    oppositeSubgroups >= Math.ceil(Math.max(1, subgroupSigns.length) / 2);

  const supportsClaim = specifications.filter(
    (item) => Math.sign(item.estimate) === config.claimDirection,
  ).length;
  const conclusive = specifications.filter(
    (item) => item.status !== "uncertain",
  ).length;
  const signStability = supportsClaim / specifications.length;
  const conclusiveRate = conclusive / specifications.length;

  let verdict: AnalysisResult["verdict"] = "Inconclusive";
  let verdictTone: AnalysisResult["verdictTone"] = "neutral";
  if (reversalFound) {
    verdict = "Fragile";
    verdictTone = "negative";
  } else if (
    specifications.length >= 3 &&
    (signStability >= 0.8 || signStability <= 0.2)
  ) {
    verdict = "Robust";
    verdictTone = "positive";
  }

  const directionWord =
    overall.estimate * config.claimDirection > 0 ? "supported" : "challenged";
  const adjustedDirectionWord =
    adjustedEffect !== null && adjustedEffect * config.claimDirection < 0
      ? "reversed"
      : "remained stable";

  const headline =
    verdict === "Fragile"
      ? "The apparent effect reverses after adjustment."
      : verdict === "Robust"
        ? "The effect remains directionally stable."
        : "The available specifications do not agree.";

  const summary =
    "The unadjusted analysis " +
    directionWord +
    " the claim with an effect of " +
    formatPoints(overall.estimate) +
    ". After accounting for " +
    (config.stratifier ?? "the selected covariate") +
    ", the direction " +
    adjustedDirectionWord +
    (adjustedEffect === null
      ? "."
      : " to " + formatPoints(adjustedEffect) + ".");

  const findings: string[] = [
    String(config.comparisonGroup) +
      " has an overall positive-outcome rate of " +
      formatPercent(overall.comparison.rate) +
      ", compared with " +
      formatPercent(overall.reference.rate) +
      " for " +
      String(config.referenceGroup) +
      ".",
  ];
  if (reversalFound && adjustedEffect !== null) {
    findings.push(
      "Adjustment changes the estimated effect by " +
        formatPoints(adjustedEffect - overall.estimate) +
        ", crossing the null in the opposite direction.",
    );
  }
  if (maxImbalance !== null) {
    findings.push(
      "The largest between-group stratum imbalance is " +
        formatPercent(maxImbalance) +
        ", making confounding plausible.",
    );
  }

  const trace: AnalysisResult["trace"] = [
    {
      title: "Schema validated",
      detail:
        rows.length +
        " source rows mapped to a binary outcome and two comparison groups.",
      state: "complete",
    },
    {
      title: "Aggregate estimate reproduced",
      detail:
        "The unadjusted risk difference is " +
        formatPoints(overall.estimate) +
        ".",
      state: overall.estimate * config.claimDirection > 0 ? "complete" : "warning",
    },
  ];
  if (config.stratifier) {
    trace.push({
      title: "Covariate balance audited",
      detail:
        maxImbalance === null
          ? "No complete stratified comparison was available."
          : "Maximum distribution gap: " + formatPercent(maxImbalance) + ".",
      state:
        maxImbalance !== null && maxImbalance >= 0.15 ? "warning" : "complete",
    });
  }
  if (reversalFound) {
    trace.push({
      title: "Direction reversal confirmed",
      detail:
        "The adjusted and majority subgroup estimates oppose the aggregate result.",
      state: "discovery",
    });
  }

  return {
    verdict,
    verdictTone,
    headline,
    summary,
    observations: totalObservations(rows, config.weight),
    sourceRows: rows.length,
    specifications,
    groupRates,
    aggregateEffect: overall.estimate,
    adjustedEffect,
    reversalMagnitude:
      adjustedEffect === null
        ? null
        : Math.abs(overall.estimate - adjustedEffect),
    reversalFound,
    signStability,
    conclusiveRate,
    maxImbalance,
    distribution,
    findings,
    trace,
    generatedAt: new Date().toISOString(),
    config,
  };
}

export function formatEffect(value: number): string {
  const sign = value > 0 ? "+" : "";
  return sign + (value * 100).toFixed(1) + " pp";
}

export function formatPValue(value: number): string {
  if (value < 0.001) {
    return "<0.001";
  }
  return value.toFixed(3);
}

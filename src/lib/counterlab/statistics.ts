export interface NumericSummary {
  n: number;
  mean: number;
  variance: number;
  standardDeviation: number;
  minimum: number;
  maximum: number;
}

export interface IntervalEstimate {
  estimate: number;
  ciLow: number;
  ciHigh: number;
  pValue: number;
  standardError: number;
  sampleSize: number;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const approximation =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-absolute * absolute);
  return sign * approximation;
}

export function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const shifted = value - 1;
  let series = 0.9999999999998099;
  coefficients.forEach((coefficient, index) => {
    series += coefficient / (shifted + index + 1);
  });
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(series);
}

function betaFraction(a: number, b: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 3e-10;
  const fpMinimum = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpMinimum) d = fpMinimum;
  d = 1 / d;
  let result = d;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const twice = 2 * iteration;
    let aa = (iteration * (b - iteration) * x) / ((qam + twice) * (a + twice));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMinimum) d = fpMinimum;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMinimum) c = fpMinimum;
    d = 1 / d;
    result *= d * c;

    aa = (-(a + iteration) * (qab + iteration) * x) / ((a + twice) * (qap + twice));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMinimum) d = fpMinimum;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMinimum) c = fpMinimum;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return result;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaFraction(a, b, x)) / a;
  }
  return 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

export function twoSidedTPValue(tStatistic: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(tStatistic) || degreesOfFreedom <= 0) return 1;
  const x = degreesOfFreedom / (degreesOfFreedom + tStatistic * tStatistic);
  return clamp(regularizedBeta(x, degreesOfFreedom / 2, 0.5), 0, 1);
}

export function tCritical95(degreesOfFreedom: number): number {
  if (!Number.isFinite(degreesOfFreedom) || degreesOfFreedom > 5000) return 1.96;
  let low = 0;
  let high = 12;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (twoSidedTPValue(middle, degreesOfFreedom) > 0.05) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function quantile(values: number[], probability: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
}

export function sampleVariance(values: number[], center = mean(values)): number {
  if (values.length < 2) return 0;
  return values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
}

export function summarize(values: number[]): NumericSummary {
  if (!values.length) throw new Error("At least one numeric observation is required.");
  const average = mean(values);
  const variance = sampleVariance(values, average);
  return {
    n: values.length,
    mean: average,
    variance,
    standardDeviation: Math.sqrt(Math.max(0, variance)),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  };
}

export function weightedSummary(values: number[], weights: number[]): NumericSummary {
  if (!values.length || values.length !== weights.length) {
    throw new Error("Values and frequency weights must be non-empty and aligned.");
  }
  const n = weights.reduce((sum, weight) => sum + weight, 0);
  if (n <= 0) throw new Error("Frequency weights must sum to a positive value.");
  const average = values.reduce((sum, value, index) => sum + value * weights[index], 0) / n;
  const numerator = values.reduce(
    (sum, value, index) => sum + weights[index] * (value - average) ** 2,
    0,
  );
  const variance = n > 1 ? numerator / (n - 1) : 0;
  return {
    n,
    mean: average,
    variance,
    standardDeviation: Math.sqrt(Math.max(0, variance)),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  };
}

export function welchDifference(
  reference: NumericSummary,
  comparison: NumericSummary,
): IntervalEstimate & { degreesOfFreedom: number } {
  if (reference.n < 2 || comparison.n < 2) {
    throw new Error("Each comparison group needs at least two complete observations.");
  }
  const estimate = comparison.mean - reference.mean;
  const referenceTerm = reference.variance / reference.n;
  const comparisonTerm = comparison.variance / comparison.n;
  const variance = referenceTerm + comparisonTerm;
  const standardError = Math.sqrt(Math.max(variance, 1e-15));
  const degreesOfFreedom =
    variance ** 2 /
    (referenceTerm ** 2 / (reference.n - 1) + comparisonTerm ** 2 / (comparison.n - 1));
  const t = estimate / standardError;
  const critical = tCritical95(degreesOfFreedom);
  return {
    estimate,
    ciLow: estimate - critical * standardError,
    ciHigh: estimate + critical * standardError,
    pValue: twoSidedTPValue(t, degreesOfFreedom),
    standardError,
    sampleSize: reference.n + comparison.n,
    degreesOfFreedom,
  };
}

function seededRandom(seed = 0x51f15e): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function boundedValues(values: number[], maximum = 3000): number[] {
  if (values.length <= maximum) return values;
  const stride = values.length / maximum;
  return Array.from({ length: maximum }, (_, index) => values[Math.floor(index * stride)]);
}

export function bootstrapDifference(
  referenceInput: number[],
  comparisonInput: number[],
  statistic: (values: number[]) => number,
  iterations = 300,
): IntervalEstimate {
  const reference = boundedValues(referenceInput);
  const comparison = boundedValues(comparisonInput);
  if (reference.length < 3 || comparison.length < 3) {
    throw new Error("Robust sensitivity estimates need at least three rows per group.");
  }
  const estimate = statistic(comparison) - statistic(reference);
  const random = seededRandom(reference.length * 1009 + comparison.length * 9176);
  const estimates: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const referenceResample = Array.from(
      { length: reference.length },
      () => reference[Math.floor(random() * reference.length)],
    );
    const comparisonResample = Array.from(
      { length: comparison.length },
      () => comparison[Math.floor(random() * comparison.length)],
    );
    estimates.push(statistic(comparisonResample) - statistic(referenceResample));
  }
  const below = estimates.filter((value) => value <= 0).length;
  const above = estimates.filter((value) => value >= 0).length;
  return {
    estimate,
    ciLow: quantile(estimates, 0.025),
    ciHigh: quantile(estimates, 0.975),
    pValue: clamp((2 * Math.min(below + 1, above + 1)) / (iterations + 1), 0, 1),
    standardError: Math.sqrt(sampleVariance(estimates)),
    sampleSize: referenceInput.length + comparisonInput.length,
  };
}

export function trimmedMean(values: number[], proportion = 0.1): number {
  const sorted = [...values].sort((left, right) => left - right);
  const trim = Math.floor(sorted.length * proportion);
  const retained = sorted.slice(trim, Math.max(trim + 1, sorted.length - trim));
  return mean(retained);
}

export function averageRanks(values: number[]): number[] {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = Array<number>(values.length);
  let index = 0;
  while (index < ordered.length) {
    let end = index + 1;
    while (end < ordered.length && ordered[end].value === ordered[index].value) end += 1;
    const rank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) ranks[ordered[cursor].index] = rank;
    index = end;
  }
  return ranks;
}

export function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) {
    throw new Error("Correlation requires at least three complete paired observations.");
  }
  const xMean = mean(x);
  const yMean = mean(y);
  let numerator = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < x.length; index += 1) {
    const xCentered = x[index] - xMean;
    const yCentered = y[index] - yMean;
    numerator += xCentered * yCentered;
    xSum += xCentered ** 2;
    ySum += yCentered ** 2;
  }
  if (xSum <= 0 || ySum <= 0) throw new Error("Both variables must vary.");
  return clamp(numerator / Math.sqrt(xSum * ySum), -1, 1);
}

export function correlationInference(correlation: number, n: number): IntervalEstimate {
  if (n < 4) throw new Error("Correlation intervals require at least four observations.");
  const bounded = clamp(correlation, -0.999999, 0.999999);
  const fisher = 0.5 * Math.log((1 + bounded) / (1 - bounded));
  const standardError = 1 / Math.sqrt(n - 3);
  const ciLow = Math.tanh(fisher - 1.96 * standardError);
  const ciHigh = Math.tanh(fisher + 1.96 * standardError);
  const t = bounded * Math.sqrt((n - 2) / Math.max(1e-12, 1 - bounded ** 2));
  return {
    estimate: correlation,
    ciLow,
    ciHigh,
    pValue: twoSidedTPValue(t, n - 2),
    standardError,
    sampleSize: n,
  };
}

export function winsorize(values: number[], proportion = 0.05): number[] {
  const lower = quantile(values, proportion);
  const upper = quantile(values, 1 - proportion);
  return values.map((value) => clamp(value, lower, upper));
}

export interface RegressionResult extends IntervalEstimate {
  intercept: number;
  rSquared: number;
  residuals: number[];
}

export function linearRegression(x: number[], y: number[], hacLag = 0): RegressionResult {
  if (x.length !== y.length || x.length < 4) {
    throw new Error("Trend regression requires at least four complete observations.");
  }
  const n = x.length;
  const xMean = mean(x);
  const yMean = mean(y);
  const sxx = x.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  if (sxx <= 0) throw new Error("The predictor or time variable must vary.");
  const sxy = x.reduce((sum, value, index) => sum + (value - xMean) * (y[index] - yMean), 0);
  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  const residuals = y.map((value, index) => value - (intercept + slope * x[index]));
  const sse = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const sst = y.reduce((sum, value) => sum + (value - yMean) ** 2, 0);

  let varianceSlope: number;
  if (hacLag <= 0) {
    varianceSlope = sse / (n - 2) / sxx;
  } else {
    const sumX = x.reduce((sum, value) => sum + value, 0);
    const sumXX = x.reduce((sum, value) => sum + value * value, 0);
    const determinant = n * sumXX - sumX * sumX;
    const inverse = [
      sumXX / determinant,
      -sumX / determinant,
      -sumX / determinant,
      n / determinant,
    ];
    let s00 = 0;
    let s01 = 0;
    let s11 = 0;
    for (let index = 0; index < n; index += 1) {
      const squared = residuals[index] ** 2;
      s00 += squared;
      s01 += squared * x[index];
      s11 += squared * x[index] ** 2;
    }
    const lag = Math.min(hacLag, n - 2);
    for (let offset = 1; offset <= lag; offset += 1) {
      const kernel = 1 - offset / (lag + 1);
      for (let index = offset; index < n; index += 1) {
        const cross = residuals[index] * residuals[index - offset] * kernel;
        s00 += 2 * cross;
        s01 += cross * (x[index] + x[index - offset]);
        s11 += 2 * cross * x[index] * x[index - offset];
      }
    }
    const left0 = inverse[2] * s00 + inverse[3] * s01;
    const left1 = inverse[2] * s01 + inverse[3] * s11;
    varianceSlope = left0 * inverse[2] + left1 * inverse[3];
  }
  const standardError = Math.sqrt(Math.max(varianceSlope, 1e-15));
  const degreesOfFreedom = n - 2;
  const critical = tCritical95(degreesOfFreedom);
  return {
    estimate: slope,
    ciLow: slope - critical * standardError,
    ciHigh: slope + critical * standardError,
    pValue: twoSidedTPValue(slope / standardError, degreesOfFreedom),
    standardError,
    sampleSize: n,
    intercept,
    rSquared: sst > 0 ? clamp(1 - sse / sst, 0, 1) : 0,
    residuals,
  };
}

export function theilSenSlope(x: number[], y: number[]): number {
  const maximum = 250;
  const indices =
    x.length <= maximum
      ? x.map((_, index) => index)
      : Array.from({ length: maximum }, (_, index) => Math.floor((index * x.length) / maximum));
  const slopes: number[] = [];
  for (let left = 0; left < indices.length; left += 1) {
    for (let right = left + 1; right < indices.length; right += 1) {
      const delta = x[indices[right]] - x[indices[left]];
      if (delta !== 0) slopes.push((y[indices[right]] - y[indices[left]]) / delta);
    }
  }
  if (!slopes.length) throw new Error("At least two distinct time points are required.");
  return median(slopes);
}

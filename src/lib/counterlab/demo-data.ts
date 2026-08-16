import type { AnalysisConfig, ResearchConfig } from "./types";

export const DEMO_CSV = [
  "treatment,severity,success,count",
  "A,Mild,1,90",
  "A,Mild,0,10",
  "A,Severe,1,210",
  "A,Severe,0,140",
  "B,Mild,1,360",
  "B,Mild,0,90",
  "B,Severe,1,25",
  "B,Severe,0,25",
].join("\n");

export const DEMO_CLAIM =
  "Treatment B produces a higher recovery rate than Treatment A.";

export const DEMO_CONFIG: AnalysisConfig = {
  claim: DEMO_CLAIM,
  outcome: "success",
  exposure: "treatment",
  stratifier: "severity",
  weight: "count",
  positiveOutcome: 1,
  referenceGroup: "A",
  comparisonGroup: "B",
  claimDirection: 1,
};

export const DEMO_NAME = "Synthetic treatment outcomes";

export interface ResearchDemo {
  id: string;
  label: string;
  name: string;
  claim: string;
  csv: string;
  config: ResearchConfig;
}

const continuousRows = [
  ["A", "Site 1", 118], ["A", "Site 1", 121], ["A", "Site 1", 116],
  ["A", "Site 1", 125], ["A", "Site 1", 119], ["A", "Site 2", 130],
  ["A", "Site 2", 128], ["A", "Site 2", 135], ["A", "Site 2", 126],
  ["A", "Site 2", 132], ["B", "Site 1", 109], ["B", "Site 1", 112],
  ["B", "Site 1", 115], ["B", "Site 1", 108], ["B", "Site 1", 111],
  ["B", "Site 2", 119], ["B", "Site 2", 121], ["B", "Site 2", 117],
  ["B", "Site 2", 123], ["B", "Site 2", 116],
];
const continuousCsv = [
  "treatment,site,blood_pressure",
  ...continuousRows.map((row) => row.join(",")),
].join("\n");

const associationCsv = [
  "dose,biomarker",
  ...Array.from({ length: 28 }, (_, index) => {
    const dose = index + 1;
    const biomarker = 22 + dose * 1.65 + ((index * 7) % 9 - 4) * 0.8;
    return `${dose},${biomarker.toFixed(1)}`;
  }),
].join("\n");

const timeSeriesCsv = [
  "date,measurement",
  ...Array.from({ length: 24 }, (_, index) => {
    const date = new Date(Date.UTC(2024, index, 1)).toISOString().slice(0, 10);
    const measurement = 50 + index * 0.72 + Math.sin(index / 2) * 2.2;
    return `${date},${measurement.toFixed(2)}`;
  }),
].join("\n");

export const RESEARCH_DEMOS: ResearchDemo[] = [
  {
    id: "binary",
    label: "Binary",
    name: DEMO_NAME,
    claim: DEMO_CLAIM,
    csv: DEMO_CSV,
    config: {
      kind: "binary-comparison",
      claim: DEMO_CLAIM,
      outcome: "success",
      predictor: "treatment",
      stratifier: "severity",
      weight: "count",
      positiveOutcome: 1,
      referenceGroup: "A",
      comparisonGroup: "B",
      claimDirection: 1,
    },
  },
  {
    id: "continuous",
    label: "Continuous",
    name: "Synthetic blood-pressure study",
    claim: "Treatment B lowers systolic blood pressure compared with Treatment A.",
    csv: continuousCsv,
    config: {
      kind: "continuous-comparison",
      claim: "Treatment B lowers systolic blood pressure compared with Treatment A.",
      outcome: "blood_pressure",
      predictor: "treatment",
      stratifier: "site",
      referenceGroup: "A",
      comparisonGroup: "B",
      claimDirection: -1,
    },
  },
  {
    id: "association",
    label: "Association",
    name: "Synthetic dose-response study",
    claim: "Higher dose is associated with a higher biomarker response.",
    csv: associationCsv,
    config: {
      kind: "association",
      claim: "Higher dose is associated with a higher biomarker response.",
      outcome: "biomarker",
      predictor: "dose",
      claimDirection: 1,
    },
  },
  {
    id: "time",
    label: "Time series",
    name: "Synthetic longitudinal measurements",
    claim: "The measured outcome increases over time.",
    csv: timeSeriesCsv,
    config: {
      kind: "time-series",
      claim: "The measured outcome increases over time.",
      outcome: "measurement",
      predictor: "date",
      time: "date",
      claimDirection: 1,
    },
  },
];

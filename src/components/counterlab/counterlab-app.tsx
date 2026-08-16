"use client";

import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
  ChevronDown,
  Download,
  FlaskConical,
  HelpCircle,
  Lock,
  Play,
  RotateCcw,
  Sliders,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LogoMark, Wordmark } from "./logo";
import { SpecificationPlot } from "./specification-plot";
import {
  detectResearchConfig,
  inferConfigForKind,
  parseDataset,
  profileColumns,
  uniqueValues,
  valueKey,
} from "@/lib/counterlab/csv";
import { RESEARCH_DEMOS } from "@/lib/counterlab/demo-data";
import {
  defaultClaimForKind,
  formatResearchEffect,
  formatResearchPValue,
  runResearchAnalysis,
} from "@/lib/counterlab/research";
import { compileClaim } from "@/lib/counterlab/compile.functions";
import type {
  CellValue,
  ParsedDataset,
  ResearchAnalysisKind,
  ResearchAnalysisResult,
  ResearchConfig,
} from "@/lib/counterlab/types";

const EMPTY_DATASET: ParsedDataset = { columns: [], rows: [] };

const EMPTY_CONFIG: ResearchConfig = {
  kind: "binary-comparison",
  claim: "",
  outcome: "",
  predictor: "",
  claimDirection: 1,
};

const FAMILIES: Array<{ kind: ResearchAnalysisKind; label: string; detail: string }> = [
  { kind: "binary-comparison", label: "Binary", detail: "Rates & strata" },
  { kind: "continuous-comparison", label: "Continuous", detail: "Means & robust location" },
  { kind: "association", label: "Association", detail: "Pearson & ranks" },
  { kind: "time-series", label: "Time series", detail: "HAC & robust trend" },
];

const STAGES = ["Detect", "Validate", "Test", "Synthesize"];

const TONE_RING: Record<string, string> = {
  positive: "border-supports/40 bg-supports-soft",
  negative: "border-challenges/40 bg-challenges-soft",
  neutral: "border-uncertain/40 bg-uncertain-soft",
};

const TONE_TEXT: Record<string, string> = {
  positive: "text-supports",
  negative: "text-challenges",
  neutral: "text-uncertain",
};

const ASSESSMENT: Record<string, string> = {
  supports: "bg-supports-soft text-supports border-supports/30",
  challenges: "bg-challenges-soft text-challenges border-challenges/30",
  uncertain: "bg-uncertain-soft text-uncertain border-uncertain/30",
};

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function displayValue(value: CellValue) {
  return value === null ? "Missing" : String(value);
}

function actualValue(values: CellValue[], key: string): CellValue {
  return values.find((value) => valueKey(value) === key) ?? values[0] ?? null;
}

function positiveDefault(values: CellValue[]): CellValue {
  return (
    values.find((value) =>
      ["1", "true", "yes", "success", "positive", "recovered", "case"].includes(
        String(value).toLowerCase(),
      ),
    ) ??
    values[values.length - 1] ??
    null
  );
}

function isGroupComparison(kind: ResearchAnalysisKind) {
  return kind === "binary-comparison" || kind === "continuous-comparison";
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {label}
        {hint ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="size-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-56">{hint}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function ColumnSelect({
  value,
  options,
  onChange,
  placeholder = "Select column",
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full font-mono text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="font-mono text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SectionHeading({
  kicker,
  title,
  description,
  action,
}: {
  kicker: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="label-micro">{kicker}</p>
        <h2 className="mt-1.5 text-2xl font-semibold text-foreground">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function CounterLabApp() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [datasetText, setDatasetText] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [parseName, setParseName] = useState("dataset.csv");
  const [claim, setClaim] = useState("");
  const [config, setConfig] = useState<ResearchConfig>(EMPTY_CONFIG);
  const [analysis, setAnalysis] = useState<ResearchAnalysisResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runStage, setRunStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [compilerLabel, setCompilerLabel] = useState("Awaiting dataset");
  const [compilerDetail, setCompilerDetail] = useState(
    "Upload a tabular file to create a transparent analysis plan",
  );
  const [tab, setTab] = useState("analyze");

  const dataset = useMemo(
    () => (datasetText ? parseDataset(datasetText, parseName) : EMPTY_DATASET),
    [datasetText, parseName],
  );
  const profiles = useMemo(() => profileColumns(dataset), [dataset]);
  const outcomeValues = useMemo(
    () => uniqueValues(dataset.rows, config.outcome),
    [dataset, config.outcome],
  );
  const predictorValues = useMemo(
    () => uniqueValues(dataset.rows, config.predictor),
    [dataset, config.predictor],
  );
  const missingCells = profiles.reduce((sum, profile) => sum + profile.missingCount, 0);
  const activePositiveKey = valueKey(config.positiveOutcome ?? positiveDefault(outcomeValues));
  const referenceKey = valueKey(config.referenceGroup ?? predictorValues[0] ?? null);
  const comparisonKey = valueKey(
    config.comparisonGroup ?? predictorValues[1] ?? predictorValues[0] ?? null,
  );
  const activeFamily = FAMILIES.find((family) => family.kind === config.kind);
  const hasDataset = dataset.rows.length > 0 && dataset.columns.length > 0;
  const canRun = hasDataset && Boolean(claim.trim() && config.outcome && config.predictor);

  const invalidateAnalysis = () => {
    setAnalysis(null);
    setRunStage(0);
  };

  const goTo = (next: string) => {
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const applyDataset = (
    parsed: ParsedDataset,
    text: string,
    displayName: string,
    sourceName: string,
    nextConfig: ResearchConfig,
  ) => {
    setDatasetText(text);
    setDatasetName(displayName);
    setParseName(sourceName);
    setClaim(nextConfig.claim);
    setConfig(nextConfig);
    setAnalysis(null);
    setCompilerLabel("Deterministic method router");
    setCompilerDetail(
      `${FAMILIES.find((family) => family.kind === nextConfig.kind)?.label ?? "Analysis"} mapping detected · review before execution`,
    );
    setRunStage(0);
    setError(null);
    setTab("analyze");
  };

  const loadDemo = (id: string) => {
    const demo = RESEARCH_DEMOS.find((item) => item.id === id) ?? RESEARCH_DEMOS[0];
    const parsed = parseDataset(demo.csv, "demo.csv");
    applyDataset(parsed, demo.csv, demo.name, "demo.csv", demo.config);
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseDataset(text, file.name);
      if (parsed.rows.length > 50000)
        throw new Error("Upload 50,000 source rows or fewer for this browser-based release.");
      if (parsed.columns.length > 150)
        throw new Error("Upload 150 variables or fewer so schema review remains auditable.");
      applyDataset(parsed, text, file.name, file.name, detectResearchConfig(parsed));
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "The dataset could not be loaded.",
      );
    } finally {
      event.target.value = "";
    }
  };

  const changeKind = (kind: ResearchAnalysisKind) => {
    if (!hasDataset) return;
    try {
      const nextClaim = defaultClaimForKind(kind);
      const nextConfig = inferConfigForKind(dataset, kind, nextClaim);
      setClaim(nextClaim);
      setConfig(nextConfig);
      invalidateAnalysis();
      setCompilerLabel("Manual method selection");
      setCompilerDetail(
        `${FAMILIES.find((family) => family.kind === kind)?.label ?? "Analysis"} mapping ready for validation`,
      );
      setError(null);
    } catch (kindError) {
      setError(
        kindError instanceof Error
          ? kindError.message
          : "That analysis family does not fit this dataset.",
      );
    }
  };

  const updateOutcome = (outcome: string) => {
    setConfig((current) => ({
      ...current,
      outcome,
      positiveOutcome:
        current.kind === "binary-comparison"
          ? positiveDefault(uniqueValues(dataset.rows, outcome))
          : undefined,
    }));
    invalidateAnalysis();
  };

  const updatePredictor = (predictor: string) => {
    const values = uniqueValues(dataset.rows, predictor);
    setConfig((current) => ({
      ...current,
      predictor,
      time: current.kind === "time-series" ? predictor : current.time,
      referenceGroup: isGroupComparison(current.kind) ? (values[0] ?? null) : undefined,
      comparisonGroup: isGroupComparison(current.kind)
        ? (values[1] ?? values[0] ?? null)
        : undefined,
    }));
    invalidateAnalysis();
  };

  const runStressTest = async () => {
    if (!canRun) {
      setError(
        "Upload a dataset and confirm the claim and variable mappings before running the stress test.",
      );
      return;
    }
    setIsRunning(true);
    setError(null);
    setRunStage(1);
    const selectedConfig: ResearchConfig = { ...config, claim };
    try {
      await delay(180);
      setRunStage(2);
      let finalConfig = selectedConfig;
      try {
        const compiled = await compileClaim({
          data: {
            claim,
            columns: dataset.columns,
            profiles,
            mapping: selectedConfig,
          },
        });
        if (compiled.available && compiled.claimDirection) {
          finalConfig = { ...selectedConfig, claimDirection: compiled.claimDirection };
          setCompilerLabel(`${compiled.provider ?? "Compiler"} · ${compiled.model ?? "model"}`);
          setCompilerDetail(
            compiled.rationale ?? "Claim direction compiled into the validated method plan",
          );
        } else {
          setCompilerLabel("Deterministic method router");
          setCompilerDetail("Validated locally · no raw rows left this browser");
        }
      } catch {
        setCompilerLabel("Deterministic method router");
        setCompilerDetail("Assistant unavailable; validated local fallback completed");
      }
      await delay(180);
      setRunStage(3);
      const nextAnalysis = runResearchAnalysis(dataset.rows, finalConfig);
      await delay(240);
      setConfig(finalConfig);
      setAnalysis(nextAnalysis);
      setRunStage(4);
      goTo("results");
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : "The stress test could not be completed.",
      );
      setRunStage(0);
    } finally {
      setIsRunning(false);
    }
  };

  const exportEvidence = () => {
    if (!analysis || !hasDataset) return;
    downloadFile(
      "counterlab-evidence.json",
      JSON.stringify(
        {
          project: "CounterLab",
          engineVersion: "0.2.0",
          dataset: {
            name: datasetName,
            format: dataset.format,
            columns: dataset.columns,
            profiles,
          },
          compiler: compilerLabel,
          result: analysis,
        },
        null,
        2,
      ),
      "application/json",
    );
  };

  const exportMethods = () => {
    if (!analysis) return;
    const lines = [
      "# CounterLab methods report",
      "",
      "## Research claim",
      claim,
      "",
      "## Routed analysis",
      `${analysis.kindLabel}: ${analysis.methodLabel}`,
      "",
      "## Verdict",
      `${analysis.verdict}: ${analysis.headline}`,
      "",
      "## Summary",
      analysis.summary,
      "",
      "## Specifications",
      ...analysis.specifications.map(
        (item) =>
          `- ${item.label}: ${formatResearchEffect(item.estimate, analysis.effectScale)} ` +
          `(95% interval ${formatResearchEffect(item.ciLow, analysis.effectScale)} to ${formatResearchEffect(item.ciHigh, analysis.effectScale)}, p=${formatResearchPValue(item.pValue)})`,
      ),
      "",
      "## Data-quality warnings",
      ...(analysis.qualityWarnings.length
        ? analysis.qualityWarnings.map((item) => `- ${item}`)
        : ["- No critical automated warning was detected."]),
      "",
      "## Assumptions",
      ...analysis.assumptions.map((item) => `- ${item}`),
      "",
      "## Limitations",
      ...analysis.limitations.map((item) => `- ${item}`),
      "",
      "CounterLab evaluates statistical stability; it does not establish causality or provide clinical guidance.",
    ];
    downloadFile("counterlab-methods.md", lines.join("\n"), "text/markdown");
  };

  const columnOptions = dataset.columns.map((column) => ({ value: column, label: column }));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5">
          <button type="button" onClick={() => goTo("analyze")} aria-label="CounterLab home">
            <Wordmark />
          </button>

          <nav className="ml-auto hidden items-center gap-1 rounded-lg border border-border bg-surface p-1 md:flex">
            {[
              { id: "analyze", label: "Analyze" },
              { id: "results", label: "Evidence" },
              { id: "data", label: "Dataset" },
              { id: "methods", label: "Methodology" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goTo(item.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === item.id
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Badge variant="outline" className="hidden gap-1.5 font-normal lg:flex">
              <Lock className="size-3 text-accent" /> Local-first
            </Badge>
            <Button variant="outline" size="sm" onClick={exportEvidence} disabled={!analysis}>
              <Download className="size-4" /> Export
            </Button>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="mx-auto max-w-7xl px-5 py-8">
        <TabsList className="mb-6 w-full md:hidden">
          <TabsTrigger value="analyze">Analyze</TabsTrigger>
          <TabsTrigger value="results">Evidence</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="methods">Methods</TabsTrigger>
        </TabsList>

        {/* ANALYZE ------------------------------------------------------- */}
        <TabsContent value="analyze" className="space-y-6">
          <section className="grid-canvas panel overflow-hidden">
            <div className="grid gap-8 bg-gradient-to-br from-card via-card/90 to-transparent p-8 lg:grid-cols-[1.4fr_1fr]">
              <div>
                <p className="label-micro flex items-center gap-2">
                  <FlaskConical className="size-3.5 text-accent" /> Computational research workspace
                </p>
                <h1 className="mt-3 text-4xl font-semibold leading-[1.1] text-foreground">
                  Pressure-test a <span className="text-accent">scientific claim.</span>
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  Upload a dataset, confirm the study mapping, and see whether the conclusion
                  survives multiple defensible analyses.
                </p>
              </div>

              {analysis ? (
                <aside
                  className={`rounded-xl border p-5 ${TONE_RING[analysis.verdictTone]}`}
                  aria-label="Current analysis result"
                >
                  <div className="flex items-center justify-between">
                    <span className="label-micro">Current result</span>
                    <button
                      type="button"
                      onClick={() => goTo("results")}
                      className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      View evidence →
                    </button>
                  </div>
                  <p
                    className={`mt-4 font-display text-2xl font-semibold ${TONE_TEXT[analysis.verdictTone]}`}
                  >
                    {analysis.verdict}
                  </p>
                  <p className="mt-1 text-sm text-foreground/80">{analysis.headline}</p>
                  <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border/60 pt-4">
                    {[
                      {
                        label: analysis.primaryLabel,
                        value: formatResearchEffect(analysis.primaryEstimate, analysis.effectScale),
                      },
                      {
                        label: analysis.secondaryLabel,
                        value:
                          analysis.secondaryEstimate === null
                            ? "—"
                            : formatResearchEffect(
                                analysis.secondaryEstimate,
                                analysis.effectScale,
                              ),
                      },
                      { label: "Observations", value: formatNumber(analysis.observations) },
                    ].map((item) => (
                      <div key={item.label}>
                        <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                          {item.label}
                        </dt>
                        <dd className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </aside>
              ) : (
                <aside
                  className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/70 p-6 text-center"
                  aria-label="No analysis result yet"
                >
                  <Beaker className="size-7 text-muted-foreground/70" />
                  <p className="mt-3 text-sm font-medium text-foreground">Awaiting analysis</p>
                  <p className="mt-1 max-w-64 text-xs leading-relaxed text-muted-foreground">
                    Upload a dataset and run a stress test to generate evidence.
                  </p>
                </aside>
              )}
            </div>
          </section>

          <section className="panel p-6">
            <SectionHeading
              kicker="Step 1 · Data & claim"
              title="Define the study"
              description="CounterLab profiles the file and proposes a transparent starting plan."
              action={
                <Button variant="ghost" size="sm" onClick={() => loadDemo("binary")}>
                  <RotateCcw className="size-4" /> Load example
                </Button>
              }
            />

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="label-micro">Research dataset</p>
                {hasDataset ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-[0.6rem] font-semibold text-primary-foreground">
                      {String(dataset.format ?? "data").toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{datasetName}</p>
                      <p className="text-xs text-muted-foreground">
                        {dataset.columns.length} variables · {dataset.rows.length} source rows
                      </p>
                    </div>
                    <Badge variant="outline" className="font-normal text-supports">
                      Profiled
                    </Badge>
                  </div>
                ) : (
                  <div className="flex min-h-20 items-center gap-3 rounded-lg border border-dashed border-border bg-surface/60 p-4">
                    <Upload className="size-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">No dataset selected</p>
                      <p className="text-xs text-muted-foreground">
                        Choose a supported tabular file to begin.
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="size-4" /> Choose file
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    CSV, TSV, JSON, JSONL · parsed in your browser
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.tab,.txt,.json,.jsonl,.ndjson,text/csv,text/plain,application/json"
                    onChange={handleUpload}
                    hidden
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="label-micro">Examples</span>
                  {RESEARCH_DEMOS.map((demo) => (
                    <button
                      key={demo.id}
                      type="button"
                      onClick={() => loadDemo(demo.id)}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
                    >
                      {demo.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <p className="label-micro">Research claim</p>
                <Textarea
                  value={claim}
                  rows={4}
                  spellCheck
                  disabled={!hasDataset}
                  placeholder={
                    hasDataset
                      ? "State the scientific claim to test"
                      : "Upload a dataset before entering a claim"
                  }
                  onChange={(event) => {
                    setClaim(event.target.value);
                    setConfig((current) => ({ ...current, claim: event.target.value }));
                    invalidateAnalysis();
                  }}
                  className="resize-none text-sm"
                />
                <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent/10 font-mono text-sm text-accent">
                    ƒ
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{compilerLabel}</p>
                    <p className="text-xs text-muted-foreground">{compilerDetail}</p>
                  </div>
                </div>
              </div>
            </div>

            {hasDataset ? (
              <>
                <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-accent/25 bg-accent/5 px-4 py-3">
                  <CheckCircle2 className="size-4 text-accent" />
                  <div className="mr-auto">
                    <p className="text-sm font-medium text-foreground">
                      Detected analysis · {activeFamily?.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{activeFamily?.detail}</p>
                  </div>
                  <Badge className="bg-accent text-accent-foreground">Ready</Badge>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Outcome" hint="The measured variable the claim is about.">
                    <ColumnSelect
                      value={config.outcome}
                      options={columnOptions}
                      onChange={updateOutcome}
                    />
                  </Field>
                  <Field
                    label={
                      config.kind === "time-series"
                        ? "Time variable"
                        : isGroupComparison(config.kind)
                          ? "Comparison group"
                          : "Predictor"
                    }
                    hint="The variable the outcome is compared across."
                  >
                    <ColumnSelect
                      value={config.predictor}
                      options={columnOptions.filter((option) => option.value !== config.outcome)}
                      onChange={updatePredictor}
                    />
                  </Field>
                  {config.kind === "binary-comparison" ? (
                    <Field label="Positive outcome" hint="Value treated as the event of interest.">
                      <ColumnSelect
                        value={activePositiveKey}
                        options={outcomeValues.map((value) => ({
                          value: valueKey(value),
                          label: displayValue(value),
                        }))}
                        onChange={(value) => {
                          setConfig((current) => ({
                            ...current,
                            positiveOutcome: actualValue(outcomeValues, value),
                          }));
                          invalidateAnalysis();
                        }}
                      />
                    </Field>
                  ) : null}
                </div>

                <Collapsible className="mt-5 rounded-lg border border-border bg-surface">
                  <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left">
                    <Sliders className="size-4 text-muted-foreground" />
                    <span className="mr-auto">
                      <span className="block text-sm font-medium text-foreground">
                        Advanced settings
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Method override, reference groups, stratification, weights, direction
                      </span>
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-5 border-t border-border px-4 py-5">
                    <div>
                      <p className="label-micro mb-2">Analysis family override</p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {FAMILIES.map((family) => (
                          <button
                            key={family.kind}
                            type="button"
                            onClick={() => changeKind(family.kind)}
                            className={`rounded-lg border p-3 text-left transition-colors ${
                              config.kind === family.kind
                                ? "border-accent bg-accent/10"
                                : "border-border bg-card hover:border-accent/40"
                            }`}
                          >
                            <span className="block text-sm font-medium text-foreground">
                              {family.label}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {family.detail}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {isGroupComparison(config.kind) ? (
                        <>
                          <Field label="Reference group">
                            <ColumnSelect
                              value={referenceKey}
                              options={predictorValues.map((value) => ({
                                value: valueKey(value),
                                label: displayValue(value),
                              }))}
                              onChange={(value) => {
                                setConfig((current) => ({
                                  ...current,
                                  referenceGroup: actualValue(predictorValues, value),
                                }));
                                invalidateAnalysis();
                              }}
                            />
                          </Field>
                          <Field label="Comparison group">
                            <ColumnSelect
                              value={comparisonKey}
                              options={predictorValues.map((value) => ({
                                value: valueKey(value),
                                label: displayValue(value),
                              }))}
                              onChange={(value) => {
                                setConfig((current) => ({
                                  ...current,
                                  comparisonGroup: actualValue(predictorValues, value),
                                }));
                                invalidateAnalysis();
                              }}
                            />
                          </Field>
                          <Field label="Stratifier" hint="Subgroup variable for stratified checks.">
                            <ColumnSelect
                              value={config.stratifier ?? "__none"}
                              options={[
                                { value: "__none", label: "None" },
                                ...columnOptions.filter(
                                  (option) =>
                                    option.value !== config.outcome &&
                                    option.value !== config.predictor,
                                ),
                              ]}
                              onChange={(value) => {
                                setConfig((current) => ({
                                  ...current,
                                  stratifier: value === "__none" ? undefined : value,
                                }));
                                invalidateAnalysis();
                              }}
                            />
                          </Field>
                          <Field label="Frequency weight">
                            <ColumnSelect
                              value={config.weight ?? "__none"}
                              options={[
                                { value: "__none", label: "One row = one observation" },
                                ...columnOptions,
                              ]}
                              onChange={(value) => {
                                setConfig((current) => ({
                                  ...current,
                                  weight: value === "__none" ? undefined : value,
                                }));
                                invalidateAnalysis();
                              }}
                            />
                          </Field>
                        </>
                      ) : null}
                      <Field
                        label="Claim direction"
                        hint="Direction the claim expects the effect to go."
                      >
                        <ColumnSelect
                          value={String(config.claimDirection)}
                          options={[
                            { value: "1", label: "Positive / higher" },
                            { value: "-1", label: "Negative / lower" },
                          ]}
                          onChange={(value) => {
                            setConfig((current) => ({
                              ...current,
                              claimDirection: value === "-1" ? -1 : 1,
                            }));
                            invalidateAnalysis();
                          }}
                        />
                      </Field>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2 rounded-lg border border-challenges/30 bg-challenges-soft px-4 py-3 text-sm text-challenges"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
              <ol className="flex flex-wrap items-center gap-4" aria-live="polite">
                {STAGES.map((label, index) => {
                  const done = runStage > index;
                  const active = runStage > 0 && runStage === index;
                  return (
                    <li key={label} className="flex items-center gap-2 text-xs">
                      <span
                        className={`flex size-5 items-center justify-center rounded-full border font-mono text-[0.6rem] ${
                          done
                            ? "border-supports bg-supports text-primary-foreground"
                            : active
                              ? "border-accent text-accent"
                              : "border-border text-muted-foreground"
                        }`}
                      >
                        {done ? "✓" : index + 1}
                      </span>
                      <span
                        className={done || active ? "text-foreground" : "text-muted-foreground"}
                      >
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <Button size="lg" onClick={runStressTest} disabled={isRunning || !canRun}>
                <Play className="size-4" />
                {isRunning ? "Testing claim…" : "Run stress test"}
              </Button>
            </div>
          </section>
        </TabsContent>

        {/* EVIDENCE ------------------------------------------------------ */}
        <TabsContent value="results" className="space-y-6">
          {analysis ? (
            <>
              <SectionHeading
                kicker="Evidence workspace"
                title="Evidence synthesis"
                description={analysis.methodLabel}
                action={
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={exportMethods}>
                      <Download className="size-4" /> Methods report
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportEvidence}>
                      <Download className="size-4" /> Evidence JSON
                    </Button>
                  </div>
                }
              />

              <article
                className={`panel grid gap-6 border p-6 lg:grid-cols-[auto_1fr_auto] lg:items-center ${TONE_RING[analysis.verdictTone]}`}
              >
                <span
                  className={`flex size-12 items-center justify-center rounded-xl border bg-card font-display text-xl font-semibold ${TONE_TEXT[analysis.verdictTone]}`}
                >
                  {analysis.verdict === "Fragile" ? "!" : analysis.verdict === "Robust" ? "✓" : "?"}
                </span>
                <div>
                  <p className="label-micro">{analysis.verdict} conclusion</p>
                  <h3 className="mt-1 text-xl font-semibold text-foreground">
                    {analysis.headline}
                  </h3>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-foreground/75">
                    {analysis.summary}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card px-5 py-4 text-center">
                  <p className="label-micro">Effect contrast</p>
                  <p className="mt-2 flex items-center gap-2 font-mono text-sm font-semibold tabular-nums text-foreground">
                    {formatResearchEffect(analysis.primaryEstimate, analysis.effectScale)}
                    <span className="text-muted-foreground">→</span>
                    {analysis.secondaryEstimate === null
                      ? "—"
                      : formatResearchEffect(analysis.secondaryEstimate, analysis.effectScale)}
                  </p>
                  <p className="mt-1 text-[0.65rem] text-muted-foreground">
                    {analysis.primaryLabel} → {analysis.secondaryLabel}
                  </p>
                </div>
              </article>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {analysis.metrics.map((metric) => (
                  <article key={metric.label} className="panel p-4">
                    <p className="label-micro">{metric.label}</p>
                    <p
                      className={`mt-2 font-mono text-xl font-semibold tabular-nums ${
                        metric.tone === "alert"
                          ? "text-challenges"
                          : metric.tone === "teal"
                            ? "text-accent"
                            : "text-foreground"
                      }`}
                    >
                      {metric.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
                  </article>
                ))}
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
                <article className="panel p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <p className="label-micro">Specification curve</p>
                      <h3 className="mt-1 text-lg font-semibold">Effect stability</h3>
                    </div>
                    <Badge variant="outline" className="font-normal">
                      95% intervals
                    </Badge>
                  </div>
                  <SpecificationPlot
                    specifications={analysis.specifications}
                    scale={analysis.effectScale}
                    label={analysis.effectLabel}
                  />
                </article>

                <article className="panel p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <p className="label-micro">Method audit</p>
                      <h3 className="mt-1 text-lg font-semibold">Reasoning trace</h3>
                    </div>
                    <Badge variant="outline" className="font-normal">
                      {analysis.trace.length} checks
                    </Badge>
                  </div>
                  <ol className="space-y-3">
                    {analysis.trace.map((item, index) => (
                      <li key={item.title} className="flex gap-3">
                        <span
                          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-[0.65rem] ${
                            item.state === "warning"
                              ? "border-uncertain/40 bg-uncertain-soft text-uncertain"
                              : item.state === "discovery"
                                ? "border-challenges/40 bg-challenges-soft text-challenges"
                                : "border-border bg-surface text-muted-foreground"
                          }`}
                        >
                          {item.state === "discovery" ? "!" : index + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{item.title}</p>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {item.detail}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-5 rounded-lg border border-border bg-surface p-4">
                    <p className="label-micro">Primary finding</p>
                    <p className="mt-1.5 text-sm text-foreground/80">
                      {analysis.findings[1] ?? analysis.findings[0]}
                    </p>
                  </div>
                </article>
              </div>

              <article className="panel p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="label-micro">Evidence ledger</p>
                    <h3 className="mt-1 text-lg font-semibold">Executed specifications</h3>
                  </div>
                  <Badge variant="outline" className="font-normal">
                    Computed locally
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-3xl border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {[
                          "Specification",
                          "Family",
                          "Effect",
                          "95% interval",
                          "p-value",
                          "Assessment",
                        ].map((head) => (
                          <th
                            key={head}
                            className="label-micro py-2 pr-4 text-left font-normal last:pr-0"
                          >
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.specifications.map((item) => (
                        <tr key={item.id} className="border-b border-border/60 last:border-0">
                          <td className="max-w-xs py-3 pr-4 align-top">
                            <p className="font-medium text-foreground">{item.label}</p>
                            <p className="text-xs text-muted-foreground">{item.evidence}</p>
                          </td>
                          <td className="py-3 pr-4 align-top text-muted-foreground">
                            {item.family}
                          </td>
                          <td className="py-3 pr-4 align-top font-mono tabular-nums">
                            {formatResearchEffect(item.estimate, analysis.effectScale)}
                          </td>
                          <td className="py-3 pr-4 align-top font-mono text-xs tabular-nums text-muted-foreground">
                            {formatResearchEffect(item.ciLow, analysis.effectScale)} to{" "}
                            {formatResearchEffect(item.ciHigh, analysis.effectScale)}
                          </td>
                          <td className="py-3 pr-4 align-top font-mono tabular-nums">
                            {formatResearchPValue(item.pValue)}
                          </td>
                          <td className="py-3 align-top">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[0.65rem] font-medium capitalize ${ASSESSMENT[item.status]}`}
                            >
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <div className="grid gap-4 lg:grid-cols-3">
                {[
                  {
                    kicker: "Data quality",
                    title: "Automated cautions",
                    items: analysis.qualityWarnings.length
                      ? analysis.qualityWarnings
                      : ["No critical automated warning was detected."],
                  },
                  {
                    kicker: "Interpretation",
                    title: "Assumptions",
                    items: analysis.assumptions,
                  },
                  { kicker: "Scope boundary", title: "Limitations", items: analysis.limitations },
                ].map((card) => (
                  <article key={card.title} className="panel p-5">
                    <p className="label-micro">{card.kicker}</p>
                    <h3 className="mt-1 text-base font-semibold">{card.title}</h3>
                    <ul className="mt-3 space-y-2">
                      {card.items.map((item) => (
                        <li
                          key={item}
                          className="flex gap-2 text-xs leading-relaxed text-muted-foreground"
                        >
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <SectionHeading
                kicker="Evidence workspace"
                title="Evidence synthesis"
                description="Results appear here only after a dataset has been uploaded and analyzed."
              />
              <article className="panel flex min-h-80 flex-col items-center justify-center border-dashed p-8 text-center">
                <Beaker className="size-8 text-muted-foreground/70" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  No evidence generated
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Upload a dataset, review the proposed mappings, and run the stress test. No
                  conclusion is shown before that analysis completes.
                </p>
                <Button className="mt-5" variant="outline" onClick={() => goTo("analyze")}>
                  Go to analysis
                </Button>
              </article>
            </>
          )}
        </TabsContent>

        {/* DATA ---------------------------------------------------------- */}
        <TabsContent value="data" className="space-y-6">
          <SectionHeading
            kicker="Data workspace"
            title="Dataset audit"
            description="Structure, inferred types, missingness, and complete-case coverage."
          />
          {hasDataset ? (
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <article className="panel p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="label-micro">Source preview</p>
                    <h3 className="mt-1 text-lg font-semibold">{datasetName}</h3>
                  </div>
                  <Badge variant="outline" className="font-normal">
                    {missingCells ? `${missingCells} missing cells` : "No missing values"}
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        {dataset.columns.map((column) => (
                          <th
                            key={column}
                            className="label-micro py-2 pr-4 text-left font-normal whitespace-nowrap"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dataset.rows.slice(0, 8).map((row, index) => (
                        <tr key={index} className="border-b border-border/50 last:border-0">
                          {dataset.columns.map((column) => (
                            <td
                              key={column}
                              className="py-2 pr-4 font-mono tabular-nums whitespace-nowrap text-muted-foreground"
                            >
                              {displayValue(row[column] ?? null)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="panel p-6">
                <p className="label-micro">Schema profile</p>
                <h3 className="mt-1 text-lg font-semibold">Variable health</h3>
                <div className="mt-4 space-y-2">
                  {profiles.map((profile) => (
                    <div
                      key={profile.name}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs font-medium text-foreground">
                          {profile.name}
                        </p>
                        <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                          {profile.kind}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-[0.7rem] text-muted-foreground">
                        <p>{profile.uniqueCount} unique</p>
                        <p>{profile.missingCount} missing</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          ) : (
            <article className="panel flex min-h-80 flex-col items-center justify-center border-dashed p-8 text-center">
              <Upload className="size-8 text-muted-foreground/70" />
              <h3 className="mt-4 text-lg font-semibold text-foreground">No dataset loaded</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Dataset structure and variable profiles will appear here after you upload a file.
              </p>
              <Button className="mt-5" variant="outline" onClick={() => goTo("analyze")}>
                Choose a dataset
              </Button>
            </article>
          )}
        </TabsContent>

        {/* METHODS ------------------------------------------------------- */}
        <TabsContent value="methods" className="space-y-6">
          <SectionHeading
            kicker="Methods workspace"
            title="Transparent methodology"
            description="Typed analysis routes, deterministic estimates, and bounded model assistance."
          />
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              {
                index: "01",
                title: "Typed method routing",
                body: "Column profiles route data into binary, continuous, association, or longitudinal engines. Every mapping stays visible and editable.",
              },
              {
                index: "02",
                title: "Defensible sensitivities",
                body: "Welch, rank, winsorized, stratified, Newey–West, and Theil–Sen specifications expose choices that can change a conclusion.",
              },
              {
                index: "03",
                title: "Bounded AI role",
                body: "The optional compiler sees schema metadata—not raw rows—and cannot calculate or override the deterministic statistical results.",
              },
            ].map((card) => (
              <article key={card.index} className="panel p-6">
                <span className="font-mono text-xs text-accent">{card.index}</span>
                <h3 className="mt-3 text-lg font-semibold">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
              </article>
            ))}
          </div>
          <div className="panel flex flex-wrap items-center gap-4 p-5">
            <span className="label-micro flex items-center gap-2">
              <Beaker className="size-3.5 text-accent" /> Methodological grounding
            </span>
            {[
              { href: "https://doi.org/10.1038/s41562-020-0912-z", label: "Specification curves" },
              { href: "https://doi.org/10.1177/1745691616658637", label: "Multiverse analysis" },
              { href: "https://doi.org/10.2307/1913610", label: "Newey–West HAC" },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-foreground underline decoration-accent/50 underline-offset-4 hover:decoration-accent"
              >
                {link.label}
              </a>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-5 py-8 text-xs text-muted-foreground">
          <span className="flex items-center gap-2 text-foreground">
            <LogoMark className="size-6 text-primary" />
            <span className="font-display font-semibold">CounterLab</span>
          </span>
          <span className="mr-auto">Make analytical uncertainty visible before publication.</span>
          <span>Research prototype · Not clinical guidance</span>
        </div>
      </footer>
    </div>
  );
}

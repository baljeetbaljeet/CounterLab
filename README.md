# CounterLab

CounterLab is a research-auditing workbench that tests whether a claim remains stable across defensible analytical choices. Upload a tabular dataset, describe a claim, confirm the inferred schema, and run a transparent multiverse-style analysis. CounterLab reports effect sizes, uncertainty, specification stability, data-quality warnings, and reproducible evidence exports instead of producing an unexplained yes/no answer.

> CounterLab is a research prototype, not a medical device. Its results are exploratory and do not establish causality or replace statistical, clinical, or regulatory review.

## What it does

- Accepts CSV, TSV, tab-delimited text, JSON arrays, JSON Lines, and NDJSON.
- Profiles columns and proposes mappings for outcomes, groups, predictors, time fields, strata, and frequency weights.
- Supports binary comparisons, continuous group comparisons, numeric associations, and longitudinal trend analyses.
- Runs multiple defensible specifications, including robust, transformed, stratified, and temporal sensitivity checks where the data allow them.
- Displays effect estimates, confidence intervals, p-values, sign stability, reversals, quality warnings, assumptions, and an analysis trace.
- Exports a machine-readable evidence bundle and a human-readable methods report.
- Keeps the uploaded dataset in the browser. The optional language-model call receives only the claim, column names, column profiles, and selected mapping—not the raw rows.

The statistical engine is deterministic and works without an API key. An optional server-side Featherless key enables conservative claim-direction assistance; it does not generate numerical findings.

## Run locally

Requirements: Node.js 20+ and npm, or Bun 1.2+.

```sh
git clone https://github.com/baljeetbaljeet/CounterLab.git
cd CounterLab
npm install
cp .env.example .env.local
npm run dev
```

Open the local URL printed by Vite. Leave `FEATHERLESS_API_KEY` blank to run the full deterministic workflow without language-model assistance.

## Environment variables

```dotenv
FEATHERLESS_API_KEY=
FEATHERLESS_MODEL=Qwen/Qwen2.5-7B-Instruct
```

Keep real credentials in local or deployment environment settings. Never commit `.env`, `.env.local`, `.dev.vars`, or provider secrets.

## Validation

```sh
npm run lint
npm run build
```

## Deploy

Build the application with `npm run build` and deploy the generated TanStack Start server output to a compatible Node or edge host. Configure `FEATHERLESS_API_KEY` as a server-side secret only if optional claim assistance is desired.

## Methodological scope

CounterLab currently implements four analysis families:

1. Binary group comparisons using risk differences and stratified sensitivity analyses.
2. Continuous group comparisons using Welch inference plus robust bootstrap and subgroup checks when applicable.
3. Numeric associations using Pearson, Spearman, winsorized, transformed, and simple-regression diagnostics.
4. Time-series trends using OLS, Newey–West HAC uncertainty, Theil–Sen sensitivity, and segmented checks.

The interface surfaces limitations for each run. Users remain responsible for study design, confounding control, missing-data assumptions, multiplicity, model validity, and domain interpretation.

## Stack

TanStack Start, React 19, TypeScript, Tailwind CSS, Recharts, Radix UI, and Vite.

import { createFileRoute } from "@tanstack/react-router";
import { CounterLabApp } from "@/components/counterlab/counterlab-app";

const title = "CounterLab — Scientific Claim Stress Testing";
const description =
  "Test whether a research conclusion survives multiple defensible analyses. Specification curves, robust estimators, and reproducible exports, computed in your browser.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CounterLabApp,
});

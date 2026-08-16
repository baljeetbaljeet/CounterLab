import { createServerFn } from "@tanstack/react-start";

export interface CompileResponse {
  claimDirection?: 1 | -1;
  rationale?: string;
  provider?: string;
  model?: string;
  available: boolean;
}

export const compileClaim = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { claim: string; columns: string[]; mapping: unknown; profiles: unknown }) => data,
  )
  .handler(async ({ data }): Promise<CompileResponse> => {
    const apiKey = process.env["FEATHERLESS_API_KEY"];
    if (!apiKey || !data.claim.trim() || data.columns.length < 2) {
      return { available: false };
    }
    const model = process.env["FEATHERLESS_MODEL"] || "Qwen/Qwen2.5-7B-Instruct";
    const systemPrompt = [
      "You are a conservative statistical hypothesis compiler.",
      "Map a plain-language research claim to the supplied dataset schema.",
      "Return JSON only. Never invent a column or a numerical result.",
      "claimDirection is 1 when the claim expects a positive effect, association, or slope; otherwise -1.",
      'Use this exact object shape: {"claimDirection":1,"rationale":"one sentence"}',
    ].join(" ");

    try {
      const upstream = await fetch("https://api.featherless.ai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 300,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                claim: data.claim,
                columns: data.columns,
                columnProfiles: data.profiles,
                selectedMapping: data.mapping,
              }),
            },
          ],
        }),
      });
      if (!upstream.ok) return { available: false };
      const completion = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = completion.choices?.[0]?.message?.content;
      if (!content) return { available: false };
      const parsed = JSON.parse(content) as { claimDirection?: number; rationale?: string };
      return {
        available: true,
        claimDirection: parsed.claimDirection === -1 ? -1 : 1,
        rationale:
          typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 320) : undefined,
        provider: "Featherless",
        model,
      };
    } catch {
      return { available: false };
    }
  });

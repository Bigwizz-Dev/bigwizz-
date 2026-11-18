import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function clean(value: unknown, max = 1200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply({ error: "Please sign in to use AI writing." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!supabaseUrl || !supabaseKey) return reply({ error: "The AI service is not configured correctly." }, 503);
    if (!openAiKey) return reply({ error: "AI writing is not configured yet. Add the OPENAI_API_KEY secret to this Supabase project." }, 503);

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return reply({ error: "Your session is invalid. Please sign in again." }, 401);

    const { data: sellerRole, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", authData.user.id)
      .eq("role", "seller")
      .maybeSingle();
    if (roleError) return reply({ error: "Could not verify your seller account." }, 403);
    if (!sellerRole) return reply({ error: "AI writing tools are available to seller accounts only." }, 403);

    const body = await req.json();
    const kind = body?.kind;
    if (kind !== "maker_story" && kind !== "product_description") {
      return reply({ error: "Unsupported AI writing task." }, 400);
    }
    const details = body?.details && typeof body.details === "object" ? body.details : {};

    let instructions = "";
    let input = "";
    if (kind === "maker_story") {
      const notes = clean(details.notes, 2500);
      const category = clean(details.category, 100);
      const productTitle = clean(details.productTitle, 120);
      instructions = "You are BigWizz's maker-story writing assistant. Write a warm, authentic, engaging first-person-plural or maker-centred social caption for the Maker & Process Feed. Use only facts explicitly supplied by the seller. Never invent materials, techniques, timelines, achievements, product qualities, customer outcomes, or behind-the-scenes events. If details are sparse, keep the story general and honest. Avoid hashtags unless they add clear value. Return only the finished story, around 70 to 120 words.";
      input = JSON.stringify({ sellerNotes: notes, makerCategory: category, taggedProduct: productTitle });
    } else {
      const title = clean(details.title, 120);
      const category = clean(details.category, 120);
      const colours = clean(details.colours, 240);
      const sizes = clean(details.sizes, 240);
      const customMeasurements = details.customMeasurements === true;
      const existingDraft = clean(details.existingDraft, 1800);
      if (!title) return reply({ error: "Add a product title before generating its description." }, 400);
      instructions = "You are BigWizz's marketplace product-copy assistant. Write a clear, appealing, buyer-friendly product description in natural English for a Nigerian marketplace. Use only facts supplied by the seller; do not invent materials, dimensions, quality certifications, origin, guarantees, stock, delivery promises, or product features. Mention category, available colours, sizes, or custom measurements only when supplied. If the seller's draft includes claims not supported by the other details, do not amplify them. Return only the finished description, around 80 to 140 words.";
      input = JSON.stringify({ productTitle: title, category, availableColours: colours, availableSizes: sizes, customMeasurementsAvailable: customMeasurements, sellerDraftToImprove: existingDraft });
    }

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openAiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.4-mini", instructions, input, max_output_tokens: 450 }),
    });
    const aiData = await aiResponse.json();
    if (!aiResponse.ok) {
      console.error("OpenAI request failed:", aiResponse.status, aiData?.error?.message || "Unknown provider error");
      return reply({ error: "The AI writing service could not complete your request. Please try again." }, 502);
    }

    const text = (aiData.output || [])
      .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
      .filter((item: any) => item.type === "output_text" && typeof item.text === "string")
      .map((item: any) => item.text)
      .join("\n")
      .trim();
    if (!text) return reply({ error: "The AI returned no text. Please try again." }, 502);
    return reply({ text });
  } catch (error) {
    console.error("seller-ai-copy error:", error);
    return reply({ error: "AI writing is temporarily unavailable. Please try again." }, 500);
  }
});
import OpenAI from "openai";

export function createOpenAIClient(apiKey: string, baseURL?: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: baseURL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    dangerouslyAllowBrowser: false,
  });
}

export async function generateImage(
  client: OpenAI,
  params: {
    prompt: string;
    model: string;
    size?: string;
    image?: string;
    n?: number;
    quality?: string;
  }
): Promise<string[]> {
  const response = await client.images.generate({
    model: params.model,
    prompt: params.prompt,
    n: params.n || 1,
    size: (params.size || "1024x1024") as "1024x1024" | "1536x1024" | "1024x1536" | "1792x1024" | "1024x1792",
    ...(params.quality && { quality: params.quality as "standard" | "hd" }),
  });

  return (response.data || [])
    .map((img) => img.url || img.b64_json)
    .filter(Boolean) as string[];
}

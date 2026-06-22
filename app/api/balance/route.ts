import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const apiKey =
    request.headers.get("x-api-key") || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "API Key required" }, { status: 401 });
  }

  // GPT-Image2 API does not directly return balance; stub for future implementation
  return NextResponse.json({
    balance: 0,
    currency: "CNY",
    message: "Balance query not supported by this API",
  });
}

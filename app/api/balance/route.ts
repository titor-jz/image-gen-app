import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/error-messages";

export async function GET(request: NextRequest) {
  const apiKey =
    request.headers.get("x-api-key") || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const { body, status } = errorResponse("AUTH_MISSING_KEY");
    return NextResponse.json({ error: body }, { status });
  }

  // GPT-Image2 API does not directly return balance; stub for future implementation
  return NextResponse.json({
    balance: 0,
    currency: "CNY",
    message: "Balance query not supported by this API",
  });
}

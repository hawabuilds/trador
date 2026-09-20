import {MOONPAY_API_KEY} from "@/config/moonpay";
import {signMoonPayUrl} from "@/lib/server/moonpaySign";
import {badRequest, json} from "@/lib/server/http";

const SECRET = process.env.MOONPAY_SECRET_KEY ?? "";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!MOONPAY_API_KEY || !SECRET) {
    return json({error: "MoonPay is not configured."}, {status: 503});
  }

  const body = (await request.json()) as {urlForSignature?: string};
  const urlForSignature = body.urlForSignature;
  if (typeof urlForSignature !== "string" || !urlForSignature.startsWith("http")) {
    return badRequest("urlForSignature from the MoonPay SDK is required.");
  }

  try {
    const signature = signMoonPayUrl(urlForSignature, SECRET);
    return json({signature});
  } catch (err) {
    return badRequest((err as Error).message);
  }
}

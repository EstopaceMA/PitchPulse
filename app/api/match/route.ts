import dataset from "@/public/arsenal-vs-chelsea-match.json";
import { validateMatch } from "@/lib/match/validation";

export function GET() {
  // Use the public-folder source, stripping final summaries for the simulator.
  return Response.json(validateMatch(dataset));
}
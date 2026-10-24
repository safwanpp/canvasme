import { pwaIcon } from "../../_og/pwa-icon";

export const dynamic = "force-static";

export function GET() {
  return pwaIcon(512, false);
}

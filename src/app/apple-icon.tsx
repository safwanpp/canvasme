import { ImageResponse } from "next/og";
import { markDataUrl } from "./_og/assets";

export const dynamic = "force-static";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS adds its own rounded corners, so the icon is a full-bleed square.
export default async function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FDFDFE",
        }}
      >
        <img src={await markDataUrl()} width={112} height={112} alt="" />
      </div>
    ),
    size,
  );
}

import { ImageResponse } from "next/og";
import { markDataUrl } from "./assets";

/**
 * PNG app icon for the web manifest. `maskable` keeps the mark inside the
 * central safe zone so Android's circle/squircle masks never crop it.
 */
export async function pwaIcon(size: number, maskable = false) {
  const mark = Math.round(size * (maskable ? 0.5 : 0.62));
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
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <img src={await markDataUrl()} width={mark} height={mark} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}

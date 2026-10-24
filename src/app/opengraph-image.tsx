import { ImageResponse } from "next/og";
import { markDataUrl, ogFonts } from "./_og/assets";

export const dynamic = "force-static";
export const alt = "canvas.me: a free design editor that runs in your browser";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0E1530";
const INK2 = "#474D6B";
const INK3 = "#656A82";
const ACCENT = "#3E3AA8";

function Handle({ style }: { style: React.CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        width: 16,
        height: 16,
        borderRadius: 999,
        border: `2px solid ${ACCENT}`,
        background: "#FFFFFF",
        ...style,
      }}
    />
  );
}

export default async function OpengraphImage() {
  const mark = await markDataUrl();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 72px",
          background: "#F3F4F7",
          backgroundImage: "radial-gradient(circle at 92% 0%, rgba(62,58,168,0.16), rgba(62,58,168,0) 55%)",
          fontFamily: "Geist",
          color: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src={mark} width={48} height={48} alt="" />
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>
            canvas<span style={{ color: ACCENT }}>.me</span>
          </div>
        </div>

        {/* Headline shown selected, the way the editor draws a text box */}
        <div style={{ display: "flex" }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              padding: "10px 26px 18px",
              border: `2px solid ${ACCENT}`,
              fontSize: 104,
              fontWeight: 600,
              letterSpacing: -5,
              lineHeight: 1,
            }}
          >
            <span>Design it here.</span>
            <span>Keep it yours.</span>
            <Handle style={{ left: -9, top: -9 }} />
            <Handle style={{ right: -9, top: -9 }} />
            <Handle style={{ left: -9, bottom: -9 }} />
            <Handle style={{ right: -9, bottom: -9 }} />
            <Handle style={{ left: -9, top: "50%", marginTop: -8 }} />
            <Handle style={{ right: -9, top: "50%", marginTop: -8 }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 32, color: INK2 }}>Free design editor in your browser. No account.</div>
            <div style={{ fontFamily: "Geist Mono", fontSize: 22, color: INK3 }}>canvasme.setitup.in</div>
          </div>
          <div style={{ fontSize: 22, color: INK3 }}>Built by SETITUP</div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}

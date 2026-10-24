"""Turn a pixel bitmap into one SVG path drawn like the SETITUP mark: outer corners rounded,
the counter's inner corners rounded, and one-block notches (where a tab meets a bar) left sharp."""
import sys

def outline(rows):
    filled = {(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == "1"}
    edges = {}
    for (x, y) in filled:
        if (x, y - 1) not in filled: edges[(x, y)] = (x + 1, y)
        if (x + 1, y) not in filled: edges[(x + 1, y)] = (x + 1, y + 1)
        if (x, y + 1) not in filled: edges[(x + 1, y + 1)] = (x, y + 1)
        if (x - 1, y) not in filled: edges[(x, y + 1)] = (x, y)
    loops = []
    while edges:
        start = next(iter(edges)); loop = [start]; cur = edges.pop(start)
        while cur != start:
            loop.append(cur); cur = edges.pop(cur)
        # drop collinear points
        pts = []
        n = len(loop)
        for i in range(n):
            p, v, q = loop[i - 1], loop[i], loop[(i + 1) % n]
            if (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]) != 0:
                pts.append(v)
        loops.append(pts)
    return loops

def path(rows, size=400, r=16, rc=16):
    unit = size / max(len(rows), len(rows[0]))
    ox = (size - unit * len(rows[0])) / 2
    oy = (size - unit * len(rows)) / 2
    d = []
    for pts in outline(rows):
        n = len(pts)
        P = [(ox + x * unit, oy + y * unit) for x, y in pts]
        G = pts
        segs = []
        for i in range(n):
            p, v, q = P[i - 1], P[i], P[(i + 1) % n]
            din = ((v[0] - p[0]) / max(1e-9, abs(v[0] - p[0]) + abs(v[1] - p[1])), (v[1] - p[1]) / max(1e-9, abs(v[0] - p[0]) + abs(v[1] - p[1])))
            dout = ((q[0] - v[0]) / max(1e-9, abs(q[0] - v[0]) + abs(q[1] - v[1])), (q[1] - v[1]) / max(1e-9, abs(q[0] - v[0]) + abs(q[1] - v[1])))
            convex = din[0] * dout[1] - din[1] * dout[0] > 0
            gp, gv, gq = G[i - 1], G[i], G[(i + 1) % n]
            short = min(abs(gv[0] - gp[0]) + abs(gv[1] - gp[1]), abs(gq[0] - gv[0]) + abs(gq[1] - gv[1])) < 2
            rad = r if convex else (0 if short else rc)
            a = (v[0] - din[0] * rad, v[1] - din[1] * rad)
            b = (v[0] + dout[0] * rad, v[1] + dout[1] * rad)
            segs.append((a, b, rad, 1 if convex else 0))
        cmd = f"M{segs[0][1][0]:.1f} {segs[0][1][1]:.1f}"
        for i in range(1, n + 1):
            a, b, rad, sweep = segs[i % n]
            cmd += f"L{a[0]:.1f} {a[1]:.1f}"
            if rad: cmd += f"A{rad} {rad} 0 0 {sweep} {b[0]:.1f} {b[1]:.1f}"
        d.append(cmd + "Z")
    return "".join(d)

def svg(rows, r, rc=None):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" fill="none">
  <path d="{path(rows, r=r, rc=r if rc is None else rc)}" fill="url(#g)"/>
  <defs><linearGradient id="g" x1="200" y1="0" x2="200" y2="400" gradientUnits="userSpaceOnUse"><stop stop-color="#9D7FF4"/><stop offset="1" stop-color="#0755FF"/></linearGradient></defs>
</svg>
'''

VARIANTS = {
    # Shipped mark (from the 11x11 sketch): bars inset from the wall, stepped inner corners,
    # terminals dropping a row and stepping one block past the bars.
    "block": ["00111111110",
              "00111111110",
              "11110000011",
              "11110000011",
              "11000000000",
              "11000000000",
              "11000000000",
              "11110000011",
              "11110000011",
              "00111111110",
              "00111111110"],
    # Earlier 8x8 take: bars inset one block, terminals step one block past them.
    "minimal": ["01111100",
                "11111111",
                "11000000",
                "11000000",
                "11000000",
                "11000000",
                "11111111",
                "01111100"],
    # Earlier, busier take with two-step staircase corners.
    "stepped": ["0001111100",
                "0011111110",
                "0111000111",
                "1110000111",
                "1100000000",
                "1100000000",
                "1110000111",
                "0111000111",
                "0011111110",
                "0001111100"],
}
RADII = {"block": 9, "minimal": 12, "stepped": 8}

if __name__ == "__main__":
    # Usage: python3 scripts/pixel_logo.py public/brand/canvasme-mark.svg [variant]
    variant = sys.argv[2] if len(sys.argv) > 2 else "block"
    open(sys.argv[1], "w").write(svg(VARIANTS[variant], RADII[variant]))

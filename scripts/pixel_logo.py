"""Turn a pixel bitmap into one SVG path: convex corners rounded, concave corners sharp
(the construction used by the SETITUP mark)."""
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

def path(rows, size=400, r=16, rc=0):
    unit = size / max(len(rows), len(rows[0]))
    ox = (size - unit * len(rows[0])) / 2
    oy = (size - unit * len(rows)) / 2
    d = []
    for pts in outline(rows):
        n = len(pts)
        P = [(ox + x * unit, oy + y * unit) for x, y in pts]
        segs = []
        for i in range(n):
            p, v, q = P[i - 1], P[i], P[(i + 1) % n]
            din = ((v[0] - p[0]) / max(1e-9, abs(v[0] - p[0]) + abs(v[1] - p[1])), (v[1] - p[1]) / max(1e-9, abs(v[0] - p[0]) + abs(v[1] - p[1])))
            dout = ((q[0] - v[0]) / max(1e-9, abs(q[0] - v[0]) + abs(q[1] - v[1])), (q[1] - v[1]) / max(1e-9, abs(q[0] - v[0]) + abs(q[1] - v[1])))
            convex = din[0] * dout[1] - din[1] * dout[0] > 0
            rad = r if convex else rc
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

def svg(rows, r, rc=0):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400" fill="none">
  <path d="{path(rows, r=r, rc=rc)}" fill="url(#g)"/>
  <defs><linearGradient id="g" x1="200" y1="0" x2="200" y2="400" gradientUnits="userSpaceOnUse"><stop stop-color="#9D7FF4"/><stop offset="1" stop-color="#0755FF"/></linearGradient></defs>
</svg>
'''

VARIANTS = {
    # 10x10 stepped C: two-step staircase on every outer corner
    "a": ["0001111100",
          "0011111110",
          "0111000111",
          "1110000111",
          "1100000000",
          "1100000000",
          "1110000111",
          "0111000111",
          "0011111110",
          "0001111100"],
    # 5x5 blocky C, one step per corner, S-like proportions
    "b": ["01110",
          "11011",
          "11000",
          "11011",
          "01110"],
    # 8x8 with chunkier terminals
    "c": ["00111100",
          "01111110",
          "11100111",
          "11000011",
          "11000000",
          "11000011",
          "11100111",
          "01111110",
          "00111100"],
}

if __name__ == "__main__":
    # Usage: python3 scripts/pixel_logo.py public/brand/canvasme-mark.svg
    # Variant "a" (radius 8) is the shipped mark; "b" and "c" are the alternatives considered.
    variant = sys.argv[2] if len(sys.argv) > 2 else "a"
    radii = {"a": 8, "b": 16, "c": 10}
    open(sys.argv[1], "w").write(svg(VARIANTS[variant], radii[variant]))

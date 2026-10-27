import { z } from "zod";

// Colours are hex only: they reach CSS and canvas, so never accept url() or other values.
export const Color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "Expected a hex colour");

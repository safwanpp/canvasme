import { FONTS } from "./fonts";
import { LATIN_FONT_COUNT, MALAYALAM_FONT_COUNT } from "./site";

/**
 * Long-form copy for /features and the guides, kept as data so llms-full.txt says exactly
 * what the pages say. Every claim here maps to code in src/; keep it that way.
 */

export type FeatureGroup = { id: string; title: string; items: [string, string][] };

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "text",
    title: "Text and fonts",
    items: [
      ["Built-in fonts", `${LATIN_FONT_COUNT} Latin fonts (including Inter, Geist, Montserrat, Poppins, Playfair Display, Bebas Neue and Caveat) and ${MALAYALAM_FONT_COUNT} Malayalam fonts.`],
      ["Searchable font picker", "Live previews, with filters for Latin and Malayalam fonts."],
      ["Upload your own fonts", "Add TTF, OTF, WOFF or WOFF2 files up to 15 MB. They stay in this browser, work in every design and travel inside work files."],
      ["Text styling", "Font size, colour, bold, italic, underline, alignment, letter spacing and line height. Double-click a text box to edit it in place."],
    ],
  },
  {
    id: "drawing",
    title: "Shapes, lines and drawing",
    items: [
      ["Shapes", "Square, circle, triangle, star and hexagon, with fill colour, border colour and weight, and rounded corners."],
      ["Lines and arrows", "Drag to draw a line, then set its colour and weight and add an arrow head."],
      ["Freehand drawing", "Pen, marker and highlighter in any colour and size, plus an eraser for strokes."],
      ["Sticky notes", "Drop a note on the page for ideas and reminders."],
      ["Tool strip", "Select (V), Draw (P), Eraser (E), Shape (R), Line (L), Sticky note and Text in one strip at the side of the canvas."],
    ],
  },
  {
    id: "images",
    title: "Images",
    items: [
      ["Add images", "Upload, drag in or paste PNG, JPG, GIF, WebP or AVIF images."],
      ["Background remover", "Remove the background of a photo with an AI model that runs on your device. The image is never uploaded."],
      ["Crop", "Double-click an image to crop it. Drag the handles to change the crop, or drag the picture to slide it inside the frame."],
      ["Clipping masks", "Select an image and a shape, then clip the image to the shape. Release the mask to get both back."],
      ["Eraser", "Rub out parts of an image with an erase brush that has adjustable size and softness, and paint parts back with the restore brush."],
      ["Rasterize", "Turn a selection, or a cropped, masked or rounded image, into one flat image."],
      ["Rounded corners and transparency", "Round the corners of any image and change the transparency of any element."],
    ],
  },
  {
    id: "layout",
    title: "Layout and editing",
    items: [
      ["Selection", "Click, shift-click or drag a box to select. Move, resize and rotate with handles."],
      ["Snapping", "Guides snap elements to the page and to each other while you drag. Hold Ctrl or ⌘ to skip snapping."],
      ["Layers", "Bring forward, send backward, to front or to back. Lock and hide elements."],
      ["Groups", "Group and ungroup elements to move them together."],
      ["Align to page", "Left, centre, right, top, middle or bottom."],
      ["Undo and redo", "Full undo history while you edit, plus copy, cut, paste and duplicate."],
      ["Pages", "Many pages in one design, each with its own background colour. Zoom and pan freely."],
    ],
  },
  {
    id: "files",
    title: "Saving, import, export and work files",
    items: [
      ["Autosave", "Every change is saved in this browser's IndexedDB storage a moment after you make it."],
      ["No account", "There is no sign-up, login or server copy of your designs."],
      ["Export images", "PNG or JPG at twice the design size, one page or every page as a zip."],
      ["Export PDF", "A multi-page PDF of the whole design, for print and sharing. It opens in Illustrator, with each page as an image."],
      ["Export PSD", "Download the current page as a Photoshop file with one layer per element, groups as layer folders and layer names and visibility kept. Text becomes pixel layers, not editable Photoshop text."],
      ["Open Photoshop files (.psd)", "Each pixel layer becomes an image at its place, with opacity, hidden layers and groups kept. Straight text layers become editable text boxes; fonts canvas.me doesn't have are swapped for Inter and listed. Adjustment layers, layer effects and blend modes aren't imported, and the flattened image comes along as a hidden layer when something was left out. Files up to 250 MB."],
      ["Open Illustrator (.ai) and PDF files", "Each artboard or page becomes a page of the design, as a high-resolution image. Optionally, straight lines of text become editable text boxes on top (beta). The .ai file must have been saved with “Create PDF Compatible File”, Illustrator's default. Vector shapes don't become editable shapes."],
      ["Work files", "Download a .canvasme file (a zip with the design, its images and uploaded fonts) to back up a design or move it to another device, then open it to keep editing."],
    ],
  },
  {
    id: "app",
    title: "App and devices",
    items: [
      ["Phones and tablets", "Pinch to zoom, tap to select and a bottom panel built for touch."],
      ["Install as an app", "Install canvas.me from the browser, or Add to Home Screen on iPhone and iPad. It opens in its own window."],
      ["Works offline", "After the first visit the editor works without a connection. Malayalam fonts are cached the first time a design uses them."],
      ["Open work files directly", "In the installed app on Chrome and Edge for desktop, double-click a .canvasme file to open it."],
    ],
  },
];

export const SIZES: [string, string][] = [
  ["Instagram post", "1080 × 1080 px"],
  ["Instagram story", "1080 × 1920 px"],
  ["Presentation", "1920 × 1080 px"],
  ["A4 document", "794 × 1123 px"],
  ["Poster", "1587 × 2245 px"],
  ["YouTube thumbnail", "1280 × 720 px"],
  ["Facebook cover", "1640 × 624 px"],
  ["Logo", "500 × 500 px"],
  ["Custom", "Any size from 16 to 8000 px on each side"],
];

export const SHORTCUTS: [string, string][] = [
  ["Undo / redo", "Ctrl/⌘ Z / Ctrl/⌘ Shift Z"],
  ["Copy, cut, paste, duplicate", "Ctrl/⌘ C, X, V, D"],
  ["Select all", "Ctrl/⌘ A"],
  ["Group / ungroup", "Ctrl/⌘ G / Ctrl/⌘ Shift G"],
  ["Forward / backward", "Ctrl/⌘ ] / Ctrl/⌘ [ (add Shift for front / back)"],
  ["Nudge", "Arrow keys, Shift for 10 px"],
  ["Zoom in / out / fit", "Ctrl/⌘ + / - / 0, or Ctrl/⌘ and scroll"],
  ["Pan", "Scroll, or hold Space and drag"],
  ["New text box", "T"],
  ["Select, draw, eraser, shape, line", "V, P, E, R, L (Esc goes back to select)"],
  ["Duplicate while dragging", "Hold Alt/⌥ as you start the drag"],
];

export const MALAYALAM_FONT_NAMES = FONTS.filter((f) => f.script === "malayalam").map((f) => f.family);

export const MALAYALAM_STEPS: [string, string][] = [
  ["Open the editor and pick a size", "Choose Poster (1587 × 2245 px) for print, Instagram post (1080 × 1080 px) or Story (1080 × 1920 px) for WhatsApp status and Instagram, or type a custom size."],
  ["Add a text box", "Press T or choose Text in the tool strip, then click the page."],
  ["Type or paste Malayalam", "Use the Malayalam keyboard on your phone or computer, or paste text you wrote somewhere else. canvas.me doesn't convert Manglish, so type in Malayalam script."],
  ["Choose a Malayalam font", "Open the font picker and switch the filter to Malayalam. Each font shows a live preview, so you can compare them before you pick one."],
  ["Style the poster", "Set size, colour, weight, spacing and line height, then add shapes, lines and your photos. Remove a photo's background if you need a clean cut-out."],
  ["Export", "Download a JPG or PNG to share on WhatsApp or Instagram, or a PDF for the print shop. Download a .canvasme work file too, so you can edit the poster later."],
];

export const BG_STEPS: [string, string][] = [
  ["Open the editor", "Start a new design, or open an existing one."],
  ["Add your photo", "Upload it, drag it onto the page or paste it. PNG, JPG, GIF, WebP and AVIF all work."],
  ["Select the photo and choose BG Remover", "BG Remover appears in the toolbar that opens when an image is selected."],
  ["Confirm", "The first time, canvas.me downloads the AI model once and keeps it in your browser for next time. Then it cuts out the subject."],
  ["Tidy up if you need to", "Use the eraser to rub out any leftover bits, or press Ctrl/⌘ Z to go back to the original photo."],
  ["Use or export the cut-out", "Place it on a new background colour, a shape or another photo, then export PNG, JPG or PDF."],
];

// Parametric tablet keyguard for the Vuga board (hardware/README.md). Licence CERN-OHL-P v2.
// Measure the tablet's active area and the board grid in the app, set the values below, export STL.
// Print flat, PETG or PLA, 0.2 mm layers, 3 perimeters; no supports needed.

// --- tablet (mm) ---------------------------------------------------------------------------
tablet_w   = 245;    // outer width of the tablet body
tablet_h   = 160;    // outer height
screen_x   = 12;     // left bezel: distance from body edge to active screen
screen_y   = 12;     // top bezel
screen_w   = 221;    // active screen width
screen_h   = 136;    // active screen height
corner_r   = 8;      // tablet corner radius

// --- board grid as laid out by the app at this screen size (mm) ---------------------------
strip_h    = 24;     // message strip + speak/correct row at the top of the screen
suggest_h  = 22;     // suggestion row (0 for static board)
cat_h      = 14;     // category tabs row
grid_rows  = 4;
grid_cols  = 5;
gap        = 2.5;    // gap between cells in the app
cell_r     = 3;      // cell corner radius in the app

// --- keyguard ------------------------------------------------------------------------------
thickness  = 3;      // plate thickness (2.5-4 works; thicker = more finger isolation)
lip_h      = 6;      // clip lip height wrapping the tablet edge
lip_t      = 2;      // lip wall thickness
hole_inset = 1.5;    // shrink each opening by this much per side so the ridge is visible
speak_w    = 40;     // width of the Speak opening at the right of the strip
correct_w  = 24;     // width of the correct (delete) opening

$fn = 40;

module rrect(w, h, r) { offset(r) offset(-r) square([w, h]); }

grid_y0 = strip_h + suggest_h + cat_h;                 // top of the symbol grid in screen coords
grid_h  = screen_h - grid_y0;
cell_w  = (screen_w - (grid_cols - 1) * gap) / grid_cols;
cell_h  = (grid_h  - (grid_rows - 1) * gap) / grid_rows;

module openings() {
  // message strip (left part), correct button, speak button
  translate([hole_inset, hole_inset]) rrect(screen_w - speak_w - correct_w - 2 * gap - 2 * hole_inset, strip_h - 2 * hole_inset, cell_r);
  translate([screen_w - speak_w - correct_w - gap + hole_inset, hole_inset]) rrect(correct_w - 2 * hole_inset, strip_h - 2 * hole_inset, cell_r);
  translate([screen_w - speak_w + hole_inset, hole_inset]) rrect(speak_w - 2 * hole_inset, strip_h - 2 * hole_inset, cell_r);
  // suggestions: three equal openings
  if (suggest_h > 0) for (i = [0:2])
    translate([i * (screen_w / 3) + hole_inset, strip_h + hole_inset]) rrect(screen_w / 3 - 2 * hole_inset, suggest_h - 2 * hole_inset, cell_r);
  // category row: one long slot (tabs scroll)
  translate([hole_inset, strip_h + suggest_h + hole_inset]) rrect(screen_w - 2 * hole_inset, cat_h - 2 * hole_inset, cell_r);
  // symbol cells
  for (r = [0:grid_rows - 1], c = [0:grid_cols - 1])
    translate([c * (cell_w + gap) + hole_inset, grid_y0 + r * (cell_h + gap) + hole_inset])
      rrect(cell_w - 2 * hole_inset, cell_h - 2 * hole_inset, cell_r);
}

module plate() {
  difference() {
    linear_extrude(thickness) rrect(tablet_w, tablet_h, corner_r);
    // screen openings, mirrored in y because the screen origin is top-left
    translate([screen_x, tablet_h - screen_y, -1]) mirror([0, 1, 0]) linear_extrude(thickness + 2) openings();
  }
}

module lip() {
  translate([0, 0, -lip_h]) difference() {
    linear_extrude(lip_h) rrect(tablet_w, tablet_h, corner_r);
    translate([lip_t, lip_t, -1]) linear_extrude(lip_h + 2) rrect(tablet_w - 2 * lip_t, tablet_h - 2 * lip_t, corner_r - lip_t);
    // cut-outs for charging port and buttons: adjust to the tablet
    translate([tablet_w / 2 - 15, -1, -1]) cube([30, lip_t + 2, lip_h + 2]);
  }
}

plate();
lip();

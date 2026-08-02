// This file exists specifically because electron-builder's auto-detected
// "react-cra" preset expects the Electron entry point to be here (copied
// automatically into build/electron.js by `react-scripts build`), rather
// than reading the "main" field from package.json when this preset is
// active. The real application logic lives in src/main/main.js — this
// file is just a hand-off, nothing else should be added here.
require("../src/main/main.js");

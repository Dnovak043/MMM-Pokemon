import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node
    }
  },
  {
    files: ["MMM-Pokemon.js", "lib/pk-*.js"],
    languageOptions: { globals: globals.browser }
  },
  { ignores: ["sprites/", "check/", "data/"] }
];

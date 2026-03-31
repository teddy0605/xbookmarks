import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";

export default [
  {
    files: ["src/**/*.ts"],
    plugins: { obsidianmd },
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
    rules: {
      ...obsidianmd.configs.recommended,
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          enforceCamelCaseLower: true,
          acronyms: [...DEFAULT_ACRONYMS, "LLM", "CSRF"],
          brands: [...DEFAULT_BRANDS, "LM Studio", "OpenAI", "llama.cpp"],
          ignoreWords: ["IDs"],
          ignoreRegex: ["^https?://"],
        },
      ],
    },
  },
];

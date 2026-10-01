import houseRules from "@jakubszwajka/house-rules";
import houseRulesMarkdown from "@jakubszwajka/house-rules/markdown";

export default [
	{ ignores: ["node_modules/**", "coverage/**", ".scratch/**"] },
	...houseRules.configs.recommended.map((config) => ({ ...config, files: ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.mjs", "*.mjs"] })),
	...houseRulesMarkdown,
];
